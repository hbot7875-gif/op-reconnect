// Item art — one drawing per KIND, not per item.
//
// Everything is drawn here in SVG, in the game's own palette. That is
// deliberate and it is the line we do not cross: these are stylised objects
// of a TYPE (a mug, a rug, a light box), never traced product photography,
// never official artwork, never a logo. The game is a non-commercial fan
// project and nothing in it is sold.
//
// Because art is keyed by kind, the catalogue can grow in the database
// forever without a code change — a new cushion is a new row, and it draws
// itself.

import { eraCoverBody as coverBody } from './run-ami-art.js'
import { MERCH_ART } from './items-art-merch.js'

// A cover inside a small tile: the cards' artwork, with two things Chrome
// won't paint inside a clipped, nested SVG on a button swapped for
// equivalents (MOTS:7's "7" vanished): blend modes are dropped, and element
// opacity becomes fill/stroke opacity. At tile size it reads the same.
const eraCoverBody = (era) => coverBody(era)
  ?.replace(/ style="mix-blend-mode:[a-z-]+"/g, '')
  .replace(/ opacity="([\d.]+)"/g, ' fill-opacity="$1" stroke-opacity="$1"') ?? null

const D = {
  album: `<rect x="4" y="4" width="32" height="32" rx="1.5" class="ia-body"/>
    <circle cx="20" cy="20" r="9" class="ia-accent"/><circle cx="20" cy="20" r="2.4" class="ia-hole"/>
    <rect x="4" y="4" width="4" height="32" class="ia-spine"/>`,

  photocard: `<rect x="9" y="5" width="22" height="30" rx="1.5" class="ia-body"/>
    <rect x="11.5" y="7.5" width="17" height="18" rx="1" class="ia-accent"/>
    <rect x="11.5" y="28" width="11" height="1.6" class="ia-line"/>
    <rect x="11.5" y="31" width="7" height="1.4" class="ia-line"/>`,

  lightstick: `<circle cx="20" cy="14" r="8.5" class="ia-accent"/>
    <circle cx="17.5" cy="11.5" r="2.6" class="ia-shine"/>
    <rect x="17.6" y="22" width="4.8" height="4" rx="1" class="ia-body"/>
    <rect x="18" y="25" width="4" height="11" rx="1.4" class="ia-body"/>`,

  poster: `<rect x="7" y="4" width="26" height="32" rx="1" class="ia-body"/>
    <rect x="10" y="7" width="20" height="14" class="ia-accent"/>
    <rect x="10" y="24" width="20" height="1.8" class="ia-line"/>
    <rect x="10" y="28" width="13" height="1.6" class="ia-line"/>
    <rect x="10" y="31.5" width="16" height="1.4" class="ia-line"/>`,

  banner: `<path d="M5 9 H35 V27 L20 32 L5 27 Z" class="ia-body"/>
    <rect x="10" y="14" width="20" height="2.4" class="ia-accent"/>
    <rect x="10" y="19" width="13" height="2.2" class="ia-accent"/>`,

  ticket: `<path d="M4 12 H36 V18 A3 3 0 0 0 36 24 V30 H4 V24 A3 3 0 0 0 4 18 Z" class="ia-body"/>
    <rect x="8" y="16" width="12" height="1.8" class="ia-accent"/>
    <rect x="8" y="20" width="8" height="1.6" class="ia-line"/>
    <rect x="26" y="16" width="6" height="10" rx="1" class="ia-accent"/>
    <line x1="23" y1="13" x2="23" y2="29" class="ia-perf"/>`,

  /* ── home + living: the ones that make a district feel lived in ── */

  mug: `<path d="M9 12 H27 V27 A5 5 0 0 1 22 32 H14 A5 5 0 0 1 9 27 Z" class="ia-body"/>
    <path d="M27 16 H30 A4 4 0 0 1 30 24 H27" class="ia-outline"/>
    <rect x="12.5" y="16" width="11" height="2.4" class="ia-accent"/>`,

  cushion: `<rect x="6" y="8" width="28" height="24" rx="5" class="ia-body"/>
    <rect x="11" y="14" width="18" height="2.2" class="ia-accent"/>
    <rect x="11" y="18.5" width="12" height="1.8" class="ia-line"/>
    <rect x="11" y="22.5" width="15" height="1.8" class="ia-line"/>`,

  rug: `<ellipse cx="20" cy="20" rx="16" ry="10" class="ia-body"/>
    <ellipse cx="20" cy="20" rx="10.5" ry="6" class="ia-accent"/>
    <ellipse cx="20" cy="20" rx="5" ry="2.6" class="ia-hole"/>`,

  lightbox: `<rect x="4" y="13" width="32" height="15" rx="2.5" class="ia-body"/>
    <rect x="8" y="17" width="24" height="7" rx="1" class="ia-accent"/>
    <rect x="16" y="28" width="8" height="3" class="ia-spine"/>`,

  record: `<circle cx="20" cy="20" r="15" class="ia-body"/>
    <circle cx="20" cy="20" r="10.5" class="ia-groove"/>
    <circle cx="20" cy="20" r="6" class="ia-accent"/>
    <circle cx="20" cy="20" r="1.8" class="ia-hole"/>`,

  tray: `<ellipse cx="20" cy="21" rx="15" ry="9" class="ia-body"/>
    <ellipse cx="20" cy="19.5" rx="11" ry="6.2" class="ia-accent"/>`,

  /* ── wearable + carried ── */

  apparel: `<path d="M13 8 L9 11 L6 17 L10 19 L11 16 V33 H29 V16 L30 19 L34 17 L31 11 L27 8 L24 11 H16 Z" class="ia-body"/>
    <rect x="16" y="21" width="8" height="6" rx="1" class="ia-accent"/>`,

  keyring: `<circle cx="20" cy="10" r="5" class="ia-outline"/>
    <rect x="16.5" y="16" width="7" height="3" rx="1" class="ia-spine"/>
    <rect x="13" y="19" width="14" height="14" rx="2.5" class="ia-body"/>
    <circle cx="20" cy="26" r="4" class="ia-accent"/>`,

  plush: `<circle cx="13" cy="12" r="4" class="ia-body"/><circle cx="27" cy="12" r="4" class="ia-body"/>
    <ellipse cx="20" cy="23" rx="11" ry="11" class="ia-body"/>
    <circle cx="16" cy="21" r="1.6" class="ia-hole"/><circle cx="24" cy="21" r="1.6" class="ia-hole"/>
    <ellipse cx="20" cy="26" rx="3.4" ry="2.2" class="ia-accent"/>`,

  figure: `<circle cx="20" cy="12" r="6.5" class="ia-body"/>
    <path d="M13 21 H27 L29 33 H11 Z" class="ia-body"/>
    <rect x="16" y="24" width="8" height="2.4" class="ia-accent"/>`,

  blanket: `<path d="M5 11 H35 V26 Q20 31 5 26 Z" class="ia-body"/>
    <rect x="9" y="15" width="22" height="2.2" class="ia-accent"/>
    <path d="M5 26 Q20 31 35 26 V29 Q20 34 5 29 Z" class="ia-spine"/>`,

  magnet: `<path d="M11 30 V17 A9 9 0 0 1 29 17 V30 H23 V17 A3 3 0 0 0 17 17 V30 Z" class="ia-body"/>
    <rect x="11" y="26" width="6" height="4" class="ia-accent"/>
    <rect x="23" y="26" width="6" height="4" class="ia-accent"/>`,
}

