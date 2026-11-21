// Which stored plays a Red Zone event may count, per agent.
//
// A play only counts from the source the agent has selected, so two linked
// providers can never count one listen twice. A ListenBrainz agent is the
// exception that bit AGENT273 (Nov 21 2026, SWIM + Haegeum): Pano Scrobbler
// and Web Scrobbler send straight to us ('lb-like' / 'webhook'), and daily
// counting already reads those rows next to the ListenBrainz ones, while Red
// Zone accepted only 'listenbrainz' rows — 52 target plays, 0 counted.
//
// So for a ListenBrainz agent the direct feeds count too. For every agent
// whose plays come from more than one feed, each second report of one listen
// is removed with the same withoutCopies() daily counting uses (Pano often
// writes to ListenBrainz as well as to us; some direct agents run Web
// Scrobbler and Pano at once).

import { withoutCopies } from './listen-copies.ts'

export function redZoneSourceAllowed(selected: string | undefined, stored: string | null | undefined) {
  if (!selected) return false
  if (selected === 'direct') return stored === 'webhook' || stored === 'lb-like'
  return stored === selected
}

const DIRECT_FEEDS = new Set(['webhook', 'lb-like'])

export function redZoneFeedAllowed(selected: string | undefined, stored: string | null | undefined) {
  if (selected === 'listenbrainz' && DIRECT_FEEDS.has(String(stored || ''))) return true
  return redZoneSourceAllowed(selected, stored)
}

interface FeedRow {
  agent_no: string
  track_name: string
  listened_at: number
  source?: string | null
  source_client?: string | null
  source_clients?: string[] | null
}

/** Rows (chronological, as read) an event may count: allowed feeds only, one
 *  report per listen. Keeps the input order, so countRedZoneRows still sees
 *  plays in the order they happened. */
export function redZoneEligibleRows<T extends FeedRow>(rows: T[], sources: Map<string, string>): T[] {
  const byAgent = new Map<string, T[]>()
  for (const row of rows) {
    if (!row?.agent_no || !redZoneFeedAllowed(sources.get(row.agent_no), row.source)) continue
    const list = byAgent.get(row.agent_no)
    if (list) list.push(row)
    else byAgent.set(row.agent_no, [row])
  }
  const kept = new Set<T>()
  for (const list of byAgent.values()) {
    // Any agent whose plays arrive from more than one feed (a ListenBrainz
    // agent's Pano plays, or a direct agent running Web Scrobbler and Pano
    // side by side) is checked for copies, as daily counting does.
    // AGENT005, Nov 21 2026: 14 listens, each reported by both apps ~80 s
    // apart, had counted 28.
    const mixed = new Set(list.map((r) => r.source || '')).size > 1
    for (const row of mixed ? withoutCopies(list) : list) kept.add(row)
  }
  return rows.filter((row) => kept.has(row))
}
