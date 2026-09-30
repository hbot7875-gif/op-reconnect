// Skip Quest — a paid way out of a ReConnect Quest an agent no longer wants
// to finish. It waives only this district attempt's ReConnect gate; it never
// completes the Quest or grants its Mission Bond badge. Track and album goals
// still have to be completed, and the team's pooled streams stay put.
//
// Every rule (price, 24h wait, 7-day cooldown, free paths, balances) lives in
// SQL — the hardened v2 RPCs, see the 20260924160000 migration.
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
import { getMissionStatus, questExitContributionEvidence } from './reconnect-missions.ts'
import { runSkipWithEvidenceRetry } from './quest-skip-retry.ts'

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

/** The snapshot the SQL decides from: every joined member's counted
 *  contribution, plus the stream cursor it was counted at. */
interface QuestEvidence { contributions: Record<string, number>; highWater: number }

async function freshEvidence(supabase: SupabaseDB, found: any) {
  // Capture the stream-table high-water mark BEFORE counting. SQL rejects
  // the quote/exit if any roster member receives a newer scrobble before the
  // row-locked decision, closing the asynchronous-ingestion race safely.
  const { data: latest, error: latestError } = await supabase.from('rc_scrobbles')
    .select('id').order('id', { ascending: false }).limit(1).maybeSingle()
  if (latestError) throw new Error('quest_stream_cursor_unavailable')
  const content = await loadContent(supabase)
  const goal = content.goals.find((g: any) => g.id === found.mission.goal_id)
  const variant = goal?.variant === 'invite' ? 'invite' : 'connect'
  if (!goal) throw new Error('quest_goal_unavailable')
  const contributions = await questExitContributionEvidence(supabase, found.mission, variant, goal.config || {})
  return { contributions, highWater: Number(latest?.id) || 0 }
}

/** Read-only: what would this cost, can they pay, and are they eligible yet.
 *  Drives the Skip Quest button's enabled/disabled state and the sheet. */
export async function getQuestSkipQuote(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const districtId = String(params.districtId || '').trim()
  if (!districtId) return { success: false, error: 'district_required' }
  const found = await myOpenMission(supabase, agentNo, districtId)
  if (!found?.mission) return { success: false, error: 'not_in_mission' }
  // The quote writes nothing at all, so the same race here only ever cost the
  // player a sheet that refused to open. Same bounded retry, same reasons.
  const outcome = await runSkipWithEvidenceRetry<QuestEvidence, any>({
    buildEvidence: () => freshEvidence(supabase, found),
    callRpc: (evidence) => supabase.rpc('rc_quest_skip_quote_v2', {
      p_agent: agentNo, p_mission: found.mission.id,
      p_evidence: evidence.contributions, p_scrobble_high_water: evidence.highWater,
    }) as any,
    stillSkippable: () => true,
  })
  if (!outcome.ok) return { success: false, error: outcome.error || 'quote_failed' }
  return { ...outcome.data, success: true }
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

  // The snapshot is the only volatile part of this, so it is the only part
  // that gets another go. On an active roster a teammate's scrobble landing
  // between the high-water read and the RPC is ordinary, not exceptional, and
  // before this the player simply lost — every tap refused, nothing written,
  // no way through. See quest-skip-retry.ts for why re-calling the RPC after
  // these two rejections cannot charge twice.
  let lastEvidence: QuestEvidence | null = null
  const expiresAt = Date.parse(found.mission.expires_at)

  const outcome = await runSkipWithEvidenceRetry<QuestEvidence, any>({
    buildEvidence: async () => {
      lastEvidence = await freshEvidence(supabase, found)
      return lastEvidence
    },
    callRpc: (evidence) => supabase.rpc('rc_quest_skip_v2', {
      p_agent: agentNo, p_mission: found.mission.id,
      p_evidence: evidence.contributions, p_scrobble_high_water: evidence.highWater,
    }) as any,
    // An expiry that lands mid-retry must not quietly become a free Expired
    // Exit: that one does NOT waive the district requirement, so the player
    // would pay nothing and still be blocked, having asked for the opposite.
    stillSkippable: () => !Number.isFinite(expiresAt) || Date.now() < expiresAt,
  })

  if (!outcome.ok) {
    const data = outcome.data && typeof outcome.data === 'object' ? outcome.data : {}
    return { ...data, success: false, error: outcome.error }
  }

  const data = outcome.data
  return {
    success: true,
    free: !!data.free,
    freeReason: data.freeReason || null,
    costXp: data.costXp || 0,
    costCells: data.costCells || 0,
    districtId,
    contributionKept: Number((lastEvidence as QuestEvidence | null)?.contributions[agentNo]) || 0,
    waivesRequirement: !!data.waivesRequirement,
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
