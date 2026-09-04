import assert from 'node:assert/strict'
import test from 'node:test'
import { bombHealthStatus, lastFedLabel } from './agent-charge-health.js'

test('bomb health stays quiet and positive early in the 14-day window', () => {
  assert.deepEqual(bombHealthStatus({ daysLeft: 14 }), {
    tone: 'happy', icon: '♥', label: 'FULL OF BORA', detail: 'FEED · 14D LEFT',
  })
  assert.equal(bombHealthStatus({ daysLeft: 10 }).tone, 'happy')
})

test('bomb health becomes hungry before it becomes urgent', () => {
  assert.equal(bombHealthStatus({ daysLeft: 9 }).label, 'STILL GLOWING')
  assert.equal(bombHealthStatus({ daysLeft: 5 }).label, 'LOW ON BORA')
  assert.equal(bombHealthStatus({ daysLeft: 2 }).label, 'ARMY, FEED ME')
})

test('bomb health handles expired and missing values safely', () => {
  assert.deepEqual(bombHealthStatus({ daysLeft: -2 }), {
    tone: 'urgent', icon: '!', label: 'ARMY, FEED ME', detail: 'LIMIT REACHED',
  })
  assert.equal(bombHealthStatus(null), null)
})

test('last-fed copy stays compact from minutes through days', () => {
  const now = Date.parse('2026-09-04T12:00:00Z')
  assert.equal(lastFedLabel({ lastFedAt: '2026-09-04T11:40:00Z' }, now), 'FED JUST NOW')
  assert.equal(lastFedLabel({ lastFedAt: '2026-09-04T04:00:00Z' }, now), 'FED 8H AGO')
  assert.equal(lastFedLabel({ lastFedAt: '2026-09-01T10:00:00Z' }, now), 'FED 3D AGO')
  assert.equal(lastFedLabel({}, now), null)
})
