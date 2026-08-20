// Pure, dependency-free planner helpers for the Candy Star generator.
// Deliberately plain .js (no Deno-only imports, no TypeScript syntax) so
// the exact same module can be imported both by the real Deno edge
// function (candy-star-rules.ts) and by a plain Node test — one
// implementation, not a hand-maintained mirror that can drift from what's
// actually deployed.

export function shuffle(arr, rng = Math.random) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
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

/**
 * Remove duplicate Spotify recordings while preserving the first pool item.
 * Different track IDs can represent the same recording/mastering, so ISRC is
 * the primary identity and the Spotify id/URI is the fallback when no ISRC is
 * available. This is intentionally pure so production and Node tests share
 * the exact same dedupe rule.
 */
export function trackIdentityTokens(track) {
  const rawIsrc = String(track?.isrc || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  const rawId = String(track?.id || track?.track_id || track?.uri || '').trim()
  const idMatch = rawId.match(/(?:spotify:track:|open\.spotify\.com\/track\/)?([A-Za-z0-9]{22})(?:\?|$)/i)
  const spotifyId = idMatch?.[1] || rawId
  const tokens = []
  if (rawIsrc) tokens.push(`isrc:${rawIsrc}`)
  if (spotifyId) tokens.push(`id:${spotifyId}`)
  return tokens
}

export function dedupeTracksByIdentity(tracks) {
  const seen = new Set()
  const out = []
  for (const track of tracks || []) {
    const identities = trackIdentityTokens(track)
    if (identities.length === 0 || identities.some((identity) => seen.has(identity))) continue
    for (const identity of identities) seen.add(identity)
    out.push(track)
  }
  return out
}

/** Remove candidates that represent a recording already owned by another
 * pool. Both Spotify ID and ISRC participate so a stale catalog copy with no
 * ISRC still collides with a fully-hydrated filler carrying the same ID. */
export function excludeTracksByIdentity(tracks, excludedTracks) {
  const blocked = new Set((excludedTracks || []).flatMap(trackIdentityTokens))
  return (tracks || []).filter((track) =>
    !trackIdentityTokens(track).some((identity) => blocked.has(identity)))
}

/** Apply Spotify's saved recording metadata to the planner's positional
 * roles. Spotify supplies the authoritative ID/ISRC/duration, while only the
 * planner knows which occurrences are focus plays, album tracks, spacers, or
 * non-BTS fillers and which cover versions share one catalog song key. */
export function mergeSavedTracksWithPlan(savedTracks, plannedTracks) {
  if ((savedTracks || []).length !== (plannedTracks || []).length) {
    throw new Error(`Spotify saved ${(savedTracks || []).length} of ${(plannedTracks || []).length} planned tracks.`)
  }
  return savedTracks.map((saved, index) => {
    const planned = plannedTracks[index] || {}
    return {
      ...saved,
      key: planned.key || saved.key,
      isBTS: planned.isBTS === true,
      isFocus: planned.isFocus === true,
      isAlbumTrack: planned.isAlbumTrack === true,
    }
  })
}

/** Plan n gap-track-counts summing to `total` (clamped into the feasible
 *  [n*MIN_G, n*MAX_G] range first — an out-of-range `total` used to make
 *  the balancing loop below exit early at n*MIN_G or n*MAX_G silently,
 *  which didn't match this function's "sums to total" contract), centered
 *  on 3 with 2/4 as common shoulders and 5/6 rare. */
export function planGapCounts(n, total, rng = Math.random) {
  if (n <= 0) return []
  const MIN_G = 1, MAX_G = 6, MODE = 3
  const clampedTotal = Math.max(n * MIN_G, Math.min(n * MAX_G, total))
  const plan = new Array(n).fill(MODE)
  let sum = plan.reduce((a, b) => a + b, 0)
  const idxOrder = shuffle([...Array(n).keys()], rng)
  let iter = 0
  while (sum !== clampedTotal && iter < n * 100) {
    const idx = idxOrder[iter % n]
    if (sum < clampedTotal && plan[idx] < MAX_G) { plan[idx]++; sum++ } else
    if (sum > clampedTotal && plan[idx] > MIN_G) { plan[idx]--; sum-- }
    iter++
  }
  // Sum-preserving +1/-1 swaps for natural variety around the target sum.
  for (let pass = 0; pass < n * 2; pass++) {
    const a = Math.floor(rng() * n), b = Math.floor(rng() * n)
    if (a === b) continue
    if (rng() < 0.4 && plan[a] < MAX_G && plan[b] > MIN_G) { plan[a]++; plan[b]-- }
  }
  return shuffle(plan, rng)
}

/** Build the repeat-gap shape used by the two-focus planner. Unlike the
 * generic sum planner above, this deliberately keeps each profile inside
 * the product pattern: close-tight leaves headroom for the near-equal
 * partner's overlapping window, tight = mostly 3 with a few 4s, balanced =
 * a different 3/4 pattern with at most one rare 2/5 pair, spread = mostly 4
 * with occasional 3/5, and wide = 5-ish for the less-frequent song in a
 * lopsided pairing. The returned values are TOTAL visible tracks between
 * repeats, not an amount to append on top of content already in a window. */
export function planFocusGapCounts(n, profile, rng = Math.random) {
  if (n <= 0) return []

  let plan
  if (profile === 'close-tight') {
    plan = new Array(n).fill(2)
    for (let i = 0; i < Math.max(1, Math.round(n * 0.22)); i++) plan[i] = 3
  } else if (profile === 'tight') {
    plan = new Array(n).fill(3)
    for (let i = 0; i < Math.max(1, Math.round(n * 0.22)); i++) plan[i] = 4
  } else if (profile === 'balanced') {
    plan = new Array(n).fill(3)
    for (let i = 0; i < Math.round(n * 0.45); i++) plan[i] = 4
    if (n >= 7) { plan[0] = 2; plan[1] = 5 }
  } else if (profile === 'spread') {
    plan = new Array(n).fill(4)
    if (n >= 3) plan[0] = 3
    if (n >= 5) plan[1] = 5
  } else if (profile === 'close-spread') {
    // In a 10:9 pairing, mandatory partner/album tracks already create an
    // occasional five-track window. Plan four with one three so the final
    // result remains mostly four without turning five into a common case.
    plan = new Array(n).fill(4)
    if (n >= 3) plan[0] = 3
  } else {
    plan = new Array(n).fill(5)
    if (n >= 3) plan[0] = 4
    if (n >= 4) plan[1] = 6
  }
  return shuffle(plan, rng)
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
export function buildBurstSkeleton(m, n, targetRatio = 0.97, rng = Math.random) {
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
    if (prev === 'A') choice = rng() < targetRatio ? 'B' : 'A'
    else if (prev === 'B') choice = rng() < targetRatio ? 'A' : 'B'
    else choice = rng() < remA / (remA + remB) ? 'A' : 'B'
    if (choice === 'A') { out.push('A'); remA-- } else { out.push('B'); remB-- }
  }
  return out
}

const altRatio = (arr) =>
  arr.length < 2 ? 0 : arr.filter((k, i) => i > 0 && k !== arr[i - 1]).length / (arr.length - 1)

/** Best-of-8-attempts wrapper around buildBurstSkeleton, picking whichever
 *  candidate's actual alternation ratio lands closest to targetRatio. */
export function buildFocusOrder(m, n, targetRatio = 0.97, attempts = 8, rng = Math.random) {
  let best = buildBurstSkeleton(m, n, targetRatio, rng)
  let bestDist = Math.abs(altRatio(best) - targetRatio)
  for (let attempt = 1; attempt < attempts; attempt++) {
    const candidate = buildBurstSkeleton(m, n, targetRatio, rng)
    const dist = Math.abs(altRatio(candidate) - targetRatio)
    if (dist < bestDist) { best = candidate; bestDist = dist }
  }
  return best
}

/** Focus-only order for the full two-song builder. Close-count pairs stay
 * strictly alternating until the smaller count is exhausted; lopsided
 * pairs distribute the smaller song evenly across the larger one. This
 * avoids an A-A burst while B still has a tight 3–5-track window open — a
 * structural conflict that no spacer picker can repair without overflowing
 * B in order to give A its mandatory eight-minute repeat gap. */
export function buildDistributedFocusOrder(m, n, rng = Math.random) {
  if (n <= 0) return new Array(m).fill('A')
  const out = []
  if (m / n <= 1.2) {
    const bFirst = rng() < 0.5
    for (let i = 0; i < n; i++) out.push(...(bFirst ? ['B', 'A'] : ['A', 'B']))
    for (let i = n; i < m; i++) out.push('A')
    return out
  }

  let placedB = 0
  for (let placedA = 1; placedA <= m; placedA++) {
    out.push('A')
    const targetB = Math.round((placedA * n) / m)
    while (placedB < targetB) { out.push('B'); placedB++ }
  }
  while (placedB < n) { out.push('B'); placedB++ }
  return out
}

/**
 * Two-focus playlist builder. All material between repeat occurrences is
 * accounted for against the same live per-song window: the other focus
 * song, album tracks, BTS spacers, and non-BTS checkpoints. Checkpoints
 * replace a planned spacer whenever possible instead of being appended as
 * an independent extra track, and runtime admission reserves every pending
 * mandatory focus/album/checkpoint track before accepting another spacer.
 *
 * `options.rng` exists so the committed tests can reproduce an exact order;
 * production callers omit it and retain normal Math.random behaviour.
 */
export function buildPlaylistOrder2Focus(
  focusSongs, btsSpacers, nonBtsFillers, albumOnce, targetMs, fillerEvery, MIN_GAP_MS, options = {},
) {
  const rng = options.rng || Math.random
  const btsQ = artistInterleave(shuffle(btsSpacers, rng)); let bi = 0
  const nbQ = shuffle(nonBtsFillers, rng); let fi = 0
  const order = []
  let ms = 0
  let sinceVarietyBreak = 0
  const truncated = false

  const push = (t) => {
    order.push(t)
    ms += t.durationMs || 210000
    if (t.isBTS === false) sinceVarietyBreak = 0
    else sinceVarietyBreak++
  }

  const btsRecycle = () => {
    if (bi < btsQ.length || btsQ.length === 0) return
    const mid = Math.ceil(btsQ.length / 2)
    btsQ.splice(0, btsQ.length,
      ...shuffle(btsQ.slice(0, mid), rng),
      ...shuffle(btsQ.slice(mid), rng))
    bi = 0
  }

  // Aim early enough inside the window to absorb a planned two-track spacer
  // pair. The deadline guard remains as a safety net for unusually long
  // catalog tracks, but normal checkpoints replace an existing spacer slot.
  const nextCheckpointGapMs = () => 33 * 60000
  let remainingCheckpoints = targetMs >= 120 * 60000 ? 2 : 0
  let nextCheckpointMs = remainingCheckpoints > 0 ? nextCheckpointGapMs() : Infinity
  let checkpointWindowStartMs = remainingCheckpoints > 0 ? 30 * 60000 : Infinity
  let checkpointWindowEndMs = remainingCheckpoints > 0 ? 45 * 60000 : Infinity
  const checkpointDue = () => remainingCheckpoints > 0 && ms >= nextCheckpointMs
  const checkpointWouldBeLate = (durationMs) => remainingCheckpoints > 0 &&
    ms >= checkpointWindowStartMs && ms + (durationMs || 210000) > checkpointWindowEndMs
  // Preserve the existing playlist density/shape without using another
  // artist to break a long track-count run. These positions now receive a
  // BTS spacer; only the two timed checkpoints may receive non-BTS tracks.
  const btsVarietySpacerAt = Math.min(fillerEvery, 10)

  const pushNonBts = (consumeCheckpoint, remainingMs = 0, requireMinDuration = false) => {
    if (fi >= nbQ.length) return false
    let pick = -1, bestDuration = Infinity
    for (let i = fi; i < nbQ.length; i++) {
      const duration = nbQ[i].durationMs || 0
      if (duration >= remainingMs && duration < bestDuration) {
        pick = i
        bestDuration = duration
      }
    }
    if (pick < 0 && requireMinDuration) return false
    if (pick > fi) { const tmp = nbQ[fi]; nbQ[fi] = nbQ[pick]; nbQ[pick] = tmp }
    push({ ...nbQ[fi++], isBTS: false })
    if (consumeCheckpoint) {
      remainingCheckpoints--
      nextCheckpointMs = remainingCheckpoints > 0 ? ms + nextCheckpointGapMs() : Infinity
      checkpointWindowStartMs = remainingCheckpoints > 0 ? ms + 30 * 60000 : Infinity
      checkpointWindowEndMs = remainingCheckpoints > 0 ? ms + 45 * 60000 : Infinity
    }
    return true
  }

  // Duration-aware BTS selection. When a gap needs exactly two new filler
  // tracks, minDurationMs is 4:00+ for BOTH selections, matching the user's
  // explicit two-filler rule rather than merely reaching eight minutes in
  // aggregate with one short track and one long track.
  const pushBtsFiller = (remainingMs = 0, minDurationMs = 0) => {
    btsRecycle()
    let bestIdx = -1, bestDur = Infinity
    let longestIdx = -1, longestDur = -1
    for (let i = bi; i < btsQ.length; i++) {
      const d = btsQ[i].durationMs || 0
      if (d < minDurationMs) continue
      if (d >= remainingMs && d < bestDur) { bestDur = d; bestIdx = i }
      if (d > longestDur) { longestDur = d; longestIdx = i }
    }
    const pick = bestIdx >= 0 ? bestIdx : longestIdx
    if (pick < 0) return false
    const pickedDuration = btsQ[pick].durationMs || 210000
    if (checkpointWouldBeLate(pickedDuration)) {
      // This replaces the already-planned neutral slot. When the slot is a
      // two-filler pair, require this checkpoint track to satisfy that same
      // 4:00+ promise rather than weakening the separate duration rule.
      const minimum = Math.max(remainingMs, minDurationMs)
      if (pushNonBts(true, minimum, minDurationMs > 0)) return true
    }
    if (pick > bi) { const tmp = btsQ[bi]; btsQ[bi] = btsQ[pick]; btsQ[pick] = tmp }
    push({ ...btsQ[bi++], isBTS: true })
    return true
  }

  // A non-BTS checkpoint uses an already-budgeted neutral slot. It may only
  // fire when its 30–45 minute checkpoint is due; track-count heuristics must
  // never add extra other-artist songs between those two planned placements.
  // Four-minute two-filler slots stay BTS-only so both selected tracks still
  // satisfy that separate duration promise.
  const pushNeutral = (remainingMs = 0, minDurationMs = 0) => {
    const due = checkpointDue()
    if (due && fi < nbQ.length) {
      const minimum = Math.max(remainingMs, minDurationMs)
      if (pushNonBts(true, minimum, minDurationMs > 0)) return true
    }
    return pushBtsFiller(remainingMs, minDurationMs)
  }
  const pushNeutralTracks = (count) => {
    for (let i = 0; i < count; i++) if (!pushNeutral()) break
  }

  const [songA, songB] = [...focusSongs].sort((a, b) => b.plays - a.plays)
  const m = songA.plays, n = songB.plays
  const ratio = n > 0 ? m / n : 1
  const focusOrder = buildDistributedFocusOrder(m, n, rng)
  const focusSeq = []
  let vA = 0, vB = 0
  for (const key of focusOrder) {
    const song = key === 'A' ? songA : songB
    const versionIndex = key === 'A' ? vA++ : vB++
    const v = song.versions[versionIndex % song.versions.length]
    focusSeq.push({
      key: song.key, uri: v.uri, id: v.id, name: song.name,
      isrc: v.isrc || song.isrc, durationMs: v.durationMs || song.durationMs,
      isBTS: true, isFocus: true, album: v.album,
    })
  }

  // There are plays-1 repeat windows. The old plays-sized plans consumed a
  // value for whichever song happened to appear second in the playlist,
  // even though that was its first occurrence and no repeat gap existed.
  const profileA = m === n ? 'balanced' : ratio <= 1.2 ? 'close-tight' : 'tight'
  // In a close 10:9 pairing the less-frequent song still needs the wider
  // existing pattern (mostly four). Previously the extra non-BTS insertion
  // accidentally supplied that extra space; keep the shape with BTS
  // spacing now that non-BTS is reserved strictly for two checkpoints.
  const profileB = m === n ? 'balanced' : ratio <= 1.2 ? 'close-spread' : 'wide'
  const gapPlanA = planFocusGapCounts(Math.max(0, m - 1), profileA, rng)
  let gapPlanB = planFocusGapCounts(Math.max(0, n - 1), profileB, rng)
  if (m === n && gapPlanA.length > 1 && gapPlanA.join(',') === gapPlanB.join(',')) {
    gapPlanB = [...gapPlanB.slice(1), gapPlanB[0]]
  }

  const avgSpacerMs = btsQ.length > 0
    ? btsQ.reduce((s, t) => s + (t.durationMs || 210000), 0) / btsQ.length
    : 210000
  const HARD_CAP_MS = 179 * 60000
  const softTargetMs = Math.min(targetMs, 145 * 60000, HARD_CAP_MS)
  const focusSuffixMs = new Array(focusSeq.length + 1).fill(0)
  for (let k = focusSeq.length - 1; k >= 0; k--) {
    focusSuffixMs[k] = focusSuffixMs[k + 1] + (focusSeq[k].durationMs || 210000)
  }

  const albumQueue = shuffle(albumOnce, rng)
  const albumSuffixMs = new Array(albumQueue.length + 1).fill(0)
  for (let i = albumQueue.length - 1; i >= 0; i--) {
    albumSuffixMs[i] = albumSuffixMs[i + 1] + (albumQueue[i].durationMs || 210000)
  }
  let albumIdx = 0
  const checkpointReserveMs = () => {
    let total = 0
    for (let i = 0; i < remainingCheckpoints && fi + i < nbQ.length; i++) {
      total += nbQ[fi + i].durationMs || 210000
    }
    return total
  }
  const closingReserveMs = 2 * avgSpacerMs
  const roomForSpacer = (focusIdx) =>
    ms + focusSuffixMs[focusIdx] + albumSuffixMs[albumIdx] +
      checkpointReserveMs() + closingReserveMs + avgSpacerMs <= softTargetMs

  let seenA = false, seenB = false
  let remainingA = m, remainingB = n
  let windowCountA = 0, windowCountB = 0
  let windowDurationA = 0, windowDurationB = 0
  const hardCapA = m === n ? 5 : 4
  const hardCapB = m === n ? 5 : ratio <= 1.2 ? 5 : 7
  const activeA = () => seenA && remainingA > 0
  const activeB = () => seenB && remainingB > 0
  const addNeutralTrack = (track) => {
    const duration = track.durationMs || 0
    if (activeA()) { windowCountA++; windowDurationA += duration }
    if (activeB()) { windowCountB++; windowDurationB += duration }
  }
  const passCheckpointBefore = (durationMs) => {
    if (!checkpointWouldBeLate(durationMs)) return false
    if (!pushNonBts(true)) return false
    addNeutralTrack(order[order.length - 1])
    return true
  }

  // Reserve the focus occurrence that will follow the neutral slot: an A
  // play adds one visible track to B's still-open repeat window and vice
  // versa. Ignoring this +1 was the remaining source of 7-track overflows.
  const capRoomBeforeFocus = (nextKey) => {
    let room = Infinity
    if (activeA()) room = Math.min(room, hardCapA - windowCountA - (nextKey === songB.key ? 1 : 0))
    if (activeB()) room = Math.min(room, hardCapB - windowCountB - (nextKey === songA.key ? 1 : 0))
    return Math.max(0, Number.isFinite(room) ? room : Math.max(hardCapA, hardCapB))
  }

  // Place album tracks in the real between-focus slots (0..length-2), not
  // after the final focus. A finished song no longer constrains placement,
  // so the 10:5 tail can continue accepting album tracks under A's live cap
  // instead of force-flushing four to six of them at the end.
  const slotCount = Math.max(1, focusSeq.length - 1)
  // Two one-time album tracks in the non-focus opening create slack for the
  // dense 14-track album case without affecting any repeat window. They are
  // separated by a neutral track and still follow the two opening spacers,
  // so the playlist neither opens on a focus song nor stacks album tracks.
  const openingAlbumCount = Math.min(2, albumQueue.length)
  const remainingAlbumCount = albumQueue.length - openingAlbumCount
  const albumPlacementSpan = Math.max(1, slotCount - 1)
  const albumTargets = albumQueue.map((_, i) => {
    if (i < openingAlbumCount) return -1
    const remainingIndex = i - openingAlbumCount
    return Math.min(slotCount - 1,
      Math.floor((remainingIndex + 0.5) * albumPlacementSpan / Math.max(1, remainingAlbumCount)))
  })
  const tryPlaceAlbumTracks = (slotIdx, nextKey) => {
    let placed = 0
    while (albumIdx < albumQueue.length && albumTargets[albumIdx] <= slotIdx && placed < 2) {
      // Dense albums can fill every available neutral slot, leaving no BTS
      // spacer for the normal checkpoint-replacement path. Spend capacity
      // on a due non-BTS checkpoint first and defer the album if necessary;
      // the album is mandatory, but this particular slot is not.
      if ((checkpointDue() || sinceVarietyBreak >= btsVarietySpacerAt) && capRoomBeforeFocus(nextKey) > 0) {
        const due = checkpointDue()
        const remainingForClosingWindow = nextKey === songA.key
          ? Math.max(0, MIN_GAP_MS - windowDurationA)
          : Math.max(0, MIN_GAP_MS - windowDurationB)
        const placedVariety = due
          ? pushNonBts(true, remainingForClosingWindow)
          : pushBtsFiller(remainingForClosingWindow)
        if (placedVariety) {
          addNeutralTrack(order[order.length - 1])
          sinceVarietyBreak = 0
        }
      }
      // A deferred album may catch up in a later, roomier slot. Keep two
      // albums audibly separated and count that separator against the same
      // live window; never hide it outside the capacity calculation.
      if (placed > 0) {
        const remainingForClosingWindow = nextKey === songA.key
          ? Math.max(0, MIN_GAP_MS - windowDurationA)
          : Math.max(0, MIN_GAP_MS - windowDurationB)
        if (capRoomBeforeFocus(nextKey) < 2 || !pushNeutral(remainingForClosingWindow)) break
        addNeutralTrack(order[order.length - 1])
      }
      if (capRoomBeforeFocus(nextKey) <= 0) break
      passCheckpointBefore(albumQueue[albumIdx].durationMs || 210000)
      push({ ...albumQueue[albumIdx++], isBTS: true, isAlbumTrack: true })
      addNeutralTrack(order[order.length - 1])
      placed++
    }
    return placed
  }

  pushNeutralTracks(2)
  for (let i = 0; i < openingAlbumCount; i++) {
    passCheckpointBefore(albumQueue[albumIdx].durationMs || 210000)
    push({ ...albumQueue[albumIdx++], isBTS: true, isAlbumTrack: true })
    if (i + 1 < openingAlbumCount) pushNeutral()
  }

  const lastPlayed = {}
  let gapCursorA = 0, gapCursorB = 0
  for (let k = 0; k < focusSeq.length; k++) {
    let curr = focusSeq[k]
    const isSongA = curr.key === songA.key
    const ck = curr.key || curr.isrc || curr.uri || curr.id
    const prev = lastPlayed[ck]

    if (prev) {
      const plannedGap = isSongA ? gapPlanA[gapCursorA++] : gapPlanB[gapCursorB++]
      // Checkpoints consume an existing planned slot. Insert one before
      // calculating the shortfall so it replaces a BTS spacer instead of
      // being added after the gap is already full. This also lets a due
      // checkpoint turn an intended two-new-filler window into one
      // checkpoint + one filler, preserving the separate rule that a true
      // two-filler selection must contain two 4:00+ BTS tracks.
      if ((checkpointDue() || sinceVarietyBreak >= btsVarietySpacerAt) &&
          capRoomBeforeFocus(curr.key) > 0 && roomForSpacer(k)) {
        const due = checkpointDue()
        const remainingForCurrent = isSongA
          ? Math.max(0, MIN_GAP_MS - windowDurationA)
          : Math.max(0, MIN_GAP_MS - windowDurationB)
        const placedVariety = due
          ? pushNonBts(true, remainingForCurrent)
          : pushBtsFiller(remainingForCurrent)
        if (placedVariety) {
          addNeutralTrack(order[order.length - 1])
          sinceVarietyBreak = 0
        }
      }

      const ownWindowCount = isSongA ? windowCountA : windowCountB
      const stillNeeded = Math.max(0, plannedGap - ownWindowCount)
      const effectiveGap = Math.min(stillNeeded, capRoomBeforeFocus(curr.key))
      let gapAccumMs = Math.max(0, ms - prev.ms)
      const requireLongPair = effectiveGap === 2

      for (let g = 0; g < effectiveGap && roomForSpacer(k); g++) {
        const stepsLeft = effectiveGap - g
        const remainingToFloor = Math.max(0, MIN_GAP_MS - gapAccumMs)
        const perStepTarget = stepsLeft > 0 ? Math.ceil(remainingToFloor / stepsLeft) : 0
        const ok = pushNeutral(perStepTarget, requireLongPair ? 240001 : 0)
        if (!ok) break
        addNeutralTrack(order[order.length - 1])
        gapAccumMs += order[order.length - 1].durationMs || 0
      }

      // Time compliance outranks the cosmetic count target. With the
      // duration-aware/long-pair selection above this should be exceptional.
      while (ms - prev.ms < MIN_GAP_MS) {
        if (!pushNeutral(MIN_GAP_MS - (ms - prev.ms))) break
        addNeutralTrack(order[order.length - 1])
      }
    }

    const lastInOrder = order[order.length - 1]
    if (lastInOrder && lastInOrder.uri === curr.uri) {
      const song = isSongA ? songA : songB
      const alt = song.versions.find((v) => v.uri !== lastInOrder.uri)
      if (alt) curr = { ...curr, uri: alt.uri, id: alt.id, album: alt.album }
    }

    passCheckpointBefore(curr.durationMs || 210000)
    push(curr)
    lastPlayed[ck] = { ms, durationMs: curr.durationMs }
    if (isSongA) {
      remainingA--
      seenA = true
      windowCountA = 0
      windowDurationA = 0
      if (activeB()) { windowCountB++; windowDurationB += curr.durationMs || 0 }
    } else {
      remainingB--
      seenB = true
      windowCountB = 0
      windowDurationB = 0
      if (activeA()) { windowCountA++; windowDurationA += curr.durationMs || 0 }
    }

    if (k < focusSeq.length - 1) tryPlaceAlbumTracks(k, focusSeq[k + 1].key)
  }

  // Standard supported combinations have enough between-focus slots for
  // every album track. This fallback preserves mandatory content for edge
  // inputs while still separating leftovers; committed tests ensure the
  // real 10:10/10:9/10:5 combinations never need it.
  while (albumIdx < albumQueue.length) {
    passCheckpointBefore(albumQueue[albumIdx].durationMs || 210000)
    push({ ...albumQueue[albumIdx++], isBTS: true, isAlbumTrack: true })
    if (checkpointDue()) pushNonBts(true)
    if (albumIdx < albumQueue.length) pushNeutral()
  }
  pushNeutralTracks(2)
  while (remainingCheckpoints > 0 && fi < nbQ.length) pushNonBts(true)

  return { order, usedFillers: fi, usedSpacers: bi, truncated }
}
