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
 *
 * The baseline check/update and the actual grant are one FOR UPDATE-locked
 * unit (rc_credit_charge_cells, migrations/…_rc_atomic_charge_cell_credit.sql)
 * — this runs on every buildState call, i.e. every poll, not just an
 * occasional user action, so two overlapping calls for the same agent
 * (two open tabs, a poll landing mid-refresh) are a real, frequent
 * possibility, not a rare edge case. Reading the baseline and granting the
 * delta as two separate non-transactional writes let that double-credit —
 * both calls read the same stale baseline, both computed the same delta,
 * both granted it.
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
  if (earned <= (activePd.charge_cells_awarded || 0)) return 0

  const { data, error } = await supabase.rpc('rc_credit_charge_cells', {
    p_agent_no: agentNo, p_district_id: activePd.district_id, p_earned: earned,
  })
  if (error) return 0
  return typeof data === 'number' ? data : 0
}
