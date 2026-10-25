// RUN AMI — request orchestration, independent of Supabase.
//
// run-ami.ts hands this a `store` backed by the database RPCs in
// migration 20261018120000_rc_run_ami.sql; the tests hand it an in-memory
// store with the same contract. Everything that decides an outcome lives in
// run-ami-rules.js; everything a browser receives is built by
// run-ami-view.js. This file only sequences them:
//
//   heartbeat → load → settle the clock → validate (rules) → commit → view
//
// Concurrency: every change is ONE store.commit carrying the version it was
// computed from. The store applies it only if that is still the current
// version (rc_run_ami_commit's `where version = p_expected_version`), so of
// two simultaneous actions exactly one lands and the other comes back
// 'stale' with a fresh view. Each player action carries a client UUID; a
// replay of one that already landed is answered from current state and
// applied nothing twice.
//
// Closed test: only RUN_AMI_TESTERS (run-ami-access.js) get past the gate
// at the bottom of this file; everyone else is answered `not_invited`
// before any store call.
//
// ARMY Bomb: entry requires an active Bomb (checked inside the store's
// create/join/start RPCs, which only ever READ rc_agent_charge). Nothing in
// RUN AMI writes any charge, wallet or feed column.

import { finalResults, newMatch, publicState, resolveConfig, topCard } from './run-ami-rules.js'
import { applyAction, forfeitSeat, resolveClock } from './run-ami-actions.js'
import { viewForEntry, viewForLobby, viewForMatch, viewForSpectator } from './run-ami-view.js'
import { isRunAmiTester } from './run-ami-access.js'
import { checkRunAmiChat } from './run-ami-chat-rules.js'

// No 0, O or 1: the three a player can't tell apart when reading a code
// aloud or off a screenshot. (With 1 gone, I and L are unambiguous.)
export const ROOM_CODE_ALPHABET = 'ABCDEFGHIJKLMNPQRSTUVWXYZ23456789'
export const ROOM_CODE_RE = /^[A-NP-Z2-9]{6}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ACTION_TYPES = new Set(['play', 'draw', 'pass', 'call', 'catch'])
const LOG_LIMIT = 12
const RESULT_SHOWN_MS = 15 * 60_000
const JOIN_ATTEMPTS = { max: 12, windowSeconds: 300 }
// Room chat: the newest messages ride along with every room view; sending
// is throttled per agent (a short burst, then a per-minute ceiling).
const CHAT_SHOWN = 30
const CHAT_BURST = { max: 5, windowSeconds: 15 }
const CHAT_MINUTE = { max: 30, windowSeconds: 60 }
// Watchers: per-room cap, and how recently one must have been seen to be
// listed as watching (a watch nobody touches for WATCH_IDLE_MINUTES ends).
const MAX_WATCHERS = 20
const WATCHER_FRESH_SECONDS = 60
const WATCH_IDLE_MINUTES = 30

export function normalizeRoomCode(raw) {
  return String(raw ?? '').toUpperCase().replace(/[\s-]/g, '')
}

