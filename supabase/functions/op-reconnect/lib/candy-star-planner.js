// Pure, dependency-free planner helpers for the Candy Star generator.
// Deliberately plain .js (no Deno-only imports, no TypeScript syntax) so
// the exact same module can be imported both by the real Deno edge
// function (candy-star-rules.ts) and by a plain Node test — one
// implementation, not a hand-maintained mirror that can drift from what's
// actually deployed.

export function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Interleave songs by primary artist so no more than ~1 consecutive track
// from the same member.
export function artistInterleave(songs) {
  const groups = new Map()
  for (const s of songs) {
    const artist = (s.artists?.[0] || '').toLowerCase() || 'bts'
    if (!groups.has(artist)) groups.set(artist, [])
    groups.get(artist).push(s)
  }
  const keys = [...groups.keys()]
  const result = []
  let changed = true
  while (changed) {
    changed = false
    for (const k of keys) {
      const g = groups.get(k)
      if (g.length) { result.push(g.shift()); changed = true }
    }
  }
  return result
}

/** Plan n gap-track-counts summing to `total` (clamped into the feasible
 *  [n*MIN_G, n*MAX_G] range first — an out-of-range `total` used to make
 *  the balancing loop below exit early at n*MIN_G or n*MAX_G silently,
 *  which didn't match this function's "sums to total" contract), centered
 *  on 3 with 2/4 as common shoulders and 5/6 rare. */
export function planGapCounts(n, total) {
  if (n <= 0) return []
  const MIN_G = 1, MAX_G = 6, MODE = 3
  const clampedTotal = Math.max(n * MIN_G, Math.min(n * MAX_G, total))
  const plan = new Array(n).fill(MODE)
  let sum = plan.reduce((a, b) => a + b, 0)
  const idxOrder = shuffle([...Array(n).keys()])
  let iter = 0
  while (sum !== clampedTotal && iter < n * 100) {
    const idx = idxOrder[iter % n]
    if (sum < clampedTotal && plan[idx] < MAX_G) { plan[idx]++; sum++ } else
    if (sum > clampedTotal && plan[idx] > MIN_G) { plan[idx]--; sum-- }
    iter++
  }
  // Sum-preserving +1/-1 swaps for natural variety around the target sum.
  for (let pass = 0; pass < n * 2; pass++) {
    const a = Math.floor(Math.random() * n), b = Math.floor(Math.random() * n)
    if (a === b) continue
    if (Math.random() < 0.4 && plan[a] < MAX_G && plan[b] > MIN_G) { plan[a]++; plan[b]-- }
  }
  return shuffle(plan)
}

/** Build one candidate near-alternating 'A'/'B' skeleton for m A-plays and
 *  n B-plays: prefers switching songs each step (targetRatio), allows up
 *  to 2 of the busier song in a row but never a direct repeat of the other,
 *  and — critically — when NEITHER preference can be honored (only
 *  possible once one song is exhausted and the other's own no-3-in-a-row
 *  rule is blocking the next slot), drains whichever song still has plays
 *  left rather than assuming it's always B. An earlier version only ever
 *  drained B in that branch, which silently dropped the rest of A's plays
 *  whenever A was the one still holding a remainder — the no-repeat rules
 *  are discretionary shape preferences, not correctness requirements, so
 *  every requested play landing takes priority over their shape. */
export function buildBurstSkeleton(m, n, targetRatio = 0.97) {
  const out = []
  let remA = m, remB = n
  while (remA + remB > 0) {
    const prev = out.length > 0 ? out[out.length - 1] : ''
    const prev2 = out.length > 1 ? out[out.length - 2] : ''
    const canA = remA > 0 && !(prev === 'A' && prev2 === 'A')
    const canB = remB > 0 && prev !== 'B'
    if (!canA && !canB) {
      while (remA > 0) { out.push('A'); remA-- }
      while (remB > 0) { out.push('B'); remB-- }
      break
    }
    if (!canA) { out.push('B'); remB--; continue }
    if (!canB) { out.push('A'); remA--; continue }
    let choice
    if (prev === 'A') choice = Math.random() < targetRatio ? 'B' : 'A'
    else if (prev === 'B') choice = Math.random() < targetRatio ? 'A' : 'B'
    else choice = Math.random() < remA / (remA + remB) ? 'A' : 'B'
    if (choice === 'A') { out.push('A'); remA-- } else { out.push('B'); remB-- }
  }
  return out
}

const altRatio = (arr) =>
  arr.length < 2 ? 0 : arr.filter((k, i) => i > 0 && k !== arr[i - 1]).length / (arr.length - 1)

