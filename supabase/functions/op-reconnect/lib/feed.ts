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
