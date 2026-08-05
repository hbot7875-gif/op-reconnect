// Co-op variants of the `reconnect` goal kind — 'connect' (open matchmaking;
// each participant must contribute to their OWN frozen track/album goals
// while paired — "any goal", not one fixed shared track) and 'invite'
// (direct ask to a specific agent who's also actively restoring this
// district; satisfied on acceptance alone, no streaming required).
//
// Folded in from the old post-restoration "Reconnect Mission" bonus stage —
// same underlying rc_reconnect_missions/rc_reconnect_participants tables,
// but this now GATES restoration instead of following it. Config always
// comes from the CALLER's own frozen `rc_player_districts.goals.reconnect`
// (set once at activation by districts.ts's freezeGoals(), never a live
// rc_goals re-read) — a district can host several reconnect goals with
// different configs at once, so every mission is scoped by goal_id, not
// just district_id: agents only ever match within the same frozen goal
// instance. See migration 037_rc_reconnect_goal_kind.sql.
//
// Reward is NOT awarded here — completion just flips mission status to
// 'complete'; handlers.ts's buildState() awards XP/Fuel once, when the
// WHOLE district (solo goals + reconnect) completes, avoiding a double
// payout from two separate reward pipelines.

import type { SupabaseDB } from './config.ts'
import type { FrozenReconnectGoal } from './districts.ts'

/** The caller's own active restoration attempt on this district (and
 *  whatever reconnect goal was frozen into it, if any) — the only source of
 *  truth for "what mission am I even trying to do." */
async function myActivePd(supabase: SupabaseDB, agentNo: string, districtId: string) {
  const { data } = await supabase.from('rc_player_districts')
    .select('status, goals').eq('agent_no', agentNo).eq('district_id', districtId).maybeSingle()
  return data || null
}

function myReconnectGoal(pd: any): FrozenReconnectGoal | null {
  const r = pd?.goals?.reconnect
  return r && (r.variant === 'connect' || r.variant === 'invite') ? r : null
}

/** One open mission this agent participates in, optionally narrowed to a
 *  specific goal_id and/or participant status. Scoped by goal_id when
 *  looking up "my own" mission (an agent's frozen goal_id is singular per
 *  district); left district-wide when checking an INVITEE, since they may
 *  have a different reconnect goal (or none) of their own. */
async function findMyMission(
  supabase: SupabaseDB, agentNo: string, districtId: string,
  opts: { goalId?: string; status?: 'invited' | 'joined' } = {},
) {
  let mq = supabase.from('rc_reconnect_missions').select('id').eq('district_id', districtId).eq('status', 'open')
  if (opts.goalId) mq = mq.eq('goal_id', opts.goalId)
  const { data: openMissions } = await mq
  const missionIds = (openMissions || []).map((m: any) => m.id)
  if (!missionIds.length) return null

  let pq = supabase.from('rc_reconnect_participants').select('mission_id').eq('agent_no', agentNo).in('mission_id', missionIds)
  if (opts.status) pq = pq.eq('status', opts.status)
  const { data: rows } = await pq.order('joined_at', { ascending: false }).limit(1)
  const row: any = (rows || [])[0]
  if (!row) return null

  const { data: mission } = await supabase.from('rc_reconnect_missions').select('*').eq('id', row.mission_id).maybeSingle()
  return mission
}

/** An open mission for this exact goal with a free slot — 'connect' only
 *  (invite has no open matchmaking pool). Oldest first: fill the mission
 *  that's been waiting longest before starting a new one. */
async function joinableMission(supabase: SupabaseDB, districtId: string, goalId: string, requiredAgents: number) {
  const { data: missions } = await supabase.from('rc_reconnect_missions')
    .select('*').eq('district_id', districtId).eq('goal_id', goalId).eq('status', 'open')
    .order('created_at', { ascending: true })
  for (const m of missions || []) {
    const { count } = await supabase.from('rc_reconnect_participants')
      .select('agent_no', { count: 'exact', head: true }).eq('mission_id', m.id).eq('status', 'joined')
    if ((count || 0) < (m.required_agents ?? requiredAgents)) return m
  }
  return null
}

/** Every key from a participant's OWN frozen track/album goals — this is
 *  what "connect" checks against, not one fixed shared track. */
function ownGoalKeys(pd: any): string[] {
  const g = pd?.goals || {}
  const keys: string[] = []
  for (const t of g.trackGoals || []) keys.push(...(t.keys || []))
  for (const a of g.albumGoals || []) for (const t of a.tracks || []) keys.push(...(t.keys || []))
  return keys
}

