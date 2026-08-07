// Admin agent lookup — support tooling only. Read-only: this looks up and
// diagnoses an account, it does not edit one. Adapted from the per-self
// patterns settings.ts's getAccount and handlers.ts's getAgent/getPlayer
// already use, generalized to look up BY handle or agent number instead of
// trusting a caller's own session.

import type { SupabaseDB } from './config.ts'
import { loadContent, rankFor } from './config.ts'
import { totalXp } from './derive.ts'
import { levelFor } from './leveling.ts'

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

/** Admin: look up one agent by handle or agent number for support purposes.
 *  Returns enough to actually diagnose "why isn't this working for them" —
 *  account basics, level/XP/rank, which stream source is configured (or
 *  isn't), and a district/ward progress summary. Not an editing interface. */
export async function adminGetAgent(supabase: SupabaseDB, params: any) {
  const q = String(params.query || params.handle || params.agentNo || '').trim()
  if (!q) return { success: false, error: 'query_required' }

  let agent: any = null
  if (/^AGENT\d+$/i.test(q)) {
    const { data } = await supabase.from('rc_agents').select('*').eq('agent_no', q.toUpperCase()).maybeSingle()
    agent = data
  }
  if (!agent) {
    const { data } = await supabase.from('rc_agents').select('*').ilike('handle', q).maybeSingle()
    agent = data
  }
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
    ['rc_players', 'agent_no'],
  ]
  for (const [table, column] of deletes) {
    const { error } = await supabase.from(table).delete().eq(column, agentNo)
    if (error) return { success: false, error: `delete_failed:${table}:${error.message}` }
  }

  // Invites sent by the deleted tester should no longer name a missing agent.
  await supabase.from('rc_reconnect_participants').update({ invited_by: null }).eq('invited_by', agentNo)
  const { error } = await supabase.from('rc_agents').delete().eq('agent_no', agentNo)
  if (error) return { success: false, error: `delete_failed:rc_agents:${error.message}` }
  return { success: true, deleted: { agentNo, handle: agent.handle } }
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