const FALLBACK = `<rect x="8" y="8" width="24" height="24" rx="2" class="ia-body"/>`

/* ── albums as records ────────────────────────────────────────────────────
   An album collectible is drawn as a vinyl record. What makes each one its
   own is the centre label: the era's colours and its name set in type —
   never the cover artwork (see the note at the top of this file). Media
   items (a tour documentary, a concert film) are films, not records, so they
   get a disc in a slim case instead. Unknown eras fall back to a colour
   picked from the name, so a new album row still draws as a distinct record. */

// `cover` names the War of Cards era artwork (run-ami-art.js) used as the
// sleeve; label colours are taken from that cover.
const ALBUM_LABELS = {
  arirang: { label: '#c3102d', ink: '#fbe9d7', sleeve: '#2f2a26', word: 'ARIRANG', cover: 'arirang' },
  proof: { label: '#f2efe8', ink: '#141414', sleeve: '#000000', word: 'PROOF', cover: 'proof' },
  be: { label: '#161616', ink: '#f7f7f5', sleeve: '#f7f7f5', word: 'BE', cover: 'be' },
  mots: { label: '#2a64c5', ink: '#fbfbfb', sleeve: '#fbfbfb', word: 'MOTS:7', cover: 'mots7' },
}
const FALLBACK_LABELS = [
  { label: '#8b5cf6', ink: '#f4efff', sleeve: '#2a1d52' },
  { label: '#d9ad5f', ink: '#241a08', sleeve: '#3b2c12' },
  { label: '#5fb3c9', ink: '#081d24', sleeve: '#16323b' },
  { label: '#e58fb0', ink: '#2a0d19', sleeve: '#3d1a28' },
]