/** Best-of-8-attempts wrapper around buildBurstSkeleton, picking whichever
 *  candidate's actual alternation ratio lands closest to targetRatio. */
export function buildFocusOrder(m, n, targetRatio = 0.97, attempts = 8) {
  let best = buildBurstSkeleton(m, n, targetRatio)
  let bestDist = Math.abs(altRatio(best) - targetRatio)
  for (let attempt = 1; attempt < attempts; attempt++) {
    const candidate = buildBurstSkeleton(m, n, targetRatio)
    const dist = Math.abs(altRatio(candidate) - targetRatio)
    if (dist < bestDist) { best = candidate; bestDist = dist }
  }
  return best
}

/**
 * 2-focus playlist order builder — near-alternation skeleton (buildFocusOrder
 * above) + coordinated placement of gap spacers, album tracks, and non-BTS
 * checkpoints, all sharing ONE live capacity budget across both focus songs.
 *
 * Earlier versions gated spacer delivery against a MAX_GAP window cap but
 * placed album tracks via a separate pre-computed splice pass (blind to
 * live window state — could still pile several into one window) and fired
 * checkpoints unconditionally on their own timer (could also push a window
 * over the cap). Every kind of neutral (non-focus) content now goes through
 * the same capRoom() gate: album tracks and checkpoints are only placed
 * once their turn comes up in the sequence AND there's live room, deferred
 * (not skipped) otherwise, with a mandatory force-flush at the very end so
 * neither is ever silently lost — same "never lose requested/selected
 * content" guarantee buildFocusOrder already gives the focus plays
 * themselves.
 *
 * MIN_GAP_MS is passed in (not imported) because this module has to stay
 * plain JS with no TypeScript-file imports — see the module header.
 */
