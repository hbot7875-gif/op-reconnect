// Real, runnable Node test for the Candy Star planner helpers — not a
// hand-maintained mirror. This imports the exact same module the deployed
// Deno edge function imports (candy-star-rules.ts -> candy-star-planner.js),
// so there is no drift risk between what's tested and what's deployed.
//
// Run with: node candy-star-planner.test.mjs
// (No test runner dependency — plain Node assert, since this repo has no
// existing JS test harness to hook into.)

import assert from 'node:assert/strict'
import {
  planGapCounts, shuffle, artistInterleave, buildBurstSkeleton, buildFocusOrder,
  buildPlaylistOrder2Focus,
} from './candy-star-planner.js'

const MIN_GAP_MS = 480000 // matches spotify-shared.ts's MIN_GAP_MS — duplicated because that's a
// .ts file this plain-JS module can't import; see the module header for why.

function mkFocusSong(key, plays, durationMs) {
  return {
    key, name: key, plays, durationMs,
    versions: [{ id: `${key}-v1`, uri: `u-${key}-1` }, { id: `${key}-v2`, uri: `u-${key}-2` }],
  }
}
function mkSpacerPool(count, prefix = 'bts') {
  return Array.from({ length: count }, (_, i) => {
    const isSkit = Math.random() < 0.15
    const durationMs = isSkit ? 30000 + Math.floor(Math.random() * 60000) : 180000 + Math.floor(Math.random() * 140000)
    return { key: `${prefix}-${i}`, uri: `u${prefix}${i}`, id: `id${prefix}${i}`, name: `Track ${i}`, durationMs, isBTS: true, artists: ['bts'] }
  })
}
function mkFillerPool(count) {
  return Array.from({ length: count }, (_, i) => ({
    uri: `f${i}`, id: `fid${i}`, name: `Filler ${i}`, durationMs: 150000 + Math.floor(Math.random() * 150000), isBTS: false,
  }))
}
function mkAlbum(count, prefix = 'album') {
  return Array.from({ length: count }, (_, i) => ({
    key: `${prefix}-${i}`, uri: `u-${prefix}-${i}`, id: `id-${prefix}-${i}`, name: `Album Track ${i}`,
    durationMs: 30000 + Math.floor(Math.random() * 290000),
  }))
}
// Largest run of non-A (or non-B) entries between two consecutive plays of
// that song — the actual "visible gap" a listener experiences.
function maxWindow(order, key) {
  let max = 0, run = 0, seenFirst = false
  for (const t of order) {
    if (t.key === key) {
      if (seenFirst) max = Math.max(max, run)
      run = 0
      seenFirst = true
    } else if (seenFirst) run++
  }
  return max
}

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

test('buildBurstSkeleton never drops a requested play — the play-count-loss regression', () => {
  // The exact reported bug: "Don't Say You Love Me x10 + SWIM x5" came
  // back with only 7 of 10 requested plays. The fallback branch (neither
  // song's no-repeat preference can be honored) used to only ever drain
  // leftover B, silently dropping A's remainder whenever A was the one
  // still holding plays — which happens routinely once B empties out.
  // 2000 trials per pair, including the exact reported ratios plus edge
  // cases (1:1, a lopsided 20:2, and 10:1 which is the boundary this
  // function still has to handle even though a real 10:1 request goes
  // through the single-focus builder instead).
  const pairs = [[10, 10], [10, 9], [10, 5], [10, 1], [1, 1], [15, 3], [20, 2]]
  for (const [m, n] of pairs) {
    for (let trial = 0; trial < 2000; trial++) {
      const out = buildBurstSkeleton(m, n)
      const countA = out.filter((x) => x === 'A').length
      const countB = out.filter((x) => x === 'B').length
      assert.equal(countA, m, `m=${m} n=${n}: expected ${m} A's, got ${countA} (${out.join('')})`)
      assert.equal(countB, n, `m=${m} n=${n}: expected ${n} B's, got ${countB} (${out.join('')})`)
    }
  }
})

test('buildFocusOrder (best-of-8 wrapper) also never drops a play', () => {
  for (const [m, n] of [[10, 10], [10, 9], [10, 5]]) {
    for (let trial = 0; trial < 200; trial++) {
      const out = buildFocusOrder(m, n)
      assert.equal(out.filter((x) => x === 'A').length, m)
      assert.equal(out.filter((x) => x === 'B').length, n)
    }
  }
})