function albumLabel(item) {
  const key = String(item?.era || '').toLowerCase().replace(/[^a-z]/g, '')
  const known = ALBUM_LABELS[key]
  if (known) return known
  const name = String(item?.name || item?.era || 'album')
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const pick = FALLBACK_LABELS[h % FALLBACK_LABELS.length]
  return { ...pick, word: name.toUpperCase().slice(0, 8) }
}

const escText = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))

/** The record itself, centred on (cx, cy) with radius r. */
function disc(cx, cy, r, p) {
  const grooves = [0.92, 0.82, 0.72, 0.62].map((k) => `<circle cx="${cx}" cy="${cy}" r="${(r * k).toFixed(2)}" class="ia-vinyl-groove" fill="none" stroke="rgba(255,255,255,.07)" stroke-width=".5"/>`).join('')
  const lr = r * 0.42
  const fs = lr * (p.word.length > 5 ? 0.36 : p.word.length > 3 ? 0.44 : 0.62)
  return `<circle cx="${cx}" cy="${cy}" r="${r}" class="ia-vinyl" fill="#0d0b14"/>${grooves}
    <path d="M ${cx - r * 0.78} ${cy - r * 0.42} A ${r * 0.88} ${r * 0.88} 0 0 1 ${cx - r * 0.1} ${cy - r * 0.86}" class="ia-vinyl-shine" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="1.1" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="${lr.toFixed(2)}" fill="${p.label}"/>
    <text x="${cx}" y="${(cy - lr * 0.18).toFixed(2)}" text-anchor="middle" dominant-baseline="middle" class="ia-vinyl-word" font-family="sans-serif" font-weight="800" fill="${p.ink}" font-size="${fs.toFixed(2)}">${escText(p.word)}</text>
    <circle cx="${cx}" cy="${cy + lr * 0.42}" r="${(r * 0.06).toFixed(2)}" fill="${p.ink}" opacity=".55"/>`
}

/** 1 — the whole record, label centre stage. */
export function vinylDiscArt(item) {
  return `<svg viewBox="0 0 40 40" class="ia ia-album-vinyl">${disc(20, 20, 17, albumLabel(item))}</svg>`
}

/** 2 — the record half out of its sleeve; the sleeve carries the colour. */
export function vinylSleeveArt(item) {
  const p = albumLabel(item)
  return `<svg viewBox="0 0 40 40" class="ia ia-album-vinyl">
    ${disc(26.5, 20, 12, p)}
    <rect x="1.5" y="8.5" width="23" height="23" rx="1.6" fill="${p.sleeve}"/>
    <rect x="1.5" y="8.5" width="23" height="23" rx="1.6" class="ia-sleeve-edge"/>
    <rect x="4.5" y="25" width="10" height="1.4" rx=".6" fill="${p.label}" opacity=".9"/>
    <text x="4.5" y="22.4" class="ia-vinyl-word" fill="${p.label}" font-size="${p.word.length > 5 ? 2.8 : 4}">${escText(p.word)}</text>
  </svg>`
}

