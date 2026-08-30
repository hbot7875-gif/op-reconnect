import assert from 'node:assert/strict'
import { buildAgentDiary } from './admin-diary.js'

const diary = buildAgentDiary({
  districtNames: { mono: 'Mono Station' },
  feedRows: [
    { event_type: 'district_restored', payload: {}, dedup_key: 'feed:district:AGENT001:mono', created_at: '2026-08-28T02:00:00Z' },
    { event_type: 'reconnect_completed', payload: { partnerCodename: 'purplewhale' }, dedup_key: 'feed:reconnect:1', created_at: '2026-08-28T03:00:00Z' },
    { event_type: 'ward_progress', payload: {}, dedup_key: 'feed:ward:1', created_at: '2026-08-28T04:00:00Z' },
  ],
  xpRows: [
    { amount: 8, created_at: '2026-08-28T01:00:00Z' },
    { amount: 10, created_at: '2026-08-28T08:00:00Z' },
    { amount: -20, created_at: '2026-08-28T09:00:00Z' },
  ],
})

assert.equal(diary.some((entry) => entry.title === 'Restored Mono Station'), true)
assert.equal(diary.some((entry) => entry.title === 'Completed a ReConnect Quest' && entry.detail === 'with purplewhale'), true)
assert.equal(diary.some((entry) => entry.title === 'Earned 18 XP'), true)
assert.equal(diary.some((entry) => entry.title.includes('ward progress')), false)
assert.equal(diary.filter((entry) => entry.kind === 'xp').length, 1)

console.log('admin-diary: all tests passed')