test('buildBurstSkeleton honors its shape preferences (no B-B, max 2 A-in-a-row) up until whichever song runs out first', () => {
  // These are discretionary, not guaranteed for the whole sequence — once
  // one song's supply is exhausted, the tail necessarily drains whatever's
  // left of the other with nothing to interleave with, which can violate
  // both preferences (and did even in the pre-fix code's B-only drain).
  // Only check the constraint up to the point where the first-exhausted
  // song places its LAST occurrence — before that, both songs still had
  // supply, so the preference should hold.
  for (const [m, n] of [[10, 9], [12, 11], [10, 5]]) {
    for (let trial = 0; trial < 500; trial++) {
      const out = buildBurstSkeleton(m, n)
      let seenA = 0, seenB = 0
      let exhaustIdx = out.length - 1
      for (let i = 0; i < out.length; i++) {
        if (out[i] === 'A') seenA++; else seenB++
        if (seenA === m || seenB === n) { exhaustIdx = i; break }
      }
      let run = 0
      for (let i = 0; i <= exhaustIdx; i++) {
        if (out[i] === 'B' && out[i - 1] === 'B') assert.fail(`B repeated back-to-back before exhaustion: ${out.join('')}`)
        if (out[i] === 'A') { run++; assert.ok(run <= 2, `A ran 3+ in a row before exhaustion: ${out.join('')}`) } else run = 0
      }
    }
  }
})

test('buildPlaylistOrder2Focus never loses a requested focus play or album track', () => {
  // The reviewed regression, at the full-builder level (not just the
  // skeleton helper) — and now also covering album tracks, whose
  // placement is handled entirely differently (deferred to whichever
  // window has room, force-flushed at the end) and needed the same
  // guarantee checked independently.
  const scenarios = [
    { pA: 10, pB: 10, album: 14 },
    { pA: 10, pB: 9, album: 14 },
    { pA: 10, pB: 5, album: 14 },
    { pA: 10, pB: 5, album: 0 },
    { pA: 1, pB: 1, album: 1 },
  ]
  for (const { pA, pB, album } of scenarios) {
    for (let trial = 0; trial < 100; trial++) {
      const focusSongs = [mkFocusSong('A', pA, 200000), mkFocusSong('B', pB, 195000)]
      const { order } = buildPlaylistOrder2Focus(
        focusSongs, mkSpacerPool(150), mkFillerPool(60), mkAlbum(album), 180 * 60000, 20, MIN_GAP_MS,
      )
      const actualA = order.filter((t) => t.key === 'A').length
      const actualB = order.filter((t) => t.key === 'B').length
      const actualAlbum = order.filter((t) => t.isAlbumTrack).length
      assert.equal(actualA, pA, `pA=${pA} pB=${pB} album=${album}: got ${actualA} A plays`)
      assert.equal(actualB, pB, `pA=${pA} pB=${pB} album=${album}: got ${actualB} B plays`)
      assert.equal(actualAlbum, album, `pA=${pA} pB=${pB} album=${album}: got ${actualAlbum} album tracks`)
    }
  }
})

test('buildPlaylistOrder2Focus keeps same-song windows bounded even under dense album clustering', () => {
  // Not a strict MAX_GAP<=6 guarantee — legitimate mandatory content (an
  // album track landing in the same window as the other focus song's own
  // play) can still combine past that on rare occasions, and the fix
  // doesn't pretend otherwise. What IS guaranteed: nothing like the
  // pre-fix pathological cases (up to 14 from the uncoordinated version,
  // 6+ album tracks stacked from the uncoordinated placement version).
  // 14 album tracks across 15 focus plays (10+5) was the exact reported
  // reproduction scenario.
  let maxSeenA = 0, maxSeenB = 0
  const N = 150
  for (let trial = 0; trial < N; trial++) {
    const focusSongs = [mkFocusSong('A', 10, 200000), mkFocusSong('B', 5, 195000)]
    const { order } = buildPlaylistOrder2Focus(
      focusSongs, mkSpacerPool(150), mkFillerPool(60), mkAlbum(14), 180 * 60000, 20, MIN_GAP_MS,
    )
    maxSeenA = Math.max(maxSeenA, maxWindow(order, 'A'))
    maxSeenB = Math.max(maxSeenB, maxWindow(order, 'B'))
  }
  assert.ok(maxSeenA <= 10, `A's worst window reached ${maxSeenA} across ${N} trials — regression toward the pre-fix pathological clustering`)
  assert.ok(maxSeenB <= 10, `B's worst window reached ${maxSeenB} across ${N} trials — regression toward the pre-fix pathological clustering`)
})

test('buildPlaylistOrder2Focus never stacks more than 1 album track back-to-back', () => {
  // Direct check on the placement-coordination fix itself: consecutive
  // album-track entries in the output (not just within a same-song
  // window) should never exceed 1, confirming slots are actually
  // non-colliding rather than merely "usually spread out".
  for (let trial = 0; trial < 150; trial++) {
    const focusSongs = [mkFocusSong('A', 10, 200000), mkFocusSong('B', 5, 195000)]
    const { order } = buildPlaylistOrder2Focus(
      focusSongs, mkSpacerPool(150), mkFillerPool(60), mkAlbum(14), 180 * 60000, 20, MIN_GAP_MS,
    )
    let run = 0
    for (const t of order) {
      if (t.isAlbumTrack) { run++; assert.ok(run <= 1, `2+ album tracks landed back-to-back in trial ${trial}`) } else run = 0
    }
  }
})

console.log(`\n${passed} tests passed`)
