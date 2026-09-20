// ARIRANG RE:CELEBRATE Watch Party — the one source of truth for what's on
// stage. Everything the venue does (NOW PLAYING label, palette, ARMY Bomb
// tempo, timed effects) is resolved from this file; UI code never checks a
// track name itself.
//
// Both the Gwanghwamun and Goyang playlists play in their published order
// through the YouTube player — nothing is downloaded or rehosted. Each show
// has its own item list, matched by playlist position with the video's title
// as a cross-check so a reordered playlist can't silently mislabel a song.
//
// Timing fields are in seconds of the CURRENT video. `at`/`to` values below
// zero count back from the end of the video (e.g. -8 = eight seconds before
// end); positive values count from the start of the song's segment.
//
// Two layers make the venue feel like a concert rather than a loop:
//
//  STYLE   - the song's base personality: how the Bombs move all the time
//            (a subtle, continuous life at the song's tempo).
//  MOMENTS - authored cues at points in the performance: something visibly
//            changes (the crowd swings together, a wave of light runs across
//            the Bombs, the lights drop, Bombs go up) and then it settles back.
//
// Moments are only authored where their time can be placed with confidence
// (a song's own start, a known segment boundary, the end of the show).
// Mid-song cues (SWIM's swing section, Hooligan's drop) need their real
// timestamps from the videos before they're added here; the engine is ready.

export const WATCH_PLAYLIST = {
  listId: 'PL9m3vNjHZ2N_ONJgXWpt9mIcV4ppVa2tz',
  firstVideoId: 'mmTWieXruAw',
  watchUrl: 'https://www.youtube.com/watch?v=mmTWieXruAw&list=PL9m3vNjHZ2N_ONJgXWpt9mIcV4ppVa2tz',
}

// Goyang Day 1 is a separate 28-video playlist. Its order and titles are
// intentionally kept separate from the Gwanghwamun programme above: the same
// control engine drives both shows, but an index from one must never colour a
// song in the other.
export const GOYANG_PLAYLIST = {
  listId: 'PLSvbD_xz9XGADdXCKhhpcdvH25SEeUCZ9',
  firstVideoId: 'BRzkjoWq15g',
}

// Manually chosen ambient palettes: `glow` washes the venue and the Bombs'
// reflected light, `beam` tints the stage lights, `haze` is the low fog.
// Kept dark and saturated enough to sit inside the ARIRANG red/black venue.
export const PALETTES = {
  bodyToBody: { glow: '#ff3b6b', beam: '#ffb3c4', haze: '#3a0a18' },
  hooligan: { glow: '#ef4444', beam: '#f87171', haze: '#31070b' },
  twoPointOh: { glow: '#3b82f6', beam: '#60a5fa', haze: '#081a33' },
  butter: { glow: '#ffd35a', beam: '#fff1b8', haze: '#3a2a06' },
  micDrop: { glow: '#ff2e3e', beam: '#ff9a2e', haze: '#360608' },
  aliens: { glow: '#22c55e', beam: '#86efac', haze: '#04291a' },
  fya: { glow: '#ff6a1f', beam: '#ffcc4d', haze: '#3a1204' },
  swim: { glow: '#06b6d4', beam: '#22d3ee', haze: '#04203a' },
  likeAnimals: { glow: '#d8402e', beam: '#ffb26b', haze: '#2e0a06' },
  normal: { glow: '#eab308', beam: '#fde047', haze: '#292006' },
  dynamite: { glow: '#ff5fbf', beam: '#5ff3ff', haze: '#2a0a26' },
  mikrokosmos: { glow: '#7a6bff', beam: '#ffe9a8', haze: '#0e0a36' },
  runBts: { glow: '#ff315f', beam: '#4fd1ff', haze: '#250817' },
  dontKnowUs: { glow: '#d946ef', beam: '#f0abfc', haze: '#26072d' },
  fakeLove: { glow: '#8b5cf6', beam: '#fb7185', haze: '#18092e' },
  merryGoRound: { glow: '#fb923c', beam: '#fde68a', haze: '#321407' },
  notToday: { glow: '#2563eb', beam: '#ef4444', haze: '#071534' },
  fyaFire: { glow: '#ff3d00', beam: '#ffb000', haze: '#350900' },
  comeOver: { glow: '#14b8a6', beam: '#a78bfa', haze: '#062725' },
  iNeedU: { glow: '#60a5fa', beam: '#f9a8d4', haze: '#0a1833' },
  please: { glow: '#c084fc', beam: '#fbcfe8', haze: '#24102f' },
  intoSun: { glow: '#f59e0b', beam: '#fff0a8', haze: '#352006' },
  // Ments and between-song moments: neutral, warm house lights.
  house: { glow: '#e8d8c4', beam: '#f6efe6', haze: '#1a1418' },
}

