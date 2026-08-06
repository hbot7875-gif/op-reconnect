// BOTZ redesign Phase 3 — the ARMY Bomb's charge, per agent. Replaces
// bomb.ts's shared network-wide pool (see docs/botz-network-redesign.md
// decision 1): each agent maintains their own charge, fed by their own
// Charge Cells or by lighting up a whole era's tracks in a week, and it's
// THEIR OWN restored districts at risk if it runs dark too long — not
// the network's shared multiplier.
//
// charged_until is an absolute expiry, not a decaying counter, computed at
// read time — no background job ever decrements anything. A brand-new agent
// who's never fed the Bomb (charged_until still null) is never "dark": the
// blackout clock only starts once there's been a real charge to lose.

import type { SupabaseDB, GameContent } from './config.ts'
import { todayKst, kstWeekKey } from './kst.ts'
import { artistAllowed, normKeyFull } from './text.ts'
import { ERA_CATALOG } from './era-timeline.ts'

export const HOURS_PER_CHARGE_CELL = 4
export const HOURS_PER_LIT_ERA = 10
const SOFT_RESET_DAYS = 7   // dark this long → abandon the active district, back to Home Base
const FULL_RESET_DAYS = 14  // dark this long → every restored district reverts (XP stays banked)

const HOUR_MS = 3600_000
const DAY_MS = 86400_000

interface ChargeRow {
  agent_no: string
  charged_until: string | null
  auto_feed: boolean
  blackout_started_at: string | null
  soft_reset_at: string | null
  full_reset_at: string | null
}

async function getOrCreateRow(supabase: SupabaseDB, agentNo: string): Promise<ChargeRow> {
  const { data } = await supabase.from('rc_agent_charge').select('*').eq('agent_no', agentNo).maybeSingle()
  if (data) return data
  const fresh: ChargeRow = {
    agent_no: agentNo, charged_until: null, auto_feed: false,
    blackout_started_at: null, soft_reset_at: null, full_reset_at: null,
  }
  await supabase.from('rc_agent_charge').insert(fresh)
  return fresh
}

function extend(baselineMs: number, hours: number): number {
  return baselineMs + hours * HOUR_MS
}

/** Spend `freezesAvailable` streak-freeze charges (1 day covered each) only
 *  down to just under `thresholdDays` — a reactive rescue at the moment an
 *  agent's blackout would otherwise trip a consequence, not a proactive
 *  front-load that burns charges before they're actually needed. Mutates
 *  and persists rc_players.streak_freeze_charges directly. */
async function rescueWithFreezes(
  supabase: SupabaseDB, agentNo: string, freezesAvailable: number, daysDark: number, thresholdDays: number,
): Promise<{ daysDark: number; freezesLeft: number }> {
  if (daysDark < thresholdDays || freezesAvailable <= 0) return { daysDark, freezesLeft: freezesAvailable }
  const needed = Math.ceil(daysDark - thresholdDays + 1)
  const use = Math.min(needed, freezesAvailable)
  if (use <= 0) return { daysDark, freezesLeft: freezesAvailable }
  await supabase.from('rc_players').update({ streak_freeze_charges: freezesAvailable - use }).eq('agent_no', agentNo)
  return { daysDark: daysDark - use, freezesLeft: freezesAvailable - use }
}

/** Abandon whatever district is mid-restoration, same shape as the existing
 *  7-day restoration-deadline lapse in handlers.ts — nothing was ever baked
 *  into lifetime resources for an in-progress district, so there's nothing
 *  to unwind. */
async function softReset(supabase: SupabaseDB, agentNo: string) {
  await supabase.from('rc_player_districts').delete().eq('agent_no', agentNo).eq('status', 'active')
}

/** Every restored district reverts to unrestored. XP, badges and items are
 *  untouched — this only ever removes rc_player_districts rows, the same
 *  table that already defines "restored" purely by a row's presence. */
async function fullReset(supabase: SupabaseDB, agentNo: string) {
  await supabase.from('rc_player_districts').delete().eq('agent_no', agentNo).eq('status', 'restored')
}

/** Same era track catalog as era-timeline.ts, but this reads counted plays
 *  for ONE agent, scoped to the current KST week only — a completely
 *  different question from that file's network-wide, all-time rollup, so
 *  it isn't reused directly. An era "lights up" once every one of its
 *  tracks has been streamed at least once this week; lighting one grants
 *  +10h charge exactly once (rc_agent_lit_eras' primary key is the guard).
 *  Runs BEFORE the blackout check in getAgentChargeView so a lit era can
 *  rescue an agent from going dark in the same poll it happens. */
