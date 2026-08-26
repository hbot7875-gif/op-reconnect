// Admin agent lookup — support tooling only. Read-only: this looks up and
// diagnoses an account, it does not edit one. Adapted from the per-self
// patterns settings.ts's getAccount and handlers.ts's getAgent/getPlayer
// already use, generalized to look up BY handle or agent number instead of
// trusting a caller's own session.

import type { SupabaseDB } from './config.ts'
import { loadContent, rankFor, limits } from './config.ts'
import { totalXp } from './derive.ts'
import { levelFor } from './leveling.ts'
import { fetchStreamRows } from './streams.ts'
import { flagStreamRows, findPossibleAlts, modesByAgentNo, IDENTITY_FIELDS } from './police-check.ts'

/** j***@gmail.com — enough to confirm "yes that's their address" without
 *  displaying it in full. This is sensitive, support-only data. */
function maskEmail(email: string | null): string | null {
  if (!email) return null
  const at = email.indexOf('@')
  if (at <= 0) return email
  const user = email.slice(0, at)
  const domain = email.slice(at + 1)
  return `${user[0]}${'*'.repeat(Math.max(user.length - 1, 3))}@${domain}`
}

/** Ported verbatim from reconnect/js/settings-streams.js's uplinkBroken —
 *  the exact logic behind this game's single most common support issue
 *  (that file's own header comment: sign-up treats ListenBrainz as
 *  optional, but skipping it with nothing else configured left agents
 *  earning zero XP with no explanation). Column names per settings.ts's
 *  setStreamSource: stream_source_preference, lb_username,
 *  statsfm_username, musicat_public_id. */
function uplinkBroken(agent: any): boolean {
  const src = agent.stream_source_preference || 'lb'
  if (src === 'lb') return !agent.lb_username
  if (src === 'statsfm') return !agent.statsfm_username
  if (src === 'musicat') return !agent.musicat_public_id
  if (src === 'direct') return !agent.scrobble_pin
  return true
}

/** Shared by every admin tool that looks an agent up by whatever an admin
 *  happens to have on hand — an AGENT### number or a handle. Pulled out of
 *  adminGetAgent so adminGetAgentTracks doesn't duplicate it. */
async function findAgentByQuery(supabase: SupabaseDB, rawQuery: string): Promise<any | null> {
  const q = rawQuery.trim()
  if (!q) return null
  if (/^AGENT\d+$/i.test(q)) {
    const { data } = await supabase.from('rc_agents').select('*').eq('agent_no', q.toUpperCase()).maybeSingle()
    if (data) return data
  }
  const { data } = await supabase.from('rc_agents').select('*').ilike('handle', q).maybeSingle()
  return data || null
}

/** Admin: look up one agent by handle or agent number for support purposes.
 *  Returns enough to actually diagnose "why isn't this working for them" —
 *  account basics, level/XP/rank, which stream source is configured (or
 *  isn't), and a district/ward progress summary. Not an editing interface. */
export async function adminGetAgent(supabase: SupabaseDB, params: any) {
  const q = String(params.query || params.handle || params.agentNo || '').trim()
  if (!q) return { success: false, error: 'query_required' }

  const agent = await findAgentByQuery(supabase, q)
  if (!agent) return { success: false, error: 'agent_not_found' }

  const { data: player } = await supabase.from('rc_players').select('*').eq('agent_no', agent.agent_no).maybeSingle()

  let progress: any = null
  let xp = 0
  let level = 1
  let rank: string | null = null

  if (player) {
    const content = await loadContent(supabase)
    xp = await totalXp(supabase, agent.agent_no)
    level = levelFor(content, xp).level
    rank = rankFor(content, xp).title

    const { data: pdRows } = await supabase.from('rc_player_districts')
      .select('district_id, status').eq('agent_no', agent.agent_no)
    const restored = (pdRows || []).filter((r: any) => r.status === 'restored').length
    const active = (pdRows || []).find((r: any) => r.status === 'active')
    const totalDistricts = content.districts.filter((d) => !d.is_centerpiece).length
    const wardsTotal = content.wards.length
    const wardsRestored = content.wards.filter((w) => {
      const ds = content.districts.filter((d) => d.ward_id === w.id && !d.is_centerpiece)
      return ds.length > 0 && ds.every((d) => (pdRows || []).some((r: any) => r.district_id === d.id && r.status === 'restored'))
    }).length

    progress = {
      mode: player.mode,
      codename: player.codename,
      joinedAt: player.joined_at,
      districtsRestored: restored,
      districtsTotal: totalDistricts,
      wardsRestored,
      wardsTotal,
      activeDistrict: active ? (content.districts.find((d) => d.id === active.district_id)?.name || active.district_id) : null,
    }
  }

  return {
    success: true,
    agent: {
      agentNo: agent.agent_no,
      handle: agent.handle,
      email: maskEmail(agent.email),
      createdAt: agent.created_at,
      lastLoginAt: agent.last_login_at,
      joined: !!player,
      xp, level, rank,
      streamSource: agent.stream_source_preference || 'lb',
      lbUsername: agent.lb_username,
      statsfmUsername: agent.statsfm_username,
      musicatPublicId: agent.musicat_public_id,
      hasPin: !!agent.scrobble_pin,
      uplinkBroken: uplinkBroken(agent),
      progress,
    },
  }
}