// Base personalities (continuous, subtle). The CSS gives each its own motion:
//   sway   - a small side-to-side lean
//   groove - a relaxed sway with a little bob on the beat
//   bounce - Bombs pump up and down on the beat (hype tracks)
//   ocean  - a slow, rolling side-to-side drift (SWIM)
//   drift  - a hovering left-right glide (Aliens)
//   float  - barely moving, twinkling light (ballads, Mikrokosmos)
//   idle   - Ments and between songs: a slow natural sway, no tempo
export const STYLES = ['sway', 'groove', 'bounce', 'ocean', 'drift', 'float', 'idle']

// Authored moment types.
//  Windows (need `to`; the venue holds the state for that stretch):
//    swing   - the whole crowd swings together, wide, on the tempo
//    pulse   - a stronger synchronized beat pulse
//    color   - a temporary light colour (`tint`) on the venue and Bombs
//    light   - a lighting change: `variant` blackout | spot | strobe
//    bombsUp - Bombs raised high and held
//    calm    - motion eases right down (a reset before a big moment)
//  Cues (one-shot, fire when the video crosses `at`):
//    wave     - a wave of light (`tint`) runs across the crowd
//    laser    - a laser burst behind the screen
//    confetti - confetti from the stage floor up the side gutters
export const WINDOW_MOMENTS = ['swing', 'pulse', 'color', 'light', 'bombsUp', 'calm']
export const CUE_MOMENTS = ['wave', 'laser', 'confetti']
export const LIGHT_VARIANTS = ['blackout', 'spot', 'strobe']

const perf = (title, bpm, palette, extra = {}) => ({ kind: 'performance', title, bpm, palette, style: 'sway', moments: [], ...extra })
const ment = (title = 'MENT') => ({ kind: 'ment', title, palette: 'house', style: 'idle', moments: [] })

// Playlist order exactly as published. Do not reorder.
export const WATCH_ITEMS = [
  perf('Body to Body', 120, 'bodyToBody', { match: /body\s*to\s*body/i, style: 'groove', moments: [{ at: 3, type: 'confetti' }] }),
  perf('Hooligan', 135, 'hooligan', { match: /hooligan/i, style: 'bounce' }),
  perf('2.0', 130, 'twoPointOh', { match: /\b2\.0\b/i, style: 'bounce', doubleTime: true }),
  ment(),
  perf('Butter', 110, 'butter', { match: /butter/i, style: 'groove' }),
  ment(),
  perf('MIC DROP', 170, 'micDrop', { match: /mic\s*drop/i, swayBpm: 85, style: 'bounce', moments: [{ at: 4, type: 'confetti' }] }),
  perf('Aliens', 98, 'aliens', { match: /aliens/i, style: 'drift', doubleTime: true }),
  perf('FYA', 129, 'fya', { match: /\bfya\b/i, style: 'bounce' }),
  ment(),
  perf('SWIM', 94, 'swim', { match: /\bswim\b/i, style: 'ocean' }),
  perf('Like Animals', 79, 'likeAnimals', { match: /like\s*animals/i, style: 'sway' }),
  perf('NORMAL', 73, 'normal', { match: /\bnormal\b/i, style: 'float', doubleTime: true }),
  ment(),
  {
    kind: 'segmented',
    match: /dynamite|mikrokosmos/i,
    segments: [
      perf('Dynamite', 114, 'dynamite', { from: 0, to: 200, style: 'groove', moments: [{ at: 2, type: 'confetti' }] }),
      { kind: 'transition', title: 'BETWEEN SONGS', palette: 'house', style: 'idle', moments: [], from: 200, to: 236 },
      perf('Mikrokosmos', 174, 'mikrokosmos', {
        from: 236, to: Infinity, swayBpm: 87, style: 'float',
        moments: [
          // Its start is a known boundary (3:56): the stage lights come up.
          { at: 0, to: 8, type: 'light', variant: 'spot' },
          // The end of the show: Bombs go up in starlight, a wave of light
          // runs across the crowd, lasers, then confetti.
          { at: -40, to: Infinity, type: 'bombsUp' },
          { at: -40, to: Infinity, type: 'color', tint: '#ffe9a8' },
          { at: -30, type: 'wave', tint: '#ffe9a8' },
          { at: -14, type: 'laser' },
          { at: -10, type: 'confetti' },
        ],
      }),
    ],
  },
]

