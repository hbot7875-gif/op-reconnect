import { flagStreamRows } from './police-check.ts'

function assert(value: unknown, message = 'assertion failed') {
  if (!value) throw new Error(message)
}

const rows = [
  { track_name: 'SWIM', artist_name: 'BTS', listened_at: 1_000 },
  { track_name: 'SWIM', artist_name: 'BTS', listened_at: 1_120 },
]

Deno.test('trusted stream sequences retain the repeat timing check', () => {
  const result = flagStreamRows(rows)
  assert(result[0].flags.includes('repeat'))
})

Deno.test('partial provider sequences never claim a repeat', () => {
  const result = flagStreamRows(rows, { trustSequence: false })
  assert(result.every((row) => row.flags.length === 0))
  assert(result[0].gapSeconds === 120, 'timing stays available as neutral context')
})
