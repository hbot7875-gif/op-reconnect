// Read-only admin views for the dashboard (admin.html): leave records, the
// inactivity cleanup preview, and ReConnect quests with stages and
// contributions. Every function here only SELECTs. None of them calls
// refreshMission or anything else that settles, expires or stamps a quest —
// see reconnect-admin-view.js for the rules that read stored state, and the
// admin-readonly test, which fails if a write ever appears in this file.

import type { SupabaseDB, GameContent } from './config.ts'
import { contributionTotals, ownGoalKeys } from './reconnect-missions.ts'
import { warPlayedAgents } from './war-quest-pass.ts'
import { hasWarStage } from './reconnect-war-stage.js'
import {
  inviteLapsed, questDisplayStatus, questMode, questStages, contributionWindowEnd, memberContribution,
} from './reconnect-admin-view.js'

const IN_CHUNK = 200
async function selectIn(supabase: SupabaseDB, table: string, columns: string, column: string, values: string[]) {
  const rows: any[] = []
  for (let i = 0; i < values.length; i += IN_CHUNK) {
    const { data, error } = await supabase.from(table).select(columns).in(column, values.slice(i, i + IN_CHUNK))
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...(data || []))
  }
  return rows
}

async function codenames(supabase: SupabaseDB, agentNos: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(agentNos.filter(Boolean))]
  const rows = unique.length ? await selectIn(supabase, 'rc_players', 'agent_no, codename', 'agent_no', unique) : []
  return new Map(rows.map((r: any) => [r.agent_no, r.codename]))
}

/* ── Leaves ─────────────────────────────────────────────────────────── */

/** Every leave record, newest first. Leaves always start the moment they are
 *  taken (rc_leave_start), so there is no upcoming state to report. */
export async function adminListLeaves(supabase: SupabaseDB, _params: any) {
  const { data, error } = await supabase.from('rc_player_leaves')
    .select('id, agent_no, starts_at, ends_at, ended_at, district_id, district_hours_granted, bomb_shift_hours, blackout_shift_hours, created_at')
    .order('starts_at', { ascending: false }).limit(5000)
  if (error) return { success: false, error: error.message }
  const names = await codenames(supabase, (data || []).map((r: any) => r.agent_no))
  return {
    success: true,
    leaves: (data || []).map((r: any) => ({
      id: r.id, agentNo: r.agent_no, codename: names.get(r.agent_no) || null,
      startsAt: r.starts_at, endsAt: r.ends_at, endedAt: r.ended_at, districtId: r.district_id,
      districtHoursGranted: r.district_hours_granted, bombShiftHours: r.bomb_shift_hours,
      blackoutShiftHours: r.blackout_shift_hours, createdAt: r.created_at,
    })),
  }
}

/* ── Inactivity cleanup preview ─────────────────────────────────────── */

/** Who the 18:00 UTC job would delete, and why the rest would not —
 *  rc_inactive_agent_deletion_preview (migration 20261112170000) applies the
 *  job's own gate. Read-only. */
export async function adminCleanupPreview(supabase: SupabaseDB, _params: any) {
  const { data, error } = await supabase.rpc('rc_inactive_agent_deletion_preview', { p_min_days: 9, p_inactive_days: 14 })
  if (error) return { success: false, error: error.message }
  return {
    success: true,
    inactiveDays: 14, noticeDays: 2, validDays: 45,
    agents: (data || []).map((r: any) => ({
      agentNo: r.agent_no, codename: r.codename, daysInactive: Number(r.days_inactive),
      hasEmail: !!r.has_email, firstWarnedAt: r.first_warned_at, lastWarnedAt: r.last_warned_at,
      lastAttemptAt: r.last_attempt_at, warnCount: Number(r.warn_count) || 0,
      lastDeliveryOk: r.last_delivery_ok, eligibleFrom: r.eligible_from, eligible: !!r.eligible,
    })),
  }
}

/* ── ReConnect quests ───────────────────────────────────────────────── */

const MISSION_COLUMNS = 'id, district_id, goal_id, required_agents, status, phase, cipher_index, cipher_attempts_left, created_at, completed_at, expires_at, cards_unlocked_at, created_by'
const PARTICIPANT_COLUMNS = 'mission_id, agent_no, status, joined_at, streamed_at, left_at, contribution_frozen'

/** The quest's frozen config, as its members froze it at activation (the
 *  source refreshMission reads). Falls back to the live goal row only when no
 *  member's frozen copy can be found (e.g. every attempt was since deleted). */
