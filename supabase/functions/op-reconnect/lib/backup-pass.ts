// Backup Pass: spend a Pack item to open ONE of your own active track/album
// goals to exactly one helper. See migration 20260819110000 for the schema
// and the atomic rc_backup_open/join/close/complete functions this file
// calls — all state transitions that touch the consumed item or the
// same-pair-same-goal history happen there, locked, so this file never has
// to worry about a duplicate request racing itself.
//
// Deliberately does NOT mutate rc_player_districts.goals — the boosted
// target is an overlay computed fresh each call (getBackupOverlay) and fed
// into districts.ts's districtProgress() as an extra argument. A closed
// request's banked_credit is the one thing that becomes permanent, and even
// that lives on rc_backup_requests, never written back into the frozen
// goal snapshot itself.
import type { GameContent, SupabaseDB } from './config.ts'
import { contributionSince } from './reconnect-missions.ts'

interface BackupConfig { target_multiplier: number; request_ttl_days: number }
function backupConfig(content: GameContent): BackupConfig {
  return { target_multiplier: 1.2, request_ttl_days: 5, ...(content.config.backup_pass || {}) }
}

/** The owner's own frozen goal this request refers to — track goals and
 *  album goals live in different arrays with different shapes, so this is
 *  the one place that normalizes both into {label, keys, target}. Album
 *  goals pool ALL their tracks' keys together for Backup Pass purposes
 *  (helping with "the album" means streaming any of its tracks) rather than
 *  modeling per-track backup, which the design never asked for. */
function findFrozenGoal(pd: any, goalKind: string, goalRef: string): { label: string; keys: string[]; target: number } | null {
  const goals = pd?.goals || {}
  if (goalKind === 'track') {
    const g = (goals.trackGoals || []).find((t: any) => t.id === goalRef)
    return g ? { label: g.label, keys: g.keys, target: g.target } : null
  }
  if (goalKind === 'album') {
    const a = (goals.albumGoals || []).find((al: any) => al.id === goalRef)
    if (!a) return null
    const keys = (a.tracks || []).flatMap((t: any) => t.keys || [])
    return { label: a.label, keys, target: a.target }
  }
  return null
}

async function myActivePd(supabase: SupabaseDB, agentNo: string, districtId: string) {
  const { data } = await supabase.from('rc_player_districts')
    .select('status, goals, activated_at').eq('agent_no', agentNo).eq('district_id', districtId).maybeSingle()
  return data || null
}

/** Real (uncapped) plays of a goal's keys, from the OWNER's own daily
 *  activity since their district activation — same source districtProgress()
 *  itself reads, just without the windowing/baseline subtlety that only
 *  matters for the display progress bar, not this go/no-go check. Good
 *  enough for deciding "did the owner already hit the original target
 *  solo" — a slight over-count on the activation day (no baseline
 *  subtraction) only ever makes that check trigger very slightly early,
 *  never late, and never affects the boosted-target overlay math at all
 *  (that still runs through districtProgress() itself). */
async function ownerRawProgress(supabase: SupabaseDB, agentNo: string, sinceIso: string, keys: string[]): Promise<number> {
  return contributionSince(supabase, agentNo, sinceIso, keys)
}

/** Re-derives one request's real state: closes it (banking or refunding,
 *  via the atomic SQL functions) if the helper hit the boosted target, the
 *  owner independently hit the original target solo, the owner's district
 *  is gone, or the request expired. Called from every read path so nothing
 *  needs a cron sweep — same read-time-interpretation philosophy
 *  reconnect-missions.ts already uses for its own expiry. */
