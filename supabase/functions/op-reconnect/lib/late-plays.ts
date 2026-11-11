// Plays that reach rc_scrobbles after their KST day was counted.
//
// streams.ts reopens such a day (finalized = false) and derive.ts recounts it.
// A recount of a closed day follows three rules, shared here with the
// historical recount script so the two can never disagree:
//
//  1. It only ever ADDS. Each song keeps the larger of what the day already
//     counted and what the stored rows now show, so a closed day's goals,
//     streak and district results can't move backwards because of one
//     recount (older days may have counted copies listen-copies.ts now
//     collapses; those stay as they were).
//  2. The plays it adds earn stream XP the way they would have on the day:
//     only goal songs of the district that was live at the moment the play
//     was heard (activated_at..completed_at), only allowlisted artists, at
//     that day's mode rate, with no level-up boost (boosts are for today).
//     Restored districts' results are not touched; only XP is added.
//  3. The XP is added to the day's existing ledger row (streams:<agent>:<date>),
//     with its own counter in meta, so a second recount of the same day pays
//     only for plays added since, and nothing is ever paid twice.

import { normKeyFull, normalizeKey, countedArtistPlays } from './text.ts'
import { kstDayBounds } from './kst.ts'
import type { DayBucket } from './transmission.ts'
import type { FrozenGoals } from './districts.ts'

/** A day that was closed and then reopened for late plays. The last write of
 *  a day after it ended always sets finalized = true, so an open day whose
 *  last write came after its end was reopened (streams.ts). */
export function isReopenedDay(row: { finalized: boolean; updated_at?: string | null } | undefined, date: string, today: string): boolean {
  if (!row || row.finalized || date >= today || !row.updated_at) return false
  return new Date(row.updated_at).getTime() >= kstDayBounds(date).toTs * 1000
}

/** Rule 1: per song, the larger of old and new. Returns what was added. */
export function mergeClosedDay(
  old: { raw: number; bucket: DayBucket },
  fresh: { raw: number; bucket: DayBucket },
): { raw: number; bucket: DayBucket; added: Map<string, number> } {
  const bucket: DayBucket = JSON.parse(JSON.stringify(old.bucket || {}))
  const added = new Map<string, number>()
  let addedTotal = 0
  for (const [key, entry] of Object.entries(fresh.bucket || {})) {
    const have = bucket[key]?.n || 0
    if (entry.n <= have) continue
    // Take the stored rows' count and artist split only when it has at least
    // as many plays for every artist the day already counted; otherwise the
    // day's own numbers can't be reconciled with the rows, so leave the song
    // as it was rather than guess.
    const prior = bucket[key]?.a || {}
    if (Object.entries(prior).some(([artist, n]) => (entry.a?.[artist] || 0) < n)) continue
    bucket[key] = { n: entry.n, a: { ...(entry.a || {}) } }
    added.set(key, entry.n - have)
    addedTotal += entry.n - have
  }
  return { raw: (old.raw || 0) + addedTotal, bucket, added }
}

export interface DistrictWindow {
  goals: FrozenGoals | null
  activated_at: string
  completed_at?: string | null
}

function goalKeys(goals: FrozenGoals | null | undefined): Set<string> {
  const keys = new Set<string>()
  for (const goal of goals?.trackGoals || []) for (const key of goal.keys || []) keys.add(key)
  for (const album of goals?.albumGoals || []) for (const track of album.tracks || []) for (const key of track.keys || []) keys.add(key)
  return keys
}

/** Rule 2: how many of the plays added to each song were XP-eligible goal
 *  plays. Which stored rows are the "added" ones can't be told apart (the day
 *  counted n of them, now there are n + k), so this is the lower bound: the
 *  added plays minus every play of that song that was NOT eligible. It can
 *  under-pay a boundary day; it can never pay for an ineligible play. */
