// Live City Feed — see migrations/048_rc_feed_events.sql for the "why".
//
// Every call site logs an event with the SAME dedup_key already used for
// that moment's one-time XP/badge award elsewhere in the codebase (prefixed
// `feed:` to keep the namespace separate from rc_xp_ledger's own keys) — so
// Postgres's own ON CONFLICT DO NOTHING is what guarantees exactly one feed
// row per real completion, with no new latch state to track anywhere.
//
// Deliberately excludes anything js/share.js already treats as unleakable —
// district names, old-agent "Guardian" handles, memory text. Payloads only
// ever carry codename-safe, already-public data (ward names are already
// shown in the existing share card, so those are fine).

import type { SupabaseDB } from './config.ts'

export type FeedEventType =
  | 'district_restored' | 'ward_progress' | 'ward_completed'
  | 'level_up' | 'side_mission_daily' | 'side_mission_weekly' | 'bomb_fed'
  | 'streak_badge' | 'reconnect_completed' | 'era_lit' | 'item_dropped' | 'ticket_claimed'

export async function logFeedEvent(
  supabase: SupabaseDB,
  agentNo: string,
  eventType: FeedEventType,
  payload: Record<string, unknown>,
  dedupKey: string,
) {
  await supabase.from('rc_feed_events').upsert(
    { agent_no: agentNo, event_type: eventType, payload, dedup_key: `feed:${dedupKey}` },
    { onConflict: 'dedup_key', ignoreDuplicates: true },
  )
}

// How recently someone had to poll to still count as "here right now" — the
// live client polls every 90s (main.js), so anything comfortably past two
// polls means the tab is closed or backgrounded, not just between requests.
// Exported so reconnect-missions.ts's invite candidates can use the exact
// same cutoff a "N agents active now" claim uses elsewhere — one definition
// of "online," not two that could quietly drift apart.
export const ONLINE_WINDOW_MS = 3 * 60 * 1000

/** Marks this agent as currently online — called once per real poll
 *  (buildState, handlers.ts), never from the background sync job
 *  (sync-all.ts only ever calls ensureDailyRollups directly, not buildState).
 *  That distinction is what makes this a real presence signal instead of
 *  another activity proxy: unlike raw_streams, which the hourly cron writes
 *  for every agent whether or not they've opened anything, last_seen_at only
 *  ever moves from a live app request. Best-effort — a failed write here
 *  should never break the poll it's riding on. */
export async function markOnline(supabase: SupabaseDB, agentNo: string): Promise<void> {
  await supabase.from('rc_players').update({ last_seen_at: new Date().toISOString() }).eq('agent_no', agentNo)
}

export interface OnlineNow {
  count: number
  codenames: string[]
}

/** Who's genuinely here right now — count plus a few real codenames to name,
 *  not just a number. Ordered most-recent-first so the names shown are the
 *  agents who polled most recently, not an arbitrary sample. */
export async function getOnlineNow(supabase: SupabaseDB, sampleSize = 6): Promise<OnlineNow> {
  const since = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString()
  const { data, count } = await supabase.from('rc_players')
    .select('codename', { count: 'exact' })
    .eq('appear_offline', false)
    .gte('last_seen_at', since)
    .order('last_seen_at', { ascending: false })
    .limit(sampleSize)
  return { count: count || 0, codenames: (data || []).map((r: any) => r.codename) }
}

export interface FeedEntry {
  agentNo: string
  codename: string
  eventType: FeedEventType
  payload: Record<string, unknown>
  createdAt: string
}

/** Last N events network-wide, codenames resolved fresh at read time (not
 *  baked into the row at write time) so a later codename change never
 *  leaves a stale identity sitting in old feed entries. */
export async function getCityFeed(supabase: SupabaseDB, limit = 20): Promise<FeedEntry[]> {
  const { data: rows } = await supabase.from('rc_feed_events')
    .select('agent_no, event_type, payload, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (!rows || !rows.length) return []

  const agentNos = [...new Set(rows.map((r: any) => r.agent_no))]
  const { data: players } = await supabase.from('rc_players').select('agent_no, codename').in('agent_no', agentNos)
  const codenameByAgent = new Map<string, string>((players || []).map((p: any) => [p.agent_no, p.codename]))

  // The agent number is the secret half of an agent's identity (onboarding
  // warns never to reveal it) — never fall back to it here if a codename
  // lookup somehow comes up empty. "A signal" reads fine in-fiction and
  // leaks nothing.
  return rows
    .map((r: any) => ({
      agentNo: r.agent_no,
      codename: codenameByAgent.get(r.agent_no) || 'A signal',
      eventType: r.event_type,
      payload: r.payload || {},
      createdAt: r.created_at,
    }))
}