async function hasStreamedAny(supabase: SupabaseDB, agentNo: string, sinceIso: string, keys: string[]): Promise<boolean> {
  if (!keys.length) return false
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
    goalId: m.goal_id,
    requiredAgents: m.required_agents,
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

/** Re-derives a mission's real state from source data: expire it if time's
 *  up, and for 'connect' check each joined participant's own frozen
 *  track/album goal keys against rc_daily_activity since they joined.
 *  'invite' has no streaming check — acceptance alone qualifies. Settles
 *  (marks 'complete') the moment everyone required has qualified; does NOT
 *  award anything itself (see module comment). */
async function refreshMission(supabase: SupabaseDB, mission: any, variant: 'connect' | 'invite') {
  if (mission.status !== 'open') return mission

  if (new Date(mission.expires_at).getTime() <= Date.now()) {
    await supabase.from('rc_reconnect_missions').update({ status: 'expired' }).eq('id', mission.id).eq('status', 'open')
    mission.status = 'expired'
    return mission
  }

  const { data: participants } = await supabase.from('rc_reconnect_participants')
    .select('*').eq('mission_id', mission.id)
  const joined = (participants || []).filter((p: any) => p.status === 'joined')

  if (variant === 'connect') {
    for (const p of joined) {
      if (p.streamed_at) continue
      const pd = await myActivePd(supabase, p.agent_no, mission.district_id)
      if (!pd || pd.status !== 'active') continue // dropped the district — not counted until back
      const keys = ownGoalKeys(pd)
      if (await hasStreamedAny(supabase, p.agent_no, p.joined_at, keys)) {
        await supabase.from('rc_reconnect_participants')
          .update({ streamed_at: new Date().toISOString() })
          .eq('mission_id', mission.id).eq('agent_no', p.agent_no)
        p.streamed_at = new Date().toISOString()
      }
    }
  }

  const qualified = variant === 'invite'
    ? joined.length >= mission.required_agents
    : joined.length >= mission.required_agents && joined.every((p: any) => p.streamed_at)

  if (qualified) {
    const { error } = await supabase.from('rc_reconnect_missions')
      .update({ status: 'complete', completed_at: new Date().toISOString() })
      .eq('id', mission.id).eq('status', 'open')
    if (!error) mission.status = 'complete'
  }
  return mission
}

/** Called by reconnect-goal.ts's resolveReconnectStatus on every state poll
 *  — the caller's own frozen reconnect goal is already known (never
 *  re-derived live), so this just resolves live mission state against it. */
export async function getMissionStatus(supabase: SupabaseDB, agentNo: string, districtId: string, frozenReconnect: FrozenReconnectGoal) {
  const variant = frozenReconnect.variant as 'connect' | 'invite'
  let mission = await findMyMission(supabase, agentNo, districtId, { goalId: frozenReconnect.id })
  if (mission) mission = await refreshMission(supabase, mission, variant)
  const participants = mission
    ? (await supabase.from('rc_reconnect_participants').select('*').eq('mission_id', mission.id)).data || []
    : []
  return { variant, done: mission?.status === 'complete', mission: mission ? shape(mission, participants) : null }
}

/** Read-only, richer than getMissionStatus: for the interactive player
 *  panel — includes a joinable-mission preview when the agent hasn't
 *  opened/joined one yet. */
export async function getReconnectMission(supabase: SupabaseDB, content: unknown, params: any) {
  const districtId = String(params.districtId || '')
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  if (!districtId) return { success: false, error: 'district_required' }

  const pd = await myActivePd(supabase, agentNo, districtId)
  if (pd?.status !== 'active') return { success: true, available: false }
  const reconnect = myReconnectGoal(pd)
  if (!reconnect) return { success: true, available: false }

  let mission = await findMyMission(supabase, agentNo, districtId, { goalId: reconnect.id })
  if (!mission && reconnect.variant === 'connect') {
    mission = await joinableMission(supabase, districtId, reconnect.id, reconnect.config.requiredAgents)
  }
  if (mission) mission = await refreshMission(supabase, mission, reconnect.variant)

  const { data: participants } = mission
    ? await supabase.from('rc_reconnect_participants').select('*').eq('mission_id', mission.id)
    : { data: [] }

  return {
    success: true, available: true, variant: reconnect.variant,
    config: { requiredAgents: reconnect.config.requiredAgents },
    mission: mission ? shape(mission, participants || []) : null,
  }
}

/** Opens a fresh mission for the caller's own frozen reconnect goal and
 *  auto-joins them as its first participant. */
export async function openReconnectMission(supabase: SupabaseDB, content: unknown, params: any) {
  const districtId = String(params.districtId || '')
  const agentNo = String(params.agentNo || '').trim().toUpperCase()

  const pd = await myActivePd(supabase, agentNo, districtId)
  if (pd?.status !== 'active') return { success: false, error: 'not_eligible' }
  const reconnect = myReconnectGoal(pd)
  if (!reconnect) return { success: false, error: 'not_available' }
  if (await findMyMission(supabase, agentNo, districtId)) return { success: false, error: 'already_in_mission' }

  const { data: mission, error } = await supabase.from('rc_reconnect_missions').insert({
    district_id: districtId, goal_id: reconnect.id, required_agents: reconnect.config.requiredAgents,
    // Vestigial NOT NULL columns from the old shared-track design — no
    // longer read anywhere; kept populated only to satisfy the constraint.
    track_label: `reconnect:${reconnect.variant}`, track_artist: null, track_aliases: [],
    created_by: agentNo,
  }).select().single()
  if (error) return { success: false, error: error.message }

  await supabase.from('rc_reconnect_participants').insert({ mission_id: mission.id, agent_no: agentNo, status: 'joined' })
  const { data: participants } = await supabase.from('rc_reconnect_participants').select('*').eq('mission_id', mission.id)
  return { success: true, mission: shape(mission, participants || []) }
}

/** Open-matchmaking join — 'connect' variant only; 'invite' has no open
 *  pool to join, only direct invites. */
export async function joinReconnectMission(supabase: SupabaseDB, content: unknown, params: any) {
  const districtId = String(params.districtId || '')
  const agentNo = String(params.agentNo || '').trim().toUpperCase()

  const pd = await myActivePd(supabase, agentNo, districtId)
  if (pd?.status !== 'active') return { success: false, error: 'not_eligible' }
  const reconnect = myReconnectGoal(pd)
  if (!reconnect || reconnect.variant !== 'connect') return { success: false, error: 'not_available' }
  if (await findMyMission(supabase, agentNo, districtId)) return { success: false, error: 'already_in_mission' }

  let mission = await joinableMission(supabase, districtId, reconnect.id, reconnect.config.requiredAgents)
  if (!mission) return { success: false, error: 'no_open_mission' }
  mission = await refreshMission(supabase, mission, reconnect.variant)
  if (mission.status !== 'open') return { success: false, error: 'mission_' + mission.status }

  const { error } = await supabase.from('rc_reconnect_participants')
    .insert({ mission_id: mission.id, agent_no: agentNo, status: 'joined' })
  if (error) return { success: false, error: error.message }

  const fresh = await refreshMission(supabase, mission, reconnect.variant)
  const { data: freshParticipants } = await supabase.from('rc_reconnect_participants').select('*').eq('mission_id', mission.id)
  return { success: true, mission: shape(fresh, freshParticipants || []) }
}

/** An agent already in their own open mission invites someone else who is
 *  also actively restoring this district (any reconnect variant, or none —
 *  confirmed with the user this is "recruit a real co-restorer," not an
 *  open invite to anyone registered). Sits as 'invited' until accepted. */
export async function inviteReconnectMission(supabase: SupabaseDB, content: unknown, params: any) {
  const districtId = String(params.districtId || '')
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const inviteeAgentNo = String(params.inviteeAgentNo || '').trim().toUpperCase()
  if (!inviteeAgentNo) return { success: false, error: 'invitee_required' }
  if (inviteeAgentNo === agentNo) return { success: false, error: 'cannot_invite_self' }

  const pd = await myActivePd(supabase, agentNo, districtId)
  if (pd?.status !== 'active') return { success: false, error: 'not_eligible' }
  const reconnect = myReconnectGoal(pd)
  if (!reconnect) return { success: false, error: 'not_available' }

  let mission = await findMyMission(supabase, agentNo, districtId, { goalId: reconnect.id })
  if (!mission) return { success: false, error: 'not_in_mission' }
  mission = await refreshMission(supabase, mission, reconnect.variant)
  if (mission.status !== 'open') return { success: false, error: 'mission_' + mission.status }
  if (await findMyMission(supabase, inviteeAgentNo, districtId)) return { success: false, error: 'already_in_mission' }

  const { data: participants } = await supabase.from('rc_reconnect_participants').select('*').eq('mission_id', mission.id)
  const joinedCount = (participants || []).filter((p: any) => p.status === 'joined').length
  if (joinedCount >= mission.required_agents) return { success: false, error: 'mission_full' }

  const inviteePd = await myActivePd(supabase, inviteeAgentNo, districtId)
  if (inviteePd?.status !== 'active') return { success: false, error: 'invitee_not_eligible' }

  const { error } = await supabase.from('rc_reconnect_participants')
    .insert({ mission_id: mission.id, agent_no: inviteeAgentNo, status: 'invited', invited_by: agentNo })
  if (error) return { success: false, error: error.message }
  return { success: true }
}

/** The invited agent accepts (joins a real slot) or declines (row removed
 *  outright). Resolved district-wide, not goal-scoped — the invitee may
 *  have a different reconnect goal of their own (or none). */
export async function respondReconnectInvite(supabase: SupabaseDB, content: unknown, params: any) {
  const districtId = String(params.districtId || '')
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const accept = !!params.accept

  let mission = await findMyMission(supabase, agentNo, districtId, { status: 'invited' })
  if (!mission) return { success: false, error: 'no_pending_invite' }

  const { data: goal } = await supabase.from('rc_goals').select('variant').eq('id', mission.goal_id).maybeSingle()
  const variant = goal?.variant === 'connect' || goal?.variant === 'invite' ? goal.variant : null
  if (!variant) return { success: false, error: 'no_pending_invite' }
  mission = await refreshMission(supabase, mission, variant)
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
  await refreshMission(supabase, mission, variant)
  return { success: true, joined: true }
}

/* ── Admin ────────────────────────────────────────────────────────────── */

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
 * Admin: launch a whole series of missions for one reconnect goal at once —
 * every agent actively restoring the district WITH THIS EXACT GOAL frozen
 * in, who isn't already in a live mission there, gets shuffled and split
 * into full groups of the configured size. Each group becomes its own
 * mission, everyone in it already 'joined' (no matchmaking/invite step —
 * the admin already did the assigning). Leftover agents who don't make a
 * full group sit out this round; they're still free to open/join one
 * themselves, or catch the next batch-assign.
 */
export async function adminAutoAssignMissions(supabase: SupabaseDB, params: any) {
  const goalId = String(params.goalId || '')
  if (!goalId) return { success: false, error: 'goal_required' }

  const { data: goal } = await supabase.from('rc_goals').select('*').eq('id', goalId).maybeSingle()
  if (!goal || goal.kind !== 'reconnect' || (goal.variant !== 'connect' && goal.variant !== 'invite')) {
    return { success: false, error: 'not_available' }
  }
  const requiredAgents = goal.config?.requiredAgents
  if (!Number.isFinite(requiredAgents) || requiredAgents < 2) return { success: false, error: 'not_available' }
  const districtId = goal.district_id as string

  const { data: activeRows } = await supabase.from('rc_player_districts')
    .select('agent_no, goals').eq('district_id', districtId).eq('status', 'active')
  const eligible = (activeRows || [])
    .filter((r: any) => r.goals?.reconnect?.id === goalId)
    .map((r: any) => r.agent_no as string)

  const { data: openMissions } = await supabase.from('rc_reconnect_missions')
    .select('id').eq('goal_id', goalId).eq('status', 'open')
  const openMissionIds = (openMissions || []).map((m: any) => m.id)
  const alreadyIn = new Set<string>()
  if (openMissionIds.length) {
    const { data: liveRows } = await supabase.from('rc_reconnect_participants')
      .select('agent_no').in('mission_id', openMissionIds)
    for (const r of liveRows || []) alreadyIn.add(r.agent_no)
  }

  const available = shuffle(eligible.filter((a) => !alreadyIn.has(a)))
  const groups: string[][] = []
  for (let i = 0; i + requiredAgents <= available.length; i += requiredAgents) {
    groups.push(available.slice(i, i + requiredAgents))
  }
  const leftover = available.length - groups.length * requiredAgents

  const created: string[] = []
  for (const group of groups) {
    const { data: mission, error } = await supabase.from('rc_reconnect_missions').insert({
      district_id: districtId, goal_id: goalId, required_agents: requiredAgents,
      track_label: `reconnect:${goal.variant}`, track_artist: null, track_aliases: [],
      created_by: '__admin__',
    }).select().single()
    if (error || !mission) continue
    await supabase.from('rc_reconnect_participants').insert(
      group.map((agentNo) => ({ mission_id: mission.id, agent_no: agentNo, status: 'joined' })))
    created.push(mission.id)
  }

  return { success: true, missionsCreated: created.length, agentsAssigned: groups.length * requiredAgents, agentsLeftOver: leftover }
}
