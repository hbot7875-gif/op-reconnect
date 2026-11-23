// "Your Contributions" for a district the agent has restored: their own
// Tracks, Albums and ReConnect plays, rebuilt from what is already stored.
// Read-only — nothing here writes anywhere.
//
// Tracks and Albums: the district's frozen goals and activation baseline
// (rc_player_districts) run through the game's own counting
// (districts.ts ownGoalTotals), over the daily rollups from the activation
// day up to the exact moment of restoration. The restoration day itself is
// read from raw rc_scrobbles up to completed_at, so plays made after the
// district was already restored never count. Leave days are skipped, as
// the game skips them.
//
// ReConnect: the agent's own plays of the quest songs between joining the
// team and the quest completing (or them leaving it), via the same
// contributionTotals the live quest uses — shown beside the team's goal,
// never a team total presented as theirs.
//
// No XP is shown: stream XP is recorded per day, not per district.

import { ownGoalTotals } from './districts.ts'
import type { FrozenGoals, RollupRow } from './districts.ts'
import { frozenDistrictDates } from './leave.ts'
import { kstDateOf, kstDayBounds } from './kst.ts'
import { normKeyFull } from './text.ts'

// deno-lint-ignore no-explicit-any
type Sb = any

const PAGE = 1000

/** Every track_name in [fromSec, toSec] (or [fromSec, toSec) when
 *  `inclusiveTo` is false) for one agent. The first page also asks for the
 *  row count, so the remaining pages go out together instead of one after
 *  another — for a heavy streamer that was up to ten round trips in a row.
 *  Ordered by (listened_at, track_name), which is unique per agent
 *  (rc_scrobbles' own unique key), so the pages never overlap or skip. */
export async function rawTrackNames(sb: Sb, agentNo: string, fromSec: number, toSec: number, inclusiveTo: boolean): Promise<string[]> {
  const page = (from: number, withCount: boolean) => {
    let q = sb.from('rc_scrobbles').select('track_name', withCount ? { count: 'exact' } : undefined)
      .eq('agent_no', agentNo).gte('listened_at', fromSec)
    q = inclusiveTo ? q.lte('listened_at', toSec) : q.lt('listened_at', toSec)
    return q.order('listened_at').order('track_name').range(from, from + PAGE - 1)
  }
  const first = await page(0, true)
  if (first.error) throw new Error('scrobbles_unavailable')
  const names: string[] = (first.data || []).map((r: any) => r.track_name)
  if (names.length < PAGE) return names
  const total = Number(first.count) || names.length
  const offsets: number[] = []
  for (let o = PAGE; o < total; o += PAGE) offsets.push(o)
  const pages = await Promise.all(offsets.map((o) => page(o, false)))
  for (const p of pages) {
    if (p.error) throw new Error('scrobbles_unavailable')
    for (const r of p.data || []) names.push(r.track_name)
  }
  // Rows can't arrive in a window that is already over, but if the last
  // page came back full anyway, keep reading rather than undercount.
  let last = pages.length ? (pages[pages.length - 1].data || []).length : names.length
  let next = PAGE * (offsets.length + 1)
  while (last === PAGE) {
    const more = await page(next, false)
    if (more.error) throw new Error('scrobbles_unavailable')
    for (const r of more.data || []) names.push(r.track_name)
    last = (more.data || []).length
    next += PAGE
  }
  return names
}

/** Raw plays per title key between two moments (seconds), from rc_scrobbles. */
async function rawCounts(sb: Sb, agentNo: string, fromSec: number, toSec: number) {
  const bucket: Record<string, { n: number }> = {}
  for (const name of await rawTrackNames(sb, agentNo, fromSec, toSec, true)) {
    const key = normKeyFull(name)
    if (key) (bucket[key] ||= { n: 0 }).n++
  }
  return bucket
}

