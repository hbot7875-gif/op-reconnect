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

  // R4 — fillers never repeat.
  const nonFocusRepeats = [...counts.entries()].filter(([k, c]) => {
    const t = tracks.find(x => songKey(x) === k)
    return c > 1 && t && !t.isBTS
  })
  add('Fillers never repeat', nonFocusRepeats.length === 0 ? 'pass' : 'fail',
    nonFocusRepeats.length === 0 ? 'No filler appears more than once.'
      : `${nonFocusRepeats.length} filler(s) repeat — fillers must be unique.`)

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

const shuffle = <T>(arr: T[]): T[] => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]] }
  return a
}

// Interleave songs by primary artist so no more than ~1 consecutive track from the same member.
const artistInterleave = <T extends { artists?: string[] }>(songs: T[]): T[] => {
  const groups = new Map<string, T[]>()
  for (const s of songs) {
    const artist = (s.artists?.[0] || '').toLowerCase() || 'bts'
    if (!groups.has(artist)) groups.set(artist, [])
    groups.get(artist)!.push(s)
  }
  const keys = [...groups.keys()]
  const result: T[] = []
  let changed = true
  while (changed) {
    changed = false
    for (const k of keys) {
      const g = groups.get(k)!
      if (g.length) { result.push(g.shift()!); changed = true }
    }
  }
  return result
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
    out.push({ key: (s as any).key, uri: v.uri, id: v.id, name: s.name, isrc: v.isrc || s.isrc, durationMs: v.durationMs || s.durationMs, isBTS: true, album: v.album })
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

  const avgMs = (focusSeq.reduce((s, t) => s + (t.durationMs || 0), 0) / Math.max(1, focusSeq.length)) || 200000
  // 0.6 was too tight: roomForSpacer's duration ceiling forced almost every
  // gap down to ~3 spacers regardless of the wider rolled distribution
  // above. 0.75 was simulation-verified (N=200/ratio) against a realistic
  // 10x-focus + 18-track-album scenario: 0/200 trials exceed the 180min
  // hard cap (max observed 173.4min, vs 0/200 at 0.7 topping out at
  // 161.9min) while giving real gap-size variety room to survive.
  const fillTarget = targetMs * 0.75
  const approxTracks = Math.max(focusSeq.length, Math.floor(fillTarget / avgMs))
  let spacerBudget = Math.max(0, approxTracks - focusSeq.length)
  const focusSuffix = new Array(focusSeq.length + 1).fill(0)
  for (let k = focusSeq.length - 1; k >= 0; k--) focusSuffix[k] = focusSuffix[k + 1] + (focusSeq[k].durationMs || 0)
  const roomForSpacer = (k: number) => ms + focusSuffix[k] + avgMs <= fillTarget

  const MIN_SAME_MS = (8 + Math.random() * 2) * 60 * 1000
  const DURATION_TOLERANCE_MS = 2000
  // Hard ceiling on the VISIBLE track distance between two real focus
  // plays: 6. This has to be tracked as a window that survives across
  // album-track k-iterations, not just per-k spacer count — album tracks
  // are forced gap=0 and inserted at their own independent positions, so a
  // spacer gap that's already maxed out can still get 1-2 album tracks
  // stacked on top of it, which is what produced the reported 7-8-track
  // gaps even after capping spacers alone. windowCount accumulates every
  // non-real-focus track (spacer or album) since the last real focus play
  // and only resets when a real (non-album) focus track is pushed.
  const MAX_GAP = 6
  let windowCount = 0
  const lastPlayed: Record<string, { ms: number; durationMs: number }> = {}
  const ensureGap = (key: string, durationMs: number, maxExtra: number): number => {
    const prev = lastPlayed[key]
    if (!prev) return 0
    const isDistinctVersion = Math.abs((prev.durationMs || 0) - (durationMs || 0)) > DURATION_TOLERANCE_MS
    if (isDistinctVersion) return 0
    let pushed = 0
    while (ms - prev.ms < MIN_SAME_MS && pushed < maxExtra) {
      if (!pushGapFiller(MIN_SAME_MS - (ms - prev.ms))) break
      pushed++
    }
    return pushed
  }

  for (let o = 0; o < 2; o++) {
    if (roomForSpacer(0) && pushSpacer() && spacerBudget > 0) spacerBudget--
  }

  for (let k = 0; k < focusSeq.length; k++) {
    const r = Math.random()
    // Re-weighted so 3 is the clear mode, 2/4 are the common shoulders, and
    // 5/6 are rare — 1 stays a small floor rather than disappearing.
    const gap = (k === 0 || focusSeq[k].isAlbumTrack) ? 0
      : r < 0.05 ? 1 : r < 0.30 ? 2 : r < 0.70 ? 3 : r < 0.90 ? 4 : r < 0.97 ? 5 : 6
    const roomLeftInWindow = Math.max(0, MAX_GAP - windowCount)
    const effectiveGap = Math.min(gap, roomLeftInWindow)
    let pushedThisGap = 0
    for (let g = 0; g < effectiveGap && spacerBudget > 0 && roomForSpacer(k); g++) {
      if (pushSpacer()) { spacerBudget--; pushedThisGap++ } else break
    }
    windowCount += pushedThisGap
    const ck = focusSeq[k].key || focusSeq[k].isrc || focusSeq[k].uri || focusSeq[k].id
    const extraPushed = ensureGap(ck, focusSeq[k].durationMs, Math.max(0, MAX_GAP - windowCount))
    windowCount += extraPushed
    if (sinceNonBts >= fillerEvery && windowCount < MAX_GAP) { pushSpacer(); windowCount++ }
    push(focusSeq[k])
    if (focusSeq[k].isAlbumTrack) windowCount++
    else windowCount = 0
    lastPlayed[ck] = { ms, durationMs: focusSeq[k].durationMs }
    passCheckpoints()
  }
  pushSpacer(); pushSpacer()
  return { order, usedFillers: fi, usedSpacers: bi, truncated }
}