/** Admin: every group of 2+ agents sharing one external listening identity,
 *  across the whole roster — the proactive counterpart to findPossibleAlts
 *  above, for "who's worth a closer look" instead of "check this one agent
 *  I already suspect." One full-table read of the three identity columns,
 *  grouped in memory — fine at this game's scale, and avoids needing a raw
 *  SQL GROUP BY/HAVING through the client. */
export async function adminScanAltAccounts(supabase: SupabaseDB, _params: any) {
  const { data: agents, error } = await supabase.from('rc_agents')
    .select('agent_no, handle, lb_username, statsfm_username, musicat_public_id')
  if (error) return { success: false, error: error.message }

  const groups: { via: string; value: string; agents: { agentNo: string; handle: string }[] }[] = []
  for (const f of IDENTITY_FIELDS) {
    const byValue = new Map<string, { agentNo: string; handle: string }[]>()
    for (const a of agents || []) {
      const raw = (a as any)[f.col]
      const key = raw ? String(raw).trim().toLowerCase() : ''
      if (!key) continue
      const list = byValue.get(key) || []
      list.push({ agentNo: a.agent_no, handle: a.handle })
      byValue.set(key, list)
    }
    for (const [value, list] of byValue) {
      if (list.length > 1) groups.push({ via: f.label, value, agents: list })
    }
  }

  // Same corroborating-evidence use as findPossibleAlts's mode — one query
  // for every agent across every group instead of one per group.
  const allAgentNos = [...new Set(groups.flatMap((g) => g.agents.map((a) => a.agentNo)))]
  const modes = await modesByAgentNo(supabase, allAgentNos)
  const groupsWithMode = groups.map((g) => ({
    ...g,
    agents: g.agents.map((a) => ({ ...a, mode: modes.get(a.agentNo) || null })),
  }))

  return { success: true, groupCount: groupsWithMode.length, groups: groupsWithMode }
}

/** Admin: one agent's recent listening history, straight off whichever
 *  source they're configured on — the same fetchStreamRows derive.ts's
 *  daily rollup already uses, just called for an arbitrary agent instead of
 *  the caller's own. This is the "Moon Station" police-check tool's raw
 *  material — BOTZ's answer to the old site's Police Terminal, which only
 *  ever linked out to an agent's public Last.fm page for a human to read.
 *  op-reconnect's streams already live server-side, so this shows them
 *  directly instead of sending a reviewer somewhere else to look.
 *
 *  A `repeat` flag gets attached per row where the same track lands again
 *  inside the game's real minimum-gap rule (police-check.ts's
 *  REPEAT_MIN_GAP_SECONDS). Doesn't decide pass/fail — that stays a human
 *  call. This just makes the obvious violations easy to spot instead of
 *  reading a bare timeline.
 *
 *  Also runs findPossibleAlts alongside the track fetch — one timing-based
 *  check (is THIS agent's own history clean) and one identity-based check
 *  (is this agent secretly the same person as another one) covering two
 *  different ways "PL rules" get broken, in the one call a reviewer makes. */
