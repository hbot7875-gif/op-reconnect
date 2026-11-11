// War of Cards with a temporary quest pass (Bangtan Seven Bridge): the game
// service asks allowAgent per route, and re-checks everyone seated before a
// match starts, so a member whose quest game is done can look and leave but
// can never be dealt into another game.
import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { createRunAmiService } from './run-ami-service.js'
import { createTestStore, mulberry32 } from './run-ami-test-store.mjs'
import { warPassAllows } from './reconnect-war-stage.js'

const T0 = Date.parse('2026-11-12T12:00:00Z')
const HOST = 'AGENT012' // full access (album complete)
const PASS = 'AGENT034' // quest pass
const OTHER = 'AGENT056' // full access

function setup() {
  const clock = { now: T0 }
  const agents = Object.fromEntries([HOST, PASS, OTHER, 'AGENT078'].map((no, i) => [no, {
    codename: `Codename${i}`, avatar: null, chargedUntil: T0 + 20 * 3600_000, chargeCells: 4, autoFeed: false,
  }]))
  const db = createTestStore({ clock, agents })
  // PASS starts with a playing pass; flipping passLevel to 'view' is what
  // finishing their counted game does (war-quest-pass.ts).
  const access = { passLevel: 'play', calls: [] }
  const allowAgent = async (agentNo, route) => {
    access.calls.push([agentNo, route])
    if (agentNo === PASS) return warPassAllows(access.passLevel, route)
    return agentNo !== 'AGENT078'
  }
  const svc = createRunAmiService({
    store: db.store, now: () => clock.now, rng: mulberry32(7),
    randomCode: () => 'AMI7K2', randomTopic: () => 'q'.repeat(40), allowAgent,
  })
  return { svc, access, db }
}

test('every route tells allowAgent which route is asking', async () => {
  const { svc, access } = setup()
  await svc.getState(PASS)
  await svc.createRoom(HOST)
  assert.deepEqual(access.calls.slice(0, 2), [[PASS, 'getState'], [HOST, 'createRoom']])
})

test('a pass holder can sit down and be dealt in while their pass plays', async () => {
  const { svc } = setup()
  const code = (await svc.createRoom(HOST)).view.room.code
  assert.equal((await svc.joinRoom(PASS, code)).success, true)
  const started = await svc.startMatch(HOST)
  assert.equal(started.success, true, JSON.stringify(started.error))
})

test('after the counted game: look and leave only — no new room, no join, no rematch', async () => {
  const { svc, access } = setup()
  const code = (await svc.createRoom(HOST)).view.room.code
  assert.equal((await svc.joinRoom(PASS, code)).success, true)
  access.passLevel = 'view' // their game is done
  assert.equal((await svc.getState(PASS)).success, true, 'can still see the table')
  assert.equal((await svc.createRoom(PASS)).error, 'not_invited')
  assert.equal((await svc.joinRoom(PASS, code)).error, 'not_invited')
  assert.equal((await svc.act(PASS, { type: 'DRAW', actionId: randomUUID() })).error, 'not_invited')
  // Still seated: the host may not deal them into another game.
  const rematch = await svc.startMatch(HOST)
  assert.equal(rematch.success, false)
  assert.equal(rematch.error, 'seat_not_allowed')
  // Leaving the table always works, and then the host can start without them.
  assert.equal((await svc.leaveRoom(PASS)).success, true)
  assert.equal((await svc.joinRoom(OTHER, code)).success, true)
  assert.equal((await svc.startMatch(HOST)).success, true)
})

test('no pass, no album: nothing at all', async () => {
  const { svc } = setup()
  assert.equal((await svc.getState('AGENT078')).error, 'not_invited')
  assert.equal((await svc.createRoom('AGENT078')).error, 'not_invited')
})
