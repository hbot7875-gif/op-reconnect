// Individual levels — a much more frequent, escalating ladder than the
// handful of rank titles, so there's always a near-term target to climb
// toward. See migrations/022_rc_leveling.sql for the schema and the reward
// numbers' rationale, and migrations/033_rc_level_names.sql for the name
// ladder (rc_config.level_names — purely cosmetic, index i = level i+1).

import type { GameContent, SupabaseDB } from './config.ts'
import { backupPassLevelGrants, nextLevelGrantsBackupPass } from './backup-pass-rewards.js'

export interface LevelInfo {
  level: number
  name: string | null
  xpIntoLevel: number
  xpForNextLevel: number
}

export interface LevelRewardsPreview {
  extensionCharge: number
  streakFreeze: number
  boostMultiplier: number
  boostMinutes: number
  /** Whether the NEXT level-up grants a Backup Pass. Alternating, so this is
   *  false roughly half the time — previewing it unconditionally would
   *  promise a pass the level-up then doesn't deliver. */
  backupPass: boolean
}

/** The two Backup Pass knobs this file needs, read from the same rc_config
 *  key the feature's other settings live under (see backup-pass.ts). */
function backupPassLevelOpts(content: GameContent) {
  const cfg = content.config.backup_pass || {}
  return {
    minLevel: Number.isFinite(Number(cfg.level_reward_from)) ? Number(cfg.level_reward_from) : 2,
    everyOther: cfg.level_reward_every_other !== false,
  }
}

/** What reaching the next level actually grants — same numbers
 *  applyLevelUpIfNeeded awards on a real crossing, read here so the client
 *  can preview them (Progress sheet) without duplicating the config.
 *  Fuel used to be granted here (fuelPerLevel) — dropped per the site
 *  owner, since nothing in the game reads or spends Fuel. Extension
 *  Charges (migration 057) took its place: a rare, earned way to buy a
 *  district attempt 3 more days when the clock is about to beat it — see
 *  handlers.ts's extendDistrictDeadline.
 *
 *  `level` and `lastPassLevel` are needed only for the Backup Pass line,
 *  which depends on whether the level below the next one already granted
 *  one. They are passed as plain numbers rather than the player row on
 *  purpose: applyLevelUpIfNeeded may have just advanced the latch in the
 *  database, so the caller's `player` snapshot can already be stale — the
 *  same trap documented on that function's charge counters. */
export function nextLevelRewards(content: GameContent, level?: number, lastPassLevel?: number): LevelRewardsPreview {
  const rewards = content.config.level_rewards
    || { streakFreezePerLevel: 1, extensionChargePerLevel: 1, boostMultiplier: 2, boostMinutes: 60 }
  return {
    extensionCharge: rewards.extensionChargePerLevel || 0,
    streakFreeze: rewards.streakFreezePerLevel || 0,
    boostMultiplier: rewards.boostMultiplier || 1,
    boostMinutes: rewards.boostMinutes || 60,
    backupPass: Number.isFinite(Number(level))
      ? nextLevelGrantsBackupPass(Number(level), Number(lastPassLevel) || 0, backupPassLevelOpts(content))
      : false,
  }
}

/** base * growth^n, rounded to the nearest whole XP — split out from
 *  levelFor because the naive `Math.round(base * Math.pow(growth, n))`
 *  silently rounds the wrong way on values that land exactly (or should
 *  land exactly) on a .5 boundary: 50 * 1.15 is mathematically exactly
 *  57.5, but floating-point represents 1.15 slightly short, so the raw
 *  product comes out 57.49999999999999 and rounds down to 57 instead of
 *  58. A tiny nudge before rounding costs nothing on every other level
 *  (their true values sit nowhere near a .5 boundary, so it changes
 *  nothing there) but corrects exactly this class of representation error.
 *  1e-9 is comfortably larger than the ~1e-14 error double-precision
 *  math actually produces here, and comfortably smaller than any gap that
 *  should legitimately affect which way a real (non-artifact) value rounds. */
function levelCost(base: number, growth: number, n: number): number {
  return Math.round(base * Math.pow(growth, n) + 1e-9)
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
    need = levelCost(cfg.base, cfg.growth, level - 1)
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
  extensionChargeGranted: number
  backupPassGranted: number
  /** The new rc_players.last_backup_pass_level. Handed back so the response
   *  can preview the NEXT level honestly without re-reading the row. */
  backupPassLevel: number
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
 *  so there'd be no later write to correct it.
 *
 *  `currentExtensionCharges` follows the same reasoning — nothing else
 *  spends from deadline_extension_charges within the same request today,
 *  but threading it through the same way keeps this function's contract
 *  consistent rather than half-trusting `player`'s own snapshot for one
 *  counter and not the other. */
export async function applyLevelUpIfNeeded(
  supabase: SupabaseDB, content: GameContent, player: any, xp: number,
  currentFreezeCharges: number, currentExtensionCharges: number,
): Promise<LevelUpResult | null> {
  const { level } = levelFor(content, xp)
  const storedLevel = player.last_level ?? 1
  const lastLevel = storedLevel || 1
  if (level <= lastLevel) return null

  const levelsGained = level - lastLevel
  const rewards = content.config.level_rewards
    || { streakFreezePerLevel: 1, extensionChargePerLevel: 1, boostMultiplier: 2, boostMinutes: 60 }
  const streakFreezeGranted = (rewards.streakFreezePerLevel || 0) * levelsGained
  const extensionChargeGranted = (rewards.extensionChargePerLevel || 0) * levelsGained
  const boostExpiresAt = new Date(Date.now() + (rewards.boostMinutes || 60) * 60000).toISOString()
  // Backup Passes don't scale with levelsGained the way the charges above
  // do — they alternate, so a three-level jump pays one or two, not three.
  // backup-pass-rewards.js works that out and hands back the latch value.
  const passes = backupPassLevelGrants({
    fromLevel: lastLevel, toLevel: level,
    lastPassLevel: player.last_backup_pass_level || 0,
    ...backupPassLevelOpts(content),
  })

  // Compare-and-set on last_level, not a bare update. getGameState is polled
  // on a timer and can also be triggered by the player, so two requests can
  // read the same pre-level-up row and both decide they crossed. That was
  // survivable while every reward here was an absolute value written into a
  // column — the second write just set the same numbers again. It is not
  // survivable now: the Backup Pass grant below is an INSERT, and a losing
  // race would insert it twice. Only the request that actually moves
  // last_level off its old value proceeds.
  const { data: claimed } = await supabase.from('rc_players').update({
    last_level: level,
    last_backup_pass_level: passes.lastPassLevel,
    streak_freeze_charges: currentFreezeCharges + streakFreezeGranted,
    deadline_extension_charges: currentExtensionCharges + extensionChargeGranted,
    boost_multiplier: rewards.boostMultiplier || 1,
    boost_expires_at: boostExpiresAt,
  }).eq('agent_no', player.agent_no).eq('last_level', storedLevel)
    .select('agent_no').maybeSingle()
  if (!claimed) return null

  // district_id null puts it in the Pack, where a Backup Pass is used from.
  if (passes.count > 0) {
    await supabase.from('rc_player_items').insert(
      passes.levels.map(() => ({ agent_no: player.agent_no, item_id: 'backup-pass', district_id: null })))
  }

  return {
    level, name: levelName(content, level), levelsGained, streakFreezeGranted, extensionChargeGranted,
    backupPassGranted: passes.count, backupPassLevel: passes.lastPassLevel,
    boostMultiplier: rewards.boostMultiplier || 1, boostExpiresAt,
  }
}