export async function adminGetAgentTracks(supabase: SupabaseDB, params: any) {
  const q = String(params.query || params.handle || params.agentNo || '').trim()
  if (!q) return { success: false, error: 'query_required' }

  const agent = await findAgentByQuery(supabase, q)
  if (!agent) return { success: false, error: 'agent_not_found' }

  const days = Math.max(1, Math.min(30, Number(params.days) || 7))
  const toTs = Math.floor(Date.now() / 1000)
  const fromTs = toTs - days * 86400

  const content = await loadContent(supabase)
  const lim = limits(content)
  const [{ rows }, possibleAlts, playerRow] = await Promise.all([
    fetchStreamRows(supabase, {
      agent_no: agent.agent_no,
      lb_username: agent.lb_username,
      stream_source_preference: agent.stream_source_preference,
      statsfm_username: agent.statsfm_username,
      musicat_public_id: agent.musicat_public_id,
    }, fromTs, toTs, lim.lbMaxPages),
    findPossibleAlts(supabase, agent),
    // This agent's own mode, so a reviewer can compare it against each
    // alt's mode inline instead of cross-referencing two separate lookups.
    supabase.from('rc_players').select('mode').eq('agent_no', agent.agent_no).maybeSingle(),
  ])

  const tracks = flagStreamRows(rows)

  return {
    success: true,
    agent: { agentNo: agent.agent_no, handle: agent.handle, mode: playerRow?.data?.mode || null },
    windowDays: days,
    fromDate: new Date(fromTs * 1000).toISOString(),
    toDate: new Date(toTs * 1000).toISOString(),
    trackCount: tracks.length,
    flaggedCount: tracks.filter((t) => t.flags.length > 0).length,
    tracks,
    possibleAlts,
  }
}

/** Delete one test account and all agent-scoped game rows that predate the
 * rc_agents foreign key. Kept admin-only by index.ts's central route gate. */
export async function adminDeleteAgent(supabase: SupabaseDB, params: any) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  if (!/^AGENT\d{3,}$/.test(agentNo)) return { success: false, error: 'agent_no_invalid' }

  const { data: agent } = await supabase.from('rc_agents')
    .select('agent_no, handle').eq('agent_no', agentNo).maybeSingle()
  if (!agent) return { success: false, error: 'agent_not_found' }

  // Remove references with no FK cascade first. Missions created by this test
  // account disappear too; their participant rows cascade from the mission.
  const deletes: [string, string][] = [
    ['rc_reconnect_puzzle_attempts', 'agent_no'],
    ['rc_reconnect_participants', 'agent_no'],
    ['rc_reconnect_missions', 'created_by'],
    ['rc_defuse_contrib', 'agent_no'],
    // Added 2026-08-24 — cross-checked every real FK pointing at rc_agents
    // and found these seven missing from both this list and the scheduled
    // cleanup's own copy (rc_delete_inactive_agents_scheduled), which is
    // what broke the 14-day auto-delete cron for 3 nights straight on
    // rc_vma_votes specifically. Each is a feature added after this list
    // was first written.
    //
    // rc_backup_requests has to come BEFORE rc_player_items below —
    // rc_backup_requests.spent_player_item_id is a second-order FK onto
    // rc_player_items (not onto rc_agents directly, so the audit above
    // missed it the first time), and broke a real scheduled run
    // (2026-08-24) the same way rc_vma_votes broke this exact function a
    // day earlier: "violates foreign key constraint
    // rc_backup_requests_spent_player_item_id_fkey."
    ['rc_backup_requests', 'owner_agent_no'],
    ['rc_player_items', 'agent_no'],
    ['rc_streak_freeze_log', 'agent_no'],
    ['rc_badges', 'agent_no'],
    ['rc_xp_ledger', 'agent_no'],
    ['rc_daily_activity', 'agent_no'],
    ['rc_player_districts', 'agent_no'],
    ['rc_agent_lit_eras', 'agent_no'],
    ['rc_agent_charge', 'agent_no'],
    ['generated_playlists', 'agent_no'],
    ['rc_scrobbles', 'agent_no'],
    ['rc_password_resets', 'agent_no'],
    ['rc_playlist_reports', 'agent_no'],
    ['rc_playlist_saves', 'agent_no'],
    ['rc_supply_chest_opens', 'agent_no'],
    ['rc_supply_chest_progress', 'agent_no'],
    ['rc_vma_community_chest_claims', 'agent_no'],
    ['rc_vma_votes', 'agent_no'],
    ['rc_players', 'agent_no'],
  ]
  for (const [table, column] of deletes) {
    const { error } = await supabase.from(table).delete().eq(column, agentNo)
    if (error) return { success: false, error: `delete_failed:${table}:${error.message}` }
  }

  // Invites sent by the deleted tester should no longer name a missing
  // agent, and neither should a backup-pass helper slot that isn't theirs
  // to delete (the request row belongs to its owner, deleted above only
  // when THEY'RE the one being removed).
  await supabase.from('rc_reconnect_participants').update({ invited_by: null }).eq('invited_by', agentNo)
  await supabase.from('rc_backup_requests').update({ helper_agent_no: null }).eq('helper_agent_no', agentNo)
  const { error } = await supabase.from('rc_agents').delete().eq('agent_no', agentNo)
  if (error) return { success: false, error: `delete_failed:rc_agents:${error.message}` }
  return { success: true, deleted: { agentNo, handle: agent.handle } }
}

