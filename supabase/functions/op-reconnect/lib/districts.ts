// District mechanics: freezing goal snapshots at activation, computing
// progress from daily activity rollups, and the 7-mission board shape.
// A district's checklist is FROZEN when the player starts it — era goal
// edits never change an in-flight district.

import { goalKeys } from './transmission.ts'
import type { DayBucket } from './transmission.ts'
import type { GameContent, DistrictRow } from './config.ts'
import { modeMultiplier, xpRules } from './config.ts'
import { kstDateOf } from './kst.ts'

export interface FrozenGoals {
  trackGoals: { id: string; label: string; artist: string | null; target: number; keys: string[] }[]
  albumGoal: { label: string; target: number; tracks: { label: string; keys: string[] }[] } | null
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

  if (district.is_tutorial) {
    const tut = content.config.tutorial || { trackGoalId: null, plays: 3 }
    const goal = content.goals.find((g) => g.id === tut.trackGoalId) || content.goals.find((g) => g.kind === 'track')
    return {
      trackGoals: goal
        ? [{ id: goal.id, label: goal.label, artist: goal.artist, target: tut.plays || 3, keys: goalKeys(goal) }]
        : [],
      albumGoal: null,
      meta: { mode, multiplier: 1, tutorial: true },
    }
  }

  const trackGoals = content.goals
    .filter((g) => g.kind === 'track')
    .map((g) => ({ id: g.id, label: g.label, artist: g.artist, target: g.target * multiplier, keys: goalKeys(g) }))

  const albumRow = content.goals.find((g) => g.kind === 'album') || null
  const albumGoal = albumRow && albumRow.tracks
    ? {
        label: albumRow.label,
        target: albumRow.target * multiplier,
        tracks: albumRow.tracks.map((t) => ({ label: t.label, keys: goalKeys({ label: t.label, aliases: t.aliases || [] }) })),
      }
    : null

  return { trackGoals, albumGoal, meta: { mode, multiplier } }
}

/** Capped plays already accrued today — so activation-day streams from before
 *  the "Begin Restoration" tap never count toward the new district. */
export function computeBaseline(todayBucket: DayBucket, frozen: FrozenGoals, cap: number): Record<string, number> {
  const baseline: Record<string, number> = {}
  for (const g of frozen.trackGoals) {
    const plays = g.keys.reduce((s, k) => s + (todayBucket[k]?.n || 0), 0)
    baseline[`t:${g.id}`] = Math.min(plays, cap)
  }
  if (frozen.albumGoal) {
    for (const t of frozen.albumGoal.tracks) {
      const plays = t.keys.reduce((s, k) => s + (todayBucket[k]?.n || 0), 0)
      baseline[`a:${t.label}`] = Math.min(plays, cap)
    }
  }
  return baseline
}

export interface DistrictProgress {
  trackGoals: { id: string; label: string; artist: string | null; progress: number; target: number; done: boolean }[]
  album: { label: string; passesDone: number; target: number; signalPct: number; done: boolean; nextPassTracks: { label: string; have: number; need: number }[] } | null
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
  const cap = xpRules(content).varietyCapBase * (frozen.meta.multiplier || 1)
  const activationDate = kstDateOf(Math.floor(new Date(activatedAt).getTime() / 1000))
  const inWindow = rollups.filter((r) => r.kst_date >= activationDate)

  const trackGoals = frozen.trackGoals.map((g) => {
    const total = windowedPlays(g.keys, inWindow, activationDate, baseline[`t:${g.id}`] || 0, cap, false)
    return { id: g.id, label: g.label, artist: g.artist, progress: Math.min(total, g.target), target: g.target, done: total >= g.target }
  })
  const allTracksDone = trackGoals.length > 0 && trackGoals.every((g) => g.done)

  let album: DistrictProgress['album'] = null
  if (frozen.albumGoal) {
    const perTrack = frozen.albumGoal.tracks.map((t) => ({
      label: t.label,
      total: windowedPlays(t.keys, inWindow, activationDate, baseline[`a:${t.label}`] || 0, cap, true),
    }))
    const target = frozen.albumGoal.target
    const passesDone = Math.min(perTrack.reduce((m, t) => Math.min(m, t.total), Infinity), target)
    const capped = perTrack.reduce((s, t) => s + Math.min(t.total, target), 0)
    const signalPct = Math.min(100, Math.round((capped / (perTrack.length * target)) * 100))
    const nextPassTracks = perTrack
      .filter((t) => t.total < target)
      .sort((a, b) => a.total - b.total)
      .slice(0, 5)
      .map((t) => ({ label: t.label, have: t.total, need: target - t.total }))
    album = { label: frozen.albumGoal.label, passesDone: Number.isFinite(passesDone) ? passesDone : 0, target, signalPct, done: passesDone >= target, nextPassTracks }
  }

  const complete = allTracksDone && (!album || album.done)
  return { trackGoals, album, allTracksDone, complete }
}

/** The player-facing 7-mission board. */
export function missionBoard(p: DistrictProgress, filesRevealed: number, filesTotal: number): any[] {
  const trackDone = p.allTracksDone
  const albumDone = !p.album || p.album.done
  const trackProg = p.trackGoals.reduce((s, g) => s + g.progress, 0)
  const trackReq = p.trackGoals.reduce((s, g) => s + g.target, 0)
  const restored = p.complete
  return [
    { id: 'tracks', icon: '🎵', label: 'Track Goals', status: trackDone ? 'done' : 'active', progress: trackProg, required: trackReq },
    { id: 'albums', icon: '💿', label: 'Album Goals', status: albumDone ? 'done' : 'active', progress: p.album?.passesDone || 0, required: p.album?.target || 0 },
    { id: 'intel', icon: '📂', label: 'Intel Recovery', status: trackDone ? 'done' : 'active', progress: filesRevealed, required: filesTotal },
    { id: 'signal', icon: '📡', label: 'Signal Scan', status: albumDone ? 'done' : 'active', progress: p.album ? p.album.signalPct : 100, required: 100 },
    { id: 'security', icon: '🔐', label: 'Security Check', status: trackDone && albumDone ? 'done' : 'locked', progress: trackDone && albumDone ? 1 : 0, required: 1 },
    { id: 'network', icon: '🛰️', label: 'Network Restore', status: restored ? 'done' : 'locked', progress: restored ? 1 : 0, required: 1 },
    { id: 'restored', icon: '🏛️', label: 'District Restored', status: restored ? 'done' : 'locked', progress: restored ? 1 : 0, required: 1 },
  ]
}

export function filesRevealedCount(completedTrackGoals: number, totalTrackGoals: number, seededFiles: number): number {
  if (totalTrackGoals === 0 || seededFiles === 0) return 0
  return Math.min(seededFiles, Math.round((completedTrackGoals / totalTrackGoals) * seededFiles))
}
