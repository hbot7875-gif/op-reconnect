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
  buildPlaylistOrder2Focus, dedupeTracksByIdentity, excludeTracksByIdentity,
  mergeSavedTracksWithPlan, hasHeavyFocusConflict, pickVariedDurationIndex,
  mergeGoalAlbums, isAllowedCustomCombo, goalAlbumGaps,
} from './candy-star-planner.js'

const MIN_GAP_MS = 480000 // matches spotify-shared.ts's MIN_GAP_MS — duplicated because that's a
// .ts file this plain-JS module can't import; see the module header for why.

function mkFocusSong(key, plays, durationMs) {
  return {
    key, name: key, plays, durationMs,
    // Deliberately different durations reproduce cover/remix rotation. The
    // same catalog song must still keep the full eight-minute repeat gap.
    versions: [
      { id: `${key}-v1`, uri: `u-${key}-1`, durationMs },
      { id: `${key}-v2`, uri: `u-${key}-2`, durationMs: durationMs + 15000 },
    ],
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

function nonBtsCheckpointGaps(order) {
  const gaps = []
  let elapsedMs = 0
  let previousCheckpointEndMs = 0
  for (const track of order) {
    const durationMs = track.durationMs || 0
    if (track.isBTS === false) {
      gaps.push((elapsedMs - previousCheckpointEndMs) / 60000)
      previousCheckpointEndMs = elapsedMs + durationMs
    }
    elapsedMs += durationMs
  }
  return gaps
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
let failed = 0
// Every test runs even after one fails. The previous version let the first
// assertion abort the whole module, so `node --test` reported 13 of 27 tests
// and stayed silent about the other 13 — including the play-count-loss
// regression guard. A red suite must never be able to hide what else broke.
function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`ok - ${name}`)
  } catch (error) {
    failed++
    console.log(`not ok - ${name}`)
    console.log(String(error && error.message).split('\n').map((line) => `    ${line}`).join('\n'))
  }
}
process.on('exit', () => {
  console.log(`# ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
})

test('dedupeTracksByIdentity treats alternate Spotify IDs with one ISRC as one filler', () => {
  const first = { id: 'track-a', isrc: 'us-abc-12-34567', name: 'Original' }
  const alternateId = { id: 'track-b', isrc: 'USABC1234567', name: 'Same recording' }
  const unique = { id: 'track-c', isrc: 'GBXYZ7654321', name: 'Different recording' }
  assert.deepEqual(dedupeTracksByIdentity([first, alternateId, unique]), [first, unique])
})

test('dedupeTracksByIdentity falls back to Spotify id/URI when ISRC is missing', () => {
  const tracks = [
    { id: 'one', name: 'One' },
    { track_id: 'one', name: 'Duplicate One' },
    { uri: 'spotify:track:two', name: 'Two' },
    { uri: 'spotify:track:two', name: 'Duplicate Two' },
  ]
  assert.deepEqual(dedupeTracksByIdentity(tracks).map((t) => t.name), ['One', 'Two'])
})

test('dedupeTracksByIdentity matches the same Spotify ID even when only one copy has an ISRC', () => {
  const id = '1234567890123456789012'
  const hydrated = { id, isrc: 'USRC17607839', name: 'Hydrated' }
  const stale = { uri: `spotify:track:${id}`, isrc: null, name: 'Stale catalog copy' }
  assert.deepEqual(dedupeTracksByIdentity([hydrated, stale]), [hydrated])
})

test('excludeTracksByIdentity removes filler collisions across catalog pools', () => {
  const fillerA = { id: 'AAAAAAAAAAAAAAAAAAAAAA', isrc: 'USRC17607839', name: 'Same recording' }
  const fillerB = { id: 'BBBBBBBBBBBBBBBBBBBBBB', isrc: 'GBUM71029604', name: 'Unique filler' }
  const staleCatalogCopy = { uri: 'spotify:track:AAAAAAAAAAAAAAAAAAAAAA', isrc: null }
  assert.deepEqual(excludeTracksByIdentity([fillerA, fillerB], [staleCatalogCopy]), [fillerB])
})

test('mergeSavedTracksWithPlan keeps live metadata and restores focus roles and song keys', () => {
  const saved = [
    { id: 'live-focus', isrc: 'LIVE123', durationMs: 180123, isBTS: false },
    { id: 'live-filler', isrc: 'FILL456', durationMs: 250456, isBTS: true },
  ]
  const planned = [
    { id: 'stored-focus', key: 'song:dsylm', isBTS: true, isFocus: true },
    { id: 'stored-filler', isBTS: false },
  ]
  assert.deepEqual(mergeSavedTracksWithPlan(saved, planned), [
    { id: 'live-focus', isrc: 'LIVE123', durationMs: 180123, key: 'song:dsylm', isBTS: true, isFocus: true, isAlbumTrack: false },
    { id: 'live-filler', isrc: 'FILL456', durationMs: 250456, key: undefined, isBTS: false, isFocus: false, isAlbumTrack: false },
  ])
  assert.throws(() => mergeSavedTracksWithPlan(saved.slice(0, 1), planned), /saved 1 of 2/)
})

test('15x focus is exclusive while lower-count and duplicate-key input remain valid', () => {
  assert.equal(hasHeavyFocusConflict([
    { key: 'swim', multiplier: 15 }, { key: 'winter-ahead', multiplier: 10 },
  ]), true)
  assert.equal(hasHeavyFocusConflict([
    { key: 'home', multiplier: 12 }, { key: 'astronaut', multiplier: 10 },
  ]), false)
  assert.equal(hasHeavyFocusConflict([{ key: 'swim', multiplier: 15 }]), false)
  assert.equal(hasHeavyFocusConflict([
    { key: 'swim', multiplier: 15 }, { key: 'swim', multiplier: 2 },
  ]), false)
})

test('custom combinations allow two focus songs without forcing an album', () => {
  assert.equal(isAllowedCustomCombo(2, 0), true)
  assert.equal(isAllowedCustomCombo(3, 0), true) // Quick picker promises this shape
  assert.equal(isAllowedCustomCombo(1, 1), true)
  assert.equal(isAllowedCustomCombo(1, 0), false)
  assert.equal(isAllowedCustomCombo(2, 2), false)
})

test('duration-aware selection rotates among equally safe fillers', () => {
  const candidates = Array.from({ length: 8 }, (_, i) => ({
    id: `candidate-${i}`, durationMs: 481000 + i * 1000,
  }))
  const rng = seededRng(91827)
  const picked = new Set()
  for (let i = 0; i < 100; i++) {
    picked.add(pickVariedDurationIndex(candidates, 0, 480000, 0, rng))
  }
  assert.ok(picked.size >= 4, `duration picker stayed too repetitive: ${[...picked]}`)
  for (const index of picked) assert.ok(candidates[index].durationMs >= 480000)
})

test('fully-matched district album goals automatically join the album picker', () => {
  // Live Persona catalog rows currently have keys but unresolved versions;
  // matching the album must not depend on those versions already existing.
  const catalogSong = (name, key) => ({ name, key, versions: [] })
  const catalog = [
    catalogSong('Intro : Persona', 'intro-persona'),
    catalogSong('Boy With Luv (feat. Halsey)', 'boy-with-luv'),
    catalogSong('Mikrokosmos', 'mikrokosmos'),
    catalogSong('Make It Right', 'make-it-right'),
    catalogSong('HOME', 'home'),
    catalogSong('Jamais Vu', 'jamais-vu'),
    catalogSong('Dionysus', 'dionysus'),
  ]
  const goals = [{
    id: 'persona', kind: 'album', label: 'MAP OF THE SOUL : PERSONA',
    tracks: [
      { label: 'Intro : Persona', aliases: [] },
      { label: 'Boy With Luv (Feat. Halsey)', aliases: ['Boy With Luv'] },
      { label: 'Mikrokosmos', aliases: [] },
      { label: 'Make It Right', aliases: [] },
      { label: 'HOME', aliases: [] },
      { label: 'Jamais Vu', aliases: [] },
      { label: 'Dionysus', aliases: [] },
    ],
  }]
  const merged = mergeGoalAlbums({}, catalog, goals)
  assert.deepEqual(merged['goal:persona'].trackKeys, [
    'intro-persona', 'boy-with-luv', 'mikrokosmos', 'make-it-right', 'home', 'jamais-vu', 'dionysus',
  ])

  const incomplete = mergeGoalAlbums({}, catalog.slice(0, 6), goals)
  assert.equal(incomplete['goal:persona'], undefined, 'partial album should never be offered')
})

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
  assert.ok(planFocusGapCounts(8, 'close-spread', rng).every((gap) => gap === 3 || gap === 4))
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
  // runtime, the real eight-minute floor (even across alternate versions),
  // the two timed other-artist checkpoints, and the requested per-ratio
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
      const checkpointGaps = nonBtsCheckpointGaps(order)
      assert.equal(checkpointGaps.length, 2,
        `expected exactly two other-artist songs for ${scenario.pA}:${scenario.pB}, seed ${seed}`)
      for (const gap of checkpointGaps) {
        assert.ok(gap >= 30 && gap <= 45,
          `other-artist checkpoint landed at ${gap.toFixed(2)} min for ${scenario.pA}:${scenario.pB}, seed ${seed}`)
      }
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

test('12x + 10x uses a varied repeat pattern instead of continuous threes', () => {
  const observedA = new Set(), observedB = new Set()
  for (let seed = 1; seed <= 300; seed++) {
    const { order } = buildPlaylistOrder2Focus(
      [mkFocusSong('home', 12, 200000), mkFocusSong('astronaut', 10, 195000)],
      mkDeterministicSpacerPool(), mkDeterministicFillerPool(), mkDeterministicAlbum(),
      180 * 60000, 20, MIN_GAP_MS, { rng: seededRng(seed) },
    )
    for (const window of repeatWindows(order, 'home')) {
      observedA.add(window.length)
      assert.ok(window.reduce((sum, track) => sum + (track.durationMs || 0), 0) >= MIN_GAP_MS)
    }
    for (const window of repeatWindows(order, 'astronaut')) {
      observedB.add(window.length)
      assert.ok(window.reduce((sum, track) => sum + (track.durationMs || 0), 0) >= MIN_GAP_MS)
    }
  }
  assert.ok(observedA.has(3) && observedA.has(4), `Home pattern was too rigid: ${[...observedA]}`)
  assert.ok(observedB.has(3) && observedB.has(4), `Astronaut pattern was too rigid: ${[...observedB]}`)
})

test('a true two-filler selection uses the curated long-track pool and reaches eight minutes', () => {
  const curated = Array.from({ length: 40 }, (_, i) => ({
    id: `curated-${i}`, uri: `curated-${i}`, name: `Curated ${i}`,
    // Include Spotify's common 3:59 rounding edge. It is safe only when the
    // duration-aware partner makes the pair total at least eight minutes.
    durationMs: i % 5 === 0 ? 239000 : 243000 + (i % 4) * 3000,
    isBTS: true, artists: [`member-${i % 7}`], twoFillerSource: true,
  }))
  let observedPairs = 0
  for (let seed = 1; seed <= 100; seed++) {
    const { order } = buildPlaylistOrder2Focus(
      [mkFocusSong('A', 10, 200000), mkFocusSong('B', 10, 195000)],
      mkDeterministicSpacerPool(), mkDeterministicFillerPool(), [],
      180 * 60000, 20, MIN_GAP_MS, {
        rng: seededRng(seed), twoFillerSpacers: curated,
      },
    )
    const twoFillerWindows = [...repeatWindows(order, 'A'), ...repeatWindows(order, 'B')]
      .map((window) => window.filter((track) => !track.isFocus))
      // A due timed checkpoint may legitimately occupy one of the two
      // neutral slots. This assertion targets two-BTS-filler windows.
      .filter((fillers) => fillers.length === 2 && fillers.every((track) => track.isBTS !== false))
    observedPairs += twoFillerWindows.length
    for (const fillers of twoFillerWindows) {
      assert.ok(fillers.every((track) => track.twoFillerSource),
        `two-filler window escaped the curated pool: ${fillers.map((t) => t.name)}`)
      assert.ok(fillers.reduce((sum, track) => sum + track.durationMs, 0) >= MIN_GAP_MS,
        `curated pair fell under eight minutes: ${fillers.map((t) => t.durationMs)}`)
    }
  }
  assert.ok(observedPairs > 100, `fixture produced too few two-filler windows: ${observedPairs}`)
})

test('every repeated focus song has at least two real neutral fillers', () => {
  const scenarios = [
    { pA: 10, pB: 10, album: 0 },
    { pA: 10, pB: 9, album: 14 },
    { pA: 10, pB: 5, album: 0 },
  ]
  for (const scenario of scenarios) {
    for (let seed = 1; seed <= 250; seed++) {
      const { order } = buildPlaylistOrder2Focus(
        [mkFocusSong('A', scenario.pA, 200000), mkFocusSong('B', scenario.pB, 195000)],
        mkDeterministicSpacerPool(), mkDeterministicFillerPool(), mkDeterministicAlbum(scenario.album),
        180 * 60000, 20, MIN_GAP_MS, { rng: seededRng(seed) },
      )
      for (const [key, window] of [
        ...repeatWindows(order, 'A').map((window) => ['A', window]),
        ...repeatWindows(order, 'B').map((window) => ['B', window]),
      ]) {
        const neutralCount = window.filter((track) => !track.isFocus).length
        assert.ok(neutralCount >= 2,
          `${scenario.pA}:${scenario.pB} ${key} had ${neutralCount} neutral filler(s), seed ${seed}`)
      }
    }
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

test('an album goal that cannot fully match names its missing tracks instead of vanishing', () => {
  const catalog = [
    { key: 'k1', name: 'Intro: Persona' },
    { key: 'k2', name: 'Boy With Luv' },
  ]
  const goals = [{
    kind: 'album', id: 'persona', label: 'Map of the Soul: Persona',
    tracks: [
      { label: 'Intro: Persona' },
      { label: 'Boy With Luv' },
      { label: 'Mikrokosmos' },
      { label: 'Make It Right' },
    ],
  }]
  const map = mergeGoalAlbums({}, catalog, goals)
  // Still all-or-nothing: a partial album would generate a playlist that
  // silently omits songs, so it must not reach the picker.
  assert.equal(map['goal:persona'], undefined)
  const gaps = goalAlbumGaps(map)
  assert.equal(gaps.length, 1)
  assert.equal(gaps[0].name, 'Map of the Soul: Persona')
  assert.equal(gaps[0].reason, 'unmatched_tracks')
  assert.deepEqual(gaps[0].missing, ['Mikrokosmos', 'Make It Right'])

  // A fully matched goal album still joins the picker and reports no gap.
  const full = mergeGoalAlbums({}, [...catalog, { key: 'k3', name: 'Mikrokosmos' }, { key: 'k4', name: 'Make It Right' }], goals)
  assert.equal(full['goal:persona'].count, 4)
  assert.deepEqual(goalAlbumGaps(full), [])

  // The gaps list must never leak into album iteration.
  assert.equal(Object.values(full).length, 1)
})
