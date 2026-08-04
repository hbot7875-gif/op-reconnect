// Reconnect Missions — the cooperative bonus stage a district's own player
// unlocks once THEY have personally finished that district's solo track+
// album goals (rc_player_districts.status = 'restored'). Doesn't gate or
// change solo restoration at all; it's what becomes available next, not a
// requirement to get there. See migrations/034_rc_reconnect_missions.sql.
//
// A mission needs N agents (district-configured, varies per district) who
// have ALL personally restored that same district, then everyone streams
// one shared target track (also district-configured). Filled either by
// open matchmaking (joinReconnectMission) or direct invite
// (inviteReconnectMission / respondReconnectInvite). Recomputed on every
// read — refreshMission() re-checks expiry and each participant's actual
// streaming activity — the same "derive from source data on read" pattern
// bomb.ts's refreshDefuse already uses for Red Zone events.

import type { GameContent, SupabaseDB } from './config.ts'
import { goalKeys } from './transmission.ts'

interface DistrictReconnectCfg {
  required: number
  trackLabel: string
  trackArtist: string | null
  trackAliases: string[]
}

async function districtCfg(supabase: SupabaseDB, districtId: string): Promise<DistrictReconnectCfg | null> {
  const { data } = await supabase.from('rc_districts')
    .select('reconnect_required, reconnect_track_label, reconnect_track_artist, reconnect_track_aliases')
    .eq('id', districtId).maybeSingle()
  if (!data || !data.reconnect_required) return null
  return {
    required: data.reconnect_required,
    trackLabel: data.reconnect_track_label,
    trackArtist: data.reconnect_track_artist,
    trackAliases: data.reconnect_track_aliases || [],
  }
}

/** Has this agent personally restored this district? Reconnect eligibility
 *  is always checked against the player's OWN progress — districts are
 *  restored per-agent (rc_player_districts), never globally. */
async function hasRestored(supabase: SupabaseDB, agentNo: string, districtId: string): Promise<boolean> {
  const { data } = await supabase.from('rc_player_districts')
    .select('status').eq('agent_no', agentNo).eq('district_id', districtId).maybeSingle()
  return data?.status === 'restored'
}

/** Did this agent stream the target track at all since they joined? Same
 *  track-name-key matching districts.ts's own goals use (goalKeys), no
 *  artist cross-check — consistent with how every other goal in this game
 *  already matches. */
async function hasStreamedTrack(
  supabase: SupabaseDB, agentNo: string, sinceIso: string, keys: string[],
): Promise<boolean> {
  const sinceDate = sinceIso.slice(0, 10)
  const { data } = await supabase.from('rc_daily_activity')
    .select('track_counts').eq('agent_no', agentNo).gte('kst_date', sinceDate)
  for (const row of data || []) {
    const bucket = row.track_counts || {}
    if (keys.some((k) => (bucket[k]?.n || 0) > 0)) return true
  }
  return false
}

function shape(m: any, participants: any[]) {
  return {
    id: m.id,
    districtId: m.district_id,
    requiredAgents: m.required_agents,
    trackLabel: m.track_label,
    trackArtist: m.track_artist,
    status: m.status,
    createdBy: m.created_by,
    createdAt: m.created_at,
    completedAt: m.completed_at,
    expiresAt: m.expires_at,
    participants: participants.map((p) => ({
      agentNo: p.agent_no, status: p.status, invitedBy: p.invited_by,
      joinedAt: p.joined_at, streamed: !!p.streamed_at,
    })),
  }
}

/** Re-derives an open mission's real state from source data: expire it if
 *  time's up, check every joined participant's actual streaming activity,
 *  and settle it (award rewards) the moment everyone required has streamed.
 *  Called at the top of every action below, same as refreshDefuse. */