async function refreshBackupRequest(supabase: SupabaseDB, req: any): Promise<any> {
  if (req.status !== 'open' && req.status !== 'joined') return req

  if (new Date(req.expires_at).getTime() <= Date.now()) {
    const helperContribution = req.status === 'joined'
      ? await contributionSince(supabase, req.helper_agent_no, req.joined_at, req._keys || [])
      : 0
    const ownerProgress = req.status === 'joined' ? await ownerRawProgress(supabase, req.owner_agent_no, req._activatedAt, req._keys || []) : 0
    const { data } = await supabase.rpc('rc_backup_close', {
      p_request_id: req.id, p_reason: 'expired', p_owner_progress: ownerProgress, p_helper_contribution: helperContribution,
    })
    return { ...req, status: data?.status || 'expired' }
  }

  const ownerPd = await myActivePd(supabase, req.owner_agent_no, req.district_id)
  const goal = ownerPd ? findFrozenGoal(ownerPd, req.goal_kind, req.goal_ref) : null
  if (!ownerPd || ownerPd.status !== 'active' || !goal) {
    // Owner lost the district (or the goal itself vanished, e.g. an era
    // change) — close out whatever the helper had already contributed.
    const helperContribution = req.status === 'joined'
      ? await contributionSince(supabase, req.helper_agent_no, req.joined_at, req._keys || [])
      : 0
    const { data } = await supabase.rpc('rc_backup_close', {
      p_request_id: req.id, p_reason: 'district_ended', p_owner_progress: 0, p_helper_contribution: helperContribution,
    })
    return { ...req, status: data?.status || 'cancelled' }
  }

  if (req.status !== 'joined') return req // still waiting for a helper — nothing else to check

  const ownerProgress = await ownerRawProgress(supabase, req.owner_agent_no, ownerPd.activated_at, goal.keys)
  if (ownerProgress >= req.original_target) {
    // Owner finished solo — bank whatever the helper had, goal's done either way.
    const helperContribution = await contributionSince(supabase, req.helper_agent_no, req.joined_at, goal.keys)
    const { data } = await supabase.rpc('rc_backup_close', {
      p_request_id: req.id, p_reason: 'goal_complete', p_owner_progress: ownerProgress, p_helper_contribution: helperContribution,
    })
    return { ...req, status: data?.status || 'banked', banked_credit: data?.bankedCredit ?? req.banked_credit }
  }

  const helperContribution = await contributionSince(supabase, req.helper_agent_no, req.joined_at, goal.keys)
  if (ownerProgress + helperContribution >= req.boosted_target) {
    const { data } = await supabase.rpc('rc_backup_complete', { p_request_id: req.id })
    return { ...req, status: data?.status || 'complete' }
  }
  return { ...req, _liveHelperContribution: helperContribution, _liveOwnerProgress: ownerProgress }
}

/** What districts.ts's districtProgress() should add on top of a goal's own
 *  numbers for this owner right now — either a live pooled bonus (while
 *  'joined', target raised to boosted_target) or a permanent banked one
 *  (once 'banked', target back to normal). Both districtProgress() has no
 *  idea backups even exist, keeps it a pure function over its own inputs.
 *  One owner can only ever have one open/joined/recently-banked request at
 *  a time (see rc_backup_open), so this is at most one entry. */
export async function getBackupOverlay(
  supabase: SupabaseDB, agentNo: string, districtId: string,
): Promise<Record<string, { target: number; bonus: number }>> {
  const { data: rows } = await supabase.from('rc_backup_requests')
    .select('*').eq('owner_agent_no', agentNo).eq('district_id', districtId)
    .in('status', ['open', 'joined', 'banked'])
  const overlay: Record<string, { target: number; bonus: number }> = {}
  for (const raw of rows || []) {
    if (raw.status === 'banked') {
      overlay[raw.goal_ref] = { target: raw.original_target, bonus: raw.banked_credit }
      continue
    }
    const pd = await myActivePd(supabase, agentNo, districtId)
    const goal = pd ? findFrozenGoal(pd, raw.goal_kind, raw.goal_ref) : null
    const req = { ...raw, _keys: goal?.keys || [], _activatedAt: pd?.activated_at }
    const fresh = await refreshBackupRequest(supabase, req)
    if (fresh.status === 'joined') {
      overlay[raw.goal_ref] = { target: raw.boosted_target, bonus: fresh._liveHelperContribution || 0 }
    } else if (fresh.status === 'banked') {
      overlay[raw.goal_ref] = { target: raw.original_target, bonus: fresh.banked_credit || 0 }
    } else if (fresh.status === 'complete') {
      overlay[raw.goal_ref] = { target: raw.boosted_target, bonus: raw.boosted_target } // fully satisfied either way
    }
    // 'open' with no helper yet — no bonus, target stays whatever
    // districtProgress() already uses on its own (original), nothing to add.
  }
  return overlay
}

export async function getBackupStatus(supabase: SupabaseDB, content: GameContent, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()

  const { count: passCount } = await supabase.from('rc_player_items')
    .select('id', { count: 'exact', head: true }).eq('agent_no', agentNo).eq('item_id', 'backup-pass').is('used_at', null)

  const { data: ownerRow } = await supabase.from('rc_backup_requests')
    .select('*').eq('owner_agent_no', agentNo).in('status', ['open', 'joined']).maybeSingle()
  const { data: helperRow } = await supabase.from('rc_backup_requests')
    .select('*').eq('helper_agent_no', agentNo).eq('status', 'joined').maybeSingle()

  return {
    success: true,
    backupPasses: passCount || 0,
    asOwner: ownerRow ? shapeRequest(ownerRow, agentNo) : null,
    asHelper: helperRow ? shapeRequest(helperRow, agentNo) : null,
  }
}

function shapeRequest(r: any, meAgentNo: string) {
  return {
    id: r.id, districtId: r.district_id, goalKind: r.goal_kind, goalRef: r.goal_ref,
    originalTarget: r.original_target, boostedTarget: r.boosted_target, status: r.status,
    isOwner: r.owner_agent_no === meAgentNo, hasHelper: !!r.helper_agent_no,
    expiresAt: r.expires_at, joinedAt: r.joined_at,
  }
}

