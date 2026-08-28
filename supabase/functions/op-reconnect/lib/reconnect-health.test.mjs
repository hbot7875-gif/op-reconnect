import assert from 'node:assert/strict'
import {
  reconnectHealthFlags,
  reconnectPrimaryStatus,
  reconnectRecommendedAction,
  suggestedReconnectRoster,
} from './reconnect-health.js'

const solo = reconnectHealthFlags({ missingSeats: 2, pendingInvites: 0 })
assert.deepEqual(solo, ['needs_people'])
assert.equal(reconnectPrimaryStatus(solo), 'needs_people')
assert.equal(reconnectRecommendedAction({ flags: solo, missingSeats: 2 }), 'Fill 2 open seats')

assert.deepEqual(
  reconnectHealthFlags({ missingSeats: 1, pendingInvites: 1, oldestInviteHours: 4 }),
  ['invite_pending'],
)
assert.deepEqual(
  reconnectHealthFlags({ missingSeats: 1, pendingInvites: 1, oldestInviteHours: 13 }),
  ['invite_overdue'],
)

const urgent = reconnectHealthFlags({ missingSeats: 1, deadlineHours: 3, idleTeammates: 1 })
assert.deepEqual(urgent, ['deadline_soon', 'idle_teammate', 'needs_people'])
assert.equal(reconnectPrimaryStatus(urgent), 'deadline_soon')

assert.equal(reconnectPrimaryStatus(reconnectHealthFlags({ puzzleBlocked: true, deadlineHours: 2 })), 'puzzle_blocked')
assert.deepEqual(reconnectHealthFlags({ missingSeats: 0, pendingInvites: 0 }), ['active'])

assert.deepEqual(
  suggestedReconnectRoster(['AGENT001', 'agent002'], ['AGENT002', 'AGENT003', 'AGENT004'], 3),
  ['AGENT001', 'AGENT002', 'AGENT003'],
)
assert.deepEqual(suggestedReconnectRoster(['AGENT001'], ['AGENT002'], 3), [])

console.log('reconnect-health: 9 tests passed')
