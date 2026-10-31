import test from 'node:test'
import assert from 'node:assert/strict'
import { bombNudgeStage, bombNudgeDue, markBombNudgeSeen, bombNudgeCopy } from './bomb-nudge-rules.js'

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) } }
const fh = (d, lastFedAt = '2026-10-20T00:00:00Z') => ({ daysSinceFeed: d, daysLeft: Math.ceil(14 - d - 0.5), lastFedAt })

test('stages: day 6 to 12 warn, day 13 is the last day, nothing before 6 or past the limit', () => {
  assert.equal(bombNudgeStage(fh(5)), null)
  assert.equal(bombNudgeStage(fh(6)), 6)
  assert.equal(bombNudgeStage(fh(12)), 6)
  assert.equal(bombNudgeStage(fh(13)), 13)
  assert.equal(bombNudgeStage({ daysSinceFeed: 14, daysLeft: 0 }), null)
  assert.equal(bombNudgeStage(null), null)
})

test('day 6 shows once per dark spell; charging starts a new one', () => {
  const storage = mem()
  const now = new Date('2026-10-26T03:00:00Z')
  assert.equal(bombNudgeDue(fh(6), { agentNo: 'AGENT1', storage, now }), 6)
  markBombNudgeSeen(storage, 'AGENT1', fh(6), 6, now)
  assert.equal(bombNudgeDue(fh(8), { agentNo: 'AGENT1', storage, now: new Date('2026-10-28T03:00:00Z') }), null)
  assert.equal(bombNudgeDue(fh(6, '2026-11-01T00:00:00Z'), { agentNo: 'AGENT1', storage, now }), 6)
})

test('day 13 shows again on each KST day', () => {
  const storage = mem()
  const day1 = new Date('2026-11-02T10:00:00Z')
  markBombNudgeSeen(storage, 'AGENT1', fh(13), 13, day1)
  assert.equal(bombNudgeDue(fh(13), { agentNo: 'AGENT1', storage, now: day1 }), null)
  assert.equal(bombNudgeDue(fh(13), { agentNo: 'AGENT1', storage, now: new Date('2026-11-02T15:30:00Z') }), 13)
})

test('broken storage never nags', () => {
  const storage = { getItem() { throw new Error('x') }, setItem() { throw new Error('x') } }
  assert.equal(bombNudgeDue(fh(13), { agentNo: 'AGENT1', storage }), null)
})

test('copy has no later button and names the deadline', () => {
  const six = bombNudgeCopy(6, { daysSinceFeed: 6, daysLeft: 8 })
  assert.match(six.body, /6 days/)
  assert.match(six.body, /within 8 days/)
  assert.equal(six.later, undefined)
  const last = bombNudgeCopy(13, { daysSinceFeed: 13, daysLeft: 1 })
  assert.match(last.title, /today/)
  assert.equal(last.later, undefined)
})
