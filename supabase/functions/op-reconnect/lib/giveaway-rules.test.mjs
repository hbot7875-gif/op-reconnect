import test from 'node:test'
import assert from 'node:assert/strict'
import { securePick, GIVEAWAY_RULES } from './giveaway-rules.js'

test('approved thresholds', () => {
  assert.deepEqual([GIVEAWAY_RULES.vote_mission, GIVEAWAY_RULES.vote_num, GIVEAWAY_RULES.vote_den, GIVEAWAY_RULES.stream_num, GIVEAWAY_RULES.stream_den],
    ['mnet', 8, 12, 6, 12])
  assert.ok(Object.isFrozen(GIVEAWAY_RULES))
})

test('rejection sampling never maps the uneven top of the range', () => {
  const n = 41, limit = 2 ** 32 - (2 ** 32 % n)
  const seq = [2 ** 32 - 1, limit, limit - 1]   // first two rejected, third accepted
  let i = 0
  const r = securePick(n, (a) => { a[0] = seq[i++] })
  assert.equal(i, 3)
  assert.deepEqual(r, { index: (limit - 1) % n, random: limit - 1 })
})

test('every entry is reachable with equal weight', () => {
  // Walk the whole accepted range in equal strides: each index must appear
  // the same number of times.
  const n = 41, limit = 2 ** 32 - (2 ** 32 % n), counts = new Array(n).fill(0)
  for (let k = 0; k < n * 50; k++) {
    const v = k * Math.floor(limit / (n * 50))
    counts[securePick(n, (a) => { a[0] = v }).index]++
  }
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, counts.join(','))
  // With the real RNG, results stay in range.
  for (let k = 0; k < 2000; k++) { const { index } = securePick(n); assert.ok(index >= 0 && index < n) }
})

test('bad sizes are refused', () => {
  assert.throws(() => securePick(0), /bad_entry_count/)
  assert.throws(() => securePick(2.5), /bad_entry_count/)
})