async function frozenConfigs(supabase: SupabaseDB, content: GameContent, missions: any[], participants: any[]) {
  const out = new Map<string, { variant: string; config: any; frozen: boolean }>()
  const keys = [...new Set(missions.map((m) => `${m.district_id}::${m.goal_id}`))]
  const agentsByKey = new Map<string, string[]>()
  for (const m of missions) {
    const k = `${m.district_id}::${m.goal_id}`
    const list = agentsByKey.get(k) || []
    for (const p of participants) if (p.mission_id === m.id) list.push(p.agent_no)
    agentsByKey.set(k, list)
  }
  for (const k of keys) {
    const [districtId, goalId] = k.split('::')
    const agents = [...new Set(agentsByKey.get(k) || [])].slice(0, 20)
    let found: any = null
    if (agents.length) {
      const { data } = await supabase.from('rc_player_districts')
        .select('goals').eq('district_id', districtId).in('agent_no', agents)
      found = (data || []).map((r: any) => r.goals?.reconnect).find((r: any) => r?.id === goalId) || null
    }
    if (found) out.set(k, { variant: found.variant, config: found.config || {}, frozen: true })
    else {
      const g: any = content.goals.find((row) => row.id === goalId)
      out.set(k, { variant: g?.variant || 'connect', config: g?.config || {}, frozen: false })
    }
  }
  return out
}

function publicStage(config: any) {
  // Never send cipher answers or hidden track keys to the browser.
  return {
    requiredAgents: config?.requiredAgents ?? null,
    cipherCount: Array.isArray(config?.ciphers) ? config.ciphers.length : 0,
    warOfCards: hasWarStage(config),
    sharedTrack: config?.sharedTrack ? { label: config.sharedTrack.label, target: config.sharedTrack.target } : null,
    checklistTracks: config?.checklist?.tracks?.length || 0,
    sharedTracks: config?.sharedTracks ? { target: Number(config.sharedTracks.target) || 0, tracks: (config.sharedTracks.tracks || []).length, hidden: !!config.sharedTracks.hidden } : null,
  }
}

/** Open quests with anyone still in them, plus every quest that was created
 *  or completed in the last `days` days (default 30) — completed, expired and
 *  cancelled included — district by district, with each quest's stored stage. */
export async function adminListReconnectQuests(supabase: SupabaseDB, content: GameContent, params: any) {
  const days = Math.min(120, Math.max(1, parseInt(params?.days) || 30))
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const now = Date.now()
  const [openRes, recentRes, doneRes] = await Promise.all([
    supabase.from('rc_reconnect_missions').select(MISSION_COLUMNS).eq('status', 'open'),
    supabase.from('rc_reconnect_missions').select(MISSION_COLUMNS).neq('status', 'open').gte('created_at', since),
    supabase.from('rc_reconnect_missions').select(MISSION_COLUMNS).eq('status', 'complete').gte('completed_at', since),
  ])
  for (const r of [openRes, recentRes, doneRes]) if (r.error) return { success: false, error: r.error.message }
  const byId = new Map<string, any>()
  for (const m of [...(openRes.data || []), ...(recentRes.data || []), ...(doneRes.data || [])]) byId.set(m.id, m)
  const missions = [...byId.values()]
  const participants = missions.length
    ? await selectIn(supabase, 'rc_reconnect_participants', PARTICIPANT_COLUMNS, 'mission_id', missions.map((m) => m.id))
    : []
  const configs = await frozenConfigs(supabase, content, missions, participants)
  const names = await codenames(supabase, participants.map((p) => p.agent_no))
  const districtNames = new Map(content.districts.map((d: any) => [d.id, d.name]))
  const goalLabels = new Map(content.goals.map((g: any) => [g.id, g.label]))

  const quests: any[] = []
  for (const m of missions) {
    const rows = participants.filter((p) => p.mission_id === m.id)
    const joined = rows.filter((p) => p.status === 'joined')
    const invited = rows.filter((p) => p.status === 'invited' && !inviteLapsed(p, now))
    // An open mission nobody is in any more is a leftover, not a quest.
    if (m.status === 'open' && !joined.length && !invited.length) continue
    const key = `${m.district_id}::${m.goal_id}`
    const { variant, config, frozen } = configs.get(key)!
    quests.push({
      missionId: m.id, districtId: m.district_id, districtName: districtNames.get(m.district_id) || m.district_id,
      goalId: m.goal_id, goalLabel: goalLabels.get(m.goal_id) || 'ReConnect Quest', variant, configFrozen: frozen,
      status: questDisplayStatus(m, now), storedStatus: m.status, phase: m.phase || 'streaming',
      requiredAgents: m.required_agents, createdAt: m.created_at, completedAt: m.completed_at, expiresAt: m.expires_at,
      stages: questStages(m, { variant, config, joinedCount: joined.length, now }),
      config: publicStage(config),
      members: rows.map((p) => ({
        agentNo: p.agent_no, codename: names.get(p.agent_no) || p.agent_no, status: p.status,
        inviteLapsed: inviteLapsed(p, now), joinedAt: p.joined_at, leftAt: p.left_at || null,
        streamedAt: p.streamed_at || null,
      })),
    })
  }
  quests.sort((a, b) => String(a.districtName).localeCompare(String(b.districtName)) || String(b.createdAt).localeCompare(String(a.createdAt)))
  return { success: true, days, quests }
}

