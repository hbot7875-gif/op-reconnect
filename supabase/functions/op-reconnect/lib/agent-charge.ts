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
import { trackArtistOverrides } from './config.ts'
import { todayKst, kstWeekKey } from './kst.ts'
import { countedArtistPlays } from './text.ts'
import { ERA_CATALOG, eraTrackKeys, eraTrackTitle } from './era-timeline.ts'
import { logFeedEvent } from './feed.ts'

export const HOURS_PER_CHARGE_CELL = 2
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

export interface EraCardView {
  id: string
  name: string
  icon: string
  description: string
  albums: string[]
  done: number
  total: number
  remaining: number
  status: 'dark' | 'lit' | 'used'
  tracks: { title: string; done: boolean }[]
}

/** Personal weekly progress, separate from era-timeline.ts's community,
 * all-time display. Completing every track inserts a ready inventory card;
 * charge is added only when the agent deliberately uses that card. A used
 * row remains for the week so the same streams cannot mint it repeatedly. */
async function computeWeeklyEraCards(
  supabase: SupabaseDB, content: GameContent, agentNo: string,
): Promise<{ eraCards: EraCardView[]; newlyLitEraIds: string[] }> {
  const weekKey = kstWeekKey(todayKst())

  const { data: rowsForWeek } = await supabase.from('rc_agent_lit_eras')
    .select('era_id, lit_at, used_at').eq('agent_no', agentNo).eq('week_key', weekKey)
  const stored = new Map((rowsForWeek || []).map((r: any) => [r.era_id, r]))

  // Monday of this KST week through today — the week's own activity only.
  const { data: rows } = await supabase.from('rc_daily_activity')
    .select('track_counts').eq('agent_no', agentNo).gte('kst_date', weekKey)
  const allow: string[] = content.config.bts_artists || []
  const overrides = trackArtistOverrides(content)
  const totals = new Map<string, number>()
  for (const row of rows || []) {
    const bucket = row.track_counts || {}
    for (const key of Object.keys(bucket)) {
      const counted = countedArtistPlays(bucket[key]?.a, allow, key, overrides)
      if (counted) totals.set(key, (totals.get(key) || 0) + counted)
    }
  }

  const trackCounted = (t: any) => eraTrackKeys(t).reduce((s, k) => s + (totals.get(k) || 0), 0) > 0

  const newlyLitEraIds: string[] = []
  for (const era of ERA_CATALOG) {
    const done = era.tracks.filter((t) => trackCounted(t)).length
    if (done < era.tracks.length || stored.has(era.id)) continue
    const { data: inserted, error } = await supabase.from('rc_agent_lit_eras')
      .insert({ agent_no: agentNo, era_id: era.id, week_key: weekKey })
      .select('era_id, lit_at, used_at').maybeSingle()
    if (!error && inserted) {
      stored.set(era.id, inserted)
      newlyLitEraIds.push(era.id)
      // The insert above only ever succeeds once per agent/era/week (see
      // the `stored.has(era.id)` skip guard just above), so this can't
      // double-log on a repoll either.
      await logFeedEvent(supabase, agentNo, 'era_lit', { eraName: era.name }, `era-lit:${agentNo}:${weekKey}:${era.id}`)
    }
  }

  const eraCards: EraCardView[] = ERA_CATALOG.map((era) => {
    const tracks = era.tracks.map((t) => ({ title: eraTrackTitle(t), done: trackCounted(t) }))
    const done = tracks.filter((t) => t.done).length
    const row: any = stored.get(era.id)
    return {
      id: era.id, name: era.name, icon: era.icon, description: era.description,
      albums: era.albums, done, total: tracks.length, remaining: tracks.length - done,
      status: row ? (row.used_at ? 'used' : 'lit') : 'dark', tracks,
    }
  })
  return { eraCards, newlyLitEraIds }
}

export interface AgentChargeView {
  hoursRemaining: number
  isDark: boolean
  autoFeed: boolean
  chargeCells: number
  // Lifetime totals, not just the current wallet balance — see
  // lifetimeChargeCellsEarned's own doc comment for why these exist. Two
  // agents in a row reported "Charge Cells not increasing" when the real
  // cause was auto-feed (or a manual feed) spending each cell within
  // moments of it being earned: the math was right, the wallet just never
  // sat above 0 long enough to look like it moved. chargeCells alone can't
  // tell that story; these two together can ("47 earned, 45 fed, 2 on
  // hand" instead of just "2").
  chargeCellsEarned: number
  chargeCellsSpent: number
  litEras: string[] // ready card ids; retained for older clients
  eraCards: EraCardView[]
  newlyLitEraIds: string[]
  // The real, current streak_freeze_charges count — after any blackout
  // rescue this same call already spent. handlers.ts's buildState reads
  // this instead of its own stale pre-request player.streak_freeze_charges
  // snapshot before calling computeStreak, which spends from (and blindly
  // overwrites) the same pooled counter: without it, a blackout rescue and
  // a streak-gap freeze landing in the same request would have one spend
  // silently erase the other, handing back a charge that was legitimately
  // spent moments earlier in the very same call.
  freezeChargesRemaining: number
}

/** Sum of charge_cells_awarded across EVERY district this agent has ever
 *  activated (restored ones included) — each row's own counter only ever
 *  grows (see creditChargeCells's doc comment: "award only the delta"), so
 *  this total only ever grows too, exactly like lifetime XP. The current
 *  wallet balance (rc_players.charge_cells) is the only thing that ever
 *  goes back down, and only ever from a feed (see the two
 *  rc_*_charge_feed RPCs — there is no other spend path and no refund
 *  path), which makes "spent so far" a pure subtraction: earned - on hand,
 *  no separate ledger needed. */
