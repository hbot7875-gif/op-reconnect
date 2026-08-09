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

import type { SupabaseDB, GameContent } from './config.ts'
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

/** Real play count of a specific track's keys, from the day this participant
 *  joined onward — day-granularity, same as hasStreamedAny above, since
 *  rc_daily_activity only ever buckets by day. Uncapped, matching how every
 *  other personal count works now (see config.ts's PERSONAL_COUNT_CAP). */
async function contributionSince(supabase: SupabaseDB, agentNo: string, sinceIso: string, keys: string[]): Promise<number> {
  if (!keys.length) return 0
  const sinceDate = sinceIso.slice(0, 10)
  const { data } = await supabase.from('rc_daily_activity')
    .select('track_counts').eq('agent_no', agentNo).gte('kst_date', sinceDate)
  let total = 0
  for (const row of data || []) {
    const bucket = row.track_counts || {}
    for (const k of keys) total += bucket[k]?.n || 0
  }
  return total
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
    // Only present when the frozen goal carries a sharedTrack — see
    // refreshMission. Pooled progress toward one specific track, everyone's
    // own plays (since they personally joined) counted together.
    sharedTrack: m.sharedTrackProgress || null,
    participants: participants.map((p) => ({
      agentNo: p.agent_no, status: p.status, invitedBy: p.invited_by,
      joinedAt: p.joined_at, streamed: !!p.streamed_at,
    })),
  }
}

/** Re-derives a mission's real state from source data: expire it if time's
 *  up, and for 'connect' check every joined participant's contribution
 *  since it's their own frozen goal config (config.sharedTrack, when set)
 *  that decides what "qualified" means:
 *   - sharedTrack set: pooled mode — every joined participant's own plays
 *     of that one track, counted from when THEY joined, add together;
 *     qualifies once the pool hits sharedTrack.target. One person could
 *     carry it alone, or it could be split any way — "combined," not "each."
 *   - sharedTrack unset: the original per-person rule — each joined
 *     participant just needs ANY stream of their own frozen track/album
 *     goals since joining.
 *  'invite' has no streaming check either way — acceptance alone qualifies.
 *  Settles (marks 'complete') the moment the required condition is met;
 *  does NOT award anything itself (see module comment). */
