import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { createRunAmiService, normalizeRoomCode, ROOM_CODE_RE } from './run-ami-service.js'
import { createTestStore, mulberry32 } from './run-ami-test-store.mjs'

const T0 = Date.parse('2026-10-11T12:00:00Z')
const HOUR = 3600_000
const AGENTS = ['AGENT012', 'AGENT034', 'AGENT056', 'AGENT078', 'AGENT090']

function setup({ dark = [], seed = 5 } = {}) {
  const clock = { now: T0 }
  const agents = Object.fromEntries(AGENTS.map((no, i) => [no, {
    codename: `Codename${i}`,
    avatar: i % 2 ? `https://example.test/storage/v1/object/public/badge-art/vault/t${i}/a.webp` : null,
    chargedUntil: dark.includes(no) ? (no === 'AGENT090' ? null : T0 - HOUR) : T0 + 20 * HOUR,
    chargeCells: 4,
    autoFeed: i % 2 === 0,
  }]))
  const db = createTestStore({ clock, agents })
  let codeSeq = 0
  const svc = createRunAmiService({
    store: db.store,
    now: () => clock.now,
    rng: mulberry32(seed),
    randomCode: () => ['AMI7K2', 'RUNAM2', 'LASTC4', 'PQRS23'][codeSeq++ % 4],
    randomTopic: () => 'x'.repeat(40) + codeSeq,
  })
  return { clock, db, svc }
}

const act = (svc, agentNo, type, extra = {}) => svc.act(agentNo, { type, actionId: randomUUID(), ...extra })

async function startedRoom(n = 3, opts) {
  const ctx = setup(opts)
  const host = AGENTS[0]
  const created = await ctx.svc.createRoom(host)
  assert.equal(created.success, true, JSON.stringify(created))
  const code = created.view.room.code
  for (const a of AGENTS.slice(1, n)) assert.equal((await ctx.svc.joinRoom(a, code)).success, true)
  const started = await ctx.svc.startMatch(host)
  assert.equal(started.success, true, JSON.stringify(started))
  return { ...ctx, code, players: AGENTS.slice(0, n) }
}

async function views(svc, players) {
  const out = {}
  for (const a of players) out[a] = (await svc.getState(a)).view
  return out
}

function chargeSnapshot(db) {
  return JSON.stringify({ charge: [...db.inspect.charge], wallets: [...db.inspect.wallets] })
}

// ── Entry and the ARMY Bomb gate ──────────────────────────────────────

test('not in a room: entry view with this agent\'s Bomb state', async () => {
  const { svc } = setup({ dark: ['AGENT034'] })
  assert.deepEqual((await svc.getState('AGENT012')).view, { phase: 'entry', me: { bombActive: true } })
  assert.deepEqual((await svc.getState('AGENT034')).view, { phase: 'entry', me: { bombActive: false } })
})

test('a dark Bomb cannot create or join; an active Bomb can', async () => {
  const { svc } = setup({ dark: ['AGENT034', 'AGENT090'] })
  assert.equal((await svc.createRoom('AGENT034')).error, 'bomb_dark')
  const created = await svc.createRoom('AGENT012')
  assert.equal(created.success, true)
  assert.equal((await svc.joinRoom('AGENT034', created.view.room.code)).error, 'bomb_dark')
  // never fed at all counts as dark too
  assert.equal((await svc.joinRoom('AGENT090', created.view.room.code)).error, 'bomb_dark')
  assert.equal((await svc.joinRoom('AGENT056', created.view.room.code)).success, true)
})

test('a Bomb that goes dark in the lobby blocks the start', async () => {
  const { svc, db } = setup()
  const created = await svc.createRoom('AGENT012')
  await svc.joinRoom('AGENT034', created.view.room.code)
  db.inspect.charge.get('AGENT034').charged_until = new Date(T0 - 1).toISOString()
  assert.equal((await svc.startMatch('AGENT012')).error, 'bomb_dark')
})