async function refreshMission(supabase: SupabaseDB, content: GameContent, mission: any) {
  if (mission.status !== 'open') return mission

  if (new Date(mission.expires_at).getTime() <= Date.now()) {
    await supabase.from('rc_reconnect_missions').update({ status: 'expired' }).eq('id', mission.id).eq('status', 'open')
    mission.status = 'expired'
    return mission
  }

  const { data: participants } = await supabase.from('rc_reconnect_participants')
    .select('*').eq('mission_id', mission.id)
  const joined = (participants || []).filter((p: any) => p.status === 'joined')

  const keys = goalKeys({ label: mission.track_label, aliases: mission.track_aliases || [] })
  for (const p of joined) {
    if (p.streamed_at) continue
    if (await hasStreamedTrack(supabase, p.agent_no, p.joined_at, keys)) {
      await supabase.from('rc_reconnect_participants')
        .update({ streamed_at: new Date().toISOString() })
        .eq('mission_id', mission.id).eq('agent_no', p.agent_no)
      p.streamed_at = new Date().toISOString()
    }
  }

  const allStreamed = joined.length >= mission.required_agents && joined.every((p: any) => p.streamed_at)
  if (allStreamed) {
    const { error } = await supabase.from('rc_reconnect_missions')
      .update({ status: 'complete', completed_at: new Date().toISOString() })
      .eq('id', mission.id).eq('status', 'open')
    if (!error) {
      mission.status = 'complete'
      const rewards = content.config.reconnect_rewards || { xp: 100, fuel: 20 }
      for (const p of joined) {
        await supabase.from('rc_xp_ledger').upsert({
          agent_no: p.agent_no, amount: rewards.xp || 0, source: 'reconnect',
          dedup_key: `reconnect:${p.agent_no}:${mission.id}`, meta: { missionId: mission.id },
        }, { onConflict: 'dedup_key', ignoreDuplicates: true })
        if (rewards.fuel > 0) {
          await supabase.rpc('rc_add_resources', { p_agent_no: p.agent_no, p_signal: 0, p_fuel: rewards.fuel, p_intel: 0 })
        }
        await supabase.from('rc_badges').upsert(
          { agent_no: p.agent_no, badge_id: 'reconnect:first' },
          { onConflict: 'agent_no, badge_id', ignoreDuplicates: true })
      }
    }
  }
  return mission
}

async function loadOpenMission(supabase: SupabaseDB, districtId: string) {
  return (await supabase.from('rc_reconnect_missions')
    .select('*').eq('district_id', districtId).eq('status', 'open')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()).data
}

/** Read-only: this district's current mission (any status, most recent) —
 *  the client needs to show a just-completed or just-expired one too, not
 *  just an open one. */