// Exact order of powdrrrpuff's published Goyang Day 1 playlist. Song-title
// matches are also authored for every entry, so the correct identity survives
// a reordered playlist or a YouTube index that arrives late. Ments deliberately
// have no BPM/pulse and use the slow natural house sway.
export const GOYANG_ITEMS = [
  perf('SWIM', 94, 'swim', { match: /soundcheck[\s\S]*\bswim\b/i, style: 'ocean' }),
  perf('NORMAL', 75, 'normal', { match: /soundcheck[\s\S]*\bnormal\b/i, style: 'float', doubleTime: true }),
  perf('Hooligan', 135, 'hooligan', { match: /soundcheck[\s\S]*\bhooligan\b/i, style: 'bounce' }),
  perf('Hooligan', 135, 'hooligan', { match: /^(?!.*soundcheck).*\bhooligan\b/i, style: 'bounce' }),
  perf('Aliens', 98, 'aliens', { match: /\baliens\b/i, style: 'drift', doubleTime: true }),
  perf('Run BTS', 156, 'runBts', { match: /run\s*bts|달려라\s*방탄/i, swayBpm: 78, style: 'bounce' }),
  ment('FIRST MENT'),
  perf("they don't know 'bout us", 138, 'dontKnowUs', { match: /they\s+don['’]?t\s+know\s+['’]?bout\s+us/i, style: 'groove' }),
  perf('Like Animals', 79, 'likeAnimals', { match: /like\s*animals/i, style: 'sway' }),
  perf('FAKE LOVE', 78, 'fakeLove', { match: /fake\s*love/i, style: 'sway', doubleTime: true }),
  perf('SWIM', 94, 'swim', { match: /^(?!.*soundcheck).*\bswim\b/i, style: 'ocean' }),
  perf('Merry Go Round', 123, 'merryGoRound', { match: /merry\s*go\s*round/i, style: 'groove' }),
  perf('2.0', 130, 'twoPointOh', { match: /\b2\.0\b/i, style: 'bounce', doubleTime: true }),
  perf('NORMAL', 75, 'normal', { match: /^(?!.*soundcheck).*\bnormal\b/i, style: 'float', doubleTime: true }),
  ment('SECOND MENT'),
  perf('Not Today', 110, 'notToday', { match: /not\s*today/i, style: 'bounce' }),
  perf('MIC DROP', 170, 'micDrop', { match: /mic\s*drop/i, swayBpm: 85, style: 'bounce' }),
  perf('FYA + FIRE', 129, 'fyaFire', { match: /\bfya\b[^\n]*\bfire\b/i, style: 'bounce' }),
  ment('THIRD MENT'),
  perf('Body to Body', 120, 'bodyToBody', { match: /body\s*to\s*body/i, style: 'groove' }),
  perf('Come Over', 95, 'comeOver', { match: /come\s*over/i, style: 'groove' }),
  perf('Butter', 110, 'butter', { match: /\bbutter\b/i, style: 'groove' }),
  perf('Dynamite', 114, 'dynamite', { match: /\bdynamite\b/i, style: 'groove' }),
  perf('Mikrokosmos', 174, 'mikrokosmos', { match: /mikrokosmos|소우주/i, swayBpm: 87, style: 'float' }),
  perf('I NEED U', 158, 'iNeedU', { match: /i\s*need\s*u/i, swayBpm: 79, style: 'sway' }),
  ment('FINAL MENT'),
  perf('Please', 84, 'please', { match: /\bplease\b/i, style: 'float' }),
  perf('Into the Sun', 99, 'intoSun', {
    match: /into\s*the\s*sun/i, style: 'float',
    moments: [
      { at: -40, to: Infinity, type: 'bombsUp' },
      { at: -40, to: Infinity, type: 'color', tint: '#fff0a8' },
      { at: -28, type: 'wave', tint: '#fff0a8' },
      { at: -12, type: 'laser' },
      { at: -8, type: 'confetti' },
    ],
  }),
]