test('entering and playing never alter charged_until, last_fed_at, auto_feed or Charge Cells', async () => {
  const { svc, db, clock, players } = await startedRoom(3)
  const before = chargeSnapshot(db)
  for (let i = 0; i < 40; i++) {
    clock.now += 1000
    const seat = (await svc.getState(players[0])).view.table.turn
    const agent = players[seat]
    const v = (await svc.getState(agent)).view
    if (v.me.playable.length) await act(svc, agent, 'play', { cardId: v.me.playable[0], color: 'r' })
    else await act(svc, agent, 'draw')
    await act(svc, players[(seat + 1) % 3], 'catch')
    if ((await svc.getState(agent)).view.phase !== 'match') break
  }
  await svc.leaveRoom(players[2])
  assert.equal(chargeSnapshot(db), before)
})

// ── Rooms ─────────────────────────────────────────────────────────────

test('room codes are 6 readable characters; join normalises case and spaces', async () => {
  assert.ok(ROOM_CODE_RE.test('AMI7K2'))
  assert.ok(!ROOM_CODE_RE.test('AMI0K1')) // 0 and 1 are not in the alphabet
  assert.equal(normalizeRoomCode(' ami 7k2 '), 'AMI7K2')
  const { svc } = setup()
  const created = await svc.createRoom('AGENT012')
  const joined = await svc.joinRoom('AGENT034', ' ami7k2 ')
  assert.equal(joined.success, true)
  assert.equal(joined.view.room.code, created.view.room.code)
  assert.equal((await svc.joinRoom('AGENT056', 'ZZZZZZ')).error, 'room_not_found')
})

test('waiting room: 2–4 players, host-only start, one room per agent', async () => {
  const { svc } = setup()
  const { view } = await svc.createRoom('AGENT012')
  assert.equal(view.phase, 'lobby')
  assert.equal(view.room.isHost, true)
  assert.equal(view.room.canStart, false)
  assert.equal((await svc.startMatch('AGENT012')).error, 'need_players')
  for (const a of ['AGENT034', 'AGENT056', 'AGENT078']) assert.equal((await svc.joinRoom(a, view.room.code)).success, true)
  assert.equal((await svc.joinRoom('AGENT090', view.room.code)).error, 'room_full')
  // joining twice is idempotent; joining a second room is refused
  assert.equal((await svc.joinRoom('AGENT034', view.room.code)).success, true)
  assert.equal((await svc.createRoom('AGENT034')).error, 'already_seated')
  assert.equal((await svc.startMatch('AGENT034')).error, 'not_host')
  const lobby = (await svc.getState('AGENT034')).view
  assert.equal(lobby.players.length, 4)
  assert.equal(lobby.room.canStart, false)
  assert.equal((await svc.startMatch('AGENT012')).success, true)
})

test('a fifth agent cannot join a full room', async () => {
  const { svc, db } = setup()
  db.inspect.charge.get('AGENT090').charged_until = new Date(T0 + HOUR).toISOString()
  const { view } = await svc.createRoom('AGENT012')
  for (const a of ['AGENT034', 'AGENT056', 'AGENT078']) await svc.joinRoom(a, view.room.code)
  assert.equal((await svc.joinRoom('AGENT090', view.room.code)).error, 'room_full')
})

test('join attempts are rate limited (code guessing)', async () => {
  const { svc } = setup()
  let last
  for (let i = 0; i < 13; i++) last = await svc.joinRoom('AGENT012', 'ZZZZZ' + 'ABCDEFGHJKMNP'[i])
  assert.equal(last.error, 'rate_limited')
})

test('host leaving the lobby hands the room on; last one out closes it', async () => {
  const { svc } = setup()
  const { view } = await svc.createRoom('AGENT012')
  await svc.joinRoom('AGENT034', view.room.code)
  await svc.leaveRoom('AGENT012')
  const v = (await svc.getState('AGENT034')).view
  assert.equal(v.room.isHost, true)
  await svc.leaveRoom('AGENT034')
  assert.equal((await svc.getState('AGENT034')).view.phase, 'entry')
  assert.equal((await svc.joinRoom('AGENT056', view.room.code)).error, 'room_not_found')
})

// ── Privacy ───────────────────────────────────────────────────────────

