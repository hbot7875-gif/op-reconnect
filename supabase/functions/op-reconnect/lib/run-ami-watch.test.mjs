// RUN AMI watchers: join a room by code to watch the live table and chat,
// without a seat. Runs the real service against the in-memory store (see
// run-ami-test-store.mjs; the SQL itself is run-ami-watch-pg.test.mjs).

import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { createRunAmiService } from './run-ami-service.js'
import { createTestStore, mulberry32 } from './run-ami-test-store.mjs'

const T0 = Date.parse('2026-10-25T12:00:00Z')
const HOUR = 3600_000
const AGENTS = ['AGENT012', 'AGENT034', 'AGENT056', 'AGENT078', 'AGENT090', 'AGENT101']
const WATCHER = 'AGENT101'

function setup({ dark = [] } = {}) {
  const clock = { now: T0 }
  const agents = Object.fromEntries(AGENTS.map((no, i) => [no, {
    codename: `Codename${i}`, avatar: null,
    chargedUntil: dark.includes(no) ? T0 - HOUR : T0 + 20 * HOUR,
  }]))
  const db = createTestStore({ clock, agents })
  let codeSeq = 0
  const svc = createRunAmiService({
    store: db.store, now: () => clock.now, rng: mulberry32(9),
    randomCode: () => ['AMI7K2', 'RUNAM2'][codeSeq++ % 2],
    randomTopic: () => 't'.repeat(40) + codeSeq,
    allowAgent: () => true,
  })
  return { clock, db, svc }
}

async function room(ctx, n, { start = true } = {}) {
  const created = await ctx.svc.createRoom(AGENTS[0])
  const code = created.view.room.code
  for (const a of AGENTS.slice(1, n)) assert.equal((await ctx.svc.joinRoom(a, code)).success, true)
  if (start) assert.equal((await ctx.svc.startMatch(AGENTS[0])).success, true)
  return code
}

test('a watcher joins mid-match and sees the table, never anyone\'s cards', async () => {
  const ctx = setup()
  const code = await room(ctx, 3)
  const res = await ctx.svc.watchRoom(WATCHER, code)
  assert.equal(res.success, true, JSON.stringify(res))
  const v = res.view
  assert.equal(v.phase, 'match')
  assert.equal(v.me.watching, true)
  assert.equal(v.me.seat, null)
  assert.deepEqual(v.me.hand, [])
  assert.deepEqual(v.me.playable, [])
  assert.equal(v.room.topic.length >= 40, true) // can subscribe to the room's nudges
  assert.deepEqual(v.players.map((p) => p.cards), [7, 7, 7])
  assert.equal(v.players.some((p) => p.isMe), false)
  // No card id from any hand appears anywhere in what the watcher receives.
  const match = [...ctx.db.inspect.matches.values()][0]
  const text = JSON.stringify(v)
  for (const seat of match.state.seats) for (const c of seat.hand) assert.equal(text.includes(`"${c.id}"`), false)
  assert.equal(text.includes('AGENT'), false) // and no agent numbers
})

test('players see who is watching; a watcher in a full room or with a dark Bomb still gets in', async () => {
  const ctx = setup({ dark: [WATCHER] })
  const code = await room(ctx, 4, { start: false })
  assert.equal((await ctx.svc.joinRoom('AGENT090', code)).error, 'room_full')
  assert.equal((await ctx.svc.watchRoom(WATCHER, code)).success, true)
  const lobby = (await ctx.svc.getState(AGENTS[0])).view
  assert.deepEqual(lobby.watchers, { count: 1, names: ['Codename5'] })
  const mine = (await ctx.svc.getState(WATCHER)).view
  assert.equal(mine.phase, 'lobby')
  assert.equal(mine.me.watching, true)
  assert.equal(mine.room.canSeat, false) // all four seats taken
})

test('a watcher chats: tagged as watching, seen by players, and the room is nudged at once', async () => {
  const ctx = setup()
  const code = await room(ctx, 2)
  await ctx.svc.watchRoom(WATCHER, code)
  const roomRow = [...ctx.db.inspect.rooms.values()][0]
  const versionBefore = roomRow.version
  const pings = () => ctx.db.inspect.broadcasts.filter((b) => b.event === 'p' && b.payload.k === 'c').length
  const before = pings()
  const sent = await ctx.svc.sendChat(WATCHER, { kind: 'text', body: 'go go go' })
  assert.equal(sent.success, true, JSON.stringify(sent))
  assert.equal(pings(), before + 1)
  assert.equal(roomRow.version, versionBefore) // chat never stales a start or a move
  const seen = (await ctx.svc.getState(AGENTS[1])).view.chat.at(-1)
  assert.deepEqual({ body: seen.body, watching: seen.watching, mine: seen.mine }, { body: 'go go go', watching: true, mine: false })
  // A player's own message is not tagged.
  await ctx.svc.sendChat(AGENTS[1], { kind: 'react', body: '🔥' })
  assert.equal((await ctx.svc.getState(WATCHER)).view.chat.at(-1).watching, false)
})