export function eligibleAddedPlays(
  added: Map<string, number>,
  rows: { track_name: string; artist_name?: string | null; listened_at: number }[],
  districts: DistrictWindow[],
  allowlist: string[],
  overrides?: Record<string, string[]>,
): number {
  if (!added.size || !districts.length) return 0
  const windows = districts.map((d) => ({
    from: Math.floor(new Date(d.activated_at).getTime() / 1000),
    to: d.completed_at ? Math.floor(new Date(d.completed_at).getTime() / 1000) : Infinity,
    keys: goalKeys(d.goals),
  }))
  const total = new Map<string, number>()
  const eligible = new Map<string, number>()
  for (const r of rows) {
    const key = normKeyFull(r.track_name || '')
    if (!key || !added.has(key)) continue
    total.set(key, (total.get(key) || 0) + 1)
    const live = windows.some((w) => r.listened_at >= w.from && r.listened_at <= w.to && w.keys.has(key))
    if (!live) continue
    const artist = normalizeKey(r.artist_name || '')
    if (countedArtistPlays({ [artist]: 1 }, allowlist, key, overrides) < 1) continue
    eligible.set(key, (eligible.get(key) || 0) + 1)
  }
  let sum = 0
  for (const [key, n] of added) {
    const ineligible = (total.get(key) || 0) - (eligible.get(key) || 0)
    sum += Math.max(0, Math.min(n, (total.get(key) || 0)) - ineligible)
  }
  return sum
}

/** Rule 3: the day's ledger row after paying for `plays` more eligible plays.
 *  Uses the row's own remainder so fractions carry, exactly as
 *  derive.ts awardStreamsXp does. */
export function lateXpLedgerRow(
  existing: { amount?: number | null; meta?: Record<string, any> | null } | null,
  plays: number,
  perXp: number,
): { amount: number; meta: Record<string, any>; xp: number } {
  const meta = { ...(existing?.meta || {}) }
  const available = (Number(meta.remainder) || 0) + plays
  const xp = Math.floor(available / perXp)
  meta.remainder = available - xp * perXp
  meta.late_counted = (Number(meta.late_counted) || 0) + plays
  meta.counted = Number(meta.counted) || 0
  return { amount: (Number(existing?.amount) || 0) + xp, meta, xp }
}

/** Rule 4: on an active district's activation day, late plays heard BEFORE
 *  the activation must not move the district. Its frozen baseline (plays of
 *  each goal already on the day when it started, districts.ts windowedPlays)
 *  never saw them, so they are added to it — as an upper bound, so a
 *  pre-activation play can never count. Returns the baseline deltas. */
export function activationDayBaselineBump(
  added: Map<string, number>,
  rows: { track_name: string; listened_at: number }[],
  goals: FrozenGoals | null | undefined,
  activatedAt: string,
): Record<string, number> {
  const at = Math.floor(new Date(activatedAt).getTime() / 1000)
  const before = new Map<string, number>()
  for (const r of rows) {
    if (r.listened_at >= at) continue
    const key = normKeyFull(r.track_name || '')
    if (key && added.has(key)) before.set(key, (before.get(key) || 0) + 1)
  }
  const bump = (keys: string[]) => keys.reduce((s, k) => s + Math.min(added.get(k) || 0, before.get(k) || 0), 0)
  const out: Record<string, number> = {}
  for (const g of goals?.trackGoals || []) { const n = bump(g.keys || []); if (n) out[`t:${g.id}`] = n }
  for (const a of goals?.albumGoals || []) for (const t of a.tracks || []) { const n = bump(t.keys || []); if (n) out[`a:${a.id}:${t.label}`] = n }
  const all = new Set([...(goals?.trackGoals || []).flatMap((g) => g.keys || []), ...(goals?.albumGoals || []).flatMap((a) => (a.tracks || []).flatMap((t) => t.keys || []))])
  const xp = bump([...all])
  if (xp) out['xp:goal-streams'] = xp
  return out
}
