// District mechanics: freezing goal snapshots at activation, computing
// progress from daily activity rollups, and the one-week restoration
// deadline. A district's checklist is FROZEN when the player starts it —
// later goal edits never change an in-flight district.

import { goalKeys } from './transmission.ts'
import type { DayBucket } from './transmission.ts'
import type { GameContent, DistrictRow } from './config.ts'
import { modeMultiplier, PERSONAL_COUNT_CAP } from './config.ts'
import { kstDateOf } from './kst.ts'

export interface FrozenReconnectGoal {
  id: string
  variant: 'sotd' | 'cipher' | 'memory' | 'connect' | 'invite'
  // Puzzle variants (sotd/cipher/memory) carry prompt+answerKeys; connect/
  // invite carry requiredAgents. Frozen verbatim at activation time, same
  // "later edits don't retroactively change an in-flight district"
  // invariant as trackGoals/albumGoals.
  config: Record<string, any>
}

export interface FrozenGoals {
  trackGoals: { id: string; label: string; artist: string | null; target: number; keys: string[] }[]
  albumGoals: { id: string; label: string; target: number; tracks: { label: string; keys: string[] }[] }[]
  reconnect: FrozenReconnectGoal | null
  meta: { mode: string; multiplier: number; tutorial?: boolean }
}

export interface RollupRow {
  kst_date: string
  track_counts: DayBucket
  transmission: { templateId?: number } | null
}

/** Freeze the current era's goals for a district activation. */
export function freezeGoals(content: GameContent, mode: string, district: DistrictRow): FrozenGoals {
  const multiplier = modeMultiplier(content, mode)

  const assignedTracks = content.goals.filter((g) => g.kind === 'track' && g.district_id === district.id)
  const assignedAlbums = content.goals.filter((g) => g.kind === 'album' && g.district_id === district.id && g.tracks)

  // Keep the original three-play tutorial only as a safe fallback for an
  // unconfigured Home Base. Assigned goals make it a real weekly district.
  if (district.is_tutorial && assignedTracks.length === 0 && assignedAlbums.length === 0) {
    const tut = content.config.tutorial || { trackGoalId: null, plays: 3 }
    const goal = content.goals.find((g) => g.id === tut.trackGoalId) || content.goals.find((g) => g.kind === 'track')
    return {
      trackGoals: goal
        ? [{ id: goal.id, label: goal.label, artist: goal.artist, target: tut.plays || 3, keys: goalKeys(goal) }]
        : [],
      albumGoals: [],
      reconnect: null,
      meta: { mode, multiplier: 1, tutorial: true },
    }
  }

  // Only goals explicitly assigned to THIS district — see migration
  // 036_rc_district_goals.sql. A goal with no district_id (or assigned
  // elsewhere) contributes nothing here; nothing is live anywhere until
  // the admin assigns it in the Goals tab. Album goals work the same as
  // track goals now — a district can carry more than one (each is its own
  // full-album-pass checklist), not just a single one.
  // config.flatTarget opts a specific goal out of mode scaling entirely —
  // same target on easy/medium/hard. Everything else still scales by
  // multiplier as usual; this is the exception, not a new default.
  const trackGoals = assignedTracks
    .map((g) => ({ id: g.id, label: g.label, artist: g.artist, target: g.config?.flatTarget ? g.target : g.target * multiplier, keys: goalKeys(g) }))

  const albumGoals = assignedAlbums
    .map((g) => ({
      id: g.id,
      label: g.label,
      target: g.config?.flatTarget ? g.target : g.target * multiplier,
      tracks: (g.tracks || []).map((t) => ({ label: t.label, keys: goalKeys({ label: t.label, aliases: t.aliases || [] }) })),
    }))

  // A district can carry SEVERAL reconnect goals (different flavors) —
  // freezeGoals() rolls the dice once per agent per activation, so two
  // agents restoring the same district can land on genuinely different
  // reconnect missions. Puzzle variants' answers freeze verbatim (cipher/
  // memory precomputed into text-match keys, sotd as a plain video ID),
  // same reasoning as track/album goals: an admin editing the answer later
  // must never retroactively change what an already-active agent is being
  // asked to guess.
  const reconnectCandidates = content.goals.filter((g) => g.kind === 'reconnect' && g.district_id === district.id)
  let reconnect: FrozenReconnectGoal | null = null
  if (reconnectCandidates.length > 0) {
    const picked = reconnectCandidates[Math.floor(Math.random() * reconnectCandidates.length)]
    const variant = picked.variant as FrozenReconnectGoal['variant']
    const cfg = picked.config || {}
    const config = variant === 'connect' || variant === 'invite'
      // sharedTrack (optional) turns 'connect' from "everyone streams
      // anything of their own once" into a pooled target on one specific
      // track — every joined participant's own plays of it, counted from
      // when THEY joined, add together toward the same total. Frozen
      // verbatim like everything else here, so an admin editing it later
      // never changes what an already-open mission is chasing.
      ? { requiredAgents: cfg.requiredAgents, sharedTrack: cfg.sharedTrack || null }
      : variant === 'sotd'
      // A YouTube-link guess, not a text guess — frozen verbatim so an
      // admin changing the answer later can't retroactively change what an
      // already-active agent is being asked to identify.
      ? { prompt: cfg.prompt, youtubeId: cfg.youtubeId }
      : {
          prompt: cfg.prompt,
          answerKeys: goalKeys({ label: cfg.answerLabel || '', aliases: cfg.answerAliases || [] }),
        }
    reconnect = { id: picked.id, variant, config }
  }

  const tutorialMeta = district.is_tutorial ? { tutorial: true } : {}
  return { trackGoals, albumGoals, reconnect, meta: { mode, multiplier, ...tutorialMeta } }
}

