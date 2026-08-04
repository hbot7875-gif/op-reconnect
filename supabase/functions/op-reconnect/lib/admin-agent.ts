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
