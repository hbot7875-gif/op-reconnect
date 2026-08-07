import type { GameContent, SupabaseDB } from './config.ts'
import { totalXp } from './derive.ts'
import { levelFor } from './leveling.ts'

const LEVEL_BADGES: Record<string, number> = { 'level:5': 5, 'level:10': 10, 'level:20': 20 }
const DISTRICT_BADGES: Record<string, number> = { 'districts:1': 1, 'districts:10': 10, 'districts:50': 50 }
const XP_BADGES: Record<string, number> = { 'xp:1000': 1000, 'xp:10000': 10000 }
const STREAK_BADGES = new Set(['streak:7', 'streak:30', 'streak:100'])

export async function setEquippedBadge(supabase: SupabaseDB, content: GameContent, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const badgeId = String(params.badgeId || '').trim()
  const { data: player } = await supabase.from('rc_players').select('agent_no').eq('agent_no', agentNo).maybeSingle()
  if (!player) return { success: false, error: 'Not joined' }

  if (!badgeId) {
    await supabase.from('rc_players').update({ equipped_badge_id: null }).eq('agent_no', agentNo)
    return { success: true, equippedBadgeId: null }
  }

  let earned = false
  if (STREAK_BADGES.has(badgeId)) {
    const { data } = await supabase.from('rc_badges').select('badge_id')
      .eq('agent_no', agentNo).eq('badge_id', badgeId).maybeSingle()
    earned = !!data
  } else {
    const xp = await totalXp(supabase, agentNo)
    if (LEVEL_BADGES[badgeId]) earned = levelFor(content, xp).level >= LEVEL_BADGES[badgeId]
    else if (XP_BADGES[badgeId]) earned = xp >= XP_BADGES[badgeId]
    else if (DISTRICT_BADGES[badgeId]) {
      const { count } = await supabase.from('rc_player_districts').select('district_id', { count: 'exact', head: true })
        .eq('agent_no', agentNo).eq('status', 'restored')
      earned = (count || 0) >= DISTRICT_BADGES[badgeId]
    }
  }
  if (!earned) return { success: false, error: 'badge_locked' }

  const { error } = await supabase.from('rc_players').update({ equipped_badge_id: badgeId }).eq('agent_no', agentNo)
  return error ? { success: false, error: error.message } : { success: true, equippedBadgeId: badgeId }
}
