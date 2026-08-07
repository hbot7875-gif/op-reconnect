// Ranking screen — codename, mode, XP and level for every joined agent.
// Codenames are public (handlers.ts); agent numbers never leave this file.

import type { SupabaseDB } from './config.ts'
import { loadContent } from './config.ts'
import { levelFor } from './leveling.ts'

export async function getLeaderboard(supabase: SupabaseDB, _params: Record<string, unknown>) {
  const content = await loadContent(supabase)
  const { data, error } = await supabase.rpc('rc_leaderboard')
  if (error) return { success: false, error: error.message }
  const { data: profiles } = await supabase.from('rc_players').select('codename, equipped_badge_id')
  const icons = new Map((profiles || []).map((p: any) => [p.codename, p.equipped_badge_id]))

  const agents = (data || []).map((row: any) => ({
    codename: row.codename,
    mode: row.mode,
    xp: Number(row.xp) || 0,
    level: levelFor(content, Number(row.xp) || 0).level,
    equippedBadgeId: icons.get(row.codename) || null,
  }))

  return { success: true, agents }
}