async function computeWeeklyLitEras(
  supabase: SupabaseDB, content: GameContent, agentNo: string, chargedUntilMs: number | null,
): Promise<{ litEras: string[]; chargedUntilMs: number | null }> {
  const weekKey = kstWeekKey(todayKst())

  const { data: alreadyLit } = await supabase.from('rc_agent_lit_eras')
    .select('era_id').eq('agent_no', agentNo).eq('week_key', weekKey)
  const litSet = new Set((alreadyLit || []).map((r: any) => r.era_id))
  const stillToCheck = ERA_CATALOG.filter((e) => !litSet.has(e.id))
  if (!stillToCheck.length) return { litEras: [...litSet], chargedUntilMs }

  // Monday of this KST week through today — the week's own activity only.
  const { data: rows } = await supabase.from('rc_daily_activity')
    .select('track_counts').eq('agent_no', agentNo).gte('kst_date', weekKey)
  const allow: string[] = content.config.bts_artists || []
  const totals = new Map<string, number>()
  for (const row of rows || []) {
    const bucket = row.track_counts || {}
    for (const key of Object.keys(bucket)) {
      const entry = bucket[key]
      const counted = Object.entries(entry?.a || {}).reduce(
        (s: number, [artist, cnt]) => s + (artistAllowed(artist, allow) ? (cnt as number) : 0), 0)
      if (counted) totals.set(key, (totals.get(key) || 0) + counted)
    }
  }

  const now = Date.now()
  for (const era of stillToCheck) {
    const allStreamed = era.tracks.every((t: string) => (totals.get(normKeyFull(t)) || 0) > 0)
    if (!allStreamed) continue
    const { error } = await supabase.from('rc_agent_lit_eras')
      .insert({ agent_no: agentNo, era_id: era.id, week_key: weekKey })
    if (error) continue // already lit by a concurrent request — fine, just skip the grant
    litSet.add(era.id)
    const baseline = Math.max(chargedUntilMs ?? now, now)
    chargedUntilMs = extend(baseline, HOURS_PER_LIT_ERA)
    await supabase.from('rc_agent_charge')
      .update({ charged_until: new Date(chargedUntilMs).toISOString(), blackout_started_at: null, soft_reset_at: null, full_reset_at: null })
      .eq('agent_no', agentNo)
  }
  return { litEras: [...litSet], chargedUntilMs }
}

export interface AgentChargeView {
  hoursRemaining: number
  isDark: boolean
  autoFeed: boolean
  chargeCells: number
  litEras: string[] // era ids lit this week
}

/**
 * The one function handlers.ts calls each poll: catches up auto-feed, lets
 * a newly-lit era rescue a dark charge, evaluates the blackout consequences
 * (with the streak-freeze rescue), and returns the current view. Every
 * write here is idempotent — a repeat poll with nothing new to do just
 * re-reads the same state back.
 */