/** Capped plays already accrued today — so activation-day streams from before
 *  the "Begin Restoration" tap never count toward the new district. */
export function computeBaseline(
  todayBucket: DayBucket,
  frozen: FrozenGoals,
  goalCap: number,
  xpCap = goalCap,
): Record<string, number> {
  const baseline: Record<string, number> = {}
  for (const g of frozen.trackGoals) {
    const plays = g.keys.reduce((s, k) => s + (todayBucket[k]?.n || 0), 0)
    baseline[`t:${g.id}`] = Math.min(plays, goalCap)
  }
  for (const a of frozen.albumGoals) {
    for (const t of a.tracks) {
      const plays = t.keys.reduce((s, k) => s + (todayBucket[k]?.n || 0), 0)
      baseline[`a:${a.id}:${t.label}`] = Math.min(plays, goalCap)
    }
  }
  // XP uses the union of all assigned track keys, not the sum of goals.
  // Persisting that same union prevents overlapping goals from double-
  // subtracting activation-day streams when XP is recalculated.
  const xpKeys = new Set<string>()
  for (const g of frozen.trackGoals) for (const key of g.keys) xpKeys.add(key)
  for (const a of frozen.albumGoals) for (const t of a.tracks) for (const key of t.keys) xpKeys.add(key)
  baseline['xp:goal-streams'] = [...xpKeys].reduce(
    (sum, key) => sum + Math.min(todayBucket[key]?.n || 0, xpCap), 0)
  return baseline
}

export interface DistrictProgress {
  trackGoals: { id: string; label: string; artist: string | null; progress: number; target: number; done: boolean }[]
  albums: {
    id: string; label: string; passesDone: number; target: number; signalPct: number; done: boolean
    nextPassTracks: { label: string; have: number; need: number }[]
    tracks: { label: string; have: number; target: number; done: boolean }[]
  }[]
  allTracksDone: boolean
  complete: boolean
}

/** Sum capped per-day plays for a set of keys across the activation window. */
function windowedPlays(
  keys: string[],
  rollups: RollupRow[],
  activationDate: string,
  baseline: number,
  cap: number,
  albumDouble: boolean,
): number {
  let total = 0
  for (const row of rollups) {
    let day = Math.min(keys.reduce((s, k) => s + (row.track_counts[k]?.n || 0), 0), cap)
    if (row.kst_date === activationDate) day = Math.max(0, day - baseline)
    if (albumDouble && row.transmission?.templateId === 5) day *= 2
    total += day
  }
  return total
}

