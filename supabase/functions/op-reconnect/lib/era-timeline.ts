// Era Timeline — a network-wide (not per-team, not per-district) rollup of
// how much of BTS's discography the whole community has streamed, era by
// era. There's no team structure here to compare across, and rc_goals'
// track/album labels are freeform text an admin types per district (no era
// metadata at all — see goals.ts), so this can't be built from goal
// completions. Instead it reads raw counted streams straight off
// rc_daily_activity, the same ground truth bomb.ts's communityStreams()
// already trusts.
//
// Deliberately cumulative and all-time, unlike the ARMY Bomb's rolling
// charge window — a discography completion tracker that reset every day
// would defeat the point of it. The relationship actually runs the other
// way now too: bomb.ts's chargeWindowDays() reads completedEraCount() below
// to extend the Bomb's own window by a day per era the network finishes.
//
// A track "unlocks" once the community's combined counted plays for it
// cross eraTrackThreshold. "Counted" means the same thing it means
// everywhere else (BTS-artist-allowlisted) — the per-agent variety cap
// doesn't apply here, since this measures reach, not something farmable.

import type { SupabaseDB, GameContent } from './config.ts'
import { normKeyFull, artistAllowed } from './text.ts'

interface EraDef { id: string; name: string; icon: string; tracks: string[] }

// Real BTS discography, grouped the way the fandom already talks about
// eras — a handful of era-defining tracks each, not the full tracklist.
// This is a "has the network touched this era" pulse, not a
// completionist grind through every b-side.
const ERA_CATALOG: EraDef[] = [
  { id: 'school', name: 'School Trilogy', icon: '📗', tracks: ['No More Dream', 'N.O', 'Boy In Luv'] },
  { id: 'darkwild', name: 'Dark & Wild', icon: '🌙', tracks: ['Danger', 'War of Hormone', 'Rain'] },
  { id: 'hyyh', name: 'HYYH', icon: '🌸', tracks: ['I Need U', 'Run', 'Fire', 'Save Me'] },
  { id: 'wings', name: 'Wings / YNWA', icon: '🦋', tracks: ['Blood Sweat & Tears', 'Spring Day', 'Not Today'] },
  { id: 'ly', name: 'Love Yourself', icon: '💜', tracks: ['DNA', 'Fake Love', 'Idol'] },
  { id: 'mots', name: 'Map of the Soul', icon: '📖', tracks: ['Boy With Luv', 'ON', 'Black Swan'] },
  { id: 'anthology', name: 'The Anthology', icon: '💽', tracks: ['Dynamite', 'Butter', 'Life Goes On', 'Yet To Come'] },
  // ARIRANG — this season's own comeback, now actually released. Tracklist
  // sourced from the arirang-btsbackend project's own ARIRANG_TRACKS list
  // (the canonical source for this album elsewhere in this game's universe),
  // not guessed. A handful of the 14 for the same "pulse, not completionist
  // grind" reason the rest of ERA_CATALOG only samples a few tracks each.
  { id: 'arirang', name: 'ARIRANG', icon: '📡', tracks: ['Swim', 'Body to Body', 'Hooligan', 'Aliens', 'FYA', 'Merry Go Round'] },
]

export interface EraProgress { id: string; name: string; icon: string; done: number; total: number }
export interface EraTimeline { eras: EraProgress[] }

/** Config-driven so an admin can raise/lower the unlock bar without a
 *  deploy — mirrors bombCfg's spread-over-defaults pattern in bomb.ts. */
function eraCfg(content: GameContent) {
  return {
    trackThreshold: 20,
    ...(content.config.era_timeline || {}),
  }
}

// A full-table scan of rc_daily_activity is heavier than the bomb's
// 2-day-windowed one, and every connected player's 90s poll would otherwise
// re-run it. A short in-memory cache (this module's instance is warm across
// requests on the edge runtime) keeps DB load flat regardless of player
// count — 60s of staleness on a cumulative, all-time stat is invisible.
let cache: { at: number; value: EraTimeline } | null = null
const CACHE_MS = 60_000

export async function getEraTimeline(supabase: SupabaseDB, content: GameContent): Promise<EraTimeline> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value

  const cfg = eraCfg(content)
  const allow: string[] = content.config.bts_artists || []

  const { data } = await supabase.from('rc_daily_activity').select('track_counts')

  // normKeyFull(track title) -> total counted plays, pooled across every
  // agent and every day on record.
  const totals = new Map<string, number>()
  for (const row of data || []) {
    const bucket = row.track_counts || {}
    for (const key of Object.keys(bucket)) {
      const entry = bucket[key]
      const counted = Object.entries(entry?.a || {}).reduce(
        (s: number, [artist, cnt]) => s + (artistAllowed(artist, allow) ? (cnt as number) : 0), 0)
      if (counted) totals.set(key, (totals.get(key) || 0) + counted)
    }
  }

  const eraDone = (titles: string[]) =>
    titles.reduce((n, t) => n + ((totals.get(normKeyFull(t)) || 0) >= cfg.trackThreshold ? 1 : 0), 0)

  const eras: EraProgress[] = ERA_CATALOG.map((e) => ({
    id: e.id, name: e.name, icon: e.icon, total: e.tracks.length, done: eraDone(e.tracks),
  }))

  cache = { at: Date.now(), value: { eras } }
  return cache.value
}

/** How many eras the network has fully unlocked — bomb.ts reads this to
 *  extend the charge window as a network-wide reward for collective
 *  discography completion, not just per-track counting. */
export function completedEraCount(timeline: EraTimeline): number {
  return timeline.eras.filter((e) => e.total > 0 && e.done >= e.total).length
}
