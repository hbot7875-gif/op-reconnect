// BOTZ redesign Phase 2 — Charge Cells, the new per-agent currency that
// (in Phase 3) will feed the ARMY Bomb's per-agent charge. Named "Charge
// Cells", not "fuel" or "botz": rc_players already has lifetime_fuel (a
// district-restoration reward resource, unrelated), and "BOTZ" is already
// this repo's name for a separate sub-app (botz.html) — same currency the
// design doc calls "fuel/botz", a name that collides with neither.
//
// Earned from album-goal streams only (20:1), not general streaming — see
// districts.ts's albumGoalStreamTotal() for why that has to reuse
// districtProgress()'s own per-track windowed-plays math rather than
// recomputing from raw rc_daily_activity: the daily rollup pipeline
// (derive.ts) only ever sees an aggregate counted-stream total, with no
// concept of which goal a stream belonged to.

import type { SupabaseDB, GameContent } from './config.ts'
import { albumGoalStreamTotal } from './districts.ts'
import type { RollupRow } from './districts.ts'

export const STREAMS_PER_CHARGE_CELL = 20

/**
 * Credits new Charge Cells earned since last checked, for the agent's
 * currently-active district. Idempotent via rc_player_districts'
 * charge_cells_awarded column — a stored baseline, the same "award only the
 * delta past what's already been credited" shape every other per-activation
 * reward in this game uses (see handlers.ts's lifetime_fuel baking). No-ops
 * with no active district or no album goals on it.
 */
export async function creditChargeCells(
  supabase: SupabaseDB,
  content: GameContent,
  agentNo: string,
  activePd: { district_id: string; status: string; activated_at: string; baseline: Record<string, number> | null; goals: any; charge_cells_awarded: number } | null,
  rollups: RollupRow[],
): Promise<number> {
  if (!activePd || activePd.status !== 'active') return 0
  const frozen = activePd.goals
  if (!frozen?.albumGoals?.length) return 0

  const total = albumGoalStreamTotal(frozen, activePd.baseline || {}, rollups, activePd.activated_at, content)
  const earned = Math.floor(total / STREAMS_PER_CHARGE_CELL)
  const already = activePd.charge_cells_awarded || 0
  if (earned <= already) return 0

  const delta = earned - already
  await supabase.from('rc_player_districts')
    .update({ charge_cells_awarded: earned })
    .eq('agent_no', agentNo).eq('district_id', activePd.district_id).eq('status', 'active')
  await supabase.rpc('rc_add_charge_cells', { p_agent_no: agentNo, p_amount: delta })
  return delta
}