test('no seat ever receives another seat\'s card ids; no agent number anywhere', async () => {
  const { svc, db, clock, players } = await startedRoom(4)
  for (let round = 0; round < 25; round++) {
    const all = await views(svc, players)
    const match = [...db.inspect.matches.values()][0]
    if (all[players[0]].phase !== 'match') break
    for (const [agent, v] of Object.entries(all)) {
      const json = JSON.stringify(v)
      for (const a of AGENTS) assert.ok(!json.includes(a), `agent number ${a} leaked to ${agent}`)
      const mySeat = v.me.seat
      match.state.seats.forEach((s, i) => {
        if (i === mySeat) return
        for (const c of s.hand) assert.ok(!json.includes(c.id), `seat ${i} card leaked to seat ${mySeat}`)
      })
      for (const c of match.state.draw) assert.ok(!json.includes(c.id), 'draw pile card leaked')
      // opponents are counts only
      for (const p of v.players) {
        assert.deepEqual(Object.keys(p).sort(), ['avatar', 'cards', 'connected', 'isHost', 'isMe', 'isTurn', 'name', 'out', 'seat'])
      }
    }
    clock.now += 1000
    const turnAgent = players[all[players[0]].table.turn]
    const v = all[turnAgent]
    if (v.me.playable.length) await act(svc, turnAgent, 'play', { cardId: v.me.playable[0], color: 'y' })
    else await act(svc, turnAgent, 'draw')
  }
})

test('the public log carries no drawn card identities', async () => {
  const { svc, players } = await startedRoom(2)
  const v = (await svc.getState(players[0])).view
  const turnAgent = players[v.table.turn]
  await act(svc, turnAgent, 'draw')
  const other = players[1 - v.table.turn]
  const seen = (await svc.getState(other)).view
  const drawn = seen.log.filter((e) => e.type === 'CARD_DRAWN')
  assert.ok(drawn.length >= 1)
  for (const e of drawn) {
    assert.equal(e.card, undefined)
    assert.equal(e.cardIds, undefined)
  }
})

test('Realtime payloads are version numbers only', async () => {
  const { svc, db, players } = await startedRoom(3)
  const v = (await svc.getState(players[0])).view
  const turnAgent = players[v.table.turn]
  await act(svc, turnAgent, 'draw')
  assert.ok(db.inspect.broadcasts.length > 3)
  for (const b of db.inspect.broadcasts) {
    assert.deepEqual(Object.keys(b.payload).sort(), ['r', 'v'])
    for (const value of Object.values(b.payload)) assert.ok(value === null || Number.isInteger(value))
  }
  // seated players learn the topic from their own view; it is the room's
  assert.equal(`run-ami:${v.room.topic}`, db.inspect.broadcasts[0].topic)
})

// ── Concurrency, idempotency, reconnect ──────────────────────────────

test('simultaneous actions: exactly one lands, the other is stale', async () => {
  const { svc, db, players } = await startedRoom(2)
  const v = (await svc.getState(players[0])).view
  const turnAgent = players[v.table.turn]
  const before = [...db.inspect.matches.values()][0].version
  const [a, b] = await Promise.all([act(svc, turnAgent, 'draw'), act(svc, turnAgent, 'draw')])
  const outcomes = [a, b].map((r) => (r.success ? 'ok' : r.error)).sort()
  // Both requests loaded the same version before either committed, so the
  // second is rejected by the version check itself, not by the rules.
  assert.deepEqual(outcomes, ['ok', 'stale'])
  assert.equal([...db.inspect.matches.values()][0].version, before + 1)
})

test('duplicate request (same action UUID) applies once', async () => {
  const { svc, db, players } = await startedRoom(2)
  const v = (await svc.getState(players[0])).view
  const turnAgent = players[v.table.turn]
  const actionId = randomUUID()
  const first = await svc.act(turnAgent, { type: 'draw', actionId })
  const again = await svc.act(turnAgent, { type: 'draw', actionId })
  assert.equal(first.success, true)
  assert.equal(again.success, true)
  assert.equal(again.duplicate, true)
  const draws = db.inspect.events.filter((e) => e.type === 'CARD_DRAWN' && e.actionId === actionId)
  assert.equal(draws.length, 1)
})

