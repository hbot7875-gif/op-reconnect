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
import { trackArtistOverrides } from './config.ts'
import { normKeyFull, countedArtistPlays } from './text.ts'

/** A plain string is the common case (one real title, normalizes cleanly).
 *  {title, aliases} is for the rare case where different scrobble sources
 *  report the exact same song under genuinely different title strings —
 *  confirmed for "BTS Cypher, Pt. 3: KILLER (feat. Supreme Boi)" vs the
 *  plain "BTS Cypher Pt.3: Killer" this catalog otherwise uses — same
 *  "keys, not just one string" idea rc_goals' own tracks already use for
 *  exactly this reason. */
export interface EraTrackAliased { title: string; aliases: string[] }
export type EraTrackEntry = string | EraTrackAliased
export interface EraDef { id: string; name: string; icon: string; description: string; albums: string[]; tracks: EraTrackEntry[] }

export function eraTrackTitle(t: EraTrackEntry): string {
  return typeof t === 'string' ? t : t.title
}

/** Every normalized key that should count as a play of this track. */
export function eraTrackKeys(t: EraTrackEntry): string[] {
  if (typeof t === 'string') return [normKeyFull(t)]
  const keys = new Set<string>([normKeyFull(t.title)])
  for (const a of t.aliases || []) {
    const k = normKeyFull(a)
    if (k) keys.add(k)
  }
  return [...keys]
}

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
    albums: ['2 Cool 4 Skool', 'O!RUL8,2?', 'Skool Luv Affair'],
    tracks: [
      // Same comma-vs-period "Pt." punctuation split as Dark & Wild's Cypher
      // Pt.3 below — AGENT039's own scrobbles were 100% the comma form
      // ("We Are Bulletproof, Pt. 2"), so this track never crossed the
      // threshold for them at all despite real, repeated plays. Confirmed
      // via a network-wide audit (docs/bug-resolution-log.md) that Cypher
      // Pt.1 and Pt.2: Triptych below have the exact same split.
      { title: 'We Are Bulletproof Pt.2', aliases: ['We Are Bulletproof, Pt. 2'] },
      'No More Dream', 'Like',
      'N.O', 'We On', 'If I Ruled the World', 'Coffee',
      { title: 'BTS Cypher Pt.1', aliases: ['BTS Cypher, Pt. 1'] },
      'Attack on Bangtan',
      // "Paldogangsan" (one word) vs "Paldo Gangsan" (two) — not a
      // punctuation split, but the same "real metadata disagrees on the
      // title" root cause, so it gets the same alias treatment.
      { title: 'Paldogangsan', aliases: ['Paldo Gangsan'] },
      'Boy In Luv', 'Where You From', 'Just One Day', 'Tomorrow',
      { title: 'BTS Cypher Pt.2: Triptych', aliases: ['BTS Cypher, Pt. 2: Triptych'] },
      'Spine Breaker', 'Jump',
    ],
  },
  {
    id: 'darkwild', name: 'Dark & Wild / Bridge', icon: '🌙',
    description: 'The transition into a deeper, more mature identity.',
    // Most of Wake Up's tracklist is Japanese re-recordings of Dark &
    // Wild/earlier singles (Jump/Danger/Boy In Luv/Just One Day/No More
    // Dream/N.O, all "- Japanese Ver." of songs already counted below) —
    // those don't get their own entries. It isn't ONLY a re-recording disc
    // though: "The Stars", the "Wake Up" title track, and "line!"/"line!Pt.2
    // - Ano Bashode -" have no Korean-language equivalent anywhere in this
    // era's other albums, so all four are real exclusive content and are
    // counted below same as any other track (confirmed against the actual
    // Wake Up Standard Edition tracklist).
    albums: ['Dark & Wild', 'Wake Up'],
    tracks: [
      // Two genuinely different metadata variants exist for this one in the
      // wild — some sources report the plain title, others the "feat.
      // Supreme Boi" comma-punctuated one — confirmed via a real agent's
      // scrobbles that never matched the plain-string form alone.
      { title: 'BTS Cypher PT.3: KILLER', aliases: ['BTS Cypher, Pt. 3: KILLER (feat. Supreme Boi)'] },
      'Danger', 'Let Me Know', 'War Of Hormone', 'Look Here', 'Hip Hop Phile',
      // "So 4 More" was previously written off as "AGENT027 genuinely never
      // streamed it" (see docs/bug-resolution-log.md) — wrong. Musicat
      // reports this track under BTS's own original Korean-era title,
      // "2nd Grade" (2학년), a completely different-looking string with no
      // word overlap at all, so it was never going to surface from a
      // title-similarity audit either — only came to light from a real
      // scrobble-history screenshot. She had 6 real plays under that title
      // the whole time.
      { title: 'So 4 More', aliases: ['2nd Grade'] },
      'Could You Turn Off Your Cell Phone', '24/7=heaven', 'Rain', 'Embarrassed',
      'The Stars', 'Wake Up', 'line!', 'line!Pt.2 - Ano Bashode -',
    ],
  },
  {
    id: 'hyyh', name: 'HYYH (The Youth Era)', icon: '🌸',
    description: 'The Most Beautiful Moment in Life: Fragility and growth.',
    // pt.1 + pt.2 + Young Forever — every track on all three releases,
    // Intro/Skit/Outro/Epilogue fragments included this time (verified
    // against the real Spotify tracklists), not deduped down to "real
    // songs only" the way every other era here still is. The alternate
    // mixes below (Prologue/Alternative/Ballad/Remix/Full Length Edition)
    // still normalize down to the same key as their base track — a
    // trailing "(...)" is stripped before matching, same as everywhere
    // else in this catalog — so they can't require a separately-provable
    // stream from that base version; they're listed anyway so the total
    // reflects every track that's actually on the release, not a curated
    // subset of it.
    albums: ['The Most Beautiful Moment in Life Pt.1', 'The Most Beautiful Moment in Life Pt.2', 'The Most Beautiful Moment in Life: Young Forever'],
    tracks: [
      'Intro: The Most Beautiful Moment in Life',
      'I Need U', 'Hold Me Tight', 'Skit: Expectation!', 'Dope', 'Boyz With Fun', 'Converse High', 'Moving On',
      'Outro: Love Is Not Over',
      'Intro: Never Mind',
      'Run', 'Butterfly', 'Whalien 52', 'Ma City', 'Silver Spoon', 'Skit: One Night in a Strange City', 'Autumn Leaves',
      'Outro: House of Cards',
      'Save Me', 'Burning Up (Fire)', 'House Of Cards', 'Love Is Not Over',
      'Epilogue: Young Forever',
      'Butterfly (Prologue Mix)', 'House of Cards (Full Length Edition)', 'Love Is Not Over (Full Length Edition)',
      'I Need U (Urban Mix)', 'I Need U (Remix)', 'Run (Ballad Mix)', 'Run (Alternative Mix)', 'Butterfly (Alternative Mix)',
    ],
  },
  {
    id: 'wings', name: 'Wings / YNWA', icon: '🦋',
    description: 'Temptation, artistic high-concepts, and learning to fly.',
    // Every track on all three releases (verified against the real
    // Spotify tracklists), same "don't skip any track" treatment as HYYH
    // above — Intro/Interlude/Outro fragments included, and Youth's
    // Japanese re-recordings listed even though their base song belongs
    // to a different era (they're still real, distinct content on THIS
    // album). You Never Walk Alone is Wings' own repackage, so its first
    // 14 tracks are exact duplicates of Wings' own — not re-listed twice.
    albums: ['Youth', 'Wings', 'You Never Walk Alone'],
    tracks: [
      'Introduction : Youth', 'Run -Japanese Ver.-', 'Fire -Japanese Ver.-',
      'Dope -Japanese Ver.-', 'Good Day', 'Save Me -Japanese Ver.-',
      'Boyz with Fun (Japanese Ver.)', 'Pepse (Japanese Ver.)', 'Wishing On A Star',
      'Butterfly -Japanese Ver.-', 'For You', 'I Need U (Japanese Ver.)',
      'Epilogue : Young Forever -Japanese Ver.-',
      'Intro: Boy Meets Evil',
      'Blood Sweat & Tears', 'Begin', 'Lie', 'Stigma', 'First Love', 'Reflection', 'MAMA',
      'Awake', 'Lost', 'BTS Cypher 4', 'Am I Wrong', '21st Century Girl', '2! 3!',
      'Interlude: Wings',
      'Spring Day', 'Not Today', 'Outro: Wings', 'A Supplementary Story: You Never Walk Alone',
    ],
  },
  {
    id: 'ly', name: 'Love Yourself Series', icon: '💜',
    description: 'The global message of self-love and acceptance.',
    // Every track on all four releases, same "don't skip any track"
    // treatment as the eras above — fragments and Japanese re-recordings
    // included (verified against the real Spotify tracklists), even where
    // the re-recording's base song formally belongs to a different era.
    albums: ['Love Yourself: Her', 'Face Yourself', 'Love Yourself: Tear', 'Love Yourself: Answer'],
    tracks: [
      'Intro: Serendipity',
      'DNA', 'Pied Piper', 'Best Of Me', 'Dimple', 'Skit: Billboard Music Awards Speech', 'Go Go', 'MIC Drop',
      'Outro: Her',
      'INTRO : Ringwanderung',
      'Best Of Me - Japanese ver.', '血、汗、涙 - Japanese ver.', 'DNA - Japanese ver.', 'Not Today - Japanese ver.',
      'MIC Drop - Japanese ver.',
      "Don't Leave Me",
      'Go Go - Japanese ver.', 'Crystal Snow', 'Spring Day - Japanese ver.', 'Let Go', 'OUTRO : Crack',
      'Intro: Singularity',
      'Fake Love', 'The Truth Untold', '134340', 'Paradise', 'Love Maze', 'Magic Shop',
      { title: 'Airplane Pt.2', aliases: ['Airplane, Pt. 2'] },
      'Anpanman', 'So What',
      'Outro: Tear',
      'Idol', 'Euphoria',
      'Serendipity (Full Length Edition)', 'DNA (Pedal 2 LA Mix)', 'FAKE LOVE (Rocking Vibe Mix)',
      'MIC Drop (Steve Aoki Remix) (Full Length Edition)', 'IDOL (Featuring Nicki Minaj)',
      // Hanja ordinal markers (起/承/轉) in these three titles are a known
      // source of scrobble-source disagreement — same bug shape as BTS
      // Cypher Pt.3 / We Are Bulletproof Pt.2 above. AGENT046 reported Just
      // Dance and Seesaw not counting toward the Love Yourself card;
      // checked her actual rc_daily_activity keys rather than guessing —
      // her source doesn't drop the hanja, it ROMANIZES it: "trivia ki
      // just dance" and "trivia ten seesaw" (承/Love came through with the
      // hanja intact and needed no fix, which is why only these two were
      // reported broken). Aliased to the exact strings that normalize to
      // those keys, not the bare English titles a first guess landed on.
      { title: 'Trivia 起 : Just Dance', aliases: ['Trivia 起: Just Dance', 'Trivia ki : Just Dance'] },
      'Epiphany',
      { title: 'Trivia 承 : Love', aliases: ['Trivia 承: Love'] },
      'Tear', "I'm Fine", 'Answer : Love Myself', 'Her',
      { title: 'Trivia 轉 : Seesaw', aliases: ['Trivia 轉: Seesaw', 'Trivia ten : Seesaw'] },
      'Singularity',
    ],
  },
  {
    id: 'mots', name: 'Map of the Soul', icon: '🗺️',
    description: 'The psychological journey into the Shadow and the Ego.',
    // Every track on all three releases (verified against the real
    // Spotify tracklists) — fragments, the "ON (Feat. Sia)" alternate
    // cut, and 7 ~The Journey~'s Japanese re-recordings all included.
    albums: ['Map of the Soul: Persona', 'Map of the Soul: 7', 'Map of the Soul: 7 ~The Journey~'],
    tracks: [
      'Intro : Persona',
      'Boy With Luv', 'Mikrokosmos', 'Make It Right', 'HOME', 'Jamais Vu', 'Dionysus',
      'Interlude : Shadow',
      'Black Swan', 'Filter', 'My Time', 'Louder Than Bombs', 'ON', 'UGH!',
      "00:00 (Zero O'Clock)", 'Inner Child', 'Friends', 'Moon', 'Respect', 'We Are Bulletproof : The Eternal',
      'Outro : Ego', 'ON (Feat. Sia)',
      'Intro : Calling',
      'Stay Gold',
      'Boy With Luv - Japanese ver.', 'Make It Right - Japanese ver.', 'Dionysus - Japanese ver.',
      'IDOL - Japanese ver.', 'Airplane pt.2 - Japanese ver.', 'FAKE LOVE - Japanese ver.',
      'Black Swan - Japanese ver.', 'ON - Japanese ver.',
      'Lights', 'Your Eyes Tell', 'Outro : The Journey',
    ],
  },
  {
    id: 'anthology', name: 'The Anthology (Chapter 1 Finale)', icon: '💎',
    description: 'Retrospective of 9 years and comfort during the pandemic.',
    // BE + the era's standalone singles + Proof's own exclusive additions.
    // BE's tracklist is fully verified against Spotify (its one fragment,
    // 'Skit', is added below); Proof is a 3-disc compilation and the
    // fetched tracklist only returned ~30 of its tracks before cutting
    // off, so its entries below are unchanged from before rather than
    // guessed at — still just the handful actually exclusive to it.
    albums: ['BE', 'Proof'],
    tracks: [
      'Life Goes On', 'Fly To My Room', 'Blue & Grey', 'Skit', 'Telepathy', 'Dis-ease', 'Stay',
      'Dynamite', 'Butter', 'Yet To Come',
      'Born Singer', 'For Youth', 'Run BTS',
    ],
  },
  {
    id: 'arirang', name: 'ARIRANG', icon: '🎆',
    description: 'The beginning of the New Era.',
    // Full tracklist — this season's own comeback, now actually released.
    albums: ['Arirang'],
    tracks: [
      'Normal', 'Merry Go Round', '2.0', 'Body To Body', 'FYA', 'Hooligan',
      'Into The Sun', 'Like Animals', 'No. 29', 'One More Night', 'Please', 'Swim',
      "They Don't Know 'Bout Us", 'Aliens',
    ],
  },
]

