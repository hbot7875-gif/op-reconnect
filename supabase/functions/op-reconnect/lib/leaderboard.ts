// Ranking screen — codename, mode, XP and level for every joined agent.
// Codenames are public (handlers.ts); agent numbers never leave this file.

import type { SupabaseDB } from './config.ts'
import { loadContent } from './config.ts'
import { levelFor } from './leveling.ts'
import { resolveEquippedBadges } from './badge-profile.ts'
import { activeRankingRows } from './ranking-rules.js'

export async function getLeaderboard(supabase: SupabaseDB, _params: Record<string, unknown>) {
  const content = await loadContent(supabase)
  const { data, error } = await supabase.rpc('rc_leaderboard')
  if (error) return { success: false, error: error.message }
  // Retirement is intentionally a soft delete, so rc_players and the XP
  // ledger remain as historical records. rc_leaderboard therefore still
  // returns them unless this public response explicitly gates against the
  // authoritative rc_agents.retired_at flag.
  const [{ data: activeAgents }, { data: profiles }] = await Promise.all([
    supabase.from('rc_agents').select('agent_no').is('retired_at', null),
    supabase.from('rc_players').select('agent_no, equipped_badge_id'),
  ])
  const active = new Set((activeAgents || []).map((a: any) => String(a.agent_no)))
  const activeProfiles = (profiles || []).filter((p: any) => active.has(String(p.agent_no)))
  // Keyed by agent_no, not codename — codenames are only checked against the
  // owning agent's own agent number/handle (handlers.ts's validateCodename),
  // never against every OTHER agent's codename, so two agents landing on the
  // same one is a reachable state. agent_no is the real unique identity;
  // it's read here purely as an internal join key and dropped below —
  // never part of the `agents` shape this returns to the client.
  const icons = new Map(activeProfiles.map((p: any) => [p.agent_no, p.equipped_badge_id]))
  // (13) One batched resolve for the whole board instead of N lookups —
  // real Badge Collection artwork where it applies, null (client falls back
  // to badges.js) for legacy ids.
  const artwork = await resolveEquippedBadges(
    supabase, activeProfiles.map((p: any) => ({ agentNo: p.agent_no, badgeId: p.equipped_badge_id || null })),
  )

  const agents = activeRankingRows(data || [], active).map((row: any) => ({
    codename: row.codename,
    mode: row.mode,
    xp: Number(row.xp) || 0,
    level: levelFor(content, Number(row.xp) || 0).level,
    equippedBadgeId: icons.get(row.agent_no) || null,
    equippedBadgeArtwork: artwork.get(row.agent_no) || null,
  }))

  return { success: true, agents }
}