/** Films: a disc in a slim case. */
function filmArt() {
  return `<svg viewBox="0 0 40 40" class="ia">
    <rect x="7" y="5" width="24" height="30" rx="2" class="ia-body"/>
    <rect x="9.5" y="7.5" width="19" height="25" rx="1" class="ia-spine"/>
    <circle cx="23" cy="20" r="9" class="ia-film-disc" fill="#cfd3e0" fill-opacity=".85"/>
    <circle cx="23" cy="20" r="2.4" class="ia-hole"/>
    <rect x="9.5" y="9" width="3" height="22" class="ia-accent" opacity=".85"/>
  </svg>`
}

/** The real cover (the War of Cards artwork) as a sleeve, the record
 *  sliding out of it. */
export function coverSleeveArt(item) {
  const p = albumLabel(item)
  const cover = p.cover ? eraCoverBody(p.cover) : null
  if (!cover) return vinylSleeveArt(item)
  // The view is cropped to the sleeve + record (no square margin), so the
  // cover fills as much of a tile as it can. The nested <svg> clips the cover
  // to the sleeve by itself: a clipPath here turned the cover solid black
  // when the drawing is used as an image (the district scene does that).
  return `<svg viewBox="0.4 6.4 39 27.2" class="ia ia-album-vinyl ia-album-cover">
    ${disc(27, 20, 12.2, p)}
    <rect x="1.4" y="7.6" width="26" height="26" rx="1.4" fill="rgba(0,0,0,.45)"/>
    <svg x="1" y="7" width="26" height="26" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">${cover}<path d="M0 0 L100 0 L0 58 Z" fill="rgba(255,255,255,.07)"/></svg>
    <rect x="1" y="7" width="26" height="26" rx="1.4" class="ia-sleeve-edge" fill="none" stroke="rgba(255,255,255,.10)" stroke-width=".5"/>
  </svg>`
}

/** How an item looks standing in a district's illustration (scene-items.js
 *  draws it as an image on a wall or the pavement). An album there is its
 *  cover in a slim dark frame, like a print on the wall; a record poking out
 *  of a sleeve at that size reads as a black shape. Everything else is its
 *  usual drawing. */
export function itemSceneArt(item) {
  if (item?.kind === 'album' && String(item?.era || '').toLowerCase() !== 'media') {
    const p = albumLabel(item)
    const cover = p.cover ? eraCoverBody(p.cover) : null
    if (cover) {
      return `<svg viewBox="0 0 40 40" class="ia">
        <rect x="4" y="4" width="32" height="32" rx="1.2" fill="#15121f"/>
        <rect x="4" y="4" width="32" height="32" rx="1.2" fill="none" stroke="rgba(255,255,255,.18)" stroke-width=".6"/>
        <svg x="6.5" y="6.5" width="27" height="27" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">${cover}</svg>
      </svg>`
    }
  }
  return itemArt(item)
}

function albumArt(item) {
  if (String(item?.era || '').toLowerCase() === 'media') return filmArt()
  return coverSleeveArt(item)
}

/* ── per-item drawings ─────────────────────────────────────────────────
   Most collectibles draw by KIND (D above), so a new catalogue row still
   draws itself. Where two items of one kind would otherwise look identical
   — a hoodie drawn as the tee, a bottle drawn as a mug — the item gets its
   own drawing here, keyed by its catalogue id. Same flat style, same
   classes (ia-body / ia-accent / ia-line / ia-spine / ia-hole / ia-shine /
   ia-outline), so rarity colours, the Pack tints and the district scene all
   keep working. No logos, no product shots: shapes that say what it is. */