/** One quest in full: stages plus each teammate's own contribution, counted
 *  with the same contributionTotals window refreshMission uses (from when
 *  they joined), closed where the quest closed. Read-only. */
export async function adminGetReconnectQuest(supabase: SupabaseDB, content: GameContent, params: any) {
  const missionId = String(params?.missionId || '')
  if (!missionId) return { success: false, error: 'mission_required' }
  const now = Date.now()
  const { data: m, error } = await supabase.from('rc_reconnect_missions').select(MISSION_COLUMNS).eq('id', missionId).maybeSingle()
  if (error) return { success: false, error: error.message }
  if (!m) return { success: false, error: 'mission_not_found' }
  const { data: rows, error: pErr } = await supabase.from('rc_reconnect_participants').select(PARTICIPANT_COLUMNS).eq('mission_id', missionId)
  if (pErr) return { success: false, error: pErr.message }
  const participants = rows || []
  const { variant, config, frozen } = (await frozenConfigs(supabase, content, [m], participants)).get(`${m.district_id}::${m.goal_id}`)!
  const mode = questMode(variant, config)
  const status = questDisplayStatus(m, now)
  const names = await codenames(supabase, participants.map((p: any) => p.agent_no))
  const joined = participants.filter((p: any) => p.status === 'joined')

  const members: any[] = []
  for (const p of participants) {
    const base = {
      agentNo: p.agent_no, codename: names.get(p.agent_no) || p.agent_no, status: p.status,
      inviteLapsed: inviteLapsed(p, now), joinedAt: p.joined_at, leftAt: p.left_at || null, streamedAt: p.streamed_at || null,
    }
    if (p.status === 'invited' || mode === 'invite') { members.push({ ...base, contribution: null, counted: 'not_applicable' }); continue }
    if (status === 'cancelled') { members.push({ ...base, contribution: null, counted: 'cancelled' }); continue }
    if (p.status === 'left' && mode !== 'sharedTracks') {
      // Frozen at exit by the quest-skip transaction; that is what still counts
      // (sharedTracks quests instead count a leaver's plays up to left_at,
      // exactly as refreshMission's sharedTracksPlays does — below).
      members.push({ ...base, contribution: { value: Number(p.contribution_frozen) || 0, of: null, unit: 'plays' }, counted: 'frozen_at_exit' })
      continue
    }
    let ownKeys: string[] = []
    if (mode === 'ownGoals') {
      const { data: pd } = await supabase.from('rc_player_districts')
        .select('status, goals').eq('agent_no', p.agent_no).eq('district_id', m.district_id).maybeSingle()
      // An open quest counts nothing for a member whose attempt lapsed (the
      // same rule refreshMission applies); a closed quest reads their frozen goals.
      if (status === 'open' && pd?.status !== 'active') { members.push({ ...base, contribution: { value: 0, of: null, unit: 'plays' }, counted: 'left_district' }); continue }
      ownKeys = ownGoalKeys(pd)
    }
    const until = contributionWindowEnd(m, p, now)
    const totals = await contributionTotals(supabase, p.agent_no, p.joined_at, false, until)
    members.push({ ...base, contribution: memberContribution(mode, config, totals, ownKeys), counted: until ? 'until_close' : 'live', countedUntil: until })
  }

  let pooled: any = null
  if (mode === 'sharedTrack' || mode === 'sharedTracks') {
    const total = members.reduce((n, x) => n + (x.contribution?.value || 0), 0)
    const target = mode === 'sharedTrack' ? Number(config.sharedTrack.target) : null
    pooled = { total, target, unit: 'plays', capped: mode === 'sharedTracks' }
  }
  let warPlayed: string[] = []
  if (hasWarStage(config) && m.cards_unlocked_at) {
    warPlayed = await warPlayedAgents(supabase, joined.map((p: any) => p.agent_no), m.cards_unlocked_at)
  }
  for (const x of members) x.warPlayed = hasWarStage(config) ? warPlayed.includes(x.agentNo) : null

  return {
    success: true,
    quest: {
      missionId: m.id, districtId: m.district_id,
      districtName: content.districts.find((d: any) => d.id === m.district_id)?.name || m.district_id,
      goalId: m.goal_id, goalLabel: content.goals.find((g: any) => g.id === m.goal_id)?.label || 'ReConnect Quest',
      variant, mode, configFrozen: frozen, status, storedStatus: m.status, phase: m.phase || 'streaming',
      requiredAgents: m.required_agents, createdAt: m.created_at, completedAt: m.completed_at, expiresAt: m.expires_at,
      cardsUnlockedAt: m.cards_unlocked_at || null,
      stages: questStages(m, { variant, config, joinedCount: joined.length, now }),
      config: publicStage(config), pooled, members,
    },
  }
}
