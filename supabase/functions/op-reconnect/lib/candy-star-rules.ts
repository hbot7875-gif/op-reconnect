// Candy Star Generator — the rule engine.
//
// Ported verbatim (algorithm untouched — this is the hard-to-reproduce part)
// from arirang-btsbackend/index.ts's "Rule engine" and "Generator" sections:
// analyzeTracklist (validates a tracklist against the ARMY ruleset),
// spreadFocusPlays + buildPlaylistOrder (N-focus builder),
// buildPlaylistOrder2Focus (2-focus Bresenham/near-alternation builder),
// buildHumanPlaylistMeta (mood-phrase titles, not literal song names — see
// its own comment for why), and the procedural cover-art generator.

// deno-lint-ignore-file no-explicit-any
import jpegjs from 'npm:jpeg-js'
import { encodeBase64 } from 'jsr:@std/encoding/base64'
import { MAX_RUNTIME_MS, MIN_GAP_MS, SHORT_SONG_MS } from './spotify-shared.ts'
import {
  shuffle, artistInterleave, planGapCounts, buildFocusOrder,
  buildPlaylistOrder2Focus as buildPlaylistOrder2FocusImpl, trackIdentityTokens,
} from './candy-star-planner.js'

/** Analyse an ordered tracklist against the ruleset. Returns per-rule findings. */
export function analyzeTracklist(tracks: any[]): any {
  const n = tracks.length
  const songKey = (t: any) => t.key || t.isrc || t.id
  const totalMs = tracks.reduce((s, t) => s + (t.durationMs || 0), 0)

  const counts = new Map<string, number>()
  for (const t of tracks) counts.set(songKey(t), (counts.get(songKey(t)) || 0) + 1)

  const isFiller = (t: any) => (counts.get(songKey(t)) || 0) === 1 && !t.isBTS
  const findings: any[] = []
  const add = (rule: string, status: string, detail: string) => findings.push({ rule, status, detail })

  // R1 — under 3 hours.
  const mins = Math.round(totalMs / 60000)
  add('Under 3 hours', totalMs <= MAX_RUNTIME_MS ? 'pass' : 'fail',
    `Runtime ${Math.floor(mins / 60)}h ${mins % 60}m (${n} tracks).`)

  // R2 — must not OPEN on the single most-streamed ("charting") song (loop safety).
  let topKey: string | null = null, topCount = 0
  for (const [k, c] of counts) if (c > topCount) { topCount = c; topKey = k }
  const first = tracks[0]
  if (first) {
    const startsOnTop = topCount > 1 && songKey(first) === topKey
    add("Doesn't open on the top song", startsOnTop ? 'fail' : 'pass',
      startsOnTop ? `Opens on "${first.name}" — the most-streamed track. Risks back-to-back plays when the playlist loops.`
                  : `Opens on "${first.name}", not the top song.`)
  }

  // R3 — gap between repeats of the SAME SONG (catalog key), not same exact Spotify track id.
  const DURATION_TOLERANCE_MS = 2000
  const lastIdx = new Map<string, number>()
  let gapFails = 0, gapWorst = Infinity, fillerLight = 0
  for (let i = 0; i < n; i++) {
    const k = songKey(tracks[i])
    if (lastIdx.has(k)) {
      const prev = lastIdx.get(k)!
      const isDistinctVersion = Math.abs((tracks[prev].durationMs || 0) - (tracks[i].durationMs || 0)) > DURATION_TOLERANCE_MS
      if (!isDistinctVersion) {
        let gapMs = 0, fillerCount = 0
        for (let j = prev + 1; j < i; j++) {
          gapMs += tracks[j].durationMs || 0
          if (isFiller(tracks[j])) fillerCount++
        }
        const needFillers = (tracks[i].durationMs || 0) < SHORT_SONG_MS ? 3 : 2
        if (gapMs < MIN_GAP_MS) { gapFails++; gapWorst = Math.min(gapWorst, Math.round(gapMs / 60000)) }
        else if (fillerCount < needFillers) { fillerLight++ }
      }
    }
    lastIdx.set(k, i)
  }
  const gapStatus = gapFails > 0 ? 'fail' : (fillerLight > 0 ? 'warn' : 'pass')
  const gapMinLabel = Math.round(MIN_GAP_MS / 60000)
  add(`${gapMinLabel}+ min gap between repeats`, gapStatus,
    gapFails > 0 ? `${gapFails} repeat(s) under ${gapMinLabel} min apart (tightest ~${gapWorst} min).`
      : fillerLight > 0 ? `Time gaps all ${gapMinLabel}+ min; ${fillerLight} repeat(s) spaced by focus songs rather than 2–3 fillers.`
      : `Every repeat is spaced ${gapMinLabel}+ min with enough fillers.`)

  // R4 — fillers never repeat. Use Spotify recording identity directly,
  // independent of the catalog `key` R3 intentionally uses to group focus
  // versions. This also exposes the exact offending recording in failures.
  const recordingGroups = new Map<string, any[]>()
  for (const t of tracks) {
    const recordingKey = trackIdentityTokens(t)[0] || songKey(t)
    if (!recordingGroups.has(recordingKey)) recordingGroups.set(recordingKey, [])
    recordingGroups.get(recordingKey)!.push(t)
  }
  const nonFocusRepeats = [...recordingGroups.entries()].filter(([, group]) =>
    group.length > 1 && group.some((t: any) => t.isBTS === false))
  add('Fillers never repeat', nonFocusRepeats.length === 0 ? 'pass' : 'fail',
    nonFocusRepeats.length === 0 ? 'No filler appears more than once.'
      : `${nonFocusRepeats.length} filler recording(s) repeat: ${nonFocusRepeats.slice(0, 5).map(([identity, group]) => `"${group[0]?.name || 'unknown'}" ×${group.length} (${identity})`).join(', ')}.`)

  // R5 — consecutive BTS track run.
  let run = 0, longestRun = 0
  for (const t of tracks) {
    if (t.isBTS) { run++; longestRun = Math.max(longestRun, run) } else run = 0
  }
  const r5 = longestRun <= 14 ? 'pass' : (longestRun <= 22 ? 'warn' : 'fail')
  add('Non-BTS fillers interspersed', r5,
    `Longest run of consecutive BTS tracks: ${longestRun}${longestRun > 14 ? ' — consider one more filler.' : '.'}`)

  // R6 — at least 2 non-Kpop (non-BTS) songs, never more than ~80 min apart.
  const cumAt: number[] = []
  let cum = 0
  for (let i = 0; i < n; i++) { cumAt[i] = cum; cum += tracks[i].durationMs || 0 }
  const nonBtsPos = tracks.map((t, i) => ({ t, i })).filter(x => x.t.isBTS === false).map(x => x.i)
  let maxGapMin = 0, prevEnd = 0
  for (const idx of nonBtsPos) {
    maxGapMin = Math.max(maxGapMin, (cumAt[idx] - prevEnd) / 60000)
    prevEnd = cumAt[idx] + (tracks[idx].durationMs || 0)
  }
  maxGapMin = Math.max(maxGapMin, (totalMs - prevEnd) / 60000)
  const r6 = (nonBtsPos.length >= 2 && maxGapMin <= 80) ? 'pass' : (nonBtsPos.length >= 1 ? 'warn' : 'fail')
  add('Non-Kpop song every 55–75 min (≥2)', r6,
    `${nonBtsPos.length} non-Kpop song(s); longest stretch without one ~${Math.round(maxGapMin)} min.`)

  return {
    summary: {
      tracks: n, runtimeMin: mins,
      focusSongs: [...counts.entries()].filter(([, c]) => c > 1).length,
      fillers: tracks.filter(isFiller).length,
      passed: findings.filter(f => f.status === 'pass').length,
      failed: findings.filter(f => f.status === 'fail').length,
    },
    findings,
  }
}

