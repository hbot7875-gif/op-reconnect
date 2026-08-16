// Real, runnable Node test for the Candy Star planner helpers — not a
// hand-maintained mirror. This imports the exact same module the deployed
// Deno edge function imports (candy-star-rules.ts -> candy-star-planner.js),
// so there is no drift risk between what's tested and what's deployed.
//
// Run with: node candy-star-planner.test.mjs
// (No test runner dependency — plain Node assert, since this repo has no
// existing JS test harness to hook into.)

import assert from 'node:assert/strict'
import { planGapCounts, shuffle, artistInterleave } from './candy-star-planner.js'

let passed = 0
function test(name, fn) {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

test('planGapCounts sums exactly to a feasible total', () => {
  for (let trial = 0; trial < 200; trial++) {
    const n = 1 + Math.floor(Math.random() * 15)
    const total = n * (1 + Math.floor(Math.random() * 6)) // always within [n*1, n*6]
    const plan = planGapCounts(n, total)
    assert.equal(plan.length, n)
    assert.equal(plan.reduce((a, b) => a + b, 0), total, `n=${n} total=${total} plan=${plan}`)
  }
})

test('planGapCounts clamps an infeasible total instead of drifting silently', () => {
  // Below the feasible floor (n*1) -> clamps to n*1.
  assert.deepEqual(planGapCounts(5, -100).reduce((a, b) => a + b, 0), 5)
  assert.deepEqual(planGapCounts(5, 0).reduce((a, b) => a + b, 0), 5)
  // Above the feasible ceiling (n*6) -> clamps to n*6.
  assert.equal(planGapCounts(5, 999).reduce((a, b) => a + b, 0), 30)
  assert.equal(planGapCounts(5, 31).reduce((a, b) => a + b, 0), 30)
})

test('planGapCounts always stays within [1,6] per gap', () => {
  for (let trial = 0; trial < 200; trial++) {
    const n = 1 + Math.floor(Math.random() * 15)
    const total = Math.floor(Math.random() * n * 8) - n * 2 // sweep well outside feasible range too
    const plan = planGapCounts(n, total)
    for (const g of plan) {
      assert.ok(g >= 1 && g <= 6, `gap ${g} out of [1,6] for n=${n} total=${total}`)
    }
  }
})

test('planGapCounts(0, anything) returns []', () => {
  assert.deepEqual(planGapCounts(0, 50), [])
})

test('planGapCounts is centered on 3 with 5/6 rare, over many trials', () => {
  // n=9, total=27 is the exact "Come Over x10 + YNWA" scenario's balanced
  // case (avg gap 3) — statistically check the shape matches the intended
  // "3 dominant, 2/4 common, 5/6 rare" design.
  const counts = {}
  const N = 500
  for (let trial = 0; trial < N; trial++) {
    for (const g of planGapCounts(9, 27)) counts[g] = (counts[g] || 0) + 1
  }
  const total = N * 9
  const pct = (g) => ((counts[g] || 0) / total) * 100
  assert.ok(pct(3) > 30, `3 should be a strong plurality, got ${pct(3).toFixed(1)}%`)
  assert.ok(pct(5) + pct(6) < 25, `5+6 should stay a minority, got ${(pct(5) + pct(6)).toFixed(1)}%`)
})

test('shuffle preserves the multiset (no elements lost or duplicated)', () => {
  const arr = Array.from({ length: 20 }, (_, i) => i)
  const shuffled = shuffle(arr)
  assert.deepEqual([...shuffled].sort((a, b) => a - b), arr)
})

test('artistInterleave never lets more than 1 consecutive track from the same primary artist when alternatives exist', () => {
  const songs = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, artists: ['A'] })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, artists: ['B'] })),
  ]
  const out = artistInterleave(songs)
  assert.equal(out.length, 10)
  for (let i = 1; i < out.length; i++) {
    assert.notEqual(out[i].artists[0], out[i - 1].artists[0], `consecutive same-artist at ${i}`)
  }
})

console.log(`\n${passed} tests passed`)