// Colours the agent can pick for their own Bomb: every performance's own
// concert colour (in playlist order, so no song can be left out), then a few
// extras. Derived from WATCH_ITEMS/PALETTES, never a hand-kept copy.
export const SONG_BOMB_COLORS = [...WATCH_ITEMS, ...GOYANG_ITEMS]
  .flatMap((item) => item.segments || [item])
  .filter((item) => item.kind === 'performance')
  .reduce((colors, item) => colors.some((c) => c.label === item.title) ? colors
    : [...colors, { label: item.title, color: PALETTES[item.palette].glow }], [])
export const EXTRA_BOMB_COLORS = [
  { label: 'ARMY Purple', color: '#a855f7' },
  { label: 'Lavender', color: '#c4b5fd' },
  { label: 'Silver', color: '#e5e7eb' },
]

// Idle concert sway for ments/transitions: one slow side-to-side every ~4s,
// never tied to a tempo.
export const IDLE_SWAY_BPM = 30
// Above this, a literal sway on every beat looks frantic; hands move at
// half-time while the light keeps the true tempo.
export const HALF_TIME_ABOVE_BPM = 140

/** Which config item is on screen. Playlist position decides; the video's
 *  own title only overrides it when the slot is a song and the title is
 *  clearly a DIFFERENT song (a reordered playlist). A Ment's title may well
 *  mention a song, so a Ment slot is never overridden by its title. */
export function resolveItem(index, videoTitle = '') {
  return resolveItemFrom(WATCH_ITEMS, index, videoTitle)
}

export function resolveGoyangItem(index, videoTitle = '') {
  return resolveItemFrom(GOYANG_ITEMS, index, videoTitle)
}

function resolveItemFrom(items, index, videoTitle = '') {
  const valid = Number.isInteger(index) && index >= 0 && index < items.length
  const byIndex = valid ? items[index] : null
  if (byIndex && (!videoTitle || !byIndex.match || byIndex.match.test(videoTitle))) return { item: byIndex, index }
  if (videoTitle) {
    const byTitle = items.findIndex((it) => it.match && it.match.test(videoTitle))
    if (byTitle !== -1) return { item: items[byTitle], index: byTitle }
  }
  return byIndex ? { item: byIndex, index } : { item: null, index: -1 }
}

/** Everything the venue needs for this moment of this video. */
export function resolveMoment(index, currentTime, videoTitle = '') {
  return resolveMomentFrom(WATCH_ITEMS, index, currentTime, videoTitle)
}

export function resolveGoyangMoment(index, currentTime, videoTitle = '') {
  return resolveMomentFrom(GOYANG_ITEMS, index, currentTime, videoTitle)
}