// Original mood-phrase titles — NOT lifted from any song's real lyrics. Real
// makers rename theirs to something unrelated to the content specifically so
// the title doesn't read as an obvious repeat-farming pattern. Writing fresh
// phrases in that same low-key, personal-mixtape style avoids the copyright
// exposure of auto-publishing real song lyrics at scale.
const PL_VIBE_PHRASES = [
  'where the night finally feels gentle', 'the kind of silence i don’t mind',
  'soft static and slow mornings', 'the drive home nobody talks about',
  'half a diary entry', 'everything i didn’t say out loud',
  'a playlist for the in-between', 'notes to self, unsent',
  'the quiet after a good day', 'things i’d tell you if i could',
  'a little heavier than usual', 'still thinking about it',
  'for the version of me that stayed up', 'somewhere between okay and not',
  'little proof i was here', 'the long way back',
  'a soft kind of tired', 'reasons i keep coming back',
  'for whenever this feeling comes back', 'the version i keep coming back to',
  'a slower kind of loud', 'the parts i keep rewinding',
  'proof the day happened', 'quiet enough to hear it',
  'the version that got away with it', 'a little too on the nose',
  'nothing i’d admit out loud', 'the long way around the feeling',
  'still not over it, apparently', 'a diary with the names changed',
  'the 2am version of me', 'not quite ready to let go of this one',
  'the replay button, basically', 'a softer kind of loud',
  'everything i circle back to', 'the feeling i keep choosing',
  'a little unfinished on purpose', 'the one i play when no one’s watching',
  'proof i felt something', 'the long game, still going',
  'a quieter kind of proof', 'the version worth keeping',
]
const randomVibePhrase = () => PL_VIBE_PHRASES[Math.floor(Math.random() * PL_VIBE_PHRASES.length)]