/** The same totals reconnect-missions.ts contributionTotals(strict, until)
 *  returns — daily rollups strictly between the join day and the until day,
 *  plus raw plays on those two days — with the reads made together.
 *  contributionTotals itself is left as it is: the live ReConnect quest
 *  counts with it. district-contributions.test.mjs checks the two agree. */
export async function questTotals(sb: Sb, agentNo: string, sinceIso: string, untilIso: string): Promise<Map<string, number>> {
  const totals = new Map<string, number>()
  const sinceSec = Math.ceil(new Date(sinceIso).getTime() / 1000)
  const untilSec = Math.floor(new Date(untilIso).getTime() / 1000)
  if (untilSec <= sinceSec) return totals
  const sinceDate = kstDateOf(Math.floor(new Date(sinceIso).getTime() / 1000))
  const untilDate = kstDateOf(untilSec)

  const sinceEnd = kstDayBounds(sinceDate).toTs
  const windows: [number, number][] = [[sinceSec, Math.min(sinceEnd, untilSec)]]
  if (untilDate > sinceDate) windows.push([kstDayBounds(untilDate).fromTs, untilSec])

  const [daily, ...raw] = await Promise.all([
    sinceDate < untilDate
      ? sb.from('rc_daily_activity').select('track_counts').eq('agent_no', agentNo).gt('kst_date', sinceDate).lt('kst_date', untilDate)
      : Promise.resolve({ data: [], error: null }),
    ...windows.map(([from, to]) => rawTrackNames(sb, agentNo, from, to, false)),
  ])
  if (daily.error) throw new Error(`contribution_daily_unavailable:${daily.error.message}`)
  for (const row of daily.data || []) {
    const bucket = row.track_counts || {}
    for (const key of Object.keys(bucket)) totals.set(key, (totals.get(key) || 0) + (bucket[key]?.n || 0))
  }
  for (const names of raw) {
    for (const name of names) {
      const key = normKeyFull(name)
      if (key) totals.set(key, (totals.get(key) || 0) + 1)
    }
  }
  return totals
}

/** The quest songs' title keys, whichever shape the frozen quest has. */
function questKeys(config: Record<string, any> = {}): string[] {
  const keys = new Set<string>()
  for (const k of config.sharedTrack?.keys || []) keys.add(k)
  for (const t of config.sharedTracks?.tracks || []) for (const k of t.keys || []) keys.add(k)
  for (const t of config.checklist?.tracks || []) for (const k of t.keys || []) keys.add(k)
  return [...keys]
}

/** What the team was asked to do, in words (the goal, not a computed total). */
function teamGoal(config: Record<string, any> = {}): string {
  if (config.sharedTrack) return `${config.sharedTrack.target} plays of ${config.sharedTrack.label} together`
  if (config.sharedTracks) return `${config.sharedTracks.total || config.sharedTracks.tracks?.length || 0} songs, ${config.sharedTracks.target} plays each, together`
  if (config.checklist) return `every teammate streams all ${config.checklist.tracks?.length || 0} songs once`
  return 'the team quest'
}

