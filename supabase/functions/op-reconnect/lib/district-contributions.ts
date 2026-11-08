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
import { contributionTotals } from './reconnect-missions.ts'
import { frozenDistrictDates } from './leave.ts'
import { kstDateOf, kstDayBounds } from './kst.ts'
import { normKeyFull } from './text.ts'

// deno-lint-ignore no-explicit-any
type Sb = any

const PAGE = 1000

/** Raw plays per title key between two moments (seconds), from rc_scrobbles. */
async function rawCounts(sb: Sb, agentNo: string, fromSec: number, toSec: number) {
  const bucket: Record<string, { n: number }> = {}
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb.from('rc_scrobbles').select('track_name')
      .eq('agent_no', agentNo).gte('listened_at', fromSec).lte('listened_at', toSec)
      .order('listened_at').range(offset, offset + PAGE - 1)
    if (error) throw new Error('scrobbles_unavailable')
    for (const r of data || []) {
      const key = normKeyFull(r.track_name)
      if (key) (bucket[key] ||= { n: 0 }).n++
    }
    if (!data || data.length < PAGE) break
  }
  return bucket
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
    // Daily rollups up to the day before restoration; the restoration day
    // itself from raw plays up to the exact moment.
    const { data: daily, error: dailyErr } = await sb.from('rc_daily_activity')
      .select('kst_date, track_counts, transmission').eq('agent_no', agentNo)
      .gte('kst_date', startDate).lt('kst_date', endDate)
    if (dailyErr) throw new Error('daily_unavailable')
    const { data: endDay } = await sb.from('rc_daily_activity')
      .select('transmission').eq('agent_no', agentNo).eq('kst_date', endDate).maybeSingle()
    const rollups: RollupRow[] = [
      ...(daily || []).map((r: any) => ({ kst_date: String(r.kst_date), track_counts: r.track_counts || {}, transmission: r.transmission || null })),
      { kst_date: endDate, track_counts: await rawCounts(sb, agentNo, kstDayBounds(endDate).fromTs, endSec), transmission: endDay?.transmission || null },
    ]
    const leaveDays = await frozenDistrictDates(sb, agentNo, activatedAt)
    const own = ownGoalTotals(frozen, row.baseline || {}, rollups, activatedAt, leaveDays)

    // ReConnect: the team quest(s) this agent was on in this district.
    let reconnect: Record<string, unknown> | null = null
    const quest = frozen.reconnect
    if (quest && (quest.variant === 'connect' || quest.variant === 'invite')) {
      const { data: mine } = await sb.from('rc_reconnect_participants')
        .select('mission_id, status, joined_at, left_at').eq('agent_no', agentNo).in('status', ['joined', 'left'])
      const ids = (mine || []).map((p: any) => p.mission_id)
      const { data: missions } = ids.length
        ? await sb.from('rc_reconnect_missions').select('id, status, completed_at').in('id', ids).eq('district_id', districtId).eq('status', 'complete')
        : { data: [] }
      const mission = (missions || []).sort((a: any, b: any) => String(b.completed_at).localeCompare(String(a.completed_at)))[0]
      const me = mission ? (mine || []).find((p: any) => p.mission_id === mission.id) : null
      if (mission && me?.joined_at) {
        const { count: teamSize } = await sb.from('rc_reconnect_participants')
          .select('agent_no', { count: 'exact', head: true }).eq('mission_id', mission.id).eq('status', 'joined')
        const keys = questKeys(quest.config)
        const totals = keys.length
          ? await contributionTotals(sb, agentNo, me.joined_at, true, me.left_at || mission.completed_at)
          : new Map<string, number>()
        reconnect = {
          state: 'played',
          variant: quest.variant,
          plays: quest.variant === 'invite' ? null : keys.reduce((s, k) => s + (totals.get(k) || 0), 0),
          teamGoal: quest.variant === 'invite' ? 'build the team' : teamGoal(quest.config),
          teamSize: teamSize || null,
          completedAt: mission.completed_at,
        }
      } else {
        const { count: skipped } = await sb.from('rc_quest_skips')
          .select('id', { count: 'exact', head: true }).eq('agent_no', agentNo).eq('district_id', districtId)
        reconnect = { state: skipped ? 'skipped' : 'none', variant: quest.variant }
      }
    } else if (quest) {
      reconnect = { state: 'solo', variant: quest.variant }
    }

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