const SUPERSCRIPT_DIGITS: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }
const toSuperscript = (n: number): string => String(n).split('').map((d) => SUPERSCRIPT_DIGITS[d] || d).join('')

/**
 * Titles use an original vibe phrase rather than a literal "TrackA x TrackB"
 * name. The description still spells out exact play counts as superscripts
 * ("TrackA⁸ + TrackB⁹") — that's where makers keep the real record.
 */
export function buildHumanPlaylistMeta(
  focusSongs: { name: string; plays: number }[],
  albumLabel: string | null,
): { name: string; description: string } {
  const name = randomVibePhrase()
  const parts = focusSongs.map((s) => `${s.name}${toSuperscript(s.plays)}`)
  if (albumLabel) parts.push(`${albumLabel}${toSuperscript(1)}`)
  const description = parts.join(' + ') || 'Generated playlist'
  return { name, description }
}

/** Spread focus plays so the same song is never adjacent and is maximally separated. */
export function spreadFocusPlays(songs: { isrc: string; versions: any[]; name: string; durationMs: number; plays: number }[]): any[] {
  const JIT = 0.5
  const slots: { song: any; pos: number }[] = []
  for (const s of songs) {
    for (let i = 0; i < s.plays; i++) {
      slots.push({ song: s, pos: (i + 0.5) / s.plays + (Math.random() - 0.5) * JIT / s.plays })
    }
  }
  slots.sort((a, b) => a.pos - b.pos)
  for (let i = 1; i < slots.length; i++) {
    if (slots[i].song === slots[i - 1].song) {
      for (let j = i + 1; j < slots.length; j++) {
        if (slots[j].song !== slots[i].song && slots[j].song !== slots[i - 1].song &&
          (j + 1 >= slots.length || slots[j + 1].song !== slots[i].song)) {
          const t = slots[i]; slots[i] = slots[j]; slots[j] = t; break
        }
      }
    }
  }
  const vIdx = new Map<string, number>()
  const out: any[] = []
  for (const { song: s } of slots) {
    const k = (s as any).key || s.isrc
    const vi = vIdx.get(k) || 0
    const v = s.versions[vi % s.versions.length]
    out.push({ key: (s as any).key, uri: v.uri, id: v.id, name: s.name, isrc: v.isrc || s.isrc, durationMs: v.durationMs || s.durationMs, isBTS: true, isFocus: true, album: v.album })
    vIdx.set(k, vi + 1)
  }
  return out
}

/**
 * Build a rule-compliant ordered tracklist (N-focus builder).
 * focusPlays: pre-spread BTS plays. fillers: unique non-BTS pool. albumOnce: BTS album tracks added once.
 */