/** Automatic cleanup for agents who haven't fed the ARMY Bomb in
 *  p_inactive_days days straight (default 14) — "not charged" specifically,
 *  not general streaming/app activity, per the site owner. The candidate
 *  list itself lives in Postgres (migrations/053_rc_inactive_agent_cleanup
 *  .sql's rc_inactive_agent_candidates — already excludes AGENT001 and
 *  retired agents); this just loops it through the SAME adminDeleteAgent
 *  used for a manual one-off delete, so there is exactly one place that
 *  knows how to fully remove an agent, not two that can drift apart.
 *
 *  dryRun (default true) returns who WOULD be deleted without touching
 *  anything — the mode this is meant to be checked with before ever
 *  flipping it to actually run, and what the scheduled cron calls with
 *  dryRun explicitly set to false. Real deletion is permanent; there is no
 *  undo, unlike settings.ts's retireAccount(). */
export async function adminDeleteInactiveAgents(supabase: SupabaseDB, params: any) {
  const inactiveDays = Number.isFinite(parseInt(params.inactiveDays)) ? parseInt(params.inactiveDays) : 14
  const dryRun = params.dryRun !== false // opt OUT, not opt in — a missing/misspelled flag must never accidentally trigger real deletes

  const { data: candidates, error } = await supabase.rpc('rc_inactive_agent_candidates', { p_inactive_days: inactiveDays })
  if (error) return { success: false, error: error.message }
  const rows = candidates || []

  if (dryRun) {
    return {
      success: true, dryRun: true, count: rows.length,
      candidates: rows.map((r: any) => ({
        agentNo: r.agent_no, codename: r.codename, lastFedAt: r.last_fed_at, joinedAt: r.joined_at, daysInactive: r.days_inactive,
      })),
    }
  }

  const deleted: string[] = []
  const failed: { agentNo: string; error: string }[] = []
  for (const r of rows) {
    const result = await adminDeleteAgent(supabase, { agentNo: r.agent_no })
    if (result.success) deleted.push(r.agent_no)
    else failed.push({ agentNo: r.agent_no, error: result.error })
  }
  return { success: true, dryRun: false, deletedCount: deleted.length, deleted, failed }
}

/** Reset visible XP without deleting historical reward rows. A compensating
 * ledger entry prevents the next stream sync from recreating old XP. */
export async function adminResetAgentXp(supabase: SupabaseDB, params: any) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  if (!/^AGENT\d{3,}$/.test(agentNo)) return { success: false, error: 'agent_no_invalid' }
  const { data: agent } = await supabase.from('rc_agents')
    .select('agent_no').eq('agent_no', agentNo).maybeSingle()
  if (!agent) return { success: false, error: 'agent_not_found' }

  const previousXp = await totalXp(supabase, agentNo)
  if (previousXp !== 0) {
    const { error } = await supabase.from('rc_xp_ledger').insert({
      agent_no: agentNo,
      amount: -previousXp,
      source: 'admin_reset',
      dedup_key: `admin-xp-reset:${agentNo}:${Date.now()}`,
      meta: { previousXp },
    })
    if (error) return { success: false, error: `xp_reset_failed:${error.message}` }
  }
  await supabase.from('rc_players').update({
    last_level: 1, boost_multiplier: 1, boost_expires_at: null,
  }).eq('agent_no', agentNo)
  return { success: true, agentNo, previousXp, xp: 0, level: 1 }
}