async function lifetimeChargeCellsEarned(supabase: SupabaseDB, agentNo: string): Promise<number> {
  const { data } = await supabase.from('rc_player_districts').select('charge_cells_awarded').eq('agent_no', agentNo)
  return (data || []).reduce((sum: number, r: any) => sum + (r.charge_cells_awarded || 0), 0)
}

/**
 * The one function handlers.ts calls each poll: catches up auto-feed,
 * activates newly completed Era Cards, evaluates blackout consequences
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
  //
  // chargedUntilMs === null means never fed even once, not "ran dark" —
  // this file's own header comment says so, and the UI promises auto-feed
  // only spends "the moment it runs dark." Requiring chargedUntilMs !== null
  // here (rather than treating null the same as expired) is what makes that
  // true: without it, a brand-new agent who has auto-feed on and earns
  // their first Charge Cell before ever manually feeding would have that
  // cell silently spent — Math.ceil(0 / X) || 1 still charges a full cell
  // for a zero-length gap — with no feed animation or toast, before they
  // were ever actually dark.
  // rc_auto_feed_charge (migrations/…_rc_atomic_charge_feed.sql) does the
  // gap math and the charge_cells/charged_until writes as one locked unit —
  // same "prevent double spends from two taps or devices" reasoning
  // rc_use_lit_era already gets below. This JS-side condition is just a
  // cheap early-exit so a poll that clearly has nothing to do skips the RPC
  // round-trip; the RPC re-checks all of it itself and is the real guard.
  if (row.auto_feed && cells > 0 && chargedUntilMs !== null && chargedUntilMs <= now) {
    const { data, error } = await supabase.rpc('rc_auto_feed_charge', {
      p_agent_no: agentNo, p_hours_per_cell: HOURS_PER_CHARGE_CELL,
    })
    const result = !error && Array.isArray(data) ? data[0] : null
    if (result?.did_feed) {
      chargedUntilMs = new Date(result.charged_until).getTime()
      cells = result.cells_remaining
    }
  }

  const weekly = await computeWeeklyEraCards(supabase, content, agentNo)

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

  const earned = await lifetimeChargeCellsEarned(supabase, agentNo)

  return {
    hoursRemaining: chargedUntilMs ? Math.max(0, (chargedUntilMs - now) / HOUR_MS) : 0,
    isDark,
    autoFeed: row.auto_feed,
    chargeCells: cells,
    chargeCellsEarned: earned,
    chargeCellsSpent: Math.max(0, earned - cells),
    litEras: weekly.eraCards.filter((e) => e.status === 'lit').map((e) => e.id),
    eraCards: weekly.eraCards,
    newlyLitEraIds: weekly.newlyLitEraIds,
    freezeChargesRemaining: freezes,
  }
}

/** Consume one ready weekly Era Card for emergency power. The database RPC
 * marks it used and extends charge in one transaction, preventing double
 * spends from two taps or devices. */
export async function useLitEra(supabase: SupabaseDB, content: GameContent, agentNo: string, eraId: string) {
  eraId = String(eraId || '').trim().toLowerCase()
  if (!ERA_CATALOG.some((e) => e.id === eraId)) return { success: false, error: 'unknown_era' }

  // A completion may have landed since the last game-state poll. Recompute
  // first so a genuinely completed card can be used immediately.
  await computeWeeklyEraCards(supabase, content, agentNo)
  const weekKey = kstWeekKey(todayKst())
  const { data, error } = await supabase.rpc('rc_use_lit_era', {
    p_agent_no: agentNo, p_era_id: eraId, p_week_key: weekKey, p_hours: HOURS_PER_LIT_ERA,
  })
  if (error) return { success: false, error: error.message }
  if (!data) return { success: false, error: 'era_card_not_ready' }
  return { success: true, eraId, hoursAdded: HOURS_PER_LIT_ERA, chargedUntil: data }
}

/** Spends Charge Cells to extend charged_until — stacks forward from
 *  whichever is later, current expiry or now, same "adding wood extends the
 *  fire further, doesn't reset it" logic as feeding an actual fire.
 *  rc_feed_charge does the check-and-spend atomically (same "prevent double
 *  spends from two taps or devices" reasoning as rc_use_lit_era) — a plain
 *  JS read-then-write here could otherwise lose a deduction to a
 *  concurrent auto-feed check landing at the same instant. */
export async function feedCharge(supabase: SupabaseDB, agentNo: string, cellsToSpend: number) {
  cellsToSpend = Math.max(0, Math.floor(cellsToSpend))
  if (!cellsToSpend) return { success: false, error: 'invalid_amount' }

  await getOrCreateRow(supabase, agentNo) // ensures a row exists for the RPC's upsert to find/update
  const { data, error } = await supabase.rpc('rc_feed_charge', {
    p_agent_no: agentNo, p_cells_to_spend: cellsToSpend, p_hours_per_cell: HOURS_PER_CHARGE_CELL,
  })
  if (error) return { success: false, error: error.message }
  const row = Array.isArray(data) ? data[0] : null
  if (!row) return { success: false, error: 'not_enough_charge_cells' }
  const hoursAdded = cellsToSpend * HOURS_PER_CHARGE_CELL
  // Unlike the feed's other event types, feeding is a real, repeatable
  // action (not a one-time completion) — rc_feed_charge's own atomicity is
  // what prevents a double-spend, so this dedup_key just needs to be unique
  // per call, not tied to a natural "only once ever" identity.
  await logFeedEvent(supabase, agentNo, 'bomb_fed', { hoursAdded },
    `bomb-fed:${agentNo}:${Date.now()}`)
  return { success: true, hoursAdded, chargedUntil: row.charged_until }
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