export function createRunAmiService({ store, now = () => Date.now(), rng, randomCode, randomTopic, allowAgent = isRunAmiTester }) {
  async function config() {
    return resolveConfig(await store.config())
  }

  function seenWithin(lastSeenAt, seconds, at) {
    return !!lastSeenAt && at - new Date(lastSeenAt).getTime() <= seconds * 1000
  }

  /** Public rows for a list of agents, in the order given. The agent number
   *  is used here to look things up and then dropped: nothing returned from
   *  this function carries it. */
  async function publicPlayers(agents, { seats, hostAgentNo, staleSeconds, at }) {
    const profiles = await store.profiles(agents.filter(Boolean))
    const seen = new Map(seats.map((s) => [s.agentNo, s.lastSeenAt]))
    return agents.map((agentNo, seat) => {
      const profile = profiles.get(agentNo) || {}
      return {
        seat,
        name: profile.name || 'AGENT',
        avatar: profile.avatar || null,
        connected: seen.has(agentNo) && seenWithin(seen.get(agentNo), staleSeconds, at),
        isHost: agentNo === hostAgentNo,
      }
    })
  }

  function commitPayload(match, next, events, { agentNo = null, actionId = null } = {}) {
    const ended = next.status !== 'active'
    return {
      matchId: match.id,
      roomId: match.roomId,
      expectedVersion: match.version,
      state: next,
      pub: publicState(next),
      status: next.status,
      deadline: next.deadline === null ? null : new Date(next.deadline).toISOString(),
      winner: next.winner,
      endReason: next.endReason,
      events,
      agentNo,
      actionId,
      final: ended ? finalResults(next) : null,
    }
  }

  /** Seats whose agent has left the room or gone quiet past the grace. */
  function goneSeats(match, seats, at) {
    const seen = new Map(seats.map((s) => [s.agentNo, s.lastSeenAt]))
    const grace = match.state.cfg.disconnectGraceSeconds
    return match.agents
      .map((agentNo, seat) => ({ agentNo, seat }))
      .filter(({ agentNo }) => !seen.has(agentNo) || !seenWithin(seen.get(agentNo), grace, at))
      .map(({ seat }) => seat)
  }

  /** Apply whatever the clock owes (timeouts, disconnect forfeits) before
   *  anything else reads or acts on the match. A stale result means another
   *  request just settled it; reload and use theirs. */
  async function settle(match, seats) {
    const at = now()
    const due = resolveClock(match.state, { now: at, rng, goneSeats: goneSeats(match, seats, at) })
    if (!due.changed) return match
    const res = await store.commit(commitPayload(match, due.state, due.events))
    if (res.ok) return { ...match, version: res.version, state: due.state, status: due.state.status }
    return store.loadMatch(match.id)
  }

  async function lastResult(room, agentNo, at) {
    return room.lastMatchId ? resultOf(room.lastMatchId, agentNo, at) : null
  }

  /** The end of one match, from `agentNo`'s side, while it is still news. */
  async function resultOf(matchId, agentNo, at) {
    const match = await store.loadMatch(matchId)
    if (!match || !match.endedAt || at - new Date(match.endedAt).getTime() > RESULT_SHOWN_MS) return null
    const winnerAgent = match.state.winner === null ? null : match.agents[match.state.winner]
    const profiles = winnerAgent ? await store.profiles([winnerAgent]) : new Map()
    const top = topCard(match.state)
    return {
      // Identifies this result, so a screen plays the round's finale once.
      matchId: String(match.id),
      endReason: match.state.endReason,
      winnerName: winnerAgent ? (profiles.get(winnerAgent)?.name || 'AGENT') : null,
      youWon: winnerAgent === agentNo && match.state.endReason === 'played_out',
      // You were the winner by any end, walkovers included — for wording only.
      youWinner: !!winnerAgent && winnerAgent === agentNo,
      winnerSeat: match.state.winner,
      // The last card on the pile: the winning card after a played-out win.
      top: top ? { c: top.c ?? null, k: String(top.k) } : null,
    }
  }

  /** Who is watching this room right now: count and codenames. Agent
   *  numbers are used to look the names up and go no further. */
  async function watcherInfo(roomId, at) {
    const rows = (await store.listWatchers(roomId))
      .filter((w) => seenWithin(w.lastSeenAt, WATCHER_FRESH_SECONDS, at))
    const profiles = await store.profiles(rows.map((w) => w.agentNo))
    return { count: rows.length, names: rows.map((w) => profiles.get(w.agentNo)?.name || 'AGENT') }
  }

  async function buildView(agentNo, roomId, settled = false) {
    const at = now()
    const cfg = await config()
    const room = await store.getRoom(roomId)
    if (!room || room.status === 'closed') return viewForEntry({ bombActive: await store.bombActive(agentNo) })
    const seats = await store.listSeats(roomId)
    const roomPublic = { code: room.code, isHost: room.hostAgentNo === agentNo, topic: room.topic, version: room.version }

    if (room.currentMatchId && !settled) {
      let match = await store.loadMatch(room.currentMatchId)
      const mySeat = match ? match.agents.indexOf(agentNo) : -1
      if (match && mySeat >= 0) {
        if (match.status === 'active') match = await settle(match, seats)
        // The match may have just ended inside settle(); if so the room is
        // back to waiting and the lobby (with this result) is the right view.
        if (match.status === 'active') {
          const players = await publicPlayers(match.agents, {
            seats, hostAgentNo: room.hostAgentNo, staleSeconds: match.state.cfg.heartbeatStaleSeconds, at,
          })
          const log = await store.recentEvents(match.id, LOG_LIMIT)
          const view = viewForMatch({
            state: match.state, seat: mySeat, players, version: match.version, now: at, log, room: roomPublic,
            watchers: await watcherInfo(roomId, at),
          })
          return { ...view, chat: await roomChat(roomId, agentNo) }
        }
        return buildView(agentNo, roomId, true)
      }
    }

    const ordered = [...seats].sort((a, b) => a.seat - b.seat)
    const agents = ordered.map((s) => s.agentNo)
    const players = await publicPlayers(agents, {
      seats, hostAgentNo: room.hostAgentNo, staleSeconds: cfg.heartbeatStaleSeconds, at,
    })
    const view = viewForLobby({
      room: roomPublic,
      players,
      mySeat: agents.indexOf(agentNo),
      bombActive: await store.bombActive(agentNo),
      lastResult: await lastResult(room, agentNo, at),
      watchers: await watcherInfo(roomId, at),
    })
    return { ...view, chat: await roomChat(roomId, agentNo) }
  }

  /** The same room from a watcher's side: the live table without anyone's
   *  cards (viewForSpectator), or the lobby with a way to sit in. Watchers
   *  settle the clock like any reader, so a table everyone is only watching
   *  still moves on when a turn runs out. */
  async function buildWatchView(agentNo, roomId, settled = false) {
    const at = now()
    const cfg = await config()
    const room = await store.getRoom(roomId)
    if (!room || room.status === 'closed') return viewForEntry({ bombActive: await store.bombActive(agentNo) })
    const seats = await store.listSeats(roomId)
    const roomPublic = { code: room.code, isHost: false, topic: room.topic, version: room.version }
    const watchers = await watcherInfo(roomId, at)

    if (room.currentMatchId && !settled) {
      let match = await store.loadMatch(room.currentMatchId)
      if (match?.status === 'active') match = await settle(match, seats)
      if (match?.status === 'active') {
        const players = await publicPlayers(match.agents, {
          seats, hostAgentNo: room.hostAgentNo, staleSeconds: match.state.cfg.heartbeatStaleSeconds, at,
        })
        const log = await store.recentEvents(match.id, LOG_LIMIT)
        const view = viewForSpectator({ state: match.state, players, version: match.version, now: at, log, room: roomPublic, watchers })
        return { ...view, chat: await roomChat(roomId, agentNo) }
      }
      // Ended inside settle(): the room is waiting again; read it fresh.
      if (match) return buildWatchView(agentNo, roomId, true)
    }

    const ordered = [...seats].sort((a, b) => a.seat - b.seat)
    const players = await publicPlayers(ordered.map((s) => s.agentNo), {
      seats, hostAgentNo: room.hostAgentNo, staleSeconds: cfg.heartbeatStaleSeconds, at,
    })
    const view = viewForLobby({
      room: roomPublic, players, mySeat: -1, bombActive: await store.bombActive(agentNo),
      lastResult: await lastResult(room, agentNo, at), watching: true, watchers,
    })
    return { ...view, chat: await roomChat(roomId, agentNo) }
  }

  /** The room's newest messages, oldest first, from the reader's side. The
   *  agent number is used only for `mine` and never leaves this function. */
  async function roomChat(roomId, agentNo) {
    const rows = await store.chatRecent(roomId, CHAT_SHOWN)
    return rows.map((m) => ({
      id: m.id, name: m.name, kind: m.kind, body: m.body, at: m.createdAt,
      mine: m.agentNo === agentNo, watching: !!m.watching,
    }))
  }

  /** Send one chat message or quick reaction into the room the agent is
   *  seated in. Nothing about the game changes. */
  async function sendChat(agentNo, params) {
    const checked = checkRunAmiChat(params?.kind === 'react' ? 'react' : 'text', params?.body)
    if (!checked.ok) return { success: false, error: 'chat_text', reason: checked.reason }
    const seat = await store.findSeat(agentNo)
    const watchRoomId = seat ? null : await store.findWatch(agentNo)
    if (!seat && !watchRoomId) return { success: false, error: 'not_in_room' }
    if (!await store.throttle(`run-ami-chat:${agentNo}`, CHAT_BURST.max, CHAT_BURST.windowSeconds)
      || !await store.throttle(`run-ami-chat-min:${agentNo}`, CHAT_MINUTE.max, CHAT_MINUTE.windowSeconds)) {
      return { success: false, error: 'chat_slow' }
    }
    const name = (await store.profiles([agentNo])).get(agentNo)?.name || 'AGENT'
    const res = await store.chatSend({ agentNo, kind: checked.kind, body: checked.body, name })
    if (!res.ok) return { success: false, error: res.error || 'server_error' }
    return { success: true, view: seat ? await buildView(agentNo, seat.roomId) : await buildWatchView(agentNo, watchRoomId) }
  }

  /** Read (and heartbeat). Called on open, on every Realtime nudge and by
   *  the polling fallback — this is also how a refresh restores everything:
   *  the seat is found from the agent, never from anything the browser kept. */
  async function getState(agentNo) {
    const cfg = await config()
    const seat = await store.touchSeat(agentNo, cfg.heartbeatStaleSeconds)
    if (seat) return { success: true, view: await buildView(agentNo, seat.roomId) }
    const watchRoomId = await store.watchTouch(agentNo, WATCH_IDLE_MINUTES)
    if (watchRoomId) return { success: true, view: await buildWatchView(agentNo, watchRoomId) }
    return { success: true, view: viewForEntry({ bombActive: await store.bombActive(agentNo), lastResult: await droppedResult(agentNo) }) }
  }

  /** An agent dropped for disconnecting loses the seat if they are still
   *  gone when the round ends. When they come back, the entry screen tells
   *  them how that round finished and why they were out of it. */
  async function droppedResult(agentNo) {
    const matchId = await store.droppedMatch(agentNo)
    if (!matchId) return null
    const r = await resultOf(matchId, agentNo, now())
    return r ? { ...r, youDropped: true } : null
  }

  async function createRoom(agentNo) {
    let res = null
    for (let attempt = 0; attempt < 6; attempt++) {
      res = await store.createRoom({ agentNo, code: randomCode(), topic: randomTopic() })
      if (res.error !== 'code_taken') break
    }
    if (!res?.ok) return { success: false, error: res?.error || 'create_failed', view: (await getState(agentNo)).view }
    return getState(agentNo)
  }

  async function joinRoom(agentNo, rawCode) {
    if (!await store.throttle(`run-ami-join:${agentNo}`, JOIN_ATTEMPTS.max, JOIN_ATTEMPTS.windowSeconds)) {
      return { success: false, error: 'rate_limited' }
    }
    const code = normalizeRoomCode(rawCode)
    if (!ROOM_CODE_RE.test(code)) return { success: false, error: 'room_not_found' }
    const res = await store.joinRoom({ agentNo, code })
    if (!res.ok) return { success: false, error: res.error || 'join_failed', view: (await getState(agentNo)).view }
    return getState(agentNo)
  }

  /** Watch the room with this code: the live table, lobby and chat, without
   *  a seat. No Bomb needed — watching powers nothing. Shares the join
   *  throttle, so codes can't be guessed faster through this door. */
  async function watchRoom(agentNo, rawCode) {
    if (!await store.throttle(`run-ami-join:${agentNo}`, JOIN_ATTEMPTS.max, JOIN_ATTEMPTS.windowSeconds)) {
      return { success: false, error: 'rate_limited' }
    }
    const code = normalizeRoomCode(rawCode)
    if (!ROOM_CODE_RE.test(code)) return { success: false, error: 'room_not_found' }
    const res = await store.watchRoom({ agentNo, code, maxWatchers: MAX_WATCHERS })
    if (!res.ok) return { success: false, error: res.error || 'watch_failed', view: (await getState(agentNo)).view }
    return getState(agentNo)
  }

  async function leaveRoom(agentNo) {
    const seat = await store.findSeat(agentNo)
    // A watcher leaving just stops watching; nothing about the game changes.
    if (!seat) { await store.unwatch({ agentNo }); return getState(agentNo) }
    const room = await store.getRoom(seat.roomId)
    if (room?.currentMatchId) {
      // Leaving mid-match is a forfeit, committed like any other action
      // (one retry if someone else's action lands in between).
      for (let attempt = 0; attempt < 2; attempt++) {
        const match = await store.loadMatch(room.currentMatchId)
        const mySeat = match ? match.agents.indexOf(agentNo) : -1
        if (!match || match.status !== 'active' || mySeat < 0 || match.state.seats[mySeat].out) break
        const { state, events } = forfeitSeat(match.state, mySeat, 'left', { now: now(), rng })
        const res = await store.commit(commitPayload(match, state, events, { agentNo }))
        if (res.ok) break
      }
    }
    await store.leaveRoom({ agentNo })
    return getState(agentNo)
  }

  async function startMatch(agentNo) {
    const seat = await store.findSeat(agentNo)
    if (!seat) return { success: false, error: 'not_in_room' }
    const room = await store.getRoom(seat.roomId)
    if (!room || room.hostAgentNo !== agentNo) return { success: false, error: 'not_host' }
    if (room.status !== 'waiting') return { success: false, error: 'already_started' }
    const agents = [...await store.listSeats(room.id)].sort((a, b) => a.seat - b.seat).map((s) => s.agentNo)
    if (agents.length < 2) return { success: false, error: 'need_players' }

    const state = newMatch({ seatCount: agents.length, rng, now: now(), config: await store.config() })
    const res = await store.startMatch({
      roomId: room.id,
      agentNo,
      roomVersion: room.version,
      agents,
      state,
      pub: publicState(state),
      deadline: new Date(state.deadline).toISOString(),
      events: [{ type: 'MATCH_STARTED', seat: null, pub: { players: agents.length }, priv: {} }],
    })
    if (!res.ok) return { success: false, error: res.error || 'start_failed', view: (await getState(agentNo)).view }
    return getState(agentNo)
  }

  async function act(agentNo, params) {
    const type = String(params?.type || '')
    if (!ACTION_TYPES.has(type)) return { success: false, error: 'unknown_action' }
    const actionId = String(params?.actionId || '')
    if (!UUID_RE.test(actionId)) return { success: false, error: 'action_id_required' }

    const cfg = await config()
    const seat = await store.touchSeat(agentNo, cfg.heartbeatStaleSeconds)
    if (!seat) return { success: false, error: 'not_in_room' }
    const room = await store.getRoom(seat.roomId)
    if (!room?.currentMatchId) return { success: false, error: 'no_active_match', view: await buildView(agentNo, seat.roomId) }

    let match = await store.loadMatch(room.currentMatchId)
    const mySeat = match ? match.agents.indexOf(agentNo) : -1
    if (mySeat < 0) return { success: false, error: 'not_in_match', view: await buildView(agentNo, seat.roomId) }

    // A retry of an action that already landed: report success, change nothing.
    if (await store.hasAction(match.id, agentNo, actionId)) {
      return { success: true, duplicate: true, view: await buildView(agentNo, seat.roomId) }
    }

    match = await settle(match, await store.listSeats(room.id))
    if (match.status !== 'active') {
      return { success: false, error: 'match_over', view: await buildView(agentNo, seat.roomId) }
    }

    // CAUGHT! spam: one attempt per cooldown. A throttled attempt answers
    // exactly like an empty one, so spam reveals nothing and costs nothing.
    if (type === 'catch' && !await store.throttle(`run-ami-catch:${match.id}:${agentNo}`, 1, match.state.cfg.catchCooldownMs / 1000)) {
      return { success: true, reply: { caught: false }, view: await buildView(agentNo, seat.roomId) }
    }

    const result = applyAction(match.state, mySeat, {
      type, cardId: params.cardId, color: params.color, runAmi: params.runAmi === true,
    }, { now: now(), rng })
    if (!result.ok) return { success: false, error: result.error, view: await buildView(agentNo, seat.roomId) }
    if (!result.changed) return { success: true, reply: result.reply, view: await buildView(agentNo, seat.roomId) }

    const res = await store.commit(commitPayload(match, result.state, result.events, { agentNo, actionId }))
    if (!res.ok && res.reason === 'duplicate') {
      return { success: true, duplicate: true, view: await buildView(agentNo, seat.roomId) }
    }
    if (!res.ok) {
      return { success: false, error: res.reason === 'stale' ? 'stale' : 'server_error', view: await buildView(agentNo, seat.roomId) }
    }
    return { success: true, reply: result.reply, view: await buildView(agentNo, seat.roomId) }
  }

  /** Cron: close idle waiting rooms, then settle every match the clock owes
   *  something to — including matches nobody is polling any more. */
  async function sweep() {
    const cfg = await config()
    const closedRooms = await store.expireRooms(cfg.roomIdleMinutes)
    let settled = 0
    for (const matchId of await store.dueMatches(cfg.disconnectGraceSeconds)) {
      const match = await store.loadMatch(matchId)
      if (!match || match.status !== 'active') continue
      const after = await settle(match, await store.listSeats(match.roomId))
      if (after.version !== match.version) settled++
    }
    return { success: true, closedRooms, settled }
  }

  // Every player route checks the agent first. Internal calls between these
  // functions (createRoom → getState) use the ungated versions.
  // allowAgent may answer now or later (run-ami.ts asks the Album).
  const gate = (fn) => async (agentNo, ...rest) =>
    ((await allowAgent(agentNo)) ? fn(agentNo, ...rest) : { success: false, error: 'not_invited' })

  return {
    getState: gate(getState),
    createRoom: gate(createRoom),
    joinRoom: gate(joinRoom),
    watchRoom: gate(watchRoom),
    leaveRoom: gate(leaveRoom),
    startMatch: gate(startMatch),
    act: gate(act),
    sendChat: gate(sendChat),
    sweep,
  }
}
