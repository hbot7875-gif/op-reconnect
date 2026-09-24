// Everything the Helping Zone shows, in one round trip.
//
// The audit that built the helper's join flow left the helper blind twice
// over. First, listOpenBackupRequests never returned the goal's name — the
// list said "a track goal", so an agent chose who to help without knowing
// what to play. Second, once joined there was no surface at all: the toast
// faded and the pairing became invisible, while the owner (and only the
// owner) watched the numbers move. This is the read side that fixes both.
//
// Deliberately its own file rather than more of backup-pass.ts: that file is
// the write path (open/join/leave and the atomic refresh), already at the
// project's ~300-line limit, and a read has no business growing it.

import type { GameContent, SupabaseDB } from './config.ts'
import { contributionSince } from './reconnect-missions.ts'
import { findFrozenGoal, goalTrackNames, myActivePd, ownerRawProgress } from './backup-pass.ts'

/** Codenames for a set of agent numbers, in one query. */
async function codenames(supabase: SupabaseDB, agentNos: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(agentNos.filter(Boolean))]
  if (!unique.length) return new Map()
  const { data } = await supabase.from('rc_players').select('agent_no, codename').in('agent_no', unique)
  return new Map((data || []).map((p: any) => [p.agent_no, p.codename]))
}

/** District display names for a set of ids, in one query. */
async function districtNames(supabase: SupabaseDB, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return new Map()
  const { data } = await supabase.from('rc_districts').select('id, name').in('id', unique)
  return new Map((data || []).map((d: any) => [d.id, d.name]))
}

/**
 * One call behind the whole Zone: the pass you opened, the pass you are
 * answering, and everyone still waiting. Read-only — every state transition
 * still happens through backup-pass.ts's atomic write paths, and a request
 * that has silently expired is resolved by those, not here.
 */
export async function getHelpingZone(supabase: SupabaseDB, content: GameContent, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()

  const [{ count: passCount }, { data: ownerRow }, { data: helperRow }, { data: openRows }] = await Promise.all([
    supabase.from('rc_player_items').select('id', { count: 'exact', head: true })
      .eq('agent_no', agentNo).eq('item_id', 'backup-pass').is('used_at', null),
    supabase.from('rc_backup_requests').select('*')
      .eq('owner_agent_no', agentNo).in('status', ['open', 'joined']).maybeSingle(),
    supabase.from('rc_backup_requests').select('*')
      .eq('helper_agent_no', agentNo).eq('status', 'joined').maybeSingle(),
    supabase.from('rc_backup_requests')
      .select('id, owner_agent_no, district_id, goal_kind, goal_ref, original_target, boosted_target, expires_at, opened_at')
      .eq('status', 'open').neq('owner_agent_no', agentNo).order('opened_at', { ascending: true }).limit(30),
  ])

  const live = (openRows || []).filter((r: any) => new Date(r.expires_at).getTime() > Date.now())
  const names = await codenames(supabase, [
    ...live.map((r: any) => r.owner_agent_no),
    ownerRow?.helper_agent_no, helperRow?.owner_agent_no,
  ].filter(Boolean) as string[])
  const places = await districtNames(supabase, [
    ...live.map((r: any) => r.district_id), ownerRow?.district_id, helperRow?.district_id,
  ].filter(Boolean) as string[])

  // Each owner's frozen goal snapshot, so every request can be named. One
  // query for the whole list: an agent has at most one active district, so
  // matching on agent_no alone is enough to find the right row.
  const ownerNos = [...new Set(live.map((r: any) => r.owner_agent_no))]
  const { data: pds } = ownerNos.length
    ? await supabase.from('rc_player_districts').select('agent_no, district_id, goals, activated_at')
        .in('agent_no', ownerNos).eq('status', 'active')
    : { data: [] }
  const pdByOwner = new Map((pds || []).map((pd: any) => [pd.agent_no, pd]))

  const openRequests = live.map((r: any) => {
    const pd = pdByOwner.get(r.owner_agent_no)
    const matched = pd && pd.district_id === r.district_id
    const goal = matched ? findFrozenGoal(pd, r.goal_kind, r.goal_ref) : null
    return {
      id: r.id,
      ownerCodename: names.get(r.owner_agent_no) || 'an agent',
      districtId: r.district_id,
      districtName: places.get(r.district_id) || null,
      goalKind: r.goal_kind,
      goalRef: r.goal_ref,
      // The two fields the old list was missing. Without them an agent was
      // choosing who to help without being told what to play.
      goalLabel: goal?.label || null,
      tracks: matched ? goalTrackNames(pd, r.goal_kind, r.goal_ref) : [],
      originalTarget: r.original_target,
      boostedTarget: r.boosted_target,
      expiresAt: r.expires_at,
    }
  })

  return {
    success: true,
    backupPasses: passCount || 0,
    asOwner: ownerRow ? await ownerView(supabase, ownerRow, names, places) : null,
    asHelper: helperRow ? await helperView(supabase, agentNo, helperRow, names, places) : null,
    openRequests,
  }
}

