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
  planGapCounts, planFocusGapCounts, shuffle, artistInterleave,
  buildBurstSkeleton, buildFocusOrder, buildDistributedFocusOrder,
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

function repeatWindows(order, key) {
  const windows = []
  let previous = -1
  for (let i = 0; i < order.length; i++) {
    if (order[i].key !== key) continue
    if (previous >= 0) windows.push(order.slice(previous + 1, i))
    previous = i
  }
  return windows
}

function seededRng(seed) {
  let state = seed >>> 0
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296)
}

function mkDeterministicSpacerPool(count = 150) {
  return Array.from({ length: count }, (_, i) => ({
    key: `stable-bts-${i}`, uri: `stable-bts-${i}`, id: `stable-bts-${i}`,
    name: `Stable BTS ${i}`,
    // Includes realistic short catalog tracks plus ample 4:00+ tracks for
    // the explicit two-filler duration rule.
    durationMs: i % 7 === 0 ? 95000 : 185000 + (i % 10) * 13000,
    isBTS: true, artists: ['bts'],
  }))
}

function mkDeterministicFillerPool(count = 60) {
  return Array.from({ length: count }, (_, i) => ({
    uri: `stable-filler-${i}`, id: `stable-filler-${i}`,
    name: `Stable Filler ${i}`, durationMs: 155000 + (i % 10) * 14000,
    isBTS: false,
  }))
}

function mkDeterministicAlbum(count = 14) {
  return Array.from({ length: count }, (_, i) => ({
    key: `stable-album-${i}`, uri: `stable-album-${i}`, id: `stable-album-${i}`,
    name: `Stable Album ${i}`, durationMs: 95000 + (i % 10) * 22000,
  }))
}

function longestBtsRun(order) {
  let run = 0, longest = 0
  for (const track of order) {
    run = track.isBTS === false ? 0 : run + 1
    longest = Math.max(longest, run)
  }
  return longest
}

function histogram(values) {
  const out = {}
  for (const value of values) out[value] = (out[value] || 0) + 1
  return out
}

