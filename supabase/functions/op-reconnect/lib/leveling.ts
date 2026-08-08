// Individual levels — a much more frequent, escalating ladder than the
// handful of rank titles, so there's always a near-term target to climb
// toward. See migrations/022_rc_leveling.sql for the schema and the reward
// numbers' rationale, and migrations/033_rc_level_names.sql for the name
// ladder (rc_config.level_names — purely cosmetic, index i = level i+1).

import type { GameContent, SupabaseDB } from './config.ts'

export interface LevelInfo {
  level: number
  name: string | null
  xpIntoLevel: number
  xpForNextLevel: number
}

export interface LevelRewardsPreview {
  fuel: number
  streakFreeze: number
  boostMultiplier: number
  boostMinutes: number
}

/** What reaching the next level actually grants — same numbers
 *  applyLevelUpIfNeeded awards on a real crossing, read here so the client
 *  can preview them (Progress sheet) without duplicating the config. */
export function nextLevelRewards(content: GameContent): LevelRewardsPreview {
  const rewards = content.config.level_rewards
    || { streakFreezePerLevel: 1, fuelPerLevel: 5, boostMultiplier: 2, boostMinutes: 60 }
  return {
    fuel: rewards.fuelPerLevel || 0,
    streakFreeze: rewards.streakFreezePerLevel || 0,
    boostMultiplier: rewards.boostMultiplier || 1,
    boostMinutes: rewards.boostMinutes || 60,
  }
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
  return { level, name: levelName(content, level), xpIntoLevel: xp - cum, xpForNextLevel: need }
}

/** rc_config.level_names is a flat array, index i = level i+1 — cosmetic
 *  only, nothing here feeds back into the XP math. Levels past the last
 *  named entry just don't get one; the client falls back to the bare
 *  number, same as it always has. */
export function levelName(content: GameContent, level: number): string | null {
  const names: string[] = content.config.level_names || []
  return names[level - 1] || null
}

export interface LevelUpResult {
  level: number
  name: string | null
  levelsGained: number
  streakFreezeGranted: number
  fuelGranted: number
  boostMultiplier: number
  boostExpiresAt: string
}

/** Compares the freshly-computed level against rc_players.last_level (the
 *  same completion-latch pattern used elsewhere) and, on a crossing, grants
 *  rewards once — a multi-level jump in one request still only refreshes
 *  the timed boost once, not stacked to some absurd duration.
 *
 *  `currentFreezeCharges` must be the real, current streak_freeze_charges
 *  count, not player.streak_freeze_charges — handlers.ts's buildState calls
 *  getAgentChargeView (which can spend from that same pooled counter via a
 *  blackout rescue) before this runs, so the `player` object's own snapshot
 *  can already be stale by the time this writes. Passing the stale count
 *  here would silently erase whatever the rescue just spent — and unlike
 *  computeStreak (derive.ts), which only overwrites the column when it
 *  actually spends a charge, this writes unconditionally on every level-up,
 *  so there'd be no later write to correct it. */
export async function applyLevelUpIfNeeded(
  supabase: SupabaseDB, content: GameContent, player: any, xp: number, currentFreezeCharges: number,
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
    streak_freeze_charges: currentFreezeCharges + streakFreezeGranted,
    boost_multiplier: rewards.boostMultiplier || 1,
    boost_expires_at: boostExpiresAt,
  }).eq('agent_no', player.agent_no)

  if (fuelGranted > 0) {
    await supabase.rpc('rc_add_resources', { p_agent_no: player.agent_no, p_signal: 0, p_fuel: fuelGranted, p_intel: 0 })
  }

  return {
    level, name: levelName(content, level), levelsGained, streakFreezeGranted, fuelGranted,
    boostMultiplier: rewards.boostMultiplier || 1, boostExpiresAt,
  }
}