async function refreshMission(
  supabase: SupabaseDB, mission: any, variant: 'connect' | 'invite',
  config?: { requiredAgents?: number; sharedTrack?: { label: string; keys: string[]; target: number } | null },
) {
  if (mission.status !== 'open') return mission

  if (new Date(mission.expires_at).getTime() <= Date.now()) {
    await supabase.from('rc_reconnect_missions').update({ status: 'expired' }).eq('id', mission.id).eq('status', 'open')
    mission.status = 'expired'
    return mission
  }

  const { data: participants } = await supabase.from('rc_reconnect_participants')
    .select('*').eq('mission_id', mission.id)
  const joined = (participants || []).filter((p: any) => p.status === 'joined')

  const sharedTrack = config?.sharedTrack
  let sharedTotal = 0
  if (variant === 'connect' && sharedTrack?.keys?.length && sharedTrack.target > 0) {
    for (const p of joined) {
      const contributed = await contributionSince(supabase, p.agent_no, p.joined_at, sharedTrack.keys)
      sharedTotal += contributed
      if (contributed > 0 && !p.streamed_at) {
        await supabase.from('rc_reconnect_participants')
          .update({ streamed_at: new Date().toISOString() })
          .eq('mission_id', mission.id).eq('agent_no', p.agent_no)
        p.streamed_at = new Date().toISOString()
      }
    }
    mission.sharedTrackProgress = { label: sharedTrack.label, target: sharedTrack.target, progress: Math.min(sharedTotal, sharedTrack.target) }
  } else if (variant === 'connect') {
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
    : sharedTrack?.keys?.length
      ? joined.length >= mission.required_agents && sharedTotal >= sharedTrack.target
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
  if (mission) mission = await refreshMission(supabase, mission, variant, frozenReconnect.config)
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
  if (mission) mission = await refreshMission(supabase, mission, reconnect.variant, reconnect.config)

  const { data: participants } = mission
    ? await supabase.from('rc_reconnect_participants').select('*').eq('mission_id', mission.id)
    : { data: [] }

  return {
    success: true, available: true, variant: reconnect.variant,
    config: { requiredAgents: reconnect.config.requiredAgents, sharedTrack: reconnect.config.sharedTrack || null },
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
  // Refresh once even though nothing can have qualified yet — for
  // sharedTrack missions this is what puts the 0/target shape on the very
  // first response, instead of the caller having to poll again to see it.
  const fresh = await refreshMission(supabase, mission, reconnect.variant, reconnect.config)
  const { data: participants } = await supabase.from('rc_reconnect_participants').select('*').eq('mission_id', mission.id)
  return { success: true, mission: shape(fresh, participants || []) }
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
  mission = await refreshMission(supabase, mission, reconnect.variant, reconnect.config)
  if (mission.status !== 'open') return { success: false, error: 'mission_' + mission.status }

  // rc_reconnect_join_open (migrations/…_rc_fix_activation_and_mission_races.sql)
  // re-checks capacity and inserts as one row-locked unit — the
  // joinableMission/refreshMission checks above are just a cheap
  // pre-filter. Two agents racing this mission's last open slot used to
  // both pass the old (separate count-then-insert) check here.
  const { data: rpcData, error: rpcError } = await supabase.rpc('rc_reconnect_join_open', {
    p_mission_id: mission.id, p_agent_no: agentNo,
  })
  const result = !rpcError && Array.isArray(rpcData) ? rpcData[0] : null
  if (rpcError || !result?.joined) return { success: false, error: result?.error || rpcError?.message || 'join_failed' }

  const fresh = await refreshMission(supabase, mission, reconnect.variant, reconnect.config)
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
  mission = await refreshMission(supabase, mission, reconnect.variant, reconnect.config)
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

  const { data: goal } = await supabase.from('rc_goals').select('variant, config').eq('id', mission.goal_id).maybeSingle()
  const variant = goal?.variant === 'connect' || goal?.variant === 'invite' ? goal.variant : null
  if (!variant) return { success: false, error: 'no_pending_invite' }
  mission = await refreshMission(supabase, mission, variant, goal?.config)
  if (mission.status !== 'open') return { success: false, error: 'mission_' + mission.status }

  const { data: invite } = await supabase.from('rc_reconnect_participants')
    .select('*').eq('mission_id', mission.id).eq('agent_no', agentNo).eq('status', 'invited').maybeSingle()
  if (!invite) return { success: false, error: 'no_pending_invite' }

  if (!accept) {
    await supabase.from('rc_reconnect_participants').delete().eq('mission_id', mission.id).eq('agent_no', agentNo)
    return { success: true, joined: false }
  }

  // rc_reconnect_accept_invite re-checks the invite and capacity, and
  // flips the status, all as one row-locked unit — the old separate
  // count-then-update here let two invitees accepting a mission's last
  // slot within milliseconds of each other both land as 'joined'.
  const { data: rpcData, error: rpcError } = await supabase.rpc('rc_reconnect_accept_invite', {
    p_mission_id: mission.id, p_agent_no: agentNo,
  })
  const result = !rpcError && Array.isArray(rpcData) ? rpcData[0] : null
  if (rpcError || !result?.joined) return { success: false, error: result?.error || rpcError?.message || 'join_failed' }
  await refreshMission(supabase, mission, variant, goal?.config)
  return { success: true, joined: true }
}

/** Every pending invite this agent hasn't answered yet — the notification
 *  bell's whole data source. Two plain queries + a JS merge rather than an
 *  embedded relational select, matching how the rest of this codebase joins
 *  (see communityStreams/awardStreakBadges) rather than depending on a
 *  guessed FK-constraint name. invited_by resolves to a codename, never the
 *  raw agent number — same "agent numbers never leave the caller's own
 *  request" rule handlers.ts documents at the top of this file's sibling. */
export async function getMyInvites(supabase: SupabaseDB, content: GameContent, agentNo: string) {
  const { data: rows } = await supabase.from('rc_reconnect_participants')
    .select('mission_id, invited_by').eq('agent_no', agentNo).eq('status', 'invited')
  if (!rows || !rows.length) return { success: true, invites: [] }

  const missionIds = [...new Set(rows.map((r: any) => r.mission_id))]
  const { data: missions } = await supabase.from('rc_reconnect_missions')
    .select('id, district_id').in('id', missionIds)
  const districtByMission = new Map((missions || []).map((m: any) => [m.id, m.district_id]))

  const inviterNos = [...new Set(rows.map((r: any) => r.invited_by))]
  const { data: inviters } = await supabase.from('rc_players')
    .select('agent_no, codename').in('agent_no', inviterNos)
  const codenameByAgent = new Map((inviters || []).map((p: any) => [p.agent_no, p.codename]))

  const invites = rows
    .map((r: any) => {
      const districtId = districtByMission.get(r.mission_id) || ''
      const district = content.districts.find((d) => d.id === districtId)
      return {
        districtId,
        districtName: district?.name || districtId,
        fromCodename: codenameByAgent.get(r.invited_by) || 'an agent',
      }
    })
    .filter((i: any) => i.districtId)

  return { success: true, invites }
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
