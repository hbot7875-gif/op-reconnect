// Individual levels — a much more frequent, escalating ladder than the
// handful of rank titles, so there's always a near-term target to climb
// toward. See migrations/022_rc_leveling.sql for the schema and the reward
// numbers' rationale.

import type { GameContent, SupabaseDB } from './config.ts'

export interface LevelInfo {
  level: number
  xpIntoLevel: number
  xpForNextLevel: number
}

/** Level from lifetime XP, via an escalating-cost curve read from rc_config
 *  ('level_curve': base + growth) so it retunes with zero redeploys. */
export function levelFor(content: GameContent, xp: number): LevelInfo {
  const cfg = content.config.level_curve || { base: 50, growth: 1.15 }
  let level = 1
  let cum = 0
  let need = cfg.base
  while (xp >= cum + need) {
    cum += need
    level++
    need = Math.round(cfg.base * Math.pow(cfg.growth, level - 1))
  }
  return { level, xpIntoLevel: xp - cum, xpForNextLevel: need }
}

export interface LevelUpResult {
  level: number
  levelsGained: number
  streakFreezeGranted: number
  fuelGranted: number
  boostMultiplier: number
  boostExpiresAt: string
}

/** Compares the freshly-computed level against rc_players.last_level (the
 *  same completion-latch pattern used elsewhere) and, on a crossing, grants
 *  rewards once — a multi-level jump in one request still only refreshes
 *  the timed boost once, not stacked to some absurd duration. */
export async function applyLevelUpIfNeeded(
  supabase: SupabaseDB, content: GameContent, player: any, xp: number,
): Promise<LevelUpResult | null> {
  const { level } = levelFor(content, xp)
  const lastLevel = player.last_level || 1
  if (level <= lastLevel) return null

  const levelsGained = level - lastLevel
  const rewards = content.config.level_rewards
    || { streakFreezePerLevel: 1, fuelPerLevel: 5, boostMultiplier: 2, boostMinutes: 60 }
  const streakFreezeGranted = (rewards.streakFreezePerLevel || 0) * levelsGained
  const fuelGranted = (rewards.fuelPerLevel || 0) * levelsGained
  const boostExpiresAt = new Date(Date.now() + (rewards.boostMinutes || 60) * 60000).toISOString()

  await supabase.from('rc_players').update({
    last_level: level,
    streak_freeze_charges: (player.streak_freeze_charges || 0) + streakFreezeGranted,
    boost_multiplier: rewards.boostMultiplier || 1,
    boost_expires_at: boostExpiresAt,
  }).eq('agent_no', player.agent_no)

  if (fuelGranted > 0) {
    await supabase.rpc('rc_add_resources', { p_agent_no: player.agent_no, p_signal: 0, p_fuel: fuelGranted, p_intel: 0 })
  }

  return { level, levelsGained, streakFreezeGranted, fuelGranted, boostMultiplier: rewards.boostMultiplier || 1, boostExpiresAt }
}
