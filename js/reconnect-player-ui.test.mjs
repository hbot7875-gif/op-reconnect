import assert from 'node:assert/strict'
import { reconnectPlayerNext } from './reconnect-player-ui.js'

for (const teamSize of [2, 3]) {
  const next = reconnectPlayerNext({
    variant: 'connect', need: 0, teamSize,
    sharedTrack: { label: 'SWIM', progress: 88, target: 100 },
  })
  assert.equal(next.title, 'Stream SWIM 12 more times')
}

assert.equal(reconnectPlayerNext({ need: 1, pendingNames: ['moonchild7'] }).title, 'Waiting for an invited agent')
assert.equal(reconnectPlayerNext({ need: 1, expiredCount: 1 }).title, 'Invite expired — choose another teammate')
assert.equal(reconnectPlayerNext({ need: 1 }).title, 'Invite one teammate')
assert.equal(reconnectPlayerNext({ need: 0, cipher: { index: 0, total: 3, attemptsLeft: 0 } }).title, 'No attempts left — ask for help')
assert.equal(reconnectPlayerNext({ status: 'complete' }).title, 'Quest complete — finish the district')
assert.equal(reconnectPlayerNext({ need: 0, idleCount: 1, isCreator: true }).title, 'A teammate has gone quiet')

console.log('reconnect-player-ui: all tests passed')
