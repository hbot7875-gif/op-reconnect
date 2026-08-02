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

export function itemArt(item) {
  return `<svg viewBox="0 0 40 40" class="ia">${D[item?.kind] || FALLBACK}</svg>`
}

export const ITEM_KINDS = Object.keys(D)
