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
/** What a credit attempt actually settled on.
 *
 *  `balance` is the wallet as the database holds it after this call, and it
 *  is the ONLY number any surface should render. null means this call never
 *  reached the database (no active district, nothing new to credit before we
 *  asked, or the RPC failed) and the caller should keep using whatever
 *  balance it already had — never reconstruct one by adding `delta` to a row
 *  it read earlier. That reconstruction is the bug this shape exists to make
 *  impossible: it produced a Pack and an ARMY Bomb screen that disagreed
 *  inside one response, and a balance that appeared to go backwards whenever
 *  two polls overlapped.
 *
 *  `delta` is only ever for the "+N earned" toast. */
export interface ChargeCreditResult {
  delta: number
  balance: number | null
}

const NO_CREDIT: ChargeCreditResult = { delta: 0, balance: null }

/** The RPC returned a bare integer delta before migration 20261009100000 and
 *  a (delta, balance) row after it. Accept both, so the Edge function and the
 *  database can be deployed in either order without dropping a credit. */
function readCreditResult(data: unknown): ChargeCreditResult {
  if (typeof data === 'number') return { delta: data, balance: null }
  const row: any = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') return NO_CREDIT
  const delta = Number(row.delta)
  const balance = Number(row.balance)
  return {
    delta: Number.isFinite(delta) ? delta : 0,
    balance: Number.isFinite(balance) ? balance : null,
  }
}

export async function creditChargeCells(
  supabase: SupabaseDB,
  content: GameContent,
  agentNo: string,
  activePd: { district_id: string; status: string; activated_at: string; baseline: Record<string, number> | null; goals: any; charge_cells_awarded: number } | null,
  rollups: RollupRow[],
): Promise<ChargeCreditResult> {
  if (!activePd || activePd.status !== 'active') return NO_CREDIT
  const frozen = activePd.goals
  if (!frozen?.albumGoals?.length) return NO_CREDIT

  const total = albumGoalStreamTotal(frozen, activePd.baseline || {}, rollups, activePd.activated_at, content)
  const earned = Math.floor(total / STREAMS_PER_CHARGE_CELL)

  // Deliberately NOT short-circuited on `earned <= activePd.charge_cells_awarded`.
  //
  // That early exit looked free — it only skipped a call that would credit
  // nothing — but it also skipped the only read that knows the true balance,
  // and it decided using an activePd row fetched at a different instant from
  // the charge view's wallet read. With two polls overlapping, poll B could
  // read the wallet BEFORE poll A credited (0) and read activePd AFTER it
  // (already advanced), exit early with no balance, and report 0 for a wallet
  // the database says is 4. The balance going backwards is the whole bug.
  //
  // The RPC is already the arbiter: it re-checks the baseline under its own
  // FOR UPDATE and credits nothing when there is nothing to credit. Always
  // asking costs one indexed single-row call per poll and makes "what is the
  // balance" a question only the database ever answers.
  const { data, error } = await supabase.rpc('rc_credit_charge_cells', {
    p_agent_no: agentNo, p_district_id: activePd.district_id, p_earned: earned,
  })
  if (error) return NO_CREDIT
  return readCreditResult(data)
}

/**
 * The one rule for which number a surface renders.
 *
 * `viewBalance` is what getAgentChargeView read, which happens early in
 * buildState because its blackout reset has to run before rc_player_districts
 * is read. `credited` is what the database said afterwards. The database wins
 * whenever it spoke, and nothing anywhere may add a delta to a balance it
 * read earlier — that reconstruction is what let the Pack and the ARMY Bomb
 * disagree inside one response.
 */
export function resolveWalletCells(viewBalance: number, credited: ChargeCreditResult): number {
  return credited.balance !== null ? credited.balance : viewBalance
}