function resolveMomentFrom(items, index, currentTime, videoTitle = '') {
  const { item, index: at } = resolveItemFrom(items, index, videoTitle)
  if (!item) return describe({ kind: 'unknown', title: '', palette: 'house' }, at, 0)
  if (item.kind !== 'segmented') return describe(item, at, 0)
  const t = Math.max(0, Number(currentTime) || 0)
  const seg = item.segments.find((s) => t >= s.from && t < s.to) || item.segments[item.segments.length - 1]
  return describe(seg, at, item.segments.indexOf(seg))
}

function describe(seg, index, segment) {
  const performing = seg.kind === 'performance'
  const bpm = performing ? seg.bpm : null
  const swayBpm = performing ? (seg.swayBpm || (bpm > HALF_TIME_ABOVE_BPM ? bpm / 2 : bpm)) : IDLE_SWAY_BPM
  return {
    key: `${index}:${segment}`,
    index,
    segment,
    kind: seg.kind,
    title: seg.title,
    label: performing ? 'NOW PLAYING' : 'ON STAGE',
    bpm,
    swayBpm,
    pulse: performing,
    doubleTime: performing && !!seg.doubleTime,
    palette: PALETTES[seg.palette] || PALETTES.house,
    paletteKey: seg.palette,
    style: seg.style || (performing ? 'sway' : 'idle'),
    moments: seg.moments || [],
    from: seg.from ?? 0,
  }
}

// A moment time on the video's clock: negative counts back from the end.
// Until the player knows the duration, end-anchored times stay unreachable.
function clock(moment, v, duration) {
  if (v === Infinity) return Infinity
  if (v >= 0) return moment.from + v
  const d = Number(duration) || 0
  return d > 0 ? d + v : Infinity
}

/** Window moments in effect at this time. They're states, so seeking into
 *  the middle of one simply shows it. */
export function activeMoments(moment, time, duration) {
  if (!moment?.moments?.length) return []
  const t = Number(time) || 0
  return moment.moments.filter((m) => WINDOW_MOMENTS.includes(m.type)
    && t >= clock(moment, m.at, duration) && t < clock(moment, m.to, duration))
}

/** Cue moments crossed between two player readings. Only fires on a small
 *  forward step, so seeking or skipping never fires a backlog of cues. */
export function cuesCrossed(moment, prevTime, nowTime, duration) {
  if (!moment?.moments?.length) return []
  if (!(nowTime > prevTime) || nowTime - prevTime > 2) return []
  return moment.moments.filter((m) => {
    if (!CUE_MOMENTS.includes(m.type)) return false
    const at = clock(moment, m.at, duration)
    return at > prevTime && at <= nowTime
  })
}

/** What's up next: a later song inside the same combined video first
 *  (Dynamite → Mikrokosmos), otherwise the next playlist item. */
export function upNext(index, segment = 0) {
  return upNextFrom(WATCH_ITEMS, index, segment)
}

export function goyangUpNext(index, segment = 0) {
  return upNextFrom(GOYANG_ITEMS, index, segment)
}

function upNextFrom(items, index, segment = 0) {
  const here = items[index]
  if (here?.kind === 'segmented') {
    const later = here.segments.slice(segment + 1).find((s) => s.kind === 'performance')
    if (later) return { kind: 'performance', title: later.title }
  }
  const next = items[index + 1]
  if (!next) return null
  if (next.kind === 'segmented') return { kind: 'performance', title: next.segments.filter((s) => s.kind === 'performance').map((s) => s.title).join(' + ') }
  return { kind: next.kind, title: next.title }
}

const GWANGHWAMUN_PROGRAM = { items: WATCH_ITEMS, resolveMoment, upNext }
const GOYANG_PROGRAM = { items: GOYANG_ITEMS, resolveMoment: resolveGoyangMoment, upNext: goyangUpNext }

/** Concert-control programme for a schedule video's source. Unknown lists keep
 * the neutral house-light fallback instead of being assigned the wrong show. */
export function programForVideo(video) {
  if (video?.kind === 'playlist') return GWANGHWAMUN_PROGRAM
  if (video.kind === 'list' && video.listId === GOYANG_PLAYLIST.listId) return GOYANG_PROGRAM
  return null
}