export function buildPlaylistOrder2Focus(
  focusSongs, btsSpacers, nonBtsFillers, albumOnce, targetMs, fillerEvery, MIN_GAP_MS,
) {
  const btsQ = artistInterleave(shuffle(btsSpacers)); let bi = 0
  const nbQ = shuffle(nonBtsFillers); let fi = 0

  const order = []
  let ms = 0
  const truncated = false
  let sinceNonBts = 0
  const push = (t) => {
    order.push(t); ms += t.durationMs || 210000
    if (t.isBTS === false) sinceNonBts = 0
    else sinceNonBts++
  }

  const btsRecycle = () => {
    if (bi >= btsQ.length && btsQ.length > 0) {
      const mid = Math.ceil(btsQ.length / 2)
      const rnd = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]] }; return a }
      btsQ.splice(0, btsQ.length, ...rnd(btsQ.slice(0, mid)), ...rnd(btsQ.slice(mid)))
      bi = 0
    }
  }
  const nextCheckpointGapMs = () => (30 + Math.random() * 15) * 60000
  let remainingCheckpoints = targetMs >= 120 * 60000 ? 2 : 0
  let nextCheckpointMs = remainingCheckpoints > 0 ? nextCheckpointGapMs() : Infinity
  const reservedForCheckpoints = () => remainingCheckpoints
  const nonReservedNonBtsAvailable = () => fi < nbQ.length - reservedForCheckpoints()

  const pushSpacer = () => {
    btsRecycle()
    if (bi < btsQ.length) { push({ ...btsQ[bi++], isBTS: true }); return true }
    if (nonReservedNonBtsAvailable()) { push({ ...nbQ[fi++], isBTS: false }); return true }
    return false
  }
  const pushGapFiller = (remainingMs) => {
    btsRecycle()
    const end = Math.min(bi + 20, btsQ.length)
    let bestIdx = -1, bestDur = Infinity
    let longestIdx = -1, longestDur = -1
    for (let i = bi; i < end; i++) {
      const d = btsQ[i].durationMs || 0
      if (d >= remainingMs && d < bestDur) { bestDur = d; bestIdx = i }
      if (d > longestDur) { longestDur = d; longestIdx = i }
    }
    const pick = bestIdx >= 0 ? bestIdx : longestIdx
    if (pick > bi) { const tmp = btsQ[bi]; btsQ[bi] = btsQ[pick]; btsQ[pick] = tmp }
    if (bi < btsQ.length) { push({ ...btsQ[bi++], isBTS: true }); return true }
    if (nonReservedNonBtsAvailable()) { push({ ...nbQ[fi++], isBTS: false }); return true }
    return false
  }
  const pushSpacers = (count) => { for (let i = 0; i < count; i++) { if (!pushSpacer()) return } }

  const [songA, songB] = [...focusSongs].sort((a, b) => b.plays - a.plays)
  const m = songA.plays, n = songB.plays

  const focusOrder = buildFocusOrder(m, n)
  const focusSeq = []
  let vA = 0, vB = 0
  for (const key of focusOrder) {
    if (key === 'A') {
      const v = songA.versions[vA % songA.versions.length]
      focusSeq.push({ key: songA.key, uri: v.uri, id: v.id, name: songA.name, isrc: v.isrc || songA.isrc, durationMs: v.durationMs || songA.durationMs, isBTS: true, isFocus: true, album: v.album })
      vA++
    } else {
      const v = songB.versions[vB % songB.versions.length]
      focusSeq.push({ key: songB.key, uri: v.uri, id: v.id, name: songB.name, isrc: v.isrc || songB.isrc, durationMs: v.durationMs || songB.durationMs, isBTS: true, isFocus: true, album: v.album })
      vB++
    }
  }

  const DURATION_TOLERANCE_MS = 2000
  const lastPlayed = {}

  // Each song gets its own target average, planned independently — the
  // busier song (A) stays tight, the other (B) scales up modestly by how
  // much less it plays. See candy-star-rules.ts's history for why these
  // are independent per-song targets rather than a shared pre-split pool
  // (a shared pool went negative for one song when both had high play
  // counts), and why they're kept modest (3.0-3.8) rather than higher
  // (implied more total runtime than fits even the hard cap for two
  // busy songs).
  const aAvg = 3.0
  const ratio = n > 0 ? m / n : 1
  const bAvg = m === n ? 3.0 : ratio <= 1.2 ? 3.4 : 3.8
  const aTotal = Math.round(m * aAvg)
  const bTotal = Math.round(n * bAvg)
  const gapPlanA = planGapCounts(m, aTotal)
  const gapPlanB = planGapCounts(n, bTotal)

  const avgSpacerMs = btsQ.length > 0
    ? btsQ.reduce((s, t) => s + (t.durationMs || 210000), 0) / btsQ.length
    : 210000
  const HARD_CAP_MS = 179 * 60 * 1000
  const softTargetMs = Math.min(targetMs, 145 * 60 * 1000, HARD_CAP_MS)
  const focusSuffixMs = new Array(focusSeq.length + 1).fill(0)
  for (let fk = focusSeq.length - 1; fk >= 0; fk--) {
    focusSuffixMs[fk] = focusSuffixMs[fk + 1] + (focusSeq[fk].durationMs || 210000)
  }
  const roomForSpacer = (k) => ms + focusSuffixMs[k] + avgSpacerMs <= softTargetMs

  const MAX_GAP = 6
  let windowCountA = 0, windowCountB = 0
  const addNeutral = (x) => { windowCountA += x; windowCountB += x }
  const capRoom = () => Math.max(0, MAX_GAP - Math.max(windowCountA, windowCountB))

  // Album tracks are mandatory content (same guarantee as focus plays) but
  // their PLACEMENT is discretionary — paced evenly across the focus
  // sequence via target slots, only actually placed once a slot's target
  // is reached AND there's live capacity, deferred otherwise, force-placed
  // at the end if capacity never opened up.
  const albumQueue = shuffle(albumOnce)
  let albumIdx = 0
  const albumTargets = albumQueue.map((_, i) =>
    Math.round((i + 0.5) * focusSeq.length / Math.max(1, albumQueue.length)),
  )
  // At most ONE per call, deliberately — if the queue backs up while
  // capacity is unavailable (several targets accumulate <= focusIdx) and
  // capacity then opens up, a `while` here would dump all of them at once,
  // landing them back-to-back in `order` even though each individual
  // target slot was itself non-colliding. Placing at most one per focus
  // entry means any backlog spreads across subsequent entries instead.
  const tryPlaceAlbumTracks = (focusIdx) => {
    if (albumIdx < albumQueue.length && albumTargets[albumIdx] <= focusIdx && capRoom() > 0) {
      push({ ...albumQueue[albumIdx], isBTS: true, isAlbumTrack: true })
      addNeutral(1)
      albumIdx++
    }
  }

  pushSpacers(2)

  let gapCursorA = 0, gapCursorB = 0
  for (let k = 0; k < focusSeq.length; k++) {
    let curr = focusSeq[k]
    const isSongA = curr.key === songA.key

    if (k > 0) {
      const plannedGap = isSongA ? gapPlanA[gapCursorA++] : gapPlanB[gapCursorB++]
      const ownWindowCount = isSongA ? windowCountA : windowCountB
      const stillNeeded = Math.max(0, plannedGap - ownWindowCount)
      const effectiveGap = Math.min(stillNeeded, capRoom())

      const ck = curr.key || curr.isrc || curr.uri || curr.id
      const prev = lastPlayed[ck]
      const isDistinctVersion = !!prev && Math.abs((prev.durationMs || 0) - (curr.durationMs || 0)) > DURATION_TOLERANCE_MS
      let gapAccumMs = (prev && !isDistinctVersion) ? Math.max(0, ms - prev.ms) : 0
      let pushedThisGap = 0
      for (let g = 0; g < effectiveGap && roomForSpacer(k); g++) {
        const stepsLeft = effectiveGap - g
        const remainingToFloor = Math.max(0, MIN_GAP_MS - gapAccumMs)
        const perStepTarget = stepsLeft > 0 ? Math.ceil(remainingToFloor / stepsLeft) : 0
        const ok = perStepTarget > 0 ? pushGapFiller(perStepTarget) : pushSpacer()
        if (!ok) break
        pushedThisGap++
        gapAccumMs += order[order.length - 1].durationMs || 0
      }
      addNeutral(pushedThisGap)

      if (prev && !isDistinctVersion) {
        // NOT capped by MAX_GAP — compliance can't be capped, only the
        // discretionary roll-out above can. Trading a wider-than-usual gap
        // for staying compliant with the mandatory same-song floor is the
        // only acceptable choice here.
        let extraPushed = 0
        while (ms - prev.ms < MIN_GAP_MS) {
          if (!pushGapFiller(MIN_GAP_MS - (ms - prev.ms))) break
          extraPushed++
        }
        addNeutral(extraPushed)
      }

      if (sinceNonBts >= fillerEvery && capRoom() > 0) {
        if (pushGapFiller(0)) addNeutral(1)
      }
    }

    // Avoid the exact same Spotify recording landing back to back — can
    // happen when the album's own tracklist includes the focus song
    // itself (e.g. SWIM as both a focus pick and an ARIRANG album track).
    const lastInOrder = order[order.length - 1]
    if (lastInOrder && lastInOrder.uri === curr.uri) {
      const song = isSongA ? songA : songB
      const alt = song.versions.find((v) => v.uri !== lastInOrder.uri)
      if (alt) curr = { ...curr, uri: alt.uri, id: alt.id, album: alt.album }
    }

    push(curr)
    lastPlayed[curr.key || curr.isrc || curr.uri || curr.id] = { ms, durationMs: curr.durationMs }
    if (isSongA) { windowCountA = 0; windowCountB++ } else { windowCountB = 0; windowCountA++ }

    // Deliberately NOT gated by capRoom(), unlike album tracks — tried
    // that first, and it regressed a DIFFERENT rule (R5, "non-BTS fillers
    // interspersed"): deferring a checkpoint until capacity opens up let
    // the run of consecutive BTS tracks before it grow long enough to fail
    // R5 in 2 of 3 real generations. Checkpoints only fire twice total per
    // playlist (vs. album tracks which can number a dozen-plus) so their
    // contribution to any single same-song window is much smaller — firing
    // them on schedule, same as before this rewrite, is the better
    // trade-off here.
    while (remainingCheckpoints > 0 && ms >= nextCheckpointMs) {
      if (fi < nbQ.length) { push({ ...nbQ[fi++], isBTS: false }); addNeutral(1) }
      remainingCheckpoints--
      nextCheckpointMs = ms + nextCheckpointGapMs()
    }

    tryPlaceAlbumTracks(k)
  }

  // Mandatory flush: anything still queued (album tracks that never found
  // a low-capacity window, checkpoints that never got a turn) gets placed
  // now rather than silently dropped. A spacer between each leftover album
  // track (rather than dumping them raw back-to-back) keeps this fallback
  // path from reintroducing the exact clustering the placement logic above
  // exists to prevent — this path is common enough in practice (a backlog
  // that never fully clears before the sequence ends) to matter, not just
  // a rare edge case.
  while (albumIdx < albumQueue.length) {
    push({ ...albumQueue[albumIdx], isBTS: true, isAlbumTrack: true })
    albumIdx++
    if (albumIdx < albumQueue.length) pushSpacer()
  }
  while (remainingCheckpoints > 0 && fi < nbQ.length) {
    push({ ...nbQ[fi++], isBTS: false })
    remainingCheckpoints--
  }

  pushSpacers(2)

  return { order, usedFillers: fi, usedSpacers: bi, truncated }
}