function pct(hist, values) {
  const total = Object.values(hist).reduce((sum, count) => sum + count, 0)
  return values.reduce((sum, value) => sum + (hist[value] || 0), 0) / total
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

test('planFocusGapCounts keeps each product profile inside its promised shape', () => {
  const rng = seededRng(7)
  assert.ok(planFocusGapCounts(9, 'tight', rng).every((gap) => gap === 3 || gap === 4))
  assert.ok(planFocusGapCounts(9, 'close-tight', rng).every((gap) => gap === 2 || gap === 3))
  assert.deepEqual([...new Set(planFocusGapCounts(9, 'balanced', rng))].sort(), [2, 3, 4, 5])
  assert.ok(planFocusGapCounts(8, 'spread', rng).every((gap) => gap >= 3 && gap <= 5))
  assert.ok(planFocusGapCounts(4, 'wide', rng).every((gap) => gap >= 4 && gap <= 6))
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

test('buildDistributedFocusOrder alternates close pairs and evenly spreads lopsided pairs', () => {
  for (const [m, n] of [[10, 10], [10, 9], [10, 5]]) {
    const out = buildDistributedFocusOrder(m, n, seededRng(m * 100 + n))
    assert.equal(out.filter((key) => key === 'A').length, m)
    assert.equal(out.filter((key) => key === 'B').length, n)
    if (m / n <= 1.2) {
      const lastB = out.lastIndexOf('B')
      for (let i = 1; i <= lastB; i++) assert.notEqual(out[i], out[i - 1])
    } else {
      const bPositions = out.map((key, i) => key === 'B' ? i : -1).filter((i) => i >= 0)
      const aCounts = bPositions.slice(1).map((position, i) =>
        out.slice(bPositions[i] + 1, position).filter((key) => key === 'A').length)
      assert.ok(aCounts.every((count) => count === 2), `B was not evenly spread: ${out.join('')}`)
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

test('buildPlaylistOrder2Focus enforces the requested 10:10, 10:9, and 10:5 patterns', () => {
  // Seeded full-builder coverage: exact counts, mandatory album placement,
  // runtime, the real eight-minute floor, R5, and the requested per-ratio
  // gap shapes. The previous <=10 assertion let the exact 7–10-track
  // regression under review pass; these bounds describe the product rule.
  const scenarios = [
    { pA: 10, pB: 10, maxA: 5, maxB: 5 },
    { pA: 10, pB: 9, maxA: 4, maxB: 5 },
    { pA: 10, pB: 5, maxA: 4, maxB: 8 },
  ]
  const N = 1000

  for (const scenario of scenarios) {
    const allA = [], allB = []
    let differentPatterns = 0
    for (let seed = 1; seed <= N; seed++) {
      const focusSongs = [
        mkFocusSong('A', scenario.pA, 200000),
        mkFocusSong('B', scenario.pB, 195000),
      ]
      const { order } = buildPlaylistOrder2Focus(
        focusSongs,
        mkDeterministicSpacerPool(),
        mkDeterministicFillerPool(),
        mkDeterministicAlbum(),
        180 * 60000,
        20,
        MIN_GAP_MS,
        { rng: seededRng(seed) },
      )

      const windowsA = repeatWindows(order, 'A')
      const windowsB = repeatWindows(order, 'B')
      const gapsA = windowsA.map((window) => window.length)
      const gapsB = windowsB.map((window) => window.length)
      allA.push(...gapsA)
      allB.push(...gapsB)
      if (gapsA.join(',') !== gapsB.join(',')) differentPatterns++

      assert.equal(order.filter((t) => t.key === 'A').length, scenario.pA)
      assert.equal(order.filter((t) => t.key === 'B').length, scenario.pB)
      assert.equal(order.filter((t) => t.isAlbumTrack).length, 14)
      assert.ok(order.reduce((sum, t) => sum + (t.durationMs || 0), 0) <= 180 * 60000)
      assert.ok(!order[0].isFocus, 'playlist opened on a focus song')
      assert.ok(longestBtsRun(order) <= 14, `R5 failed for ${scenario.pA}:${scenario.pB}, seed ${seed}`)
      assert.ok(Math.max(...gapsA) <= scenario.maxA, `A exceeded ${scenario.maxA}: ${gapsA}`)
      assert.ok(Math.max(...gapsB) <= scenario.maxB, `B exceeded ${scenario.maxB}: ${gapsB}`)
      for (const window of [...windowsA, ...windowsB]) {
        assert.ok(window.reduce((sum, t) => sum + (t.durationMs || 0), 0) >= MIN_GAP_MS,
          `repeat window fell under eight minutes for ${scenario.pA}:${scenario.pB}, seed ${seed}`)
      }

      let lastFocus = -1
      for (let i = 0; i < order.length; i++) if (order[i].isFocus) lastFocus = i
      assert.equal(order.slice(lastFocus + 1).filter((t) => t.isAlbumTrack).length, 0,
        `album track was force-flushed after the final focus song for seed ${seed}`)
    }

    const histA = histogram(allA), histB = histogram(allB)
    if (scenario.pB === 10) {
      assert.ok(pct(histA, [3, 4]) >= 0.80, `10:10 A lost its 3/4 center: ${JSON.stringify(histA)}`)
      assert.ok(pct(histB, [3, 4]) >= 0.80, `10:10 B lost its 3/4 center: ${JSON.stringify(histB)}`)
      assert.ok(pct(histA, [5]) <= 0.20 && pct(histB, [5]) <= 0.20, '5 stopped being rare in 10:10')
      assert.ok(differentPatterns / N >= 0.95, 'equal-count songs reused the same pattern too often')
    } else if (scenario.pB === 9) {
      assert.ok(pct(histA, [3, 4]) >= 0.90, `10:9 A is not concentrated on 3/4: ${JSON.stringify(histA)}`)
      assert.ok((histB[4] || 0) > (histB[3] || 0), `10:9 B should favor 4 over 3: ${JSON.stringify(histB)}`)
      assert.ok(pct(histB, [5]) <= 0.15, `10:9 B uses 5 too often: ${JSON.stringify(histB)}`)
    } else {
      assert.ok(pct(histA, [3, 4]) >= 0.90, `10:5 A is not concentrated on 3/4: ${JSON.stringify(histA)}`)
      assert.ok(pct(histB, [7, 8]) >= 0.90, `10:5 B is not spread wider than A: ${JSON.stringify(histB)}`)
    }
  }
})

test('a true two-filler selection uses two individually 4:00+ BTS tracks', () => {
  const { order } = buildPlaylistOrder2Focus(
    [mkFocusSong('A', 2, 200000), mkFocusSong('B', 2, 195000)],
    mkDeterministicSpacerPool(), mkDeterministicFillerPool(), [],
    180 * 60000, 20, MIN_GAP_MS, { rng: seededRng(41) },
  )
  const twoFillerWindows = [...repeatWindows(order, 'A'), ...repeatWindows(order, 'B')]
    .map((window) => window.filter((track) => !track.isFocus))
    .filter((fillers) => fillers.length === 2)
  assert.ok(twoFillerWindows.length > 0, 'fixture did not produce a two-filler window')
  for (const fillers of twoFillerWindows) {
    assert.ok(fillers.every((track) => track.isBTS && track.durationMs > 240000),
      `two-filler window contained a short/non-BTS track: ${fillers.map((t) => t.durationMs)}`)
  }
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