/** Other agents' open requests this agent could help with — an open
 *  broadcast, not an invite-by-codename flow like reconnect. Deliberate:
 *  the design this follows explicitly describes "AGENT NEEDS BACKUP — JOIN"
 *  as something any eligible agent can see and tap, not something the owner
 *  sends to one specific person. */
export async function listOpenBackupRequests(supabase: SupabaseDB, content: GameContent, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const { data: rows } = await supabase.from('rc_backup_requests')
    .select('id, owner_agent_no, district_id, goal_kind, goal_ref, original_target, boosted_target, expires_at')
    .eq('status', 'open').neq('owner_agent_no', agentNo).order('opened_at', { ascending: true }).limit(30)

  const live = (rows || []).filter((r: any) => new Date(r.expires_at).getTime() > Date.now())
  const ownerNos = [...new Set(live.map((r: any) => r.owner_agent_no))]
  const { data: owners } = ownerNos.length
    ? await supabase.from('rc_players').select('agent_no, codename').in('agent_no', ownerNos)
    : { data: [] }
  const names = new Map((owners || []).map((o: any) => [o.agent_no, o.codename]))

  const requests = live.map((r: any) => {
    const pd = null // label resolved client-side isn't available here without another query; goalRef + kind is enough to key it
    return {
      id: r.id, ownerCodename: names.get(r.owner_agent_no) || 'an agent',
      districtId: r.district_id, goalKind: r.goal_kind, goalRef: r.goal_ref,
      originalTarget: r.original_target, boostedTarget: r.boosted_target, expiresAt: r.expires_at,
    }
  })
  return { success: true, requests }
}

export async function openBackupRequest(supabase: SupabaseDB, content: GameContent, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const districtId = String(params.districtId || '')
  const goalKind = String(params.goalKind || '')
  const goalRef = String(params.goalRef || '')
  if (!['track', 'album'].includes(goalKind)) return { success: false, error: 'bad_goal_kind' }

  const pd = await myActivePd(supabase, agentNo, districtId)
  if (!pd || pd.status !== 'active') return { success: false, error: 'not_eligible' }
  const goal = findFrozenGoal(pd, goalKind, goalRef)
  if (!goal) return { success: false, error: 'goal_not_found' }

  const progress = await ownerRawProgress(supabase, agentNo, pd.activated_at, goal.keys)
  if (progress >= goal.target) return { success: false, error: 'goal_already_done' }

  const cfg = backupConfig(content)
  const boostedTarget = Math.ceil(goal.target * cfg.target_multiplier)

  const { data: result, error } = await supabase.rpc('rc_backup_open', {
    p_owner: agentNo, p_district_id: districtId, p_goal_kind: goalKind, p_goal_ref: goalRef,
    p_original_target: goal.target, p_boosted_target: boostedTarget, p_ttl_days: cfg.request_ttl_days,
  })
  if (error) return { success: false, error: error.message }
  if (!result?.success) return { success: false, error: result?.error || 'open_failed' }
  return { success: true, id: result.id, boostedTarget }
}

export async function joinBackupRequest(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const requestId = String(params.requestId || '')
  if (!requestId) return { success: false, error: 'request_required' }

  const { data: result, error } = await supabase.rpc('rc_backup_join', { p_request_id: requestId, p_helper: agentNo })
  if (error) return { success: false, error: error.message }
  if (!result?.success) return { success: false, error: result?.error || 'join_failed' }
  return { success: true }
}

/** The helper explicitly leaves — one of the four things allowed to end a
 *  Backup Pass (never mere inactivity). Computes their real contribution so
 *  far and hands it to rc_backup_close, which decides refund vs. bank. */
export async function leaveBackupHelper(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const requestId = String(params.requestId || '')
  const { data: row } = await supabase.from('rc_backup_requests').select('*').eq('id', requestId).maybeSingle()
  if (!row) return { success: false, error: 'not_found' }
  if (row.helper_agent_no !== agentNo) return { success: false, error: 'not_your_backup' }
  if (row.status !== 'joined') return { success: false, error: 'not_active' }

  const ownerPd = await myActivePd(supabase, row.owner_agent_no, row.district_id)
  const goal = ownerPd ? findFrozenGoal(ownerPd, row.goal_kind, row.goal_ref) : null
  const helperContribution = goal ? await contributionSince(supabase, agentNo, row.joined_at, goal.keys) : 0
  const ownerProgress = goal && ownerPd ? await ownerRawProgress(supabase, row.owner_agent_no, ownerPd.activated_at, goal.keys) : 0

  const { data: result, error } = await supabase.rpc('rc_backup_close', {
    p_request_id: requestId, p_reason: 'helper_left', p_owner_progress: ownerProgress, p_helper_contribution: helperContribution,
  })
  if (error) return { success: false, error: error.message }
  return { success: true, status: result?.status, bankedCredit: result?.bankedCredit || 0 }
}