export interface EraTrackStatus { title: string; done: boolean }
export interface EraProgress {
  id: string; name: string; icon: string; description: string
  albums: string[]; done: number; total: number; tracks: EraTrackStatus[]
}
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
  const overrides = trackArtistOverrides(content)

  const { data } = await supabase.from('rc_daily_activity').select('track_counts')

  // normKeyFull(track title) -> total counted plays, pooled across every
  // agent and every day on record.
  const totals = new Map<string, number>()
  for (const row of data || []) {
    const bucket = row.track_counts || {}
    for (const key of Object.keys(bucket)) {
      const counted = countedArtistPlays(bucket[key]?.a, allow, key, overrides)
      if (counted) totals.set(key, (totals.get(key) || 0) + counted)
    }
  }

  const trackTotal = (t: EraTrackEntry) => eraTrackKeys(t).reduce((s, k) => s + (totals.get(k) || 0), 0)
  const trackDone = (t: EraTrackEntry) => trackTotal(t) >= cfg.trackThreshold

  const eras: EraProgress[] = ERA_CATALOG.map((e) => {
    const tracks = e.tracks.map((t) => ({ title: eraTrackTitle(t), done: trackDone(t) }))
    return {
      id: e.id, name: e.name, icon: e.icon, description: e.description, albums: e.albums,
      total: tracks.length, done: tracks.filter((t) => t.done).length, tracks,
    }
  })

  cache = { at: Date.now(), value: { eras } }
  return cache.value
}

/** How many eras the network has fully unlocked — bomb.ts reads this to
 *  extend the charge window as a network-wide reward for collective
 *  discography completion, not just per-track counting. */
export function completedEraCount(timeline: EraTimeline): number {
  return timeline.eras.filter((e) => e.total > 0 && e.done >= e.total).length
}
