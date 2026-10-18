// In-memory stand-in for the RUN AMI database, for node --test only.
//
// Mirrors the contract of the RPCs in 20261018120000_rc_run_ami.sql closely
// enough to test the service's concurrency and privacy behaviour: a commit
// lands only at the expected version, (match, agent, action_id) is unique,
// one open seat per agent, the Bomb gate reads charge and never writes it.
// Every read and write round-trips through JSON (as the database does) and
// yields to the event loop, so two requests started together really do
// interleave.

const tick = () => new Promise((resolve) => setImmediate(resolve))
const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createTestStore({ clock, agents, config = {} }) {
  // agents: { AGENT012: { codename, avatar, chargedUntil (ms|null), lastFedAt, autoFeed, chargeCells } }
  const charge = new Map(Object.entries(agents).map(([no, a]) => [no, {
    charged_until: a.chargedUntil == null ? null : new Date(a.chargedUntil).toISOString(),
    last_fed_at: a.lastFedAt || '2026-10-10T00:00:00.000Z',
    auto_feed: !!a.autoFeed,
    blackout_started_at: null,
  }]))
  const wallets = new Map(Object.entries(agents).map(([no, a]) => [no, { charge_cells: a.chargeCells ?? 3 }]))
  const rooms = new Map()
  const seats = []
  const matches = new Map()
  const events = []
  const broadcasts = []
  const throttleHits = []
  let nextId = 1
  const iso = () => new Date(clock.now).toISOString()

  const bombActive = (agentNo) => {
    const row = charge.get(agentNo)
    return !!row?.charged_until && new Date(row.charged_until).getTime() > clock.now
  }
  const openSeat = (agentNo) => seats.find((s) => s.agentNo === agentNo && !s.leftAt)
  const notify = (roomId) => {
    const room = rooms.get(roomId)
    const match = room.currentMatchId ? matches.get(room.currentMatchId) : null
    broadcasts.push({ topic: `run-ami:${room.topic}`, payload: { r: room.version, v: match ? match.version : null } })
  }
  const releaseSeat = (roomId, agentNo) => {
    const s = seats.find((x) => x.roomId === roomId && x.agentNo === agentNo && !x.leftAt)
    if (!s) return
    s.leftAt = iso()
    const room = rooms.get(roomId)
    const next = seats.filter((x) => x.roomId === roomId && !x.leftAt).sort((a, b) => a.seat - b.seat)[0]
    if (!next && !room.currentMatchId) room.status = 'closed'
    else if (room.hostAgentNo === agentNo && next) room.hostAgentNo = next.agentNo
    room.version++
    notify(roomId)
  }

  const store = {
    async config() { await tick(); return copy(config) },
    async profiles(agentNos) {
      await tick()
      return new Map(agentNos.map((no) => [no, { name: agents[no]?.codename || 'AGENT', avatar: agents[no]?.avatar || null }]))
    },
    async bombActive(agentNo) { await tick(); return bombActive(agentNo) },
    async touchSeat(agentNo, staleSeconds) {
      await tick()
      const s = openSeat(agentNo)
      if (!s) return null
      const wasStale = clock.now - new Date(s.lastSeenAt).getTime() > staleSeconds * 1000
      s.lastSeenAt = iso()
      return { roomId: s.roomId, wasStale }
    },
    async findSeat(agentNo) {
      await tick()
      const s = openSeat(agentNo)
      return s ? { roomId: s.roomId, seat: s.seat } : null
    },
    async getRoom(roomId) { await tick(); return copy(rooms.get(roomId)) || null },
    async listSeats(roomId) {
      await tick()
      return copy(seats.filter((s) => s.roomId === roomId && !s.leftAt)
        .map((s) => ({ agentNo: s.agentNo, seat: s.seat, lastSeenAt: s.lastSeenAt })))
    },
    async createRoom({ agentNo, code, topic }) {
      await tick()
      if (!bombActive(agentNo)) return { ok: false, error: 'bomb_dark' }
      if (openSeat(agentNo)) return { ok: false, error: 'already_seated' }
      if ([...rooms.values()].some((r) => r.code === code && r.status !== 'closed')) return { ok: false, error: 'code_taken' }
      const id = `room-${nextId++}`
      rooms.set(id, { id, code, hostAgentNo: agentNo, status: 'waiting', topic, version: 1, currentMatchId: null, lastMatchId: null })
      seats.push({ roomId: id, agentNo, seat: 0, lastSeenAt: iso(), leftAt: null })
      return { ok: true, room_id: id }
    },
    async joinRoom({ agentNo, code }) {
      await tick()
      if (!bombActive(agentNo)) return { ok: false, error: 'bomb_dark' }
      const room = [...rooms.values()].find((r) => r.code === code && r.status !== 'closed')
      if (!room) return { ok: false, error: 'room_not_found' }
      const mine = openSeat(agentNo)
      if (mine?.roomId === room.id) return { ok: true, room_id: room.id, already: true }
      if (mine) return { ok: false, error: 'already_seated' }
      if (room.status !== 'waiting') return { ok: false, error: 'room_in_match' }
      const taken = new Set(seats.filter((s) => s.roomId === room.id && !s.leftAt).map((s) => s.seat))
      const free = [0, 1, 2, 3].find((n) => !taken.has(n))
      if (free === undefined) return { ok: false, error: 'room_full' }
      seats.push({ roomId: room.id, agentNo, seat: free, lastSeenAt: iso(), leftAt: null })
      room.version++
      notify(room.id)
      return { ok: true, room_id: room.id }
    },
    async leaveRoom({ agentNo }) {
      await tick()
      const s = openSeat(agentNo)
      if (s) releaseSeat(s.roomId, agentNo)
      return { ok: true }
    },
    async startMatch(p) {
      await tick()
      const room = rooms.get(p.roomId)
      if (!room || room.status === 'closed') return { ok: false, error: 'room_not_found' }
      if (room.hostAgentNo !== p.agentNo) return { ok: false, error: 'not_host' }
      if (room.status !== 'waiting') return { ok: false, error: 'already_started' }
      const seated = seats.filter((s) => s.roomId === room.id && !s.leftAt).sort((a, b) => a.seat - b.seat).map((s) => s.agentNo)
      if (room.version !== p.roomVersion || JSON.stringify(seated) !== JSON.stringify(p.agents)) return { ok: false, error: 'stale' }
      if (p.agents.some((a) => !bombActive(a))) return { ok: false, error: 'bomb_dark' }
      const id = `match-${nextId++}`
      matches.set(id, {
        id, roomId: room.id, status: 'active', version: 1, endedAt: null,
        state: copy(p.state), pub: copy(p.pub), agents: [...p.agents], final: null,
      })
      p.events.forEach((e, i) => events.push({ id: nextId++, matchId: id, agentNo: p.agentNo, actionId: null, ord: i + 1, ...copy(e) }))
      room.status = 'in_match'
      room.currentMatchId = id
      room.version++
      notify(room.id)
      return { ok: true, match_id: id, version: 1 }
    },
    async loadMatch(matchId) {
      await tick()
      const m = matches.get(matchId)
      return m ? copy({ id: m.id, roomId: m.roomId, status: m.status, version: m.version, endedAt: m.endedAt, state: m.state, agents: m.agents }) : null
    },
    async hasAction(matchId, agentNo, actionId) {
      await tick()
      return events.some((e) => e.matchId === matchId && e.agentNo === agentNo && e.actionId === actionId)
    },
    async commit(p) {
      await tick()
      if (p.actionId && events.some((e) => e.matchId === p.matchId && e.agentNo === p.agentNo && e.actionId === p.actionId)) {
        return { ok: false, reason: 'duplicate' }
      }
      const m = matches.get(p.matchId)
      if (!m || m.version !== p.expectedVersion || m.status !== 'active') return { ok: false, reason: 'stale' }
      m.version++
      m.state = copy(p.state)
      m.pub = copy(p.pub)
      m.status = p.status
      p.events.forEach((e, i) => events.push({
        id: nextId++, matchId: m.id, agentNo: p.agentNo, actionId: i === 0 ? p.actionId : null, ord: i + 1, ...copy(e),
      }))
      if (p.status !== 'active') {
        m.endedAt = iso()
        m.final = copy(p.final)
        const room = rooms.get(m.roomId)
        room.status = 'waiting'
        room.currentMatchId = null
        room.lastMatchId = m.id
        room.version++
        // Only seats still quiet now: an agent who came back (and is
        // watching as a spectator) keeps their seat and sees the result.
        const stale = (m.state.cfg?.heartbeatStaleSeconds ?? 15) * 1000
        for (const f of p.final) {
          if (f.forfeit_reason !== 'disconnect') continue
          const s = openSeat(m.agents[f.seat])
          if (s && clock.now - new Date(s.lastSeenAt).getTime() < stale) continue
          releaseSeat(room.id, m.agents[f.seat])
        }
      }
      notify(m.roomId)
      return { ok: true, version: m.version }
    },
    // Most recent ended match this agent was dropped from for disconnecting.
    async droppedMatch(agentNo) {
      await tick()
      const hit = [...matches.values()]
        .filter((m) => m.endedAt && (m.final || []).some((f) => m.agents[f.seat] === agentNo && f.forfeit_reason === 'disconnect'))
        .sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt))[0]
      return hit ? hit.id : null
    },
    async recentEvents(matchId, limit) {
      await tick()
      return copy(events.filter((e) => e.matchId === matchId).slice(-limit)
        .map((e) => ({ seq: e.id, type: e.type, seat: e.seat, pub: e.pub })))
    },
    async throttle(bucket, max, windowSeconds) {
      await tick()
      const since = clock.now - windowSeconds * 1000
      const recent = throttleHits.filter((h) => h.bucket === bucket && h.at >= since).length
      if (recent >= max) return false
      throttleHits.push({ bucket, at: clock.now })
      return true
    },
    async expireRooms(idleMinutes) {
      await tick()
      let n = 0
      for (const room of rooms.values()) {
        if (room.status !== 'waiting') continue
        const live = seats.some((s) => s.roomId === room.id && !s.leftAt
          && clock.now - new Date(s.lastSeenAt).getTime() < idleMinutes * 60_000)
        if (live) continue
        room.status = 'closed'
        for (const s of seats) if (s.roomId === room.id && !s.leftAt) s.leftAt = iso()
        n++
      }
      return n
    },
    async dueMatches() {
      await tick()
      return [...matches.values()].filter((m) => m.status === 'active').map((m) => m.id)
    },
  }

  return {
    store,
    inspect: { charge, wallets, rooms, seats, matches, events, broadcasts },
    setLastSeen(agentNo, ms) { const s = openSeat(agentNo); if (s) s.lastSeenAt = new Date(ms).toISOString() },
  }
}
