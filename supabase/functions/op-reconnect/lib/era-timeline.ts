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

export interface EraDef { id: string; name: string; icon: string; description: string; tracks: string[] }

// Real BTS discography, grouped the way the arirang-btsbackend project's own
// ERAS dict names/describes them — era names, icons and descriptions taken
// from there verbatim. Its per-era neon colors were left out: this game's
// CSS has a deliberate two-hue-only palette (see reconnect.css's top-of-file
// discipline note), and giving every era its own color would break that on
// purpose, not by oversight. Its dated SCHEDULE (a day-by-day reveal
// countdown) was left out too — that's a different app's mechanic; this
// Era Timeline is cumulative and undated by design (see below).
//
// Tracklists are full mainline discography (sourced from that same
// project's ALBUM_TRACKS), deduplicated across an era's own repackages
// (e.g. HYYH pt.1/pt.2/Young Forever share plenty of tracks) and with
// Skit/Intro/Interlude/Outro fragments dropped, since those are ~30s
// spoken pieces nobody meaningfully "streams" the way a song gets streamed.
// Japanese-language repackages (Wake Up, Youth, Face Yourself, MOTS 7
// ~The Journey~) contribute only their genuinely original exclusive tracks —
// their SCHEDULE gives these their own phase, so they're real content here,
// just not the re-sung Korean songs already counted under the mainline
// album. Proof (2022's anthology compilation) only contributes the handful
// of tracks actually exclusive to it, filed under The Anthology since
// that's literally what the compilation is.
// Exported so agent-charge.ts's Lit-up Eras can reuse the same track
// catalog for its per-agent, per-week check.
export const ERA_CATALOG: EraDef[] = [
  {
    id: 'school', name: 'School Trilogy', icon: '📚',
    description: 'The foundation: Dreams, rebellion, and social commentary.',
    // 2 Cool 4 Skool + O!RUL8,2? + Skool Luv Affair
    tracks: [
      'We Are Bulletproof Pt.2', 'No More Dream', 'Like',
      'N.O', 'We On', 'If I Ruled the World', 'Coffee', 'BTS Cypher Pt.1', 'Attack on Bangtan', 'Paldogangsan',
      'Boy In Luv', 'Where You From', 'Just One Day', 'Tomorrow', 'BTS Cypher Pt.2: Triptych', 'Spine Breaker', 'Jump',
    ],
  },
  {
    id: 'darkwild', name: 'Dark & Wild / Bridge', icon: '🌙',
    description: 'The transition into a deeper, more mature identity.',
    // Dark & Wild + Wake Up's exclusive originals (its own tracklist is
    // otherwise Japanese re-recordings of Dark & Wild/earlier singles)
    tracks: [
      'BTS Cypher PT.3: KILLER', 'Danger', 'Let Me Know', 'War Of Hormone', 'Look Here', 'Hip Hop Phile',
      'So 4 More', 'Could You Turn Off Your Cell Phone', '24/7=heaven', 'Rain', 'Embarrassed',
      'The Stars',
    ],
  },
  {
    id: 'hyyh', name: 'HYYH (The Youth Era)', icon: '🌸',
    description: 'The Most Beautiful Moment in Life: Fragility and growth.',
    // pt.1 + pt.2 + Young Forever, deduped
    tracks: [
      'I Need U', 'Hold Me Tight', 'Dope', 'Boyz With Fun', 'Converse High', 'Moving On',
      'Run', 'Butterfly', 'Whalien 52', 'Ma City', 'Silver Spoon', 'Autumn Leaves',
      'Save Me', 'Burning Up (Fire)', 'House Of Cards', 'Love Is Not Over',
    ],
  },
  {
    id: 'wings', name: 'Wings / YNWA', icon: '🦋',
    description: 'Temptation, artistic high-concepts, and learning to fly.',
    // Youth's exclusive originals + Wings + You Never Walk Alone
    tracks: [
      'Good Day', 'For You', 'Wishing On A Star',
      'Blood Sweat & Tears', 'Begin', 'Lie', 'Stigma', 'First Love', 'Reflection', 'MAMA',
      'Awake', 'Lost', 'BTS Cypher 4', 'Am I Wrong', '21st Century Girl', '2! 3!',
      'Spring Day', 'Not Today', 'A Supplementary Story: You Never Walk Alone',
    ],
  },
  {
    id: 'ly', name: 'Love Yourself Series', icon: '💜',
    description: 'The global message of self-love and acceptance.',
    // Her + Face Yourself's exclusive originals + Tear + Answer, deduped
    tracks: [
      'DNA', 'Pied Piper', 'Best Of Me', 'Dimple', 'Go Go', 'MIC Drop',
      "Don't Leave Me", 'Crystal Snow', 'Let Go',
      'Fake Love', 'The Truth Untold', '134340', 'Paradise', 'Love Maze', 'Magic Shop', 'Airplane Pt.2', 'Anpanman', 'So What',
      'Idol', 'Euphoria', 'Trivia 起 : Just Dance', 'Epiphany', 'Trivia 承 : Love',
      'Tear', "I'm Fine", 'Answer : Love Myself', 'Her', 'Trivia 轉 : Seesaw', 'Singularity',
    ],
  },
  {
    id: 'mots', name: 'Map of the Soul', icon: '🗺️',
    description: 'The psychological journey into the Shadow and the Ego.',
    // Persona + 7 + 7 ~The Journey~'s exclusive originals, deduped
    tracks: [
      'Boy With Luv', 'Mikrokosmos', 'Make It Right', 'HOME', 'Jamais Vu', 'Dionysus',
      'Black Swan', 'Filter', 'My Time', 'Louder Than Bombs', 'ON', 'UGH!',
      "00:00 (Zero O'Clock)", 'Inner Child', 'Friends', 'Moon', 'Respect', 'We Are Bulletproof : The Eternal',
      'Stay Gold', 'Lights', 'Your Eyes Tell',
    ],
  },
  {
    id: 'anthology', name: 'The Anthology (Chapter 1 Finale)', icon: '💎',
    description: 'Retrospective of 9 years and comfort during the pandemic.',
    // BE + the era's standalone singles + Proof's own exclusive additions
    tracks: [
      'Life Goes On', 'Fly To My Room', 'Blue & Grey', 'Telepathy', 'Dis-ease', 'Stay',
      'Dynamite', 'Butter', 'Yet To Come',
      'Born Singer', 'For Youth', 'Run BTS',
    ],
  },
  {
    id: 'arirang', name: 'ARIRANG', icon: '🎆',
    description: 'The beginning of the New Era.',
    // Full tracklist — this season's own comeback, now actually released.
    tracks: [
      'Normal', 'Merry Go Round', '2.0', 'Body To Body', 'FYA', 'Hooligan',
      'Into The Sun', 'Like Animals', 'No. 29', 'One More Night', 'Please', 'Swim',
      "They Don't Know 'Bout Us", 'Aliens',
    ],
  },
]

export interface EraProgress { id: string; name: string; icon: string; description: string; done: number; total: number }
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
    id: e.id, name: e.name, icon: e.icon, description: e.description,
    total: e.tracks.length, done: eraDone(e.tracks),
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
