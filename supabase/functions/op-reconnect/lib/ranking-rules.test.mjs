import assert from 'node:assert/strict'
import test from 'node:test'
import { activeRankingRows } from './ranking-rules.js'

test('retired agents are removed while active ranking order is preserved', () => {
  const rows = [
    { agent_no: 'AGENT001', xp: 500 },
    { agent_no: 'AGENT002', xp: 400 },
    { agent_no: 'AGENT003', xp: 300 },
  ]
  assert.deepEqual(activeRankingRows(rows, ['AGENT001', 'AGENT003']), [rows[0], rows[2]])
})

test('an empty active roster produces an empty public ranking', () => {
  assert.deepEqual(activeRankingRows([{ agent_no: 'AGENT001' }], []), [])
})