/** Your own pass: waiting for someone, or being helped right now. */
async function ownerView(supabase: SupabaseDB, r: any, names: Map<string, string>, places: Map<string, string>) {
  const pd = await myActivePd(supabase, r.owner_agent_no, r.district_id)
  const goal = pd ? findFrozenGoal(pd, r.goal_kind, r.goal_ref) : null
  const ownProgress = goal && pd ? await ownerRawProgress(supabase, r.owner_agent_no, pd.activated_at, goal.keys) : 0
  const helperContribution = r.status === 'joined' && goal && r.joined_at
    ? await contributionSince(supabase, r.helper_agent_no, r.joined_at, goal.keys)
    : 0
  return {
    requestId: r.id, status: r.status,
    districtId: r.district_id, districtName: places.get(r.district_id) || null,
    goalKind: r.goal_kind, goalLabel: goal?.label || null,
    tracks: pd ? goalTrackNames(pd, r.goal_kind, r.goal_ref) : [],
    helperCodename: r.helper_agent_no ? names.get(r.helper_agent_no) || 'an agent' : null,
    ownProgress, helperContribution,
    originalTarget: r.original_target, boostedTarget: r.boosted_target,
    joinedAt: r.joined_at, expiresAt: r.expires_at,
  }
}

/** The view the helper never had: who, what to play, and how it is going. */
async function helperView(supabase: SupabaseDB, agentNo: string, r: any, names: Map<string, string>, places: Map<string, string>) {
  const pd = await myActivePd(supabase, r.owner_agent_no, r.district_id)
  const goal = pd ? findFrozenGoal(pd, r.goal_kind, r.goal_ref) : null
  // Two different windows on purpose: the owner has been at this goal since
  // they activated the district, the helper only since they joined. Counting
  // the helper from the district's activation would credit them for plays
  // made before they ever agreed to help.
  const ownerProgress = goal && pd ? await ownerRawProgress(supabase, r.owner_agent_no, pd.activated_at, goal.keys) : 0
  const myContribution = goal && r.joined_at ? await contributionSince(supabase, agentNo, r.joined_at, goal.keys) : 0
  return {
    requestId: r.id,
    ownerCodename: names.get(r.owner_agent_no) || 'an agent',
    districtId: r.district_id, districtName: places.get(r.district_id) || null,
    goalKind: r.goal_kind, goalLabel: goal?.label || null,
    tracks: pd ? goalTrackNames(pd, r.goal_kind, r.goal_ref) : [],
    ownerProgress, myContribution,
    combined: ownerProgress + myContribution,
    originalTarget: r.original_target, boostedTarget: r.boosted_target,
    joinedAt: r.joined_at, expiresAt: r.expires_at,
  }
}
