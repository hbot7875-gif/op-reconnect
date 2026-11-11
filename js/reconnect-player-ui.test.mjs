import assert from 'node:assert/strict'
import test from 'node:test'
import { reconnectPlayerNext, questRuleNotes } from './reconnect-player-ui.js'

for (const teamSize of [2, 3]) {
  const next = reconnectPlayerNext({
    variant: 'connect', need: 0, teamSize,
    sharedTrack: { label: 'SWIM', progress: 88, target: 100 },
  })
  assert.equal(next.title, 'Stream SWIM 12 more times')
}

assert.equal(reconnectPlayerNext({ need: 1, pendingNames: ['moonchild7'] }).title, 'Waiting for moonchild7')
// One invite out, two spots open: the next step is the other spot.
assert.deepEqual(reconnectPlayerNext({ need: 2, pendingNames: ['Rey'] }), { title: 'Invite one more teammate', body: 'Rey has 24 hours to accept your invite.' })
assert.equal(reconnectPlayerNext({ need: 2, pendingNames: ['Rey'], recruit: { districtName: 'X' } }).title, 'Waiting for Rey')
assert.equal(reconnectPlayerNext({ need: 2 }).title, 'Invite 2 teammates')
assert.equal(reconnectPlayerNext({ need: 1, expiredCount: 1 }).title, 'Invite expired — choose another teammate')
assert.equal(reconnectPlayerNext({ need: 1 }).title, 'Invite one teammate')
assert.equal(reconnectPlayerNext({ need: 0, cipher: { index: 0, total: 3, attemptsLeft: 0 } }).title, 'No attempts left — ask for help')
assert.equal(reconnectPlayerNext({ status: 'complete' }).title, 'Quest complete — finish the district')
assert.equal(reconnectPlayerNext({ need: 0, idleCount: 1, isCreator: true }).title, 'A teammate has gone quiet')

// Checklist mode — each teammate must clear a fixed track list on their own.
assert.equal(reconnectPlayerNext({
  variant: 'connect', need: 0, checklist: { total: 49 }, myChecklistDone: 12,
}).title, 'Stream 37 more tracks from the list')
assert.equal(reconnectPlayerNext({
  variant: 'connect', need: 0, checklist: { total: 49 }, myChecklistDone: 48,
}).title, 'Stream 1 more track from the list')
assert.equal(reconnectPlayerNext({
  variant: 'connect', need: 0, checklist: { total: 49 }, myChecklistDone: 49,
}).title, 'Waiting on the rest of the team')
assert.equal(reconnectPlayerNext({
  variant: 'connect', need: 0, checklist: { total: 49 }, myChecklistDone: 12,
}).body, '12/49 cleared — each teammate completes their own list.')

console.log('reconnect-player-ui: all tests passed')

// ── Two-stage quest with War of Cards (Bangtan Seven Bridge) ─────────────
const WAR_BASE = { variant: 'connect', need: 0, status: 'open', myStatus: 'joined', sharedTrack: { label: 'Danger', target: 150, progress: 150 } }

test('stage one: still streaming Danger until the team reaches 150', () => {
  const r = reconnectPlayerNext({ ...WAR_BASE, sharedTrack: { label: 'Danger', target: 150, progress: 120 }, warOfCards: { unlocked: false, done: 0, total: 4 } })
  assert.equal(r.title, 'Stream Danger 30 more times')
})

test('stage two: play one game, or charge the Bomb first', () => {
  const war = { unlocked: true, done: 1, total: 4 }
  assert.equal(reconnectPlayerNext({ ...WAR_BASE, warOfCards: war, myWarPlayed: false, bombActive: true }).title, 'Play one game of War of Cards')
  const dark = reconnectPlayerNext({ ...WAR_BASE, warOfCards: war, myWarPlayed: false, bombActive: false })
  assert.equal(dark.title, 'Charge your ARMY Bomb to play')
  assert.match(dark.body, /charged Bomb/)
})

test('stage two: after my game, wait for the others', () => {
  const r = reconnectPlayerNext({ ...WAR_BASE, warOfCards: { unlocked: true, done: 3, total: 4 }, myWarPlayed: true, bombActive: false })
  assert.equal(r.title, 'Waiting for 1 teammate to play')
})

test('stage two: an empty seat still asks for a teammate first', () => {
  const r = reconnectPlayerNext({ ...WAR_BASE, need: 1, warOfCards: { unlocked: true, done: 2, total: 4 }, myWarPlayed: true })
  assert.equal(r.title, 'Invite one teammate')
})

test('quest rules mention the War of Cards stage and that no album is needed', () => {
  const notes = questRuleNotes({ sharedTrack: { label: 'Danger', keys: ['danger'], target: 150 }, warOfCards: true })
  assert.match(notes, /War of Cards for every teammate/)
  assert.match(notes, /no album needed/)
  assert.match(notes, /one game together counts for everyone/)
})
