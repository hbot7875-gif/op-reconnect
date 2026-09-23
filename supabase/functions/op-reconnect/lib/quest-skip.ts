// Skip Quest — a paid way out of a ReConnect Quest an agent no longer wants
// to finish. It is an exit, never a shortcut: no completion, no restoration
// credit, no rewards, no badge.
//
// Every rule (price, 24h wait, 7-day cooldown, free paths, balances) lives in
// SQL — rc_quest_skip_quote / rc_quest_skip, see the 20260924100000 migration.
// The quote the UI renders and the charge the server applies come from the
// same function, so they cannot disagree, and the whole exit happens inside
// one advisory-locked transaction: double taps, two devices and replayed
// requests all resolve to a single charge.
//
// The only thing computed here is the leaver's pooled contribution, because
// that needs the scrobble-matching rules that live in TypeScript. It is
// frozen onto their participant row so the teammates who stayed keep it.

import type { SupabaseDB } from './config.ts'
import { loadContent } from './config.ts'
import { contributionSince, getMissionStatus } from './reconnect-missions.ts'

/** The mission this agent is currently in for a district, if any. Returns the
 *  joined participant row alongside it — the quote needs joined_at/mode. */
async function myOpenMission(supabase: SupabaseDB, agentNo: string, districtId: string) {
  const { data: missions } = await supabase.from('rc_reconnect_missions')
    .select('id, district_id, goal_id, status, expires_at, required_agents')
    .eq('district_id', districtId).in('status', ['open', 'expired'])
  if (!missions?.length) return null
  const { data: mine } = await supabase.from('rc_reconnect_participants')
    .select('mission_id, joined_at, status, joined_mode')
    .eq('agent_no', agentNo).eq('status', 'joined')
    .in('mission_id', missions.map((m: any) => m.id))
    .order('joined_at', { ascending: false }).limit(1).maybeSingle()
  if (!mine) return null
  return { mission: missions.find((m: any) => m.id === mine.mission_id), participant: mine }
}

/** Read-only: what would this cost, can they pay, and are they eligible yet.
 *  Drives the Skip Quest button's enabled/disabled state and the sheet. */
export async function getQuestSkipQuote(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const districtId = String(params.districtId || '').trim()
  if (!districtId) return { success: false, error: 'district_required' }
  const found = await myOpenMission(supabase, agentNo, districtId)
  if (!found?.mission) return { success: false, error: 'not_in_mission' }
  const { data, error } = await supabase.rpc('rc_quest_skip_quote', {
    p_agent: agentNo, p_mission: found.mission.id,
  })
  if (error) return { success: false, error: error.message }
  return data?.success ? { ...data, success: true } : { success: false, error: data?.error || 'quote_failed' }
}

/** Performs the exit. The contribution snapshot is taken here, immediately
 *  before the RPC, so the number frozen for the team is what they had actually
 *  pooled at the moment of leaving. */
export async function skipQuest(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const districtId = String(params.districtId || '').trim()
  if (!districtId) return { success: false, error: 'district_required' }

  const found = await myOpenMission(supabase, agentNo, districtId)
  if (!found?.mission) return { success: false, error: 'not_in_mission' }

  // What this agent has pooled toward a shared-track goal, if the quest has
  // one. Missions without a shared track pool nothing, so it stays 0.
  let contribution = 0
  try {
    const content = await loadContent(supabase)
    const goal = content.goals.find((g: any) => g.id === found.mission.goal_id)
    const keys: string[] = goal?.config?.sharedTrack?.keys || []
    if (keys.length) contribution = await contributionSince(supabase, agentNo, found.participant.joined_at, keys)
  } catch (_e) {
    // A failed snapshot must not block the exit — it only means the team
    // keeps 0 from this agent rather than their real figure.
    contribution = 0
  }

  const { data, error } = await supabase.rpc('rc_quest_skip', {
    p_agent: agentNo, p_mission: found.mission.id, p_contribution: contribution,
  })
  if (error) return { success: false, error: error.message }
  if (!data?.success) return { success: false, ...data }
  return {
    success: true,
    free: !!data.free,
    freeReason: data.freeReason || null,
    costXp: data.costXp || 0,
    costCells: data.costCells || 0,
    districtId,
    contributionKept: contribution,
  }
}

/** Re-exported for the district panel so it can show the quest again right
 *  after an exit without a second round trip from the client. */
export async function questStatusAfterSkip(
  supabase: SupabaseDB, agentNo: string, districtId: string, frozenReconnect: any,
) {
  if (!frozenReconnect) return null
  return getMissionStatus(supabase, agentNo, districtId, frozenReconnect)
}