export function buildPlaylistOrder(
  focusPlays: any[], btsSpacers: any[], nonBtsFillers: any[], albumOnce: any[],
  targetMs: number, fillerEvery = 10,
): { order: any[]; usedFillers: number; usedSpacers: number; truncated: boolean } {
  const btsQ = artistInterleave(shuffle(btsSpacers)); let bi = 0
  const nbQ = shuffle(nonBtsFillers); let fi = 0

  const order: any[] = []
  let ms = 0
  const truncated = false
  let sinceNonBts = 0
  let msSinceNonBts = 0
  const nextGapMs = () => (40 + Math.random() * 15) * 60000
  let nonKpopGapMs = nextGapMs()
  const push = (t: any) => {
    order.push(t); ms += t.durationMs || 210000
    if (t.isBTS === false) { sinceNonBts = 0; msSinceNonBts = 0; nonKpopGapMs = nextGapMs() }
    else { sinceNonBts++; msSinceNonBts += t.durationMs || 210000 }
  }

  const focusSeq = [...focusPlays]
  const shuffledAlbum = shuffle(albumOnce)
  if (shuffledAlbum.length > 0) {
    const n = focusSeq.length
    const positions = shuffledAlbum.map((_, i) =>
      Math.min(n, Math.max(1, Math.round((i + 1) * n / (shuffledAlbum.length + 1))))
    )
    for (let i = shuffledAlbum.length - 1; i >= 0; i--) {
      focusSeq.splice(positions[i], 0, { ...shuffledAlbum[i], isBTS: true, isAlbumTrack: true })
    }
  }

  // For a 2hr+ playlist, exactly 2 genuinely-other-artist plays pinned to
  // real checkpoints ~30-45 min apart (see passCheckpoints below) — not "as
  // much non-BTS as the library allows" (an earlier version of this fix
  // preferred non-BTS for every spacer slot, which overcorrected: a well-
  // stocked library produced a dozen-plus other-artist tracks when the
  // actual ask was "2 is enough"). reservedForCheckpoints holds back that
  // many non-BTS tracks from the routine BTS-spacer path below so they
  // survive to actually reach their checkpoint, and pushSpacer/pushGapFiller
  // otherwise never touch the filler library except as a last-resort
  // fallback if the BTS catalog itself somehow runs dry.
  //
  // Each checkpoint's target ms is set relative to when the PREVIOUS one
  // actually fired, not a fixed absolute mark — the build advances in
  // chunky, uneven steps (several spacers can land between one
  // passCheckpoints() call and the next), so two independently-rolled
  // absolute marks can each overshoot enough that the real gap between them
  // ends up well under 30 min even though both individually looked ~30-45
  // min from the start. Anchoring to the first firing's actual time is what
  // keeps the GAP itself correct regardless of how much either one drifts.
  const nextCheckpointGapMs = () => (30 + Math.random() * 15) * 60000
  let remainingCheckpoints = targetMs >= 120 * 60000 ? 2 : 0
  let nextCheckpointMs = remainingCheckpoints > 0 ? nextCheckpointGapMs() : Infinity
  const reservedForCheckpoints = () => remainingCheckpoints
  const nonReservedNonBtsAvailable = () => fi < nbQ.length - reservedForCheckpoints()

  // BTS spacers are the default again — both focus songs here are BTS, so a
  // spacer that's ALSO BTS (a member solo, an OT7 track) is the normal,
  // expected texture of a playlist like this. Non-BTS only ever enters
  // through the 2 checkpoints above; the nonReservedNonBtsAvailable() calls
  // below are purely a last-resort fallback for the (essentially never
  // reached) case where the BTS catalog itself is exhausted.
  const pushSpacer = (): boolean => {
    if (bi >= btsQ.length && btsQ.length > 0) {
      const mid = Math.ceil(btsQ.length / 2)
      const rnd = (a: any[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]] }; return a }
      btsQ.splice(0, btsQ.length, ...rnd(btsQ.slice(0, mid)), ...rnd(btsQ.slice(mid)))
      bi = 0
    }
    if (bi < btsQ.length) { push({ ...btsQ[bi++], isBTS: true }); return true }
    if (nonReservedNonBtsAvailable()) { push({ ...nbQ[fi++], isBTS: false }); return true }
    return false
  }
  const pushGapFiller = (remainingMs: number): boolean => {
    if (bi >= btsQ.length && btsQ.length > 0) {
      const mid = Math.ceil(btsQ.length / 2)
      const rnd = (a: any[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]] }; return a }
      btsQ.splice(0, btsQ.length, ...rnd(btsQ.slice(0, mid)), ...rnd(btsQ.slice(mid)))
      bi = 0
    }
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
  const passCheckpoints = () => {
    while (remainingCheckpoints > 0 && ms >= nextCheckpointMs) {
      if (fi < nbQ.length) push({ ...nbQ[fi++], isBTS: false })
      remainingCheckpoints--
      nextCheckpointMs = ms + nextCheckpointGapMs()
    }
  }

  // Duration-aware gap planning. Earlier attempts estimated available
  // "room" from the average FOCUS-song duration and then had to inflate a
  // global ratio (0.6 -> 0.75) just to give that inaccurate estimate enough
  // slack to survive — the real BTS catalog mixes sub-minute skits with
  // full songs, so a focus-duration-based estimate has nothing to do with
  // how many actual spacer tracks fit. This instead: (1) estimates a
  // track-count budget from the REAL spacer pool's average duration, and
  // (2) plans the exact per-gap track-count sequence upfront so it sums to
  // that budget, rather than rolling gaps independently and hoping a
  // duration ceiling doesn't truncate them unevenly.
  const spacerPool = [...btsQ, ...nbQ]
  const avgSpacerMs = spacerPool.length > 0
    ? spacerPool.reduce((s, t) => s + (t.durationMs || 210000), 0) / spacerPool.length
    : 210000
  const mandatoryMs = focusSeq.reduce((s, t) => s + (t.durationMs || 0), 0)
  const HARD_CAP_MS = 179 * 60 * 1000
  // Soft target: never plan past what was actually requested, and cap the
  // "comfortable" length at 145min even for a longer requested target —
  // mirrors buildPlaylistOrder2Focus's own budget ceiling below.
  const softTargetMs = Math.min(targetMs, 145 * 60 * 1000, HARD_CAP_MS)
  // Reserve room for the 2 intro + 2 outro pushSpacer() calls and the 2
  // artist-mix checkpoints, all of which draw from the same spacer pool.
  const reserveMs = (4 + remainingCheckpoints) * avgSpacerMs
  const spacerBudgetMs = Math.max(0, softTargetMs - mandatoryMs - reserveMs)
  const totalSpacerTracks = Math.max(0, Math.round(spacerBudgetMs / avgSpacerMs))
  const realGapCount = Math.max(0, focusSeq.filter((t) => !t.isAlbumTrack).length - 1)
  const gapPlan = planGapCounts(realGapCount, totalSpacerTracks)

  const DURATION_TOLERANCE_MS = 2000
  // Hard ceiling on the VISIBLE track distance between two real focus
  // plays: 6, as a safety net (the plan above should already stay within
  // this, but album tracks land at independent positions and can still
  // stack on top of a planned gap — see windowCount below). windowCount
  // accumulates every non-real-focus track (spacer or album) since the
  // last real focus play and only resets when a real focus track lands.
  const MAX_GAP = 6
  let windowCount = 0
  const lastPlayed: Record<string, { ms: number; durationMs: number }> = {}
  const ensureGap = (key: string, durationMs: number): number => {
    const prev = lastPlayed[key]
    if (!prev) return 0
    const isDistinctVersion = Math.abs((prev.durationMs || 0) - (durationMs || 0)) > DURATION_TOLERANCE_MS
    if (isDistinctVersion) return 0
    let pushed = 0
    // MIN_GAP_MS (flat 8min) is the actual validated, MANDATORY floor —
    // padding this randomly to 8-10min (an even earlier version) just
    // forced unplanned extra fillers for no compliance benefit. This loop
    // is NOT capped by MAX_GAP: MAX_GAP bounds the discretionary variety
    // roll-out below, but compliance can't be capped — a real generation
    // hit an actual 0-min-gap rule violation when this was capped and the
    // window was already full from unrelated album-track clustering,
    // leaving no room for the mandatory top-up. Trading a wider-than-usual
    // gap for staying compliant is the only acceptable choice here.
    while (ms - prev.ms < MIN_GAP_MS) {
      if (!pushGapFiller(MIN_GAP_MS - (ms - prev.ms))) break
      pushed++
    }
    return pushed
  }

  for (let o = 0; o < 2; o++) pushSpacer()

  let gapCursor = 0
  let totalDelivered = 0
  for (let k = 0; k < focusSeq.length; k++) {
    const isRealGapK = k > 0 && !focusSeq[k].isAlbumTrack
    const plannedGap = isRealGapK ? gapPlan[gapCursor] : 0
    const roomLeftInWindow = Math.max(0, MAX_GAP - windowCount)
    const effectiveGap = Math.min(plannedGap, roomLeftInWindow)
    const ck = focusSeq[k].key || focusSeq[k].isrc || focusSeq[k].uri || focusSeq[k].id
    const prevSame = lastPlayed[ck]
    const isDistinctVersion = !!prevSame && Math.abs((prevSame.durationMs || 0) - (focusSeq[k].durationMs || 0)) > DURATION_TOLERANCE_MS
    let pushedThisGap = 0
    // For a small planned gap (<=3), pick spacers duration-aware (reusing
    // pushGapFiller's best-fit-or-longest logic, aiming each pick at an
    // even share of whatever's still needed to clear MIN_GAP_MS) instead
    // of plain sequential pushSpacer. Without this, a planned gap of 1-2
    // short tracks almost never reaches the 8min same-song floor on its
    // own, so ensureGap silently tops it up to ~3 anyway — this makes the
    // delivered gap actually track the plan instead of quietly overriding
    // it every time.
    // Seeded from the REAL elapsed time since the previous occurrence of
    // this same song, not just what this k's own roll-out adds — an album
    // track or checkpoint filler can already have landed earlier in this
    // same visible gap (a separate k-iteration / passCheckpoints() call,
    // both of which already advanced the global `ms`), and that already
    // counts toward the 8min floor. Starting from 0 every time made this
    // loop chase a floor that was often already partly or fully met,
    // pushing avoidable extra spacers and inflating runtime.
    let gapAccumMs = (prevSame && !isDistinctVersion) ? Math.max(0, ms - prevSame.ms) : 0
    for (let g = 0; g < effectiveGap; g++) {
      const stepsLeft = effectiveGap - g
      const remainingToFloor = Math.max(0, MIN_GAP_MS - gapAccumMs)
      const perStepTarget = stepsLeft > 0 ? Math.ceil(remainingToFloor / stepsLeft) : 0
      const ok = (plannedGap <= 3 && perStepTarget > 0) ? pushGapFiller(perStepTarget) : pushSpacer()
      if (!ok) break
      pushedThisGap++
      gapAccumMs += order[order.length - 1].durationMs || 0
    }
    windowCount += pushedThisGap
    totalDelivered += pushedThisGap
    const extraPushed = ensureGap(ck, focusSeq[k].durationMs)
    windowCount += extraPushed
    totalDelivered += extraPushed
    if (sinceNonBts >= fillerEvery && windowCount < MAX_GAP) { pushSpacer(); windowCount++; totalDelivered++ }
    push(focusSeq[k])
    if (focusSeq[k].isAlbumTrack) windowCount++
    else windowCount = 0
    lastPlayed[ck] = { ms, durationMs: focusSeq[k].durationMs }
    const beforeCheckpointFi = fi
    passCheckpoints()
    totalDelivered += fi - beforeCheckpointFi
    if (isRealGapK) gapCursor++
  }
  // The MAX_GAP window (album tracks stacking on top of a planned gap) can
  // only ever hold effectiveGap <= plannedGap, so totalDelivered can end up
  // short of the planned totalSpacerTracks even though ensureGap's top-ups
  // elsewhere might also push it over. Make up a real shortfall so the
  // planned total (and therefore the target runtime) survives truncation
  // instead of just silently coming in short — but never chase it past the
  // soft target.
  for (let i = totalDelivered; i < totalSpacerTracks; i++) {
    if (ms + avgSpacerMs > softTargetMs) break
    if (!pushSpacer()) break
  }
  pushSpacer(); pushSpacer()
  return { order, usedFillers: fi, usedSpacers: bi, truncated }
}

