// The map, as a stranger is allowed to see it.
//
// The landing page has to prove this is a game without giving away the game.
// This now draws the actual illustrated city (map/city-dark.webp) — the same
// artwork and the same hand-placed island coordinates the in-game World
// screen uses (city-map.js's ISLANDS) — with a dim, static ring dropped on
// each real ward's island. No glow, no name, no count: just "something is
// here, and it's dark."
//
// Two things stay redacted on purpose:
//   - Ward NAMES. They're era lore and the player should meet them in-game.
//   - District names, which derive from real people's public handles
//     (docs/op-reconnect-districts.md) and are nobody's business out here.
//
// The stronger reason to redact is that it reads better: an unlabelled,
// blacked-out map is a hook. A labelled one is a table of contents.

import { n, ISLANDS, CITY_W, CITY_H_ART } from './city-map.js'

// Counts come from the seeded map (.claude/districts.json, the source
// docs/op-reconnect-districts.md is written from), centerpieces excluded —
// they aren't districts anyone restores. Ward order is story order.
// This is static authored content, not a server stat, so it's honest to
// state it here; the live "how much is restored" numbers stay in the
// Network status section, where they come from the backend or show a dash.
const WARDS = [
  { id: 'mono', districts: 25 },
  { id: 'happy', districts: 26 },
  { id: 'dday', districts: 27 },
  { id: 'hopeworld', districts: 28 },
  { id: 'golden', districts: 26 },
  { id: 'friends', districts: 29 },
  { id: 'oldgrid', districts: 86 },
]

// Deliberately a subset of what city-map.js's renderArtOverlay draws for the
// real World screen: no glow, no name text, no count text, no tap target.
// There is no code path in this file that can light an island — the
// no-spoiler rule is enforced by what isn't written here rather than by
// remembering to pass the right flag.
function marker([cx, cy]) {
  const g = n('g', { class: 'lm-marker' })
  g.appendChild(n('circle', { cx, cy, r: 2.6, class: 'lm-ring' }))
  g.appendChild(n('circle', { cx, cy, r: 0.55, class: 'lm-dot' }))
  return g
}

export function renderLandingMap(mount) {
  if (!mount) return

  const wrap = document.createElement('div')
  wrap.className = 'lm-wrap'

  const sr = document.createElement('p')
  sr.className = 'lm-sr'
  sr.textContent = `Illustrated city map, sealed and dark. ${WARDS.length} ward locations marked — names withheld until sign-in.`
  wrap.appendChild(sr)

  const svg = n('svg', {
    class: 'lm-art', viewBox: `0 0 ${CITY_W} ${CITY_H_ART}`, 'aria-hidden': 'true',
  })
  svg.appendChild(n('image', {
    href: '../map/city-dark.webp', x: 0, y: 0,
    width: CITY_W, height: CITY_H_ART, preserveAspectRatio: 'none',
  }))
  // ISLANDS[4] is the leafy park in the middle of the west bank, not a ward
  // — dropped so every marker lands on an actual city block.
  const spots = ISLANDS.filter((_, i) => i !== 4).slice(0, WARDS.length)
  for (const spot of spots) svg.appendChild(marker(spot))
  wrap.appendChild(svg)
  mount.appendChild(wrap)

  // This total describes the authored city, not what's reachable on day one
  // — migrations/011 seeds Mono only (game-design §4). Saying so turns an
  // expectation gap into the thing it actually is: wards open in order, and
  // you're being told which one is first. Drop the second sentence only when
  // every ward is genuinely seeded.
  const total = WARDS.reduce((a, w) => a + w.districts, 0)
  const foot = document.createElement('p')
  foot.className = 'lm-foot'
  foot.textContent = `${WARDS.length} wards. ${total} districts. One ward opens first.`
  mount.appendChild(foot)
}