test('simultaneous draw and catch on the same version: one lands, the other is stale', async () => {
  const { svc, db, clock, agent, players } = await oneCardSituation({ callInPlay: false })
  clock.now += 2500
  for (const a of players) db.setLastSeen(a, clock.now)
  const match = [...db.inspect.matches.values()][0]
  const before = match.version
  const nextAgent = players[match.state.turn]
  const catcher = players.find((a) => a !== nextAgent && a !== agent)
  const [draw, caught] = await Promise.all([act(svc, nextAgent, 'draw'), act(svc, catcher, 'catch')])
  const landed = [draw.success, caught.reply?.caught === true].filter(Boolean).length
  assert.equal(landed, 1, JSON.stringify({ draw: draw.error || 'ok', catch: caught.reply || caught.error }))
  assert.equal([...db.inspect.matches.values()][0].version, before + 1)
  assert.ok(draw.success || draw.error === 'stale')
})

test('concurrent identical requests (same UUID) also apply once', async () => {
  const { svc, db, players } = await startedRoom(2)
  const v = (await svc.getState(players[0])).view
  const turnAgent = players[v.table.turn]
  const actionId = randomUUID()
  await Promise.all([svc.act(turnAgent, { type: 'draw', actionId }), svc.act(turnAgent, { type: 'draw', actionId })])
  assert.equal(db.inspect.events.filter((e) => e.type === 'CARD_DRAWN' && e.matchId).length, 1)
})

test('an action without a UUID is refused', async () => {
  const { svc, players } = await startedRoom(2)
  assert.equal((await svc.act(players[0], { type: 'draw' })).error, 'action_id_required')
})

test('refresh/reconnect restores room, hand, turn, colour, direction, counts and timer', async () => {
  const { svc, players } = await startedRoom(3)
  const v = (await svc.getState(players[0])).view
  const turnAgent = players[v.table.turn]
  const tv = (await svc.getState(turnAgent)).view
  if (tv.me.playable.length) await act(svc, turnAgent, 'play', { cardId: tv.me.playable[0], color: 'b' })
  else await act(svc, turnAgent, 'draw')
  const a = (await svc.getState(players[1])).view
  const b = (await svc.getState(players[1])).view // "refresh": nothing kept client-side
  assert.deepEqual(b.me.hand, a.me.hand)
  assert.deepEqual(b.table, a.table)
  assert.deepEqual(b.players.map((p) => p.cards), a.players.map((p) => p.cards))
  assert.equal(b.room.code, a.room.code)
  assert.equal(b.version, a.version)
})

test('players cannot act out of turn or with cards they do not hold', async () => {
  const { svc, players } = await startedRoom(3)
  const all = await views(svc, players)
  const turn = all[players[0]].table.turn
  const waiting = players[(turn + 1) % 3]
  assert.equal((await act(svc, waiting, 'draw')).error, 'not_your_turn')
  const turnAgent = players[turn]
  const someoneElsesCard = all[waiting].me.hand[0].id
  assert.equal((await act(svc, turnAgent, 'play', { cardId: someoneElsesCard })).error, 'card_not_in_hand')
})

test('a brief disconnect shows Reconnecting… but does not forfeit', async () => {
  const { svc, db, clock, players } = await startedRoom(3)
  db.setLastSeen(players[2], clock.now)
  clock.now += 20_000 // past the 15s heartbeat, well inside the 90s grace
  for (const a of players.slice(0, 2)) await svc.getState(a)
  const v = (await svc.getState(players[0])).view
  const p2 = v.players.find((p) => p.seat === 2)
  assert.equal(p2.connected, false)
  assert.equal(p2.out, false)
  // and they come back
  const back = (await svc.getState(players[2])).view
  assert.equal(back.phase, 'match')
  assert.equal(back.me.out, false)
  assert.ok(db.inspect.events.length > 0)
})

test('gone past the grace: the seat forfeits; down to one player is last_standing', async () => {
  const { svc, clock, db, players } = await startedRoom(2)
  db.setLastSeen(players[1], clock.now)
  clock.now += 95_000
  const v = (await svc.getState(players[0])).view
  assert.equal(v.phase, 'lobby')
  assert.equal(v.lastResult.endReason, 'last_standing')
  assert.equal(v.lastResult.youWon, false)
  const match = [...db.inspect.matches.values()][0]
  assert.equal(match.status, 'finished')
  assert.equal(match.final.find((f) => f.seat === 0).result, 'last_standing')
  assert.ok(match.final.every((f) => f.result !== 'won'))
})

