// Magic Shop — BOTZ redesign Phase 2's first real currency sink. Reads/
// spends the balances charge-economy.ts and this file's own purchases add
// to rc_players (charge_cells, wings, tickets).
//
// Charge Cells aren't spendable yet — Phase 3 is what lets them charge the
// per-agent ARMY Bomb. This file only earns/displays them elsewhere; what it
// actually SELLS today is Wings (bought with XP) and a Ticket (unlocked by
// reaching a level/district/XP bar, no separate cost). BTS merch is
// deliberately not implemented here — no catalog or pricing was ever
// specified, and inventing one would just be guessing.

import type { SupabaseDB, GameContent } from './config.ts'
import { todayKst } from './kst.ts'
import { totalXp } from './derive.ts'
import { levelFor } from './leveling.ts'

const WINGS_PER_DAY = 3
const WINGS_COST_XP = 1
const TICKET_REQUIREMENT = { level: 7, districtsRestored: 3, xp: 50 }

async function restoredDistrictCount(supabase: SupabaseDB, agentNo: string): Promise<number> {
  const { count } = await supabase.from('rc_player_districts')
    .select('district_id', { count: 'exact', head: true })
    .eq('agent_no', agentNo).eq('status', 'restored')
  return count || 0
}

function ticketEligibility(level: number, districtsRestored: number, xp: number) {
  return level >= TICKET_REQUIREMENT.level
    && districtsRestored >= TICKET_REQUIREMENT.districtsRestored
    && xp >= TICKET_REQUIREMENT.xp
}

export async function getMagicShop(supabase: SupabaseDB, content: GameContent, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const { data: player } = await supabase.from('rc_players').select('*').eq('agent_no', agentNo).maybeSingle()
  if (!player) return { success: false, error: 'agent_not_found' }

  const today = todayKst()
  const wingsBoughtToday = player.wings_bought_date === today ? (player.wings_bought_today || 0) : 0
  const xp = await totalXp(supabase, agentNo)
  const level = levelFor(content, xp).level
  const districtsRestored = await restoredDistrictCount(supabase, agentNo)

  return {
    success: true,
    shop: {
      chargeCells: player.charge_cells || 0,
      wings: player.wings || 0,
      tickets: player.tickets || 0,
      wingsAvailableToday: Math.max(0, WINGS_PER_DAY - wingsBoughtToday),
      wingsCostXp: WINGS_COST_XP,
      ticket: {
        claimed: (player.tickets || 0) > 0,
        eligible: ticketEligibility(level, districtsRestored, xp),
        requirement: TICKET_REQUIREMENT,
        progress: { level, districtsRestored, xp },
      },
      merchComingSoon: true,
    },
  }
}

/**
 * Buys today's remaining Wings allotment (up to 3/day) for a flat 1 XP.
 * Spends via a real negative rc_xp_ledger entry — same ledger totalXp() sums
 * for level/rank everywhere else in the game. Worth flagging: level and rank
 * are computed from lifetime total XP and have never had to handle it going
 * DOWN before (leveling.ts's applyLevelUpIfNeeded latch assumes monotonic
 * growth). Spending 1 XP/day is unlikely to ever demote anyone in practice,
 * but this is a real design tension the rest of the game doesn't have —
 * worth a second look if Wings' cost ever changes to something bigger than 1.
 */
export async function buyWings(supabase: SupabaseDB, content: GameContent, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const { data: player } = await supabase.from('rc_players').select('*').eq('agent_no', agentNo).maybeSingle()
  if (!player) return { success: false, error: 'agent_not_found' }

  const today = todayKst()
  const boughtToday = player.wings_bought_date === today ? (player.wings_bought_today || 0) : 0
  if (boughtToday >= WINGS_PER_DAY) return { success: false, error: 'daily_limit_reached' }

  const xp = await totalXp(supabase, agentNo)
  if (xp < WINGS_COST_XP) return { success: false, error: 'not_enough_xp' }

  const grant = WINGS_PER_DAY - boughtToday
  const { error: ledgerErr } = await supabase.from('rc_xp_ledger').upsert({
    agent_no: agentNo, amount: -WINGS_COST_XP, source: 'magic_shop_wings',
    dedup_key: `wings:${agentNo}:${today}`, meta: { wingsGranted: grant },
  }, { onConflict: 'dedup_key', ignoreDuplicates: true })
  if (ledgerErr) return { success: false, error: ledgerErr.message }

  const newWings = (player.wings || 0) + grant
  const { error } = await supabase.from('rc_players').update({
    wings: newWings, wings_bought_today: WINGS_PER_DAY, wings_bought_date: today,
  }).eq('agent_no', agentNo)
  if (error) return { success: false, error: error.message }

  return { success: true, wingsGranted: grant, wings: newWings }
}

/**
 * One-time claim once the level/districts/XP bar is cleared. No separate
 * cost was ever specified beyond reaching the bar — eligibility IS the
 * price. Guarded by the current ticket count rather than a ledger dedup key,
 * same simple "check before writing" pattern settings.ts's other one-shot
 * actions use.
 */
export async function claimTicket(supabase: SupabaseDB, content: GameContent, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const { data: player } = await supabase.from('rc_players').select('*').eq('agent_no', agentNo).maybeSingle()
  if (!player) return { success: false, error: 'agent_not_found' }
  if ((player.tickets || 0) > 0) return { success: false, error: 'already_claimed' }

  const xp = await totalXp(supabase, agentNo)
  const level = levelFor(content, xp).level
  const districtsRestored = await restoredDistrictCount(supabase, agentNo)
  if (!ticketEligibility(level, districtsRestored, xp)) return { success: false, error: 'not_eligible' }

  const { error } = await supabase.from('rc_players').update({ tickets: (player.tickets || 0) + 1 }).eq('agent_no', agentNo)
  if (error) return { success: false, error: error.message }
  return { success: true, tickets: (player.tickets || 0) + 1 }
}