export async function getAgentChargeView(supabase: SupabaseDB, content: GameContent, agentNo: string): Promise<AgentChargeView> {
  const row = await getOrCreateRow(supabase, agentNo)
  const { data: player } = await supabase.from('rc_players').select('charge_cells, streak_freeze_charges').eq('agent_no', agentNo).maybeSingle()
  let cells = player?.charge_cells || 0
  let freezes = player?.streak_freeze_charges || 0
  const now = Date.now()
  let chargedUntilMs = row.charged_until ? new Date(row.charged_until).getTime() : null

  // Auto-feed: retroactively bridge the gap since it last ran dark, as if
  // it had been checked continuously — same "compute at read time" shape
  // as everything else here, not a live background process.
  if (row.auto_feed && cells > 0 && (chargedUntilMs === null || chargedUntilMs <= now)) {
    const baseline = chargedUntilMs ?? now
    const gapMs = Math.max(0, now - baseline)
    const cellsNeeded = Math.ceil(gapMs / (HOURS_PER_CHARGE_CELL * HOUR_MS)) || 1
    const use = Math.min(cellsNeeded, cells)
    if (use > 0) {
      chargedUntilMs = extend(baseline, use * HOURS_PER_CHARGE_CELL)
      cells -= use
      await supabase.from('rc_players').update({ charge_cells: cells }).eq('agent_no', agentNo)
      await supabase.from('rc_agent_charge').update({ charged_until: new Date(chargedUntilMs).toISOString() }).eq('agent_no', agentNo)
    }
  }

  const lit = await computeWeeklyLitEras(supabase, content, agentNo, chargedUntilMs)
  chargedUntilMs = lit.chargedUntilMs

  const isDark = chargedUntilMs === null ? false : chargedUntilMs <= now
  let blackoutStartMs = row.blackout_started_at ? new Date(row.blackout_started_at).getTime() : null
  let softResetAt = row.soft_reset_at
  let fullResetAt = row.full_reset_at

  if (isDark && chargedUntilMs !== null) {
    if (blackoutStartMs === null) {
      blackoutStartMs = chargedUntilMs
      await supabase.from('rc_agent_charge').update({ blackout_started_at: new Date(chargedUntilMs).toISOString() }).eq('agent_no', agentNo)
    }
    let daysDark = (now - blackoutStartMs) / DAY_MS

    if (!softResetAt) {
      const rescued = await rescueWithFreezes(supabase, agentNo, freezes, daysDark, SOFT_RESET_DAYS)
      freezes = rescued.freezesLeft
      daysDark = rescued.daysDark
      if (daysDark >= SOFT_RESET_DAYS) {
        await softReset(supabase, agentNo)
        softResetAt = new Date().toISOString()
        await supabase.from('rc_agent_charge').update({ soft_reset_at: softResetAt }).eq('agent_no', agentNo)
      }
    }

    if (!fullResetAt) {
      const rescued = await rescueWithFreezes(supabase, agentNo, freezes, daysDark, FULL_RESET_DAYS)
      freezes = rescued.freezesLeft
      daysDark = rescued.daysDark
      if (daysDark >= FULL_RESET_DAYS) {
        await fullReset(supabase, agentNo)
        fullResetAt = new Date().toISOString()
        await supabase.from('rc_agent_charge').update({ full_reset_at: fullResetAt }).eq('agent_no', agentNo)
      }
    }
  } else if (row.blackout_started_at) {
    // Charged again — clear the blackout record so the next dark spell
    // starts its own fresh clock instead of inheriting this one's age.
    await supabase.from('rc_agent_charge').update({ blackout_started_at: null, soft_reset_at: null, full_reset_at: null }).eq('agent_no', agentNo)
  }

  return {
    hoursRemaining: chargedUntilMs ? Math.max(0, (chargedUntilMs - now) / HOUR_MS) : 0,
    isDark,
    autoFeed: row.auto_feed,
    chargeCells: cells,
    litEras: lit.litEras,
  }
}

/** Spends Charge Cells to extend charged_until — stacks forward from
 *  whichever is later, current expiry or now, same "adding wood extends the
 *  fire further, doesn't reset it" logic as feeding an actual fire. */
export async function feedCharge(supabase: SupabaseDB, agentNo: string, cellsToSpend: number) {
  cellsToSpend = Math.max(0, Math.floor(cellsToSpend))
  if (!cellsToSpend) return { success: false, error: 'invalid_amount' }

  const { data: player } = await supabase.from('rc_players').select('charge_cells').eq('agent_no', agentNo).maybeSingle()
  if (!player || (player.charge_cells || 0) < cellsToSpend) return { success: false, error: 'not_enough_charge_cells' }

  const row = await getOrCreateRow(supabase, agentNo)
  const now = Date.now()
  const baseline = Math.max(row.charged_until ? new Date(row.charged_until).getTime() : now, now)
  const newChargedUntilMs = extend(baseline, cellsToSpend * HOURS_PER_CHARGE_CELL)
  const newChargedUntil = new Date(newChargedUntilMs).toISOString()

  await supabase.from('rc_players').update({ charge_cells: player.charge_cells - cellsToSpend }).eq('agent_no', agentNo)
  await supabase.from('rc_agent_charge')
    .update({ charged_until: newChargedUntil, blackout_started_at: null, soft_reset_at: null, full_reset_at: null, updated_at: new Date().toISOString() })
    .eq('agent_no', agentNo)
  return { success: true, chargedUntil: newChargedUntil }
}

export async function setAutoFeed(supabase: SupabaseDB, agentNo: string, on: boolean) {
  await getOrCreateRow(supabase, agentNo)
  await supabase.from('rc_agent_charge').update({ auto_feed: on }).eq('agent_no', agentNo)
  return { success: true, autoFeed: on }
}

/** Read-only wrapper for the Personal Charge sheet's own refresh after
 *  feeding/toggling auto-feed — avoids re-fetching the entire getGameState
 *  payload just to redraw one small screen, same reasoning as
 *  magic-shop.ts's getMagicShop(). */
export async function getAgentCharge(supabase: SupabaseDB, content: GameContent, agentNo: string) {
  const view = await getAgentChargeView(supabase, content, agentNo)
  return { success: true, charge: view }
}