test('everyone gone: the sweep abandons the match with no winner', async () => {
  const { svc, clock, db } = await startedRoom(3)
  clock.now += 10 * 60_000
  const r = await svc.sweep()
  assert.equal(r.success, true)
  const match = [...db.inspect.matches.values()][0]
  assert.equal(match.status, 'abandoned')
  assert.equal(match.state.winner, null)
  assert.ok(match.final.every((f) => f.result === 'forfeited'))
})

test('timer: an expired turn resolves on the next request', async () => {
  const { svc, clock, db, players } = await startedRoom(3)
  for (const a of players) await svc.getState(a)
  const before = (await svc.getState(players[0])).view
  clock.now += 31_000
  for (const a of players) db.setLastSeen(a, clock.now)
  const after = (await svc.getState(players[0])).view
  assert.notEqual(after.table.turn, before.table.turn)
  assert.ok(after.log.some((e) => e.type === 'TURN_TIMEOUT'))
})

test('leaving mid-match forfeits that seat only', async () => {
  const { svc, players } = await startedRoom(3)
  await svc.leaveRoom(players[2])
  const v = (await svc.getState(players[0])).view
  assert.equal(v.phase, 'match')
  assert.equal(v.players.find((p) => p.seat === 2).out, true)
  assert.equal((await svc.getState(players[2])).view.phase, 'entry')
})

/** Seat 2 goes quiet past the grace and is forfeited for disconnecting;
 *  the other two stay live. */
async function droppedSeatTwo() {
  const ctx = await startedRoom(3)
  const { svc, db, clock, players } = ctx
  db.setLastSeen(players[2], clock.now)
  clock.now += 95_000
  for (const a of players.slice(0, 2)) db.setLastSeen(a, clock.now)
  const v = (await svc.getState(players[0])).view
  assert.equal(v.players.find((p) => p.seat === 2).out, true)
  return ctx
}

test('a dropped agent who comes back watches, told why they are out', async () => {
  const { svc, players } = await droppedSeatTwo()
  const back = (await svc.getState(players[2])).view
  assert.equal(back.phase, 'match')
  assert.equal(back.me.out, true)
  assert.equal(back.me.outReason, 'disconnect')
  assert.equal((await svc.getState(players[0])).view.me.outReason, null)
})

test('a dropped agent who came back keeps the seat and sees the result', async () => {
  const { svc, players, db } = await droppedSeatTwo()
  await svc.getState(players[2]) // back, watching
  await svc.leaveRoom(players[1]) // down to one: seat 0 is last standing
  const watcher = (await svc.getState(players[2])).view
  assert.equal(watcher.phase, 'lobby')
  assert.equal(watcher.lastResult.endReason, 'last_standing')
  assert.equal(watcher.lastResult.winnerSeat, 0)
  assert.equal(watcher.lastResult.youWinner, false)
  assert.ok(watcher.players.some((p) => p.isMe), 'still seated in the room')
  const winner = (await svc.getState(players[0])).view
  assert.equal(winner.lastResult.youWinner, true)
  assert.equal(winner.lastResult.youWon, false, 'a walkover is not a played-out win')
  assert.equal(winner.lastResult.matchId, watcher.lastResult.matchId)
  assert.equal(db.inspect.seats.filter((s) => !s.leftAt).length, 2)
})

test('a dropped agent still gone when the round ends loses the seat', async () => {
  const { svc, players } = await droppedSeatTwo()
  await svc.leaveRoom(players[1])
  const host = (await svc.getState(players[0])).view
  assert.equal(host.phase, 'lobby')
  assert.equal(host.players.length, 1)
  const gone = (await svc.getState(players[2])).view
  assert.equal(gone.phase, 'entry')
  // Coming back after the end: told how it went and why they were out.
  assert.equal(gone.lastResult.youDropped, true)
  assert.equal(gone.lastResult.endReason, 'last_standing')
  assert.equal(gone.lastResult.winnerSeat, 0)
})

test('the dropped-round note is only for agents dropped for disconnecting', async () => {
  const { svc, players } = await droppedSeatTwo()
  await svc.leaveRoom(players[1]) // left on purpose: no note for them
  assert.equal((await svc.getState(players[1])).view.lastResult, undefined)
})