/**
 * 2-focus playlist order builder — near-alternation skeleton + coordinated
 * gap/album/checkpoint placement sharing one live capacity budget. The
 * actual implementation lives in candy-star-planner.js (plain JS, no
 * Deno-only imports) alongside buildFocusOrder/planGapCounts — same reason
 * as always: the exact module the deployed Deno function imports is also
 * directly testable from plain Node, with zero drift risk between what's
 * tested and what's deployed. This is a thin wrapper supplying MIN_GAP_MS
 * (imported here from spotify-shared.ts, which the plain-JS module can't
 * import directly since it's a TypeScript file).
 */
export function buildPlaylistOrder2Focus(
  focusSongs: any[], btsSpacers: any[], nonBtsFillers: any[], albumOnce: any[],
  targetMs: number, fillerEvery = 10,
): { order: any[]; usedFillers: number; usedSpacers: number; truncated: boolean } {
  return buildPlaylistOrder2FocusImpl(focusSongs, btsSpacers, nonBtsFillers, albumOnce, targetMs, fillerEvery, MIN_GAP_MS)
}

/** Create the playlist in the connected account and add the tracks. */
export async function createUserPlaylist(token: string, _userId: string, name: string, description: string, uris: string[]): Promise<any> {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const create = await fetch(`https://api.spotify.com/v1/me/playlists`, {
    method: 'POST', headers, body: JSON.stringify({ name, public: true, description }),
  })
  if (!create.ok) throw new Error(`Create failed: ${create.status} ${await create.text()}`)
  const pl = await create.json()
  for (let i = 0; i < uris.length; i += 100) {
    const batch = uris.slice(i, i + 100)
    const add = await fetch(`https://api.spotify.com/v1/playlists/${pl.id}/items`, {
      method: 'POST', headers, body: JSON.stringify({ uris: batch }),
    })
    if (!add.ok) throw new Error(`Add tracks failed: ${add.status} ${await add.text()}`)
  }
  return { id: pl.id, url: pl.external_urls?.spotify || `https://open.spotify.com/playlist/${pl.id}` }
}