const ITEM_ART = {
  // Hood, front pocket, drawstrings, long sleeves.
  'hoodie-hope': `<path d="M14 7 Q20 3 26 7 L31 10 L35 21 L31 23 L29 18 V34 H11 V18 L9 23 L5 21 L9 10 Z" class="ia-body"/>
    <path d="M14.5 7.5 Q20 13.5 25.5 7.5" class="ia-outline" stroke-width="1.3"/>
    <rect x="18.3" y="11.5" width="0.9" height="5" class="ia-line"/><rect x="20.8" y="11.5" width="0.9" height="5" class="ia-line"/>
    <path d="M14 24 H26 L24.5 30 H15.5 Z" class="ia-accent"/>`,

  // Long ribbed sleeves and a heart on the chest.
  'knit-heart': `<path d="M13 8 L16 7 Q20 10 24 7 L27 8 L33 13 L35 30 L31 31 L29 17 V34 H11 V17 L9 31 L5 30 L7 13 Z" class="ia-body"/>
    <rect x="11" y="31" width="18" height="1.2" class="ia-line"/><rect x="5.3" y="27.6" width="3.6" height="1" class="ia-line"/><rect x="31.1" y="27.6" width="3.6" height="1" class="ia-line"/>
    <path d="M20 26 L15.6 21.6 A2.6 2.6 0 0 1 20 18 A2.6 2.6 0 0 1 24.4 21.6 Z" class="ia-accent"/>`,

  // A folded triangle scarf with its knot.
  'bandana-purple': `<path d="M4 11 H36 L20 33 Z" class="ia-body"/>
    <path d="M9 14 H31 L20 29 Z" class="ia-accent"/>
    <circle cx="20" cy="20" r="1.6" class="ia-body"/><circle cx="15" cy="17" r="1.1" class="ia-line"/><circle cx="25" cy="17" r="1.1" class="ia-line"/>
    <path d="M4 11 L1.5 7 M36 11 L38.5 7" class="ia-outline" stroke-width="1.6"/>`,

  // A placard on a stick.
  'picket-image': `<rect x="18.6" y="20" width="2.8" height="16" rx="0.8" class="ia-spine"/>
    <rect x="7" y="4" width="26" height="18" rx="1.5" class="ia-body"/>
    <rect x="10" y="7" width="20" height="12" rx="1" class="ia-accent"/>
    <circle cx="20" cy="13" r="3.2" class="ia-shine"/>`,

  // Square cushion with a round emblem (the tracklist cushion keeps its lines).
  'cushion-logo': `<rect x="6" y="8" width="28" height="24" rx="5" class="ia-body"/>
    <circle cx="20" cy="20" r="6.5" class="ia-accent"/><circle cx="20" cy="20" r="2.6" class="ia-body"/>`,

  // Keyrings: what hangs off the ring is what they're named for.
  'keyring-turntable': `<circle cx="20" cy="8" r="4.5" class="ia-outline"/>
    <rect x="17.5" y="13" width="5" height="3" rx="1" class="ia-spine"/>
    <rect x="10" y="16" width="20" height="17" rx="2.5" class="ia-body"/>
    <circle cx="18" cy="24.5" r="5.5" class="ia-hole"/><circle cx="18" cy="24.5" r="2" class="ia-accent"/>
    <path d="M27 19 L25 26" class="ia-outline" stroke-width="1.4"/>`,
  'keyring-headphones': `<circle cx="20" cy="8" r="4.5" class="ia-outline"/>
    <rect x="17.5" y="13" width="5" height="3" rx="1" class="ia-spine"/>
    <path d="M11 29 V25 A9 9 0 0 1 29 25 V29" class="ia-outline" stroke-width="2.2"/>
    <rect x="8.5" y="25" width="6" height="9" rx="2.5" class="ia-accent"/><rect x="25.5" y="25" width="6" height="9" rx="2.5" class="ia-accent"/>`,
  'keyring-face': `<circle cx="20" cy="7" r="4" class="ia-outline"/>
    <path d="M20 11 L13 18 M20 11 L27 18" class="ia-outline" stroke-width="1.2"/>
    <circle cx="12.5" cy="25" r="7" class="ia-body"/><circle cx="27.5" cy="25" r="7" class="ia-body"/>
    <circle cx="10.3" cy="24" r="1" class="ia-hole"/><circle cx="14.7" cy="24" r="1" class="ia-hole"/><path d="M10.5 27.5 Q12.5 29.2 14.5 27.5" class="ia-outline" stroke-width="0.9"/>
    <circle cx="25.3" cy="24" r="1" class="ia-hole"/><circle cx="29.7" cy="24" r="1" class="ia-hole"/><rect x="25.6" y="27.3" width="3.8" height="1.1" rx="0.5" class="ia-accent"/>`,

  // Light sticks: Ver.4 has a banded globe and a chunky grip; Ver.3 a plain
  // globe on a slimmer, longer handle; the boxed one sits in its box.
  'lightstick-v4': `<circle cx="20" cy="13" r="9" class="ia-accent"/>
    <rect x="11" y="12" width="18" height="2.2" class="ia-body" fill-opacity=".55"/>
    <circle cx="17.2" cy="9.8" r="2.4" class="ia-shine"/>
    <rect x="16.5" y="21.5" width="7" height="4" rx="1.2" class="ia-body"/>
    <rect x="16.8" y="25" width="6.4" height="11" rx="2" class="ia-body"/>`,
  'lightstick-v3': `<circle cx="20" cy="12" r="7.5" class="ia-accent"/>
    <circle cx="17.6" cy="9.4" r="2.1" class="ia-shine"/>
    <rect x="18.2" y="19" width="3.6" height="3" rx="0.8" class="ia-body"/>
    <rect x="18.6" y="21.5" width="2.8" height="15" rx="1.2" class="ia-body"/>`,
  'lightstick-v4-full': `<rect x="6" y="4" width="28" height="33" rx="2" class="ia-body"/>
    <rect x="10" y="8" width="20" height="25" rx="1.5" class="ia-spine"/>
    <circle cx="20" cy="15" r="5.5" class="ia-accent"/><circle cx="18.4" cy="13.3" r="1.5" class="ia-shine"/>
    <rect x="18.5" y="20.5" width="3" height="9" rx="1" class="ia-body"/>
    <rect x="6" y="4" width="28" height="3" class="ia-line"/>`,
  // A cap with a small glowing bulb on top: clearly not a light stick.
  'lightstick-hat': `<path d="M8 27 Q8 14 20 14 Q32 14 32 27 Z" class="ia-body"/>
    <path d="M6 27 H36 Q36 31 31 31 H6 Z" class="ia-body"/>
    <rect x="19" y="9" width="2" height="6" class="ia-spine"/>
    <circle cx="20" cy="8" r="4" class="ia-accent"/><circle cx="18.8" cy="6.8" r="1.1" class="ia-shine"/>
    <rect x="9" y="22" width="22" height="1.6" class="ia-line"/>`,

  // A bottle, not a mug.
  'bottle-souvenir': `<rect x="16.5" y="3" width="7" height="4" rx="1" class="ia-accent"/>
    <path d="M17 7 H23 V11 Q28 13 28 18 V33 A3 3 0 0 1 25 36 H15 A3 3 0 0 1 12 33 V18 Q12 13 17 11 Z" class="ia-body"/>
    <rect x="14" y="20" width="12" height="7" rx="1" class="ia-accent"/>
    <rect x="15" y="14" width="1.6" height="16" rx="0.8" class="ia-shine" fill-opacity=".35"/>`,

  // The rare photocard: a starred card in a gold-edged sleeve.
  'pc-era': `<rect x="9" y="5" width="22" height="30" rx="1.5" class="ia-body"/>
    <rect x="9" y="5" width="22" height="30" rx="1.5" class="ia-outline" stroke-width="1"/>
    <rect x="11.5" y="7.5" width="17" height="18" rx="1" class="ia-accent"/>
    <path d="M20 11 L21.4 14.6 L25.2 14.8 L22.2 17.2 L23.2 20.9 L20 18.8 L16.8 20.9 L17.8 17.2 L14.8 14.8 L18.6 14.6 Z" class="ia-body"/>
    <rect x="11.5" y="28" width="11" height="1.6" class="ia-line"/>`,

  // Two plush dolls side by side (the mascot plush keeps its bear).
  'plush-doll': `<circle cx="13" cy="15" r="6" class="ia-body"/><rect x="8" y="20" width="10" height="13" rx="4" class="ia-body"/>
    <circle cx="27" cy="15" r="6" class="ia-body"/><rect x="22" y="20" width="10" height="13" rx="4" class="ia-body"/>
    <circle cx="11" cy="14.5" r="1" class="ia-hole"/><circle cx="15" cy="14.5" r="1" class="ia-hole"/>
    <circle cx="25" cy="14.5" r="1" class="ia-hole"/><circle cx="29" cy="14.5" r="1" class="ia-hole"/>
    <rect x="8" y="24" width="10" height="2.4" class="ia-accent"/><rect x="22" y="24" width="10" height="2.4" class="ia-accent"/>`,

  // Posters: the comeback poster is a single big spotlight; the set is two
  // sheets, one behind the other. (The tour poster keeps the classic one.)
  'poster-comeback': `<rect x="7" y="4" width="26" height="32" rx="1" class="ia-body"/>
    <circle cx="20" cy="16" r="8" class="ia-accent"/>
    <circle cx="20" cy="16" r="3.2" class="ia-body"/>
    <rect x="10" y="28" width="20" height="2" class="ia-line"/><rect x="13" y="31.5" width="14" height="1.5" class="ia-line"/>`,
  'poster-set-tour': `<rect x="12" y="2" width="23" height="29" rx="1" class="ia-spine"/>
    <rect x="5" y="8" width="23" height="30" rx="1" class="ia-body"/>
    <rect x="8" y="11" width="17" height="12" class="ia-accent"/>
    <rect x="8" y="26" width="17" height="1.8" class="ia-line"/><rect x="8" y="29.5" width="11" height="1.5" class="ia-line"/>`,

  // Two slipmats, one resting on the other.
  'slipmat-set': `<circle cx="15" cy="23" r="12" class="ia-body"/>
    <circle cx="15" cy="23" r="8.5" class="ia-groove"/>
    <circle cx="25" cy="16" r="12" class="ia-body"/>
    <circle cx="25" cy="16" r="12" class="ia-outline" stroke-width=".8"/>
    <circle cx="25" cy="16" r="8.5" class="ia-groove"/>
    <circle cx="25" cy="16" r="4.2" class="ia-accent"/><circle cx="25" cy="16" r="1.3" class="ia-hole"/>`,
  // A crate with record sleeves standing in it: pale sleeves, a couple in colour.
  'record-crate': `<rect x="8" y="9" width="4" height="15" rx="0.8" class="ia-line"/>
    <rect x="12.5" y="6" width="4" height="18" rx="0.8" class="ia-accent"/>
    <rect x="17" y="8" width="4" height="16" rx="0.8" class="ia-line"/>
    <rect x="21.5" y="5" width="4" height="19" rx="0.8" class="ia-line"/>
    <rect x="26" y="7.5" width="4" height="16.5" rx="0.8" class="ia-accent"/>
    <rect x="5" y="18" width="30" height="17" rx="1.5" class="ia-body"/>
    <rect x="9" y="22" width="22" height="2" class="ia-line"/><rect x="9" y="27" width="22" height="2" class="ia-line"/>`,
}

export function itemArt(item) {
  // Merch-inspired drawings (items-art-merch.js) first: they carry their own
  // colours. The album sleeves stay as they are (album ids aren't in there;
  // the concert media are, drawn as cases).
  const merch = MERCH_ART[item?.itemId]
  if (merch) return `<svg viewBox="0 0 40 40" class="ia ia-merch">${merch}</svg>`
  if (item?.kind === 'album') return albumArt(item)
  return `<svg viewBox="0 0 40 40" class="ia">${ITEM_ART[item?.itemId] || D[item?.kind] || FALLBACK}</svg>`
}

export const ITEM_IDS_WITH_OWN_ART = [...new Set([...Object.keys(ITEM_ART), ...Object.keys(MERCH_ART)])]
export const MERCH_ITEM_IDS = Object.keys(MERCH_ART)

export const ITEM_KINDS = Object.keys(D)