/**
 * 2-focus playlist order builder — near-alternation skeleton + 8-10 min
 * same-song gap rule. See the source's own long inline comments (kept out of
 * this port for brevity) for exactly why the ratios below are what they are —
 * they're calibrated against real observed manual playlists, not guesses.
 */
export function buildPlaylistOrder2Focus(
  focusSongs: any[], btsSpacers: any[], nonBtsFillers: any[], albumOnce: any[],
  targetMs: number, fillerEvery = 10,
): { order: any[]; usedFillers: number; usedSpacers: number; truncated: boolean } {
  const btsQ = artistInterleave(shuffle(btsSpacers)); let bi = 0
  const nbQ = shuffle(nonBtsFillers); let fi = 0

  const order: any[] = []
  let ms = 0
  const truncated = false

  let sinceNonBts = 0
  let msSinceNonBts = 0
  const nextGapMs = () => (55 + Math.random() * 20) * 60000
  let nonKpopGapMs = nextGapMs()
  const push = (t: any) => {
    order.push(t); ms += t.durationMs || 210000
    if (t.isBTS === false) { sinceNonBts = 0; msSinceNonBts = 0; nonKpopGapMs = nextGapMs() }
    else { sinceNonBts++; msSinceNonBts += t.durationMs || 210000 }
  }

  const btsRecycle = () => {
    if (bi >= btsQ.length && btsQ.length > 0) {
      const mid = Math.ceil(btsQ.length / 2)
      const rnd = (a: any[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]] }; return a }
      btsQ.splice(0, btsQ.length, ...rnd(btsQ.slice(0, mid)), ...rnd(btsQ.slice(mid)))
      bi = 0
    }
  }
  // Same checkpoint reservation as buildPlaylistOrder above — see its
  // comment (including why each checkpoint's target is relative to when
  // the previous one fired, not a fixed absolute mark). Declared before
  // pushSpacer/pushGapFiller so the greedy path can see how many non-BTS
  // tracks to hold back.
  const nextCheckpointGapMs = () => (30 + Math.random() * 15) * 60000
  let remainingCheckpoints = targetMs >= 120 * 60000 ? 2 : 0
  let nextCheckpointMs = remainingCheckpoints > 0 ? nextCheckpointGapMs() : Infinity
  const reservedForCheckpoints = () => remainingCheckpoints
  const nonReservedNonBtsAvailable = () => fi < nbQ.length - reservedForCheckpoints()

  // Same fix as buildPlaylistOrder above — BTS spacers are the default,
  // non-BTS only enters through the 2 checkpoints (both focus songs here
  // are BTS too, so an "OT7 track" spacer is the normal texture, not
  // dilution). See that function's comment.
  const pushSpacer = (): boolean => {
    btsRecycle()
    if (bi < btsQ.length) { push({ ...btsQ[bi++], isBTS: true }); return true }
    if (nonReservedNonBtsAvailable()) { push({ ...nbQ[fi++], isBTS: false }); return true }
    return false
  }
  const pushGapFiller = (remainingMs: number): boolean => {
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
  const passCheckpoints = () => {
    while (remainingCheckpoints > 0 && ms >= nextCheckpointMs) {
      if (fi < nbQ.length) push({ ...nbQ[fi++], isBTS: false })
      remainingCheckpoints--
      nextCheckpointMs = ms + nextCheckpointGapMs()
    }
  }
  const pushSpacers = (count: number) => { for (let i = 0; i < count; i++) { if (!pushSpacer()) return } }

  const [songA, songB] = [...focusSongs].sort((a: any, b: any) => b.plays - a.plays)
  const m = songA.plays, n = songB.plays

  let focusOrder: string[] = []
  {
    const TARGET_RATIO = 0.97
    const buildBurstSkeleton = (): string[] => {
      const out: string[] = []
      let remA = m, remB = n
      while (remA + remB > 0) {
        const prev  = out.length > 0 ? out[out.length - 1] : ''
        const prev2 = out.length > 1 ? out[out.length - 2] : ''
        const canA = remA > 0 && !(prev === 'A' && prev2 === 'A')
        const canB = remB > 0 && prev !== 'B'
        if (!canA && !canB) {
          while (remB > 0) { out.push('B'); remB-- }
          break
        }
        if (!canA) { out.push('B'); remB--; continue }
        if (!canB) { out.push('A'); remA--; continue }
        let choice: 'A' | 'B'
        if (prev === 'A') choice = Math.random() < TARGET_RATIO ? 'B' : 'A'
        else if (prev === 'B') choice = Math.random() < TARGET_RATIO ? 'A' : 'B'
        else choice = Math.random() < remA / (remA + remB) ? 'A' : 'B'
        if (choice === 'A') { out.push('A'); remA-- } else { out.push('B'); remB-- }
      }
      return out
    }
    const altRatio = (arr: string[]) =>
      arr.length < 2 ? 0 : arr.filter((k, i) => i > 0 && k !== arr[i - 1]).length / (arr.length - 1)
    let best = buildBurstSkeleton()
    let bestDist = Math.abs(altRatio(best) - TARGET_RATIO)
    for (let attempt = 1; attempt < 8; attempt++) {
      const candidate = buildBurstSkeleton()
      const dist = Math.abs(altRatio(candidate) - TARGET_RATIO)
      if (dist < bestDist) { best = candidate; bestDist = dist }
    }
    focusOrder = best
  }
  const focusSeq: any[] = []
  let vA = 0, vB = 0
  for (const key of focusOrder) {
    if (key === 'A') {
      const v = songA.versions[vA % songA.versions.length]
      focusSeq.push({ key: songA.key, uri: v.uri, id: v.id, name: songA.name, isrc: v.isrc || songA.isrc, durationMs: v.durationMs || songA.durationMs, isBTS: true, album: v.album })
      vA++
    } else {
      const v = songB.versions[vB % songB.versions.length]
      focusSeq.push({ key: songB.key, uri: v.uri, id: v.id, name: songB.name, isrc: v.isrc || songB.isrc, durationMs: v.durationMs || songB.durationMs, isBTS: true, album: v.album })
      vB++
    }
  }

  const shuffledAlbum2 = shuffle(albumOnce)
  for (let i = 0; i < shuffledAlbum2.length; i++) {
    const base = Math.round((i + 1) * focusSeq.length / (shuffledAlbum2.length + 1))
    const jitter = Math.floor(Math.random() * 3) - 1
    const pos = Math.max(0, Math.min(focusSeq.length, base + jitter))
    focusSeq.splice(pos, 0, { ...shuffledAlbum2[i], isBTS: true, isAlbumTrack: true })
  }

  for (let i = 1; i < focusSeq.length; i++) {
    if (focusSeq[i].uri === focusSeq[i - 1].uri) {
      const song = focusSeq[i].key === songA.key ? songA : songB
      const alt = song.versions.find((v: any) => v.uri !== focusSeq[i - 1].uri)
      if (alt) focusSeq[i] = { ...focusSeq[i], uri: alt.uri, id: alt.id, album: alt.album }
    }
  }

  const MIN_SAME_MS = (8 + Math.random() * 2) * 60 * 1000
  const HARD_CAP_MS = 179 * 60 * 1000
  const BUDGET_TARGET_MS = Math.min(HARD_CAP_MS, 145 * 60 * 1000)
  const DURATION_TOLERANCE_MS = 2000
  const lastPlayed: Record<string, { ms: number; durationMs: number }> = {}

  const avgSpacerMs = btsQ.length > 0
    ? btsQ.reduce((s: number, t: any) => s + (t.durationMs || 210000), 0) / btsQ.length
    : 210000

  const focusSuffixMs = new Array(focusSeq.length + 1).fill(0)
  for (let fk = focusSeq.length - 1; fk >= 0; fk--) {
    focusSuffixMs[fk] = focusSuffixMs[fk + 1] + (focusSeq[fk].durationMs || 210000)
  }

  pushSpacers(2)

  for (let k = 0; k < focusSeq.length; k++) {
    const curr = focusSeq[k]

    if (k > 0) {
      const remainingFocusMs = focusSuffixMs[k]
      const remainingGaps    = focusSeq.length - k + 1
      const closingReserveMs = 2 * avgSpacerMs
      const budgetLeft       = BUDGET_TARGET_MS - ms - remainingFocusMs - closingReserveMs
      const budgetPerGap     = remainingGaps > 0 ? budgetLeft / remainingGaps / avgSpacerMs : 0

      const r = Math.random()
      let naturalGap: number
      if (curr.isAlbumTrack) {
        naturalGap = 0
      } else if (budgetPerGap >= 2.0) {
        naturalGap = r < 0.35 ? 0 : r < 0.85 ? 1 : r < 0.97 ? 2 : 3
      } else if (budgetPerGap >= 1.0) {
        naturalGap = r < 0.50 ? 0 : r < 0.90 ? 1 : 2
      } else if (budgetPerGap >= 0.5) {
        naturalGap = r < 0.70 ? 0 : 1
      } else {
        naturalGap = 0
      }
      for (let g = 0; g < naturalGap; g++) pushSpacer()

      const ck = curr.key || curr.isrc || curr.uri || curr.id
      const prev = lastPlayed[ck]
      if (prev) {
        const isDistinctVersion = Math.abs((prev.durationMs || 0) - (curr.durationMs || 0)) > DURATION_TOLERANCE_MS
        if (!isDistinctVersion) {
          while (ms - prev.ms < MIN_SAME_MS) {
            if (!pushGapFiller(MIN_SAME_MS - (ms - prev.ms))) break
          }
        }
      }

      if (sinceNonBts >= fillerEvery) pushGapFiller(0)
    }

    push(curr)
    lastPlayed[curr.key || curr.isrc || curr.uri || curr.id] = { ms, durationMs: curr.durationMs }
    passCheckpoints()
  }

  pushSpacers(2)

  return { order, usedFillers: fi, usedSpacers: bi, truncated }
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