/** The ReConnect part of the record, read alongside Tracks/Albums. */
async function reconnectRecord(sb: Sb, agentNo: string, districtId: string, quest: any) {
  if (!quest) return null
  if (quest.variant !== 'connect' && quest.variant !== 'invite') return { state: 'solo', variant: quest.variant }
  const { data: mine } = await sb.from('rc_reconnect_participants')
    .select('mission_id, status, joined_at, left_at').eq('agent_no', agentNo).in('status', ['joined', 'left'])
  const ids = (mine || []).map((p: any) => p.mission_id)
  const { data: missions } = ids.length
    ? await sb.from('rc_reconnect_missions').select('id, status, completed_at').in('id', ids).eq('district_id', districtId).eq('status', 'complete')
    : { data: [] }
  const mission = (missions || []).sort((a: any, b: any) => String(b.completed_at).localeCompare(String(a.completed_at)))[0]
  const me = mission ? (mine || []).find((p: any) => p.mission_id === mission.id) : null
  if (mission && me?.joined_at) {
    const keys = questKeys(quest.config)
    const [{ count: teamSize }, totals] = await Promise.all([
      sb.from('rc_reconnect_participants').select('agent_no', { count: 'exact', head: true }).eq('mission_id', mission.id).eq('status', 'joined'),
      keys.length ? questTotals(sb, agentNo, me.joined_at, me.left_at || mission.completed_at) : Promise.resolve(new Map<string, number>()),
    ])
    return {
      state: 'played',
      variant: quest.variant,
      plays: quest.variant === 'invite' ? null : keys.reduce((s, k) => s + (totals.get(k) || 0), 0),
      teamGoal: quest.variant === 'invite' ? 'build the team' : teamGoal(quest.config),
      teamSize: teamSize || null,
      completedAt: mission.completed_at,
    }
  }
  const { count: skipped } = await sb.from('rc_quest_skips')
    .select('id', { count: 'exact', head: true }).eq('agent_no', agentNo).eq('district_id', districtId)
  return { state: skipped ? 'skipped' : 'none', variant: quest.variant }
}

export async function getDistrictContributions(sb: Sb, params: any) {
  const agentNo = String(params?.agentNo || '').trim().toUpperCase()
  const districtId = String(params?.districtId || '')
  if (!districtId) return { success: false, error: 'district_required' }
  const { data: row, error } = await sb.from('rc_player_districts')
    .select('status, goals, baseline, activated_at, completed_at')
    .eq('agent_no', agentNo).eq('district_id', districtId).maybeSingle()
  if (error) return { success: false, error: 'unavailable' }
  if (!row || row.status !== 'restored' || !row.activated_at || !row.completed_at || !row.goals) {
    return { success: false, error: 'not_restored' }
  }
  const frozen = row.goals as FrozenGoals
  const activatedAt = row.activated_at as string
  const completedAt = row.completed_at as string
  const startSec = Math.floor(new Date(activatedAt).getTime() / 1000)
  const endSec = Math.floor(new Date(completedAt).getTime() / 1000)
  const startDate = kstDateOf(startSec)
  const endDate = kstDateOf(endSec)

  try {
    // Every read below depends only on the district row, so they go out
    // together: daily rollups up to the day before restoration, the
    // restoration day's raw plays up to the exact moment, leave days, and
    // the ReConnect record.
    const [dailyRes, endDayRes, endDayCounts, leaveDays, reconnect] = await Promise.all([
      sb.from('rc_daily_activity').select('kst_date, track_counts, transmission').eq('agent_no', agentNo)
        .gte('kst_date', startDate).lt('kst_date', endDate),
      sb.from('rc_daily_activity').select('transmission').eq('agent_no', agentNo).eq('kst_date', endDate).maybeSingle(),
      rawCounts(sb, agentNo, kstDayBounds(endDate).fromTs, endSec),
      frozenDistrictDates(sb, agentNo, activatedAt),
      reconnectRecord(sb, agentNo, districtId, frozen.reconnect),
    ])
    if (dailyRes.error) throw new Error('daily_unavailable')
    const rollups: RollupRow[] = [
      ...(dailyRes.data || []).map((r: any) => ({ kst_date: String(r.kst_date), track_counts: r.track_counts || {}, transmission: r.transmission || null })),
      { kst_date: endDate, track_counts: endDayCounts, transmission: endDayRes.data?.transmission || null },
    ]
    const own = ownGoalTotals(frozen, row.baseline || {}, rollups, activatedAt, leaveDays)

    return {
      success: true,
      activatedAt, completedAt,
      tracks: own.tracks.map((t) => ({ label: t.label, plays: t.plays })),
      albums: own.albums.map((a) => ({ label: a.label, passes: a.passes, target: a.target, songs: a.songs })),
      reconnect,
    }
  } catch (_) {
    return { success: false, error: 'unavailable' }
  }
}
