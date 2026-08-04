// Reconnect Missions — the cooperative bonus stage a district's own player
// unlocks once THEY have personally finished that district's solo track+
// album goals (rc_player_districts.status = 'restored'). Doesn't gate or
// change solo restoration at all; it's what becomes available next, not a
// requirement to get there. See migrations/034_rc_reconnect_missions.sql
// and 035_rc_reconnect_multi.sql.
//
// A mission needs N agents (district-configured, varies per district) who
// have ALL personally restored that same district, then everyone streams
// one shared target track (also district-configured). Filled either by
// open matchmaking (joinReconnectMission), direct invite
// (inviteReconnectMission / respondReconnectInvite), or an admin batch-
// assigning a whole series at once (adminAutoAssignMissions) — several can
// run concurrently for the same district, so every read/write here works
// against "the mission this agent is in", never "the district's mission"
// singular. Recomputed on every read — refreshMission() re-checks expiry
// and each participant's actual streaming activity — the same "derive from
// source data on read" pattern bomb.ts's refreshDefuse already uses for Red
// Zone events.

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

/** Re-derives one mission's real state from source data: expire it if time's
 *  up, check every joined participant's actual streaming activity, and
 *  settle it (award rewards) the moment everyone required has streamed.
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

/** The mission this agent is currently a live part of for this district, if
 *  any — 'joined' or 'invited', most recent first. Several missions can be
 *  open for the same district at once, so "my mission" is always looked up
 *  by participation, never by district alone. */
async function myMission(supabase: SupabaseDB, agentNo: string, districtId: string) {
  // Two plain queries rather than an embedded-resource filter
  // (rc_reconnect_missions!inner(...).eq('rc_reconnect_missions.x', ...)) —
  // PostgREST's dot-filter on an embed filters what's INCLUDED in the
  // embedded object, not which base rows come back, so that would have
  // silently returned every district's participation rows for this agent,
  // not just this district's open ones.
  const { data: openMissions } = await supabase.from('rc_reconnect_missions')
    .select('id').eq('district_id', districtId).eq('status', 'open')
  const missionIds = (openMissions || []).map((m: any) => m.id)
  if (!missionIds.length) return null

  const { data: rows } = await supabase.from('rc_reconnect_participants')
    .select('mission_id').eq('agent_no', agentNo).in('mission_id', missionIds)
    .order('joined_at', { ascending: false }).limit(1)
  const row: any = (rows || [])[0]
  if (!row) return null

  const { data: mission } = await supabase.from('rc_reconnect_missions')
    .select('*').eq('id', row.mission_id).maybeSingle()
  return mission
}

/** An open mission for this district with a free slot — for the "just show
 *  me something to join" path when the agent isn't already in one. Oldest
 *  first: fill the mission that's been waiting longest before starting a
 *  new one. */
async function joinableMission(supabase: SupabaseDB, districtId: string, requiredAgents: number) {
  const { data: missions } = await supabase.from('rc_reconnect_missions')
    .select('*').eq('district_id', districtId).eq('status', 'open')
    .order('created_at', { ascending: true })
  for (const m of missions || []) {
    const { count } = await supabase.from('rc_reconnect_participants')
      .select('agent_no', { count: 'exact', head: true }).eq('mission_id', m.id).eq('status', 'joined')
    if ((count || 0) < (m.required_agents ?? requiredAgents)) return m
  }
  return null
}

/** Read-only: the mission this agent is in for this district, or (if
 *  they're not in one) a joinable one they could enter — never "the"
 *  district mission, since several can run at once. */