test('a played-out win hands every seat the winning card for the finale', async () => {
  const { svc, db, clock, players } = await startedRoom(3)
  const match = [...db.inspect.matches.values()][0]
  const s = match.state
  const turn = s.turn
  s.seats[turn].hand = [{ id: 'last', c: s.color, k: '4' }]
  s.drewThisTurn = false
  clock.now += 500
  const r = await act(svc, players[turn], 'play', { cardId: 'last' })
  assert.equal(r.success, true, JSON.stringify(r))
  assert.equal(r.view.phase, 'lobby')
  assert.equal(r.view.lastResult.youWon, true)
  assert.deepEqual(r.view.lastResult.top, { c: s.color, k: '4' })
  assert.equal(r.view.lastResult.winnerSeat, turn)
  const other = (await svc.getState(players[(turn + 1) % 3])).view
  assert.equal(other.lastResult.youWon, false)
  assert.deepEqual(other.lastResult.top, { c: s.color, k: '4' })
  assert.equal(typeof other.lastResult.matchId, 'string')
})

// ── RUN AMI / CAUGHT through the service ─────────────────────────────

async function oneCardSituation({ callInPlay }) {
  const ctx = await startedRoom(3)
  const { db, clock, svc, players } = ctx
  const match = [...db.inspect.matches.values()][0]
  const s = match.state
  const turn = s.turn
  // Hand-pick a 2-card hand for the player on turn with a guaranteed-legal card.
  s.seats[turn].hand = [{ id: 'cpick', c: s.color, k: '3' }, { id: 'ckeep', c: s.color === 'g' ? 'y' : 'g', k: '8' }]
  s.drewThisTurn = false
  const agent = players[turn]
  clock.now += 500
  const r = await act(svc, agent, 'play', { cardId: 'cpick', runAmi: callInPlay })
  assert.equal(r.success, true, JSON.stringify(r))
  return { ...ctx, agent, turn, others: players.filter((a) => a !== agent), playedAt: clock.now }
}

test('service: RUN AMI in the play is private ✓ and public log line, no catch possible', async () => {
  const { svc, clock, agent, others, db } = await oneCardSituation({ callInPlay: true })
  const mine = (await svc.getState(agent)).view
  assert.equal(mine.me.runAmiCalled, true)
  const theirs = (await svc.getState(others[0])).view
  assert.equal(theirs.me.runAmiCalled, false)
  assert.ok(theirs.log.some((e) => e.type === 'RUN_AMI_CALLED'))
  clock.now += 5000
  for (const a of [agent, ...others]) db.setLastSeen(a, clock.now)
  const c = await act(svc, others[0], 'catch')
  assert.deepEqual(c.reply, { caught: false })
})

test('service: catch after grace succeeds once; CAUGHT spam adds nothing', async () => {
  const { svc, clock, agent, others, db, turn } = await oneCardSituation({ callInPlay: false })
  clock.now += 2500
  const results = await Promise.all([
    act(svc, others[0], 'catch'), act(svc, others[0], 'catch'), act(svc, others[1], 'catch'), act(svc, others[1], 'catch'),
  ])
  const caught = results.filter((r) => r.reply?.caught === true)
  assert.equal(caught.length, 1, JSON.stringify(results.map((r) => r.reply || r.error)))
  const match = [...db.inspect.matches.values()][0]
  assert.equal(match.state.seats[turn].hand.length, 3)
  assert.equal(db.inspect.events.filter((e) => e.type === 'PLAYER_CAUGHT').length, 1)
  // the caught player's view shows it in the log; nothing else revealed
  const v = (await svc.getState(agent)).view
  assert.ok(v.log.some((e) => e.type === 'PLAYER_CAUGHT' && e.target === turn && e.penalty === 2))
})

test('service: catch during grace is a private nothing with no public event', async () => {
  const { svc, clock, others, db } = await oneCardSituation({ callInPlay: false })
  clock.now += 1000
  const c = await act(svc, others[0], 'catch')
  assert.deepEqual(c.reply, { caught: false })
  assert.equal(db.inspect.events.filter((e) => e.type === 'PLAYER_CAUGHT').length, 0)
})

test('service: late call within grace registers', async () => {
  const { svc, clock, agent } = await oneCardSituation({ callInPlay: false })
  clock.now += 1200
  const r = await act(svc, agent, 'call')
  assert.deepEqual(r.reply, { runAmi: 'called' })
  assert.equal(r.view.me.runAmiCalled, true)
})
