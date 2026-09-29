// Public campaign stream totals — the two numbers on the landing page.
//
// These are the ONLY numbers a stranger sees before signing up, so two
// things matter more than anything else here:
//
// 1. They are ReConnect's own counted streams. Nothing in this codebase
//    knows a real-world Spotify/YouTube play count — there is no external
//    total anywhere, by design (see spotify-shared.ts, which deliberately
//    left the chart-snapshot code behind). So these must never be rendered
//    in a way that reads as BTS's global totals; the landing page carries a
//    "logged by agents on ReConnect" line under them for exactly that
//    reason, and that line is not decoration.
// 2. They agree with what the game itself counts. Every key below comes
//    from the existing authoritative definitions rather than a second list
//    typed out here — ERA_CATALOG for the ARIRANG album, ROAD_TO_1B_TRACKS
//    for the Signal Sweep four. A campaign list that drifts from the one
//    gameplay uses would put a wrong number on the front door.
//
// SWIM is deliberately in BOTH campaigns: it is an ARIRANG album track and
// one of the four Road-to-1B focus songs. The two totals are computed and
// labelled separately and must NEVER be added together — their sum
// double-counts SWIM by ~119k plays.

import type { SupabaseDB, GameContent } from './config.ts'
import { trackArtistOverrides } from './config.ts'
import { countedArtistPlays } from './text.ts'
import { cachedJson } from './cache.ts'
import { ERA_CATALOG, eraTrackKeys } from './era-timeline.ts'
import { ROAD_TO_1B_TRACKS } from './side-missions.ts'

export interface CampaignStreams {
  /** Counted plays across the 14 tracks of the ARIRANG album. */
  arirang: number
  /** Counted plays across the four current Road-to-1B focus tracks. */
  roadTo1B: number
}

// Same 60s as the era timeline's own cache. These are cumulative all-time
// totals in the hundreds of thousands — a minute of staleness is invisible,
// and the hourly scrobble sync moves them far more than the TTL does.
const CACHE_MS = 60_000

/** Every normalized bucket key that counts as an ARIRANG album play.
 *  Read from ERA_CATALOG (the discography catalog the Era Timeline itself
 *  counts against) rather than recelebrate-tracks.js's ARIRANG_TRACKS —
 *  that one is a DISPLAY list in official capitalization for the Love Song
 *  picker, with no alias mechanism. Same 14 songs; only this one can carry
 *  the per-track aliases a scrobble source might report instead. */
export function arirangKeys(): string[] {
  const era = ERA_CATALOG.find((e) => e.id === 'arirang')
  // De-duplicated: summing a key twice would inflate the public number,
  // which is the one thing a front-door stat must never do.
  return [...new Set((era?.tracks || []).flatMap(eraTrackKeys).filter(Boolean))]
}

/** Every normalized bucket key that counts as a Road-to-1B play. */
export function roadTo1BKeys(): string[] {
  return [...new Set(ROAD_TO_1B_TRACKS.flatMap((t) => t.keys).filter(Boolean))]
}

/** Sums one campaign's keys out of a per-key artist breakdown.
 *
 *  countedArtistPlays is applied to EVERY key, not just the btsOnly ones.
 *  Signal Sweep itself only artist-filters SWIM (see side-missions.ts's
 *  countTrack), so this is marginally stricter than the in-game weekly
 *  grid — measured against production it excludes 188 plays on SWIM (Chase
 *  Atlantic's same-key song) and 2 on Wild Flower, out of ~278k. 0.07% is
 *  a fair price for a public number that can never credit another artist's
 *  track to BTS. Passing the key through also keeps per-track collaborator
 *  overrides working (Wild Flower → Youjeen). */
function sumCampaign(totals: Map<string, number>, keys: string[]): number {
  let n = 0
  for (const key of keys) n += totals.get(key) || 0
  return n
}

async function computeCampaignStreams(
  supabase: SupabaseDB,
  content: GameContent,
): Promise<CampaignStreams> {
  const allow: string[] = content.config.bts_artists || []
  const overrides = trackArtistOverrides(content)

  const arirang = arirangKeys()
  const road = roadTo1BKeys()
  const wanted = new Set([...arirang, ...road])

  // Only the ~18 keys these two campaigns care about are counted — the
  // table carries ~6,900 distinct ones, and pooling all of them here would
  // be a second copy of the era timeline's job for no benefit. Each row's
  // contribution is reduced to a number immediately rather than collected,
  // so the scan holds one integer per key regardless of how many days of
  // activity accumulate.
  const totals = new Map<string, number>()

  // Paginated, and this is not optional. A plain .select() is capped by
  // PostgREST at 1000 rows: against 4,223 rows of activity the first
  // deployment of this reported 91,656 ARIRANG streams instead of 440,505,
  // silently, with no error — a public number missing four fifths of the
  // community's work. The explicit .order() matters too: range pagination
  // over an unordered result can repeat or skip rows between pages.
  const PAGE = 1000
  const MAX_PAGES = 500 // ~500k rows; a guard against an infinite loop, never reached in practice
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE
    const { data, error } = await supabase
      .from('rc_daily_activity')
      .select('track_counts')
      .order('agent_no', { ascending: true })
      .order('kst_date', { ascending: true })
      .range(from, from + PAGE - 1)
    // Fail loudly rather than publishing a partial total: getPublicStats
    // turns a throw into a dash, which is honest. A short count is not.
    if (error) throw new Error(`campaign_streams_scan_failed:${error.message}`)
    for (const row of data || []) {
      const bucket = row.track_counts || {}
      for (const key of Object.keys(bucket)) {
        if (!wanted.has(key)) continue
        const counted = countedArtistPlays(bucket[key]?.a, allow, key, overrides)
        if (counted) totals.set(key, (totals.get(key) || 0) + counted)
      }
    }
    if (!data || data.length < PAGE) break
  }

  return {
    arirang: sumCampaign(totals, arirang),
    roadTo1B: sumCampaign(totals, road),
  }
}

/** Cached because this is a full scan of rc_daily_activity and the landing
 *  page is unauthenticated — anyone who finds the URL can ask for it. The
 *  scan is deliberately its own rather than shared with getEraTimeline's:
 *  this is public, gameplay-independent code, and the era timeline feeds
 *  the ARMY Bomb's charge window. Keeping them separate costs one extra
 *  cached scan a minute and buys total isolation from gameplay. */
export async function getCampaignStreams(
  supabase: SupabaseDB,
  content: GameContent,
): Promise<CampaignStreams> {
  return cachedJson(supabase, 'campaign_streams', CACHE_MS, () => computeCampaignStreams(supabase, content))
}
