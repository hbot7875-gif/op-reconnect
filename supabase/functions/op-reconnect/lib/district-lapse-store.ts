// Records an ended district attempt in rc_district_lapses just before its
// rc_player_districts row is deleted, so the district screen can show what
// it reached and what was missing instead of a bare 0% (district-lapse.js).

import type { GameContent, SupabaseDB } from './config.ts'
import { districtProgress } from './districts.ts'
import { kstDateOf } from './kst.ts'
import { getBackupOverlay } from './backup-pass.ts'
import { getTeamBoostOverlay } from './reconnect-missions.ts'
import { resolveReconnectStatus } from './reconnect-goal.ts'
import { frozenDistrictDates } from './leave.ts'
import { buildLapseSummary } from './district-lapse.js'

export type LapseReason = 'deadline' | 'reset' | 'blackout'

function reconnectInfo(content: GameContent, pd: any) {
  const frozen = pd?.goals?.reconnect
  if (!frozen) return {}
  const goal: any = content.goals.find((g: any) => g.id === frozen.id)
  return {
    label: goal?.label || 'ReConnect Quest',
    trackLabel: frozen.config?.sharedTrack?.label || null,
  }
}

/** The attempt's progress, computed the way getGameState does (backup and
 *  Team Boost overlays, leave-frozen days), for callers that don't already
 *  hold it. */
async function attemptProgress(supabase: SupabaseDB, content: GameContent, agentNo: string, pd: any) {
  const activationDate = kstDateOf(Math.floor(new Date(pd.activated_at).getTime() / 1000))
  const [{ data: rollups }, backupOverlay, teamBoostOverlay, frozenDates, reconnect] = await Promise.all([
    supabase.from('rc_daily_activity').select('kst_date, track_counts, transmission')
      .eq('agent_no', agentNo).gte('kst_date', activationDate).order('kst_date'),
    getBackupOverlay(supabase, agentNo, pd.district_id),
    getTeamBoostOverlay(supabase, agentNo, pd.district_id),
    frozenDistrictDates(supabase, agentNo, pd.activated_at),
    resolveReconnectStatus(supabase, content, agentNo, pd.district_id, pd.goals?.reconnect || null),
  ])
  const progress = districtProgress(pd.goals, pd.baseline || {}, rollups || [], pd.activated_at, content, { ...backupOverlay, ...teamBoostOverlay }, undefined, frozenDates)
  return { progress, reconnect }
}

/**
 * Never throws: losing the history row must not stop the reset it belongs
 * to (a stuck expired attempt would block starting any district).
 */
export async function recordDistrictLapse(
  supabase: SupabaseDB, content: GameContent, agentNo: string, pd: any,
  deadlineAt: string, reason: LapseReason,
  known?: { progress: any; reconnect: any },
): Promise<void> {
  try {
    if (!pd?.goals) return
    const { progress, reconnect } = known || await attemptProgress(supabase, content, agentNo, pd)
    const summary = buildLapseSummary(progress, reconnect, reconnectInfo(content, pd))
    await supabase.from('rc_district_lapses').upsert({
      agent_no: agentNo,
      district_id: pd.district_id,
      activated_at: pd.activated_at,
      deadline_at: deadlineAt,
      reason,
      summary,
    }, { onConflict: 'agent_no,district_id,activated_at', ignoreDuplicates: true })
  } catch (e) {
    console.error('recordDistrictLapse failed', agentNo, pd?.district_id, e)
  }
}