export async function getReconnectMission(supabase: SupabaseDB, content: GameContent, params: any) {
  const districtId = String(params.districtId || '')
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  if (!districtId) return { success: false, error: 'district_required' }

  const cfg = await districtCfg(supabase, districtId)
  if (!cfg) return { success: true, available: false }

  const eligible = await hasRestored(supabase, agentNo, districtId)

  let { data: mission } = await supabase.from('rc_reconnect_missions')
    .select('*').eq('district_id', districtId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (mission) mission = await refreshMission(supabase, content, mission)

  const { data: participants } = mission
    ? await supabase.from('rc_reconnect_participants').select('*').eq('mission_id', mission.id)
    : { data: [] }

  return {
    success: true, available: true, eligible,
    config: { required: cfg.required, trackLabel: cfg.trackLabel, trackArtist: cfg.trackArtist },
    mission: mission ? shape(mission, participants || []) : null,
  }
}

/** Opens a new mission for this district (must be none currently open) and
 *  auto-joins the opener as its first participant. */
export async function openReconnectMission(supabase: SupabaseDB, content: GameContent, params: any) {
  const districtId = String(params.districtId || '')
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const cfg = await districtCfg(supabase, districtId)
  if (!cfg) return { success: false, error: 'not_available' }
  if (!(await hasRestored(supabase, agentNo, districtId))) return { success: false, error: 'not_eligible' }

  const existing = await loadOpenMission(supabase, districtId)
  if (existing) return { success: false, error: 'mission_already_open' }

  const { data: mission, error } = await supabase.from('rc_reconnect_missions').insert({
    district_id: districtId, required_agents: cfg.required,
    track_label: cfg.trackLabel, track_artist: cfg.trackArtist, track_aliases: cfg.trackAliases,
    created_by: agentNo,
  }).select().single()
  if (error) return { success: false, error: error.message }

  await supabase.from('rc_reconnect_participants').insert({ mission_id: mission.id, agent_no: agentNo, status: 'joined' })
  const { data: participants } = await supabase.from('rc_reconnect_participants').select('*').eq('mission_id', mission.id)
  return { success: true, mission: shape(mission, participants || []) }
}

/** Open-matchmaking join — fills a slot directly, no invite needed. */
export async function joinReconnectMission(supabase: SupabaseDB, content: GameContent, params: any) {
  const districtId = String(params.districtId || '')
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  if (!(await hasRestored(supabase, agentNo, districtId))) return { success: false, error: 'not_eligible' }

  let mission = await loadOpenMission(supabase, districtId)
  if (!mission) return { success: false, error: 'no_open_mission' }
  mission = await refreshMission(supabase, content, mission)
  if (mission.status !== 'open') return { success: false, error: 'mission_' + mission.status }

  const { data: participants } = await supabase.from('rc_reconnect_participants').select('*').eq('mission_id', mission.id)
  const joinedCount = (participants || []).filter((p: any) => p.status === 'joined').length
  if ((participants || []).some((p: any) => p.agent_no === agentNo)) return { success: false, error: 'already_in_mission' }
  if (joinedCount >= mission.required_agents) return { success: false, error: 'mission_full' }

  const { error } = await supabase.from('rc_reconnect_participants')
    .insert({ mission_id: mission.id, agent_no: agentNo, status: 'joined' })
  if (error) return { success: false, error: error.message }

  const fresh = await refreshMission(supabase, content, mission)
  const { data: freshParticipants } = await supabase.from('rc_reconnect_participants').select('*').eq('mission_id', mission.id)
  return { success: true, mission: shape(fresh, freshParticipants || []) }
}

/** An agent already in an open mission invites someone else who's also
 *  eligible (has restored this district themselves). Sits as 'invited'
 *  until the invitee accepts — see respondReconnectInvite. */
export async function inviteReconnectMission(supabase: SupabaseDB, content: GameContent, params: any) {
  const districtId = String(params.districtId || '')
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const inviteeAgentNo = String(params.inviteeAgentNo || '').trim().toUpperCase()
  if (!inviteeAgentNo) return { success: false, error: 'invitee_required' }
  if (inviteeAgentNo === agentNo) return { success: false, error: 'cannot_invite_self' }

  let mission = await loadOpenMission(supabase, districtId)
  if (!mission) return { success: false, error: 'no_open_mission' }
  mission = await refreshMission(supabase, content, mission)
  if (mission.status !== 'open') return { success: false, error: 'mission_' + mission.status }

  const { data: participants } = await supabase.from('rc_reconnect_participants').select('*').eq('mission_id', mission.id)
  const me = (participants || []).find((p: any) => p.agent_no === agentNo && p.status === 'joined')
  if (!me) return { success: false, error: 'not_in_mission' }
  if ((participants || []).some((p: any) => p.agent_no === inviteeAgentNo)) return { success: false, error: 'already_in_mission' }

  const joinedCount = (participants || []).filter((p: any) => p.status === 'joined').length
  if (joinedCount >= mission.required_agents) return { success: false, error: 'mission_full' }
  if (!(await hasRestored(supabase, inviteeAgentNo, districtId))) return { success: false, error: 'invitee_not_eligible' }

  const { error } = await supabase.from('rc_reconnect_participants')
    .insert({ mission_id: mission.id, agent_no: inviteeAgentNo, status: 'invited', invited_by: agentNo })
  if (error) return { success: false, error: error.message }
  return { success: true }
}

/** The invited agent accepts (joins a real slot) or declines (row removed
 *  outright — nothing downstream needs to remember a decline happened). */
export async function respondReconnectInvite(supabase: SupabaseDB, content: GameContent, params: any) {
  const districtId = String(params.districtId || '')
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const accept = !!params.accept

  let mission = await loadOpenMission(supabase, districtId)
  if (!mission) return { success: false, error: 'no_open_mission' }
  mission = await refreshMission(supabase, content, mission)
  if (mission.status !== 'open') return { success: false, error: 'mission_' + mission.status }

  const { data: invite } = await supabase.from('rc_reconnect_participants')
    .select('*').eq('mission_id', mission.id).eq('agent_no', agentNo).eq('status', 'invited').maybeSingle()
  if (!invite) return { success: false, error: 'no_pending_invite' }

  if (!accept) {
    await supabase.from('rc_reconnect_participants').delete().eq('mission_id', mission.id).eq('agent_no', agentNo)
    return { success: true, joined: false }
  }

  const { data: participants } = await supabase.from('rc_reconnect_participants').select('*').eq('mission_id', mission.id)
  const joinedCount = (participants || []).filter((p: any) => p.status === 'joined').length
  if (joinedCount >= mission.required_agents) return { success: false, error: 'mission_full' }

  const { error } = await supabase.from('rc_reconnect_participants')
    .update({ status: 'joined', joined_at: new Date().toISOString() })
    .eq('mission_id', mission.id).eq('agent_no', agentNo)
  if (error) return { success: false, error: error.message }
  await refreshMission(supabase, content, mission)
  return { success: true, joined: true }
}