export async function getReconnectMission(supabase: SupabaseDB, content: GameContent, params: any) {
  const districtId = String(params.districtId || '')
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  if (!districtId) return { success: false, error: 'district_required' }

  const cfg = await districtCfg(supabase, districtId)
  if (!cfg) return { success: true, available: false }

  const eligible = await hasRestored(supabase, agentNo, districtId)

  let mission = await myMission(supabase, agentNo, districtId)
  if (!mission) mission = await joinableMission(supabase, districtId, cfg.required)
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

/** Opens a fresh mission for this district and auto-joins the opener as its
 *  first participant. Several can be open for the same district at once —
 *  this doesn't check for or block on existing ones. */
export async function openReconnectMission(supabase: SupabaseDB, content: GameContent, params: any) {
  const districtId = String(params.districtId || '')
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const cfg = await districtCfg(supabase, districtId)
  if (!cfg) return { success: false, error: 'not_available' }
  if (!(await hasRestored(supabase, agentNo, districtId))) return { success: false, error: 'not_eligible' }
  if (await myMission(supabase, agentNo, districtId)) return { success: false, error: 'already_in_mission' }

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

/** Open-matchmaking join — finds a mission for this district with a free
 *  slot and fills it, no invite needed. */
export async function joinReconnectMission(supabase: SupabaseDB, content: GameContent, params: any) {
  const districtId = String(params.districtId || '')
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const cfg = await districtCfg(supabase, districtId)
  if (!cfg) return { success: false, error: 'not_available' }
  if (!(await hasRestored(supabase, agentNo, districtId))) return { success: false, error: 'not_eligible' }
  if (await myMission(supabase, agentNo, districtId)) return { success: false, error: 'already_in_mission' }

  let mission = await joinableMission(supabase, districtId, cfg.required)
  if (!mission) return { success: false, error: 'no_open_mission' }
  mission = await refreshMission(supabase, content, mission)
  if (mission.status !== 'open') return { success: false, error: 'mission_' + mission.status }

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

  let mission = await myMission(supabase, agentNo, districtId)
  if (!mission) return { success: false, error: 'not_in_mission' }
  mission = await refreshMission(supabase, content, mission)
  if (mission.status !== 'open') return { success: false, error: 'mission_' + mission.status }
  if (await myMission(supabase, inviteeAgentNo, districtId)) return { success: false, error: 'already_in_mission' }

  const { data: participants } = await supabase.from('rc_reconnect_participants').select('*').eq('mission_id', mission.id)
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

  let mission = await myMission(supabase, agentNo, districtId)
  if (!mission) return { success: false, error: 'no_pending_invite' }
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

/* ── Admin ────────────────────────────────────────────────────────────── */

/** Every district, with its reconnect config if it has one — the panel's
 *  district picker doubles as "which ones are enabled". */
export async function adminListReconnectDistricts(supabase: SupabaseDB) {
  const { data, error } = await supabase.from('rc_districts')
    .select('id, name, ward_id, reconnect_required, reconnect_track_label, reconnect_track_artist, reconnect_track_aliases')
    .eq('active', true).order('ward_id').order('sequence')
  if (error) return { success: false, error: error.message }
  return {
    success: true,
    districts: (data || []).map((d: any) => ({
      id: d.id, name: d.name, wardId: d.ward_id,
      reconnect: d.reconnect_required ? {
        required: d.reconnect_required, trackLabel: d.reconnect_track_label,
        trackArtist: d.reconnect_track_artist, trackAliases: d.reconnect_track_aliases || [],
      } : null,
    })),
  }
}

/** Admin: set/update a district's reconnect config (required agent count +
 *  target track). Doesn't touch any mission already in flight. */
export async function adminSetReconnectConfig(supabase: SupabaseDB, params: any) {
  const districtId = String(params.districtId || '')
  const required = parseInt(params.required)
  const trackLabel = String(params.trackLabel || '').trim()
  if (!districtId) return { success: false, error: 'district_required' }
  if (!Number.isFinite(required) || required < 2) return { success: false, error: 'required_agents_at_least_2' }
  if (!trackLabel) return { success: false, error: 'track_required' }

  const { error } = await supabase.from('rc_districts').update({
    reconnect_required: required,
    reconnect_track_label: trackLabel,
    reconnect_track_artist: params.trackArtist ? String(params.trackArtist).trim() : null,
    reconnect_track_aliases: Array.isArray(params.trackAliases)
      ? params.trackAliases.map((a: any) => String(a).trim()).filter(Boolean) : [],
  }).eq('id', districtId)
  if (error) return { success: false, error: error.message }
  return { success: true }
}

/** Admin: disable Reconnect Missions for a district going forward. Missions
 *  already open keep running to their own resolution — this only stops new
 *  ones (open/join/admin-assign all check districtCfg first). */
export async function adminClearReconnectConfig(supabase: SupabaseDB, params: any) {
  const districtId = String(params.districtId || '')
  if (!districtId) return { success: false, error: 'district_required' }
  const { error } = await supabase.from('rc_districts')
    .update({ reconnect_required: null }).eq('id', districtId)
  if (error) return { success: false, error: error.message }
  return { success: true }
}

/** Fisher-Yates — every ordering equally likely, which is the entire point
 *  of "randomly assign" (a biased shuffle would quietly always favor
 *  whoever's agent_no sorts first). */
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Admin: launch a whole series of missions for one district at once — every
 * agent who's personally restored it and isn't already in a live mission
 * there gets shuffled and split into full groups of the configured size.
 * Each group becomes its own mission, everyone in it already 'joined' (no
 * matchmaking/invite step — the admin already did the assigning). Leftover
 * agents who don't make a full group sit out this round; they're still
 * free to open/join one themselves, or catch the next batch-assign.
 */
export async function adminAutoAssignMissions(supabase: SupabaseDB, params: any) {
  const districtId = String(params.districtId || '')
  if (!districtId) return { success: false, error: 'district_required' }
  const cfg = await districtCfg(supabase, districtId)
  if (!cfg) return { success: false, error: 'not_available' }

  const { data: restoredRows } = await supabase.from('rc_player_districts')
    .select('agent_no').eq('district_id', districtId).eq('status', 'restored')
  const restored = new Set((restoredRows || []).map((r: any) => r.agent_no))

  // Plain two-step lookup, not an embedded-resource filter — see myMission's
  // comment above for why that silently returns the wrong rows.
  const { data: openMissions } = await supabase.from('rc_reconnect_missions')
    .select('id').eq('district_id', districtId).eq('status', 'open')
  const openMissionIds = (openMissions || []).map((m: any) => m.id)
  const alreadyIn = new Set<string>()
  if (openMissionIds.length) {
    const { data: liveRows } = await supabase.from('rc_reconnect_participants')
      .select('agent_no').in('mission_id', openMissionIds)
    for (const r of liveRows || []) alreadyIn.add(r.agent_no)
  }

  const available = shuffle([...restored].filter((a) => !alreadyIn.has(a)))
  const groups: string[][] = []
  for (let i = 0; i + cfg.required <= available.length; i += cfg.required) {
    groups.push(available.slice(i, i + cfg.required))
  }
  const leftover = available.length - groups.length * cfg.required

  const created: string[] = []
  for (const group of groups) {
    const { data: mission, error } = await supabase.from('rc_reconnect_missions').insert({
      district_id: districtId, required_agents: cfg.required,
      track_label: cfg.trackLabel, track_artist: cfg.trackArtist, track_aliases: cfg.trackAliases,
      created_by: '__admin__',
    }).select().single()
    if (error || !mission) continue
    await supabase.from('rc_reconnect_participants').insert(
      group.map((agentNo) => ({ mission_id: mission.id, agent_no: agentNo, status: 'joined' })))
    created.push(mission.id)
  }

  return { success: true, missionsCreated: created.length, agentsAssigned: groups.length * cfg.required, agentsLeftOver: leftover }
}