test('a watcher cannot play, start or hold the table up', async () => {
  const ctx = setup()
  const code = await room(ctx, 2)
  await ctx.svc.watchRoom(WATCHER, code)
  assert.equal((await ctx.svc.act(WATCHER, { type: 'draw', actionId: randomUUID() })).error, 'not_in_room')
  assert.equal((await ctx.svc.startMatch(WATCHER)).error, 'not_in_room')
  // The round's turn clock runs out with only the watcher reading: the
  // watcher's own read settles it, so a watched table never stalls.
  const match = () => [...ctx.db.inspect.matches.values()][0]
  const turnBefore = match().state.turnNo
  ctx.clock.now = match().state.deadline + 1000
  ctx.db.setLastSeen(AGENTS[0], ctx.clock.now)
  ctx.db.setLastSeen(AGENTS[1], ctx.clock.now)
  await ctx.svc.getState(WATCHER)
  assert.ok(match().state.turnNo > turnBefore)
})

test('between rounds a watcher can take a free seat, which ends the watch', async () => {
  const ctx = setup()
  const code = await room(ctx, 2, { start: false })
  await ctx.svc.watchRoom(WATCHER, code)
  assert.equal((await ctx.svc.getState(WATCHER)).view.room.canSeat, true)
  const sat = await ctx.svc.joinRoom(WATCHER, code)
  assert.equal(sat.success, true)
  assert.equal(sat.view.me.watching, false)
  assert.equal(sat.view.players.length, 3)
  assert.equal(ctx.db.inspect.watchers.filter((w) => !w.leftAt).length, 0)
  assert.equal((await ctx.svc.getState(AGENTS[0])).view.watchers.count, 0)
})

test('a seated agent can\'t watch somewhere else, and "watching" their own room keeps the seat', async () => {
  const ctx = setup()
  const code = await room(ctx, 2, { start: false })
  const other = (await ctx.svc.createRoom('AGENT078')).view.room.code
  assert.equal((await ctx.svc.watchRoom(AGENTS[1], other)).error, 'already_seated')
  const same = await ctx.svc.watchRoom(AGENTS[1], code)
  assert.equal(same.success, true)
  assert.equal(same.view.me.watching, false)
  assert.equal(same.view.me.seat, 1)
})

test('leaving stops watching; a closed room ends the watch; an old watch drops off the list', async () => {
  const ctx = setup()
  const code = await room(ctx, 2, { start: false })
  await ctx.svc.watchRoom(WATCHER, code)
  const left = await ctx.svc.leaveRoom(WATCHER)
  assert.equal(left.view.phase, 'entry')
  assert.equal((await ctx.svc.getState(AGENTS[0])).view.watchers.count, 0)

  await ctx.svc.watchRoom(WATCHER, code)
  ctx.db.setWatchSeen(WATCHER, ctx.clock.now - 2 * 60_000) // quiet for 2 minutes
  assert.equal((await ctx.svc.getState(AGENTS[0])).view.watchers.count, 0) // not listed
  assert.equal((await ctx.svc.getState(WATCHER)).view.me.watching, true) // but still watching

  await ctx.svc.leaveRoom(AGENTS[1])
  await ctx.svc.leaveRoom(AGENTS[0]) // last seat out closes the room
  assert.equal((await ctx.svc.getState(WATCHER)).view.phase, 'entry')
  assert.equal((await ctx.svc.sendChat(WATCHER, { kind: 'text', body: 'hi' })).error, 'not_in_room')
})

test('a watch nobody touches for half an hour ends', async () => {
  const ctx = setup()
  const code = await room(ctx, 2, { start: false })
  await ctx.svc.watchRoom(WATCHER, code)
  ctx.db.setWatchSeen(WATCHER, ctx.clock.now - 31 * 60_000)
  assert.equal((await ctx.svc.getState(WATCHER)).view.phase, 'entry')
})

test('watching shares the join throttle and rejects a malformed code', async () => {
  const ctx = setup()
  assert.equal((await ctx.svc.watchRoom(WATCHER, 'O0O0O0')).error, 'room_not_found')
  for (let i = 0; i < 11; i++) await ctx.svc.watchRoom(WATCHER, 'ZZZZZZ')
  assert.equal((await ctx.svc.watchRoom(WATCHER, 'ZZZZZZ')).error, 'rate_limited')
})

test('the closed-test gate covers watching too', async () => {
  const { db } = setup()
  const svc = createRunAmiService({ store: db.store, rng: mulberry32(1), randomCode: () => 'AMI7K2', randomTopic: () => 't'.repeat(40) })
  assert.equal((await svc.watchRoom('AGENT999', 'AMI7K2')).error, 'not_invited')
})