export function districtProgress(
  frozen: FrozenGoals,
  baseline: Record<string, number>,
  rollups: RollupRow[],
  activatedAt: string,
  content: GameContent,
): DistrictProgress {
  // District/album goal progress is uncapped — every real counted stream
  // moves the goal, same as the arirang mission. See config.ts's
  // PERSONAL_COUNT_CAP for what still keeps a real cap (the shared Bomb).
  const cap = PERSONAL_COUNT_CAP
  const activationDate = kstDateOf(Math.floor(new Date(activatedAt).getTime() / 1000))
  const inWindow = rollups.filter((r) => r.kst_date >= activationDate)

  const trackGoals = frozen.trackGoals.map((g) => {
    const total = windowedPlays(g.keys, inWindow, activationDate, baseline[`t:${g.id}`] || 0, cap, false)
    return { id: g.id, label: g.label, artist: g.artist, progress: Math.min(total, g.target), target: g.target, done: total >= g.target }
  })
  const allTracksDone = trackGoals.length > 0 && trackGoals.every((g) => g.done)

  const albums = frozen.albumGoals.map((a) => {
    const perTrack = a.tracks.map((t) => ({
      label: t.label,
      total: windowedPlays(t.keys, inWindow, activationDate, baseline[`a:${a.id}:${t.label}`] || 0, cap, true),
    }))
    const target = a.target
    const passesDone = Math.min(perTrack.reduce((m, t) => Math.min(m, t.total), Infinity), target)
    const capped = perTrack.reduce((s, t) => s + Math.min(t.total, target), 0)
    const signalPct = Math.min(100, Math.round((capped / (perTrack.length * target)) * 100))
    // Unsliced now — the 148 Protocol playlist builder (playlist.js's
    // remaining()) reads every entry here to know what to queue, so a
    // 5-item cap used to silently under-queue any album with more than 5
    // tracks still short of its next pass, not just truncate a display.
    const nextPassTracks = perTrack
      .filter((t) => t.total < target)
      .sort((a2, b2) => a2.total - b2.total)
      .map((t) => ({ label: t.label, have: t.total, need: target - t.total }))
    // Full roster, done tracks included — lets the UI expand an album's
    // "X passes" summary into every track's own progress, not just the
    // ones still short (site owner: "expanded to all tracks in that album").
    const tracks = perTrack
      .map((t) => ({ label: t.label, have: Math.min(t.total, target), target, done: t.total >= target }))
      .sort((a2, b2) => Number(a2.done) - Number(b2.done) || a2.have - b2.have)
    return { id: a.id, label: a.label, passesDone: Number.isFinite(passesDone) ? passesDone : 0, target, signalPct, done: passesDone >= target, nextPassTracks, tracks }
  })

  const complete = allTracksDone && albums.every((a) => a.done)
  return { trackGoals, albums, allTracksDone, complete }
}

/** Total capped plays of this activation's album-goal tracks — the raw
 *  number charge-economy.ts converts into Charge Cells at 20:1. Deliberately
 *  NOT the same as albums[].passesDone (which floors at the slowest track
 *  and caps at target): every stream toward an album goal counts here, even
 *  past what a pass needs, the same way streaming doesn't stop mattering
 *  once you've technically finished. Shares windowedPlays() with
 *  districtProgress() rather than recomputing anything independently. */
export function albumGoalStreamTotal(
  frozen: FrozenGoals, baseline: Record<string, number>, rollups: RollupRow[], activatedAt: string, content: GameContent,
): number {
  // Goal progress is uncapped — same as districtProgress().
  const cap = PERSONAL_COUNT_CAP
  const activationDate = kstDateOf(Math.floor(new Date(activatedAt).getTime() / 1000))
  const inWindow = rollups.filter((r) => r.kst_date >= activationDate)
  let total = 0
  for (const a of frozen.albumGoals) {
    for (const t of a.tracks) {
      total += windowedPlays(t.keys, inWindow, activationDate, baseline[`a:${a.id}:${t.label}`] || 0, cap, true)
    }
  }
  return total
}

export interface DistrictDeadline { expiresAt: string; msLeft: number; expired: boolean }

/** A district's restoration window — exactly `days` from activation. Checked
 *  against `!progress.complete` by the caller: a completion that lands on
 *  the buzzer still counts, since completion is evaluated before expiry. */
export function districtDeadline(activatedAt: string, days: number): DistrictDeadline {
  const deadlineMs = new Date(activatedAt).getTime() + days * 86400000
  const msLeft = deadlineMs - Date.now()
  return { expiresAt: new Date(deadlineMs).toISOString(), msLeft: Math.max(0, msLeft), expired: msLeft <= 0 }
}

export function filesRevealedCount(completedTrackGoals: number, totalTrackGoals: number, seededFiles: number): number {
  if (totalTrackGoals === 0 || seededFiles === 0) return 0
  return Math.min(seededFiles, Math.round((completedTrackGoals / totalTrackGoals) * seededFiles))
}