// Cover art — deliberately generic/abstract, not BTS-related at all. A soft
// bokeh-glow aesthetic over a dark diagonal base, plus grain — purely
// procedural, no external image fetch.
const COVER_PALETTES: [number, number, number][][] = [
  [[232, 58, 93], [60, 15, 45]],
  [[124, 58, 183], [20, 8, 35]],
  [[255, 176, 90], [110, 25, 65]],
  [[90, 60, 180], [10, 10, 28]],
  [[220, 90, 150], [35, 15, 55]],
]
const COVER_SIZE = 640

function paletteFor(seed: string): [number, number, number][] {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return COVER_PALETTES[hash % COVER_PALETTES.length]
}

function generateCoverJpeg(seed: string): Uint8Array {
  const w = COVER_SIZE, h = COVER_SIZE
  const [c1, c2] = paletteFor(seed)
  let s = 0
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i) + 7) >>> 0
  const rand = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s >>> 8) / 0xFFFFFF }

  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = (x + y) / (w + h)
      const idx = (y * w + x) * 4
      data[idx]     = c2[0] + (c1[0] - c2[0]) * t * 0.35
      data[idx + 1] = c2[1] + (c1[1] - c2[1]) * t * 0.35
      data[idx + 2] = c2[2] + (c1[2] - c2[2]) * t * 0.35
      data[idx + 3] = 255
    }
  }

  const blobColors = [c1, c2, [255, 255, 255] as [number, number, number]]
  const blobCount = 4 + Math.floor(rand() * 3)
  for (let b = 0; b < blobCount; b++) {
    const cx = rand() * w, cy = rand() * h
    const radius = 90 + rand() * 170
    const [br, bg, bb] = blobColors[Math.floor(rand() * blobColors.length)]
    const strength = 0.22 + rand() * 0.3
    const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(w, Math.ceil(cx + radius))
    const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(h, Math.ceil(cy + radius))
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const dx = x - cx, dy = y - cy
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist > radius) continue
        const falloff = Math.pow(1 - dist / radius, 2) * strength
        const idx = (y * w + x) * 4
        data[idx]     = Math.min(255, data[idx]     + br * falloff)
        data[idx + 1] = Math.min(255, data[idx + 1] + bg * falloff)
        data[idx + 2] = Math.min(255, data[idx + 2] + bb * falloff)
      }
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4
      const grain = (Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1) * 8 - 4
      data[idx]     = Math.max(0, Math.min(255, data[idx]     + grain))
      data[idx + 1] = Math.max(0, Math.min(255, data[idx + 1] + grain))
      data[idx + 2] = Math.max(0, Math.min(255, data[idx + 2] + grain))
    }
  }
  return jpegjs.encode({ data, width: w, height: h }, 82).data
}

/** Non-fatal — a failed cover upload should never break playlist creation. */
export async function uploadPlaylistCover(token: string, playlistId: string, seed: string): Promise<void> {
  const jpegBytes = generateCoverJpeg(seed)
  const base64 = encodeBase64(jpegBytes)
  const res = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/images`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' },
    body: base64,
  })
  if (!res.ok) throw new Error(`Cover upload failed: ${res.status} ${await res.text()}`)
}
