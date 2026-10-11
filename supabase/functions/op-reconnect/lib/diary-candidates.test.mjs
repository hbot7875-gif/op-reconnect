import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  backupPassCandidates, candidateDigest, dedupeDiaryCandidates,
  normalizeDiaryCandidate, selectDailyMemories, streamingXpKstDate,
} from './diary-candidates.ts'

const base = (overrides = {}) => ({
  type: 'mission-completed', occurredAt: '2026-10-04T03:00:00.000Z',
  importance: 'special', reliability: 'A', safeTitle: 'Completed SWIM.',
  source: { table: 'rc_reconnect_missions', id: 'mission-1' }, facts: {}, ...overrides,
})

test('normalizer rejects unreliable, untraceable, and private-agent-number facts', () => {
  assert.equal(normalizeDiaryCandidate(base({ reliability: 'C' })), null)
  assert.equal(normalizeDiaryCandidate(base({ source: { table: '', id: '' } })), null)
  assert.equal(normalizeDiaryCandidate(base({ safeTitle: 'Helped AGENT004 today.' })), null)
  assert.equal(normalizeDiaryCandidate(base())?.kstDate, '2026-10-04')
})

test('streaming XP uses the ledger day key and rejects malformed or other-agent keys', () => {
  assert.equal(streamingXpKstDate('streams:AGENT001:2026-10-04', 'AGENT001'), '2026-10-04')
  assert.equal(streamingXpKstDate('streams:AGENT002:2026-10-04', 'AGENT001'), null)
  assert.equal(streamingXpKstDate('streams:AGENT001:not-a-date', 'AGENT001'), null)
})

test('correlated mission/feed and district/xp facts dedupe but badges never do', () => {
  const input = [
    normalizeDiaryCandidate(base()),
    normalizeDiaryCandidate(base({ type: 'reconnect-completed', source: { table: 'rc_feed_events', id: '9' } })),
    normalizeDiaryCandidate(base({ type: 'badge-awarded', safeTitle: 'Earned Mission Bond.', artworkId: 2, source: { table: 'rc_badges', id: 'mission_bond:x' } })),
  ]
  const output = dedupeDiaryCandidates(input)
  assert.equal(output.filter((x) => ['mission-completed', 'reconnect-completed'].includes(x.type)).length, 1)
  assert.equal(output.filter((x) => x.type === 'badge-awarded').length, 1)
})

test('selection keeps every badge and limits supporting memories', () => {
  const input = [
    normalizeDiaryCandidate(base({ type: 'agent-joined', safeTitle: 'Became an agent.', source: { table: 'rc_players', id: 'A' } })),
    ...[1, 2, 3, 4].map((n) => normalizeDiaryCandidate(base({ type: 'badge-awarded', safeTitle: `Earned badge ${n}.`, artworkId: n, source: { table: 'rc_badges', id: `b${n}` } }))),
    normalizeDiaryCandidate(base({ type: 'high-stream-day', importance: 'nice', safeTitle: '27 streams.', source: { table: 'rc_daily_activity', id: 'A:2026-10-04' }, facts: { count: 27 } })),
  ]
  const selected = selectDailyMemories(input)
  assert.equal(selected.badges.length, 4)
  assert.equal(selected.anchor?.type, 'agent-joined')
  assert.equal(selected.state, 'real')
  assert.equal(candidateDigest(selected.selected), candidateDigest(selected.selected))
})

test('Backup Pass memories require a proven complete or positive banked outcome', () => {
  const people = new Map([['B', 'Moon']])
  const common = { owner_agent_no: 'A', helper_agent_no: 'B', completed_at: '2026-10-04T02:00:00Z', closed_at: '2026-10-04T02:00:00Z' }
  const rows = [
    { ...common, id: 'joined', status: 'joined', banked_credit: 0 },
    { ...common, id: 'empty', status: 'banked', banked_credit: 0 },
    { ...common, id: 'done', status: 'complete', banked_credit: 0 },
    { ...common, id: 'banked', status: 'banked', banked_credit: 5 },
  ]
  const output = backupPassCandidates(rows, people, 'A')
  assert.deepEqual(output.map((x) => x.source.id), ['done', 'banked'])
  assert.ok(output.every((x) => !x.safeTitle.includes('AGENT')))
})
