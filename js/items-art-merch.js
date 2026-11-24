// Collectibles drawn after the real merchandise (Weverse Shop references),
// in HT's flat style: merch colours instead of rarity colours, no gradients,
// no logos, no likenesses. Shapes and colours that say which piece it is.
// Dark pieces carry a light rim so they read on the dark tiles; rarity stays
// visible through the card's border and label.
//
// Keyed by catalogue id; items-art.js prefers these over its own drawings.

const RIM = 'stroke="rgba(255,255,255,.4)" stroke-width=".7"'
const SILVER = '#c9ccd6', SILVER_D = '#9ea2b0', SILVER_L = '#e2e4ea'
const RED = '#d6343f', RED_D = '#9e1f2a'
const INK = '#1d1a27', INK_2 = '#2c2838', WHITE = '#eeedf3', CREAM = '#f3e3c7'
const GLOBE = '#ecebf6', GLOW = '#c4b5fd'

// Split ring, clasp and a short chain, ending at y.
const ringTop = (y) => `<circle cx="20" cy="4.4" r="3" fill="none" stroke="${SILVER}" stroke-width="1.3"/>
  <rect x="18.9" y="7" width="2.2" height="2.6" rx=".7" fill="${SILVER_D}"/>
  <path d="M20 9.6 V${y}" stroke="${SILVER}" stroke-width="1.2" stroke-dasharray="1.3 .6"/>`

// Seven little figures, each a bit different: hair, top, height.
const HAIR = [
  (x, y) => `<path d="M${x - 2.5} ${y} A2.5 2.5 0 0 1 ${x + 2.5} ${y} Z" fill="${INK}"/>`,                                   // bowl
  (x, y) => `<path d="M${x - 2.5} ${y} A2.5 2.5 0 0 1 ${x + 2.5} ${y - 0.2} L${x + 2.6} ${y + 0.9} Q${x} ${y - 1.4} ${x - 2.5} ${y} Z" fill="#6b4226"/>`, // side swept
  (x, y) => `<circle cx="${x - 1.4}" cy="${y - 1.3}" r="1.3" fill="${INK}"/><circle cx="${x}" cy="${y - 2}" r="1.3" fill="${INK}"/><circle cx="${x + 1.4}" cy="${y - 1.3}" r="1.3" fill="${INK}"/>`, // curls
  (x, y) => `<path d="M${x - 2.7} ${y - 0.2} A2.7 2.9 0 0 1 ${x + 2.7} ${y - 0.2} Z" fill="${RED}"/><rect x="${x - 2.8}" y="${y - 0.9}" width="5.6" height="1.1" rx=".5" fill="${RED_D}"/>`, // beanie
  (x, y) => `<path d="M${x - 2.5} ${y} L${x - 2} ${y - 2.6} L${x - 0.8} ${y - 1.6} L${x} ${y - 3} L${x + 0.9} ${y - 1.6} L${x + 2} ${y - 2.6} L${x + 2.5} ${y} Z" fill="#d8b46a"/>`, // spiky
  (x, y) => `<path d="M${x - 2.6} ${y + 1.4} V${y} A2.6 2.6 0 0 1 ${x + 2.6} ${y} V${y + 1.4} L${x + 1.8} ${y + 0.4} H${x - 1.8} Z" fill="#3b3150"/>`, // longer
  (x, y) => `<path d="M${x - 2} ${y - 0.6} Q${x} ${y - 3.4} ${x + 2} ${y - 0.6} Z" fill="${WHITE}"/><rect x="${x - 3.2}" y="${y - 0.8}" width="6.4" height="1" rx=".4" fill="${WHITE}"/>`, // bucket hat
]
const TOPS = ['#f2f0f6', '#2b2f4a', '#e7b9c6', '#9fc3e8', '#f2d38a', '#c7e6c9', '#c9b7f0']
const LIFT = [0, -0.6, 0.2, -0.3, 0.4, -0.5, 0]
const figures = () => [0, 1, 2, 3, 4, 5, 6].map((i) => {
  const x = 6 + i * 4.67, top = 21.8 + LIFT[i], head = 19.2 + LIFT[i]
  return `<rect x="${x - 1.8}" y="${top}" width="3.6" height="${27.2 - top}" rx="1.2" fill="${TOPS[i]}"/>`
    + `<circle cx="${x}" cy="${head}" r="2.4" fill="#f3dcc6"/>` + HAIR[i](x, head)
    + `<circle cx="${x - 0.8}" cy="${head + 0.5}" r=".35" fill="${INK}"/><circle cx="${x + 0.8}" cy="${head + 0.5}" r=".35" fill="${INK}"/>`
}).join('')

export const MERCH_ART = {
  // ── Light sticks ──────────────────────────────────────────────────────
  // Ver.4: clear globe with the knob on top, a neck, then a long black grip
  // (about 1.4× the globe) with a silver band and a small badge.
  'lightstick-v4': `<rect x="17" y="21" width="6" height="16" rx="2" fill="${INK}" ${RIM}/>
    <rect x="16" y="19.2" width="8" height="3.2" rx="1" fill="${INK_2}" ${RIM}/>
    <rect x="17" y="31" width="6" height="1.2" fill="${SILVER}"/><rect x="18.8" y="24.2" width="2.4" height="2.8" rx=".6" fill="${SILVER_L}"/>
    <circle cx="20" cy="11.4" r="8.6" fill="${GLOBE}" stroke="#ffffff" stroke-width=".6"/>
    <circle cx="20" cy="11.4" r="4.4" fill="${GLOW}"/>
    <rect x="24.6" y="1.6" width="3.2" height="2.6" rx=".8" fill="${INK}" transform="rotate(32 26.2 2.9)"/><circle cx="26.6" cy="2.6" r=".7" fill="${RED}"/>
    <path d="M14.8 8.2 A6.2 6.2 0 0 1 19.4 5.4" stroke="#ffffff" stroke-width="1.3" fill="none" stroke-linecap="round"/>`,
  // Ver.3: the same clear globe and knob, sitting straight on a short, wide
  // grip (about the globe's width) with two grey buttons.
  'lightstick-v3': `<rect x="16.4" y="21" width="7.2" height="14" rx="2.4" fill="${INK}" ${RIM}/>
    <path d="M15.6 20.6 H24.4 L23.6 23 H16.4 Z" fill="${INK_2}" ${RIM}/>
    <ellipse cx="20" cy="26.4" rx="1.6" ry="1.3" fill="${SILVER_D}"/><ellipse cx="20" cy="30.6" rx="1.6" ry="1.3" fill="${SILVER_D}"/>
    <circle cx="20" cy="12" r="9" fill="${GLOBE}" stroke="#ffffff" stroke-width=".6"/>
    <circle cx="20" cy="12" r="4.6" fill="${GLOW}"/>
    <rect x="24.8" y="1.8" width="3.2" height="2.6" rx=".8" fill="${INK}" transform="rotate(32 26.4 3.1)"/>
    <path d="M14.4 8.6 A6.6 6.6 0 0 1 19.2 5.6" stroke="#ffffff" stroke-width="1.3" fill="none" stroke-linecap="round"/>`,
  // Boxed: the tall black box, the stick outlined on its front.
  'lightstick-v4-full': `<rect x="10" y="3" width="20" height="34" rx="1.5" fill="${INK}" stroke="rgba(255,255,255,.45)" stroke-width=".8"/>
    <rect x="10" y="3" width="20" height="3.4" fill="${INK_2}"/>
    <circle cx="20" cy="14" r="4.8" fill="none" stroke="${WHITE}" stroke-width="1.1"/>
    <rect x="18.8" y="19" width="2.4" height="11" rx=".9" fill="${WHITE}"/>
    <rect x="13" y="33" width="14" height="1" fill="${SILVER_D}"/>`,
  // The light stick hat: a bucket hat with a tiny globe on a stalk.
  'lightstick-hat': `<path d="M11 24 Q11 13 20 13 Q29 13 29 24 Z" fill="${INK}" ${RIM}/>
    <path d="M5 24 H35 L32 29 H8 Z" fill="${INK_2}" ${RIM}/>
    <rect x="11" y="21.6" width="18" height="1.4" fill="${RED}"/>
    <rect x="19" y="8" width="2" height="6" fill="${SILVER}"/>
    <circle cx="20" cy="7" r="3.8" fill="${GLOBE}"/><circle cx="20" cy="7" r="1.9" fill="${GLOW}"/>`,

  // ── ARIRANG home goods ────────────────────────────────────────────────
  // On Air light box: red box, white "OOO N AIR".
  'lightbox-onair': `<rect x="3" y="12" width="34" height="16" rx="1.5" fill="${RED}"/>
    <rect x="3" y="26.4" width="34" height="1.6" fill="${RED_D}"/>
    <circle cx="7.6" cy="20" r="2.1" fill="none" stroke="#fff" stroke-width="1.2"/>
    <circle cx="12.1" cy="20" r="2.1" fill="none" stroke="#fff" stroke-width="1.2"/>
    <circle cx="16.6" cy="20" r="2.1" fill="none" stroke="#fff" stroke-width="1.2"/>
    <text x="19.6" y="22" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="5.5" fill="#fff">N AIR</text>`,
  // Logo cushion: three puffy silver rounds, a red tag.
  'cushion-logo': `<circle cx="10" cy="20" r="7.4" fill="${SILVER}"/><circle cx="20" cy="20" r="7.4" fill="${SILVER}"/><circle cx="30" cy="20" r="7.4" fill="${SILVER}"/>
    <path d="M15 14.6 Q15.8 20 15 25.4 M25 14.6 Q25.8 20 25 25.4" stroke="${SILVER_D}" stroke-width=".9" fill="none"/>
    <path d="M6.4 16.4 A4.4 4.4 0 0 1 10 14 M16.4 16.4 A4.4 4.4 0 0 1 20 14 M26.4 16.4 A4.4 4.4 0 0 1 30 14" stroke="#fff" stroke-width="1" fill="none" stroke-linecap="round"/>
    <rect x="36.4" y="17.4" width="2" height="3.2" rx=".5" fill="${RED}"/>`,
  // Tracklist cushion: a soft square pillow — pinched corners, a stitched
  // seam, a shaded underside, the tracklist printed on the front.
  'cushion-track': `<path d="M5 7 Q12 9.6 20 9 Q28 9.6 35 7 Q32.4 14 33 20 Q32.4 26 35 33 Q28 30.4 20 31 Q12 30.4 5 33 Q7.6 26 7 20 Q7.6 14 5 7 Z" fill="${WHITE}"/>
    <path d="M7 24.5 Q20 27.5 33 24.5 Q32.6 28.6 35 33 Q28 30.4 20 31 Q12 30.4 5 33 Q7.4 28.6 7 24.5 Z" fill="#d6d4e0"/>
    <path d="M7.6 10 Q14 11.8 20 11.4 Q26 11.8 32.4 10 Q30.6 15 31 20 Q30.6 25 32.4 30 Q26 28.4 20 28.8 Q14 28.4 7.6 30 Q9.4 25 9 20 Q9.4 15 7.6 10 Z" fill="none" stroke="#bdbacb" stroke-width=".6" stroke-dasharray="1.1 .8"/>
    <rect x="11" y="13.4" width="11" height="1.8" rx=".4" fill="${INK_2}"/><rect x="11" y="16.2" width="8" height="1.8" rx=".4" fill="${INK_2}"/>
    <rect x="11" y="20" width="7" height=".9" fill="#8e8a9e"/><rect x="11" y="22" width="7" height=".9" fill="#8e8a9e"/>
    <rect x="21" y="20" width="7" height=".9" fill="#8e8a9e"/><rect x="21" y="22" width="7" height=".9" fill="#8e8a9e"/>
    <path d="M27 12.6 Q29 14.6 28.4 17" stroke="#d6d4e0" stroke-width="1" fill="none" stroke-linecap="round"/>
    <circle cx="11.8" cy="26" r=".9" fill="${RED}"/>`,
  // Record crate: the official grey square crate (round cut-out in front),
  // drawn with its open top so the records standing in it show.
  'record-crate': `<path d="M5 13 L9 9 H35 L31 13 Z" fill="#26222f"/>
    <rect x="11" y="3.4" width="3.2" height="9" rx=".5" fill="${RED}"/><rect x="14.8" y="2.4" width="3.2" height="10" rx=".5" fill="${CREAM}"/>
    <rect x="18.6" y="4" width="3.2" height="8.4" rx=".5" fill="${INK}" ${RIM}/><rect x="22.4" y="2.8" width="3.2" height="9.6" rx=".5" fill="#c9b7f0"/>
    <rect x="26.2" y="4.6" width="3.2" height="7.8" rx=".5" fill="${WHITE}"/>
    <path d="M31 13 L35 9 V33 L31 37 Z" fill="${SILVER_D}"/>
    <rect x="5" y="13" width="26" height="24" rx="1" fill="${SILVER}"/>
    <rect x="5" y="13" width="26" height="1.6" fill="${SILVER_L}"/>
    <circle cx="18" cy="25.4" r="7" fill="#26222f"/>
    <rect x="13.8" y="20" width="1.2" height="11" fill="${RED}"/><rect x="16.8" y="18.8" width="1.2" height="13.2" fill="${CREAM}"/>
    <rect x="19.8" y="18.8" width="1.2" height="13.2" fill="#4d475e"/><rect x="22.6" y="20.2" width="1.2" height="10.6" fill="#c9b7f0"/>
    <circle cx="18" cy="25.4" r="7" fill="none" stroke="${SILVER_D}" stroke-width="1"/>`,
  // Mirror tray: three joined round mirrors with red rims.
  'tray-mirror': `<circle cx="9" cy="20" r="7" fill="#dfe1e8" stroke="${RED}" stroke-width="1.3"/>
    <circle cx="20" cy="20" r="7" fill="#dfe1e8" stroke="${RED}" stroke-width="1.3"/>
    <circle cx="31" cy="20" r="7" fill="#dfe1e8" stroke="${RED}" stroke-width="1.3"/>
    <path d="M5.6 17 L8.4 14.8 M16.6 17 L19.4 14.8 M27.6 17 L30.4 14.8" stroke="#fff" stroke-width="1.2" stroke-linecap="round"/>`,

  // ── ISLAND ────────────────────────────────────────────────────────────
  // Seven little chibi figures on the blue stand, each a bit different.
  'figure-island': `<rect x="2.5" y="27" width="35" height="7.5" rx="2" fill="#3f6fd8"/><rect x="2.5" y="27" width="35" height="2" rx="1" fill="#7ea0ee"/>
    <rect x="6" y="31" width="10" height=".9" fill="#c9d8fb"/>
    ${figures()}`,
  // Face rug: a flat, shaped rug — cream border round a little chipmunk-ish
  // face with pointed ears, forehead stripes and eye-stripe markings.
  'rug-hope': `<path d="M8 3.6 L15 10.6 Q20 8.8 25 10.6 L32 3.6 Q36 12 34.2 17 Q38.4 24 33.2 30.4 Q27.4 36.6 20 36.6 Q12.6 36.6 6.8 30.4 Q1.6 24 5.8 17 Q4 12 8 3.6 Z" fill="${CREAM}" stroke="#3b2216" stroke-width="1"/>
    <path d="M9 7 L15 12.6 Q20 10.9 25 12.6 L31 7 Q34 12.5 32.4 17.2 Q35.8 24 31.6 29 Q26.4 34.4 20 34.4 Q13.6 34.4 8.4 29 Q4.2 24 7.6 17.2 Q6 12.5 9 7 Z" fill="#c0682c"/>
    <path d="M10.2 9.4 L14 13.2 L10.8 14.2 Z M29.8 9.4 L26 13.2 L29.2 14.2 Z" fill="#f0a36a"/>
    <path d="M19.2 11.6 L20 18 L20.8 11.6 Z M16 12.6 L17.6 17.4 L18.2 12.2 Z M24 12.6 L22.4 17.4 L21.8 12.2 Z" fill="#5a2c12"/>
    <ellipse cx="14" cy="21.4" rx="3.8" ry="2.9" fill="#fff8ee"/><ellipse cx="26" cy="21.4" rx="3.8" ry="2.9" fill="#fff8ee"/>
    <path d="M8.6 18.6 Q13.6 16.4 18 19.2 M31.4 18.6 Q26.4 16.4 22 19.2" stroke="#5a2c12" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <circle cx="14.4" cy="21.6" r="1.7" fill="${INK}"/><circle cx="25.6" cy="21.6" r="1.7" fill="${INK}"/>
    <circle cx="15" cy="21" r=".6" fill="#fff"/><circle cx="26.2" cy="21" r=".6" fill="#fff"/>
    <ellipse cx="20" cy="28" rx="6.2" ry="4.4" fill="#fff3dc"/>
    <ellipse cx="20" cy="25.8" rx="1.7" ry="1.1" fill="#3b2216"/>
    <path d="M17.8 28.4 Q18.9 29.6 20 28.4 Q21.1 29.6 22.2 28.4" stroke="#3b2216" stroke-width=".7" fill="none" stroke-linecap="round"/>
    <ellipse cx="10.4" cy="26.4" rx="1.6" ry="1" fill="#e88a6a"/><ellipse cx="29.6" cy="26.4" rx="1.6" ry="1" fill="#e88a6a"/>`,

  // ── Clothing ──────────────────────────────────────────────────────────
  // Hoodie: black, light rim, small chest graphic, pocket.
  'hoodie-hope': `<path d="M14 7 Q20 3 26 7 L31 10 L35 21 L31 23 L29 18 V34 H11 V18 L9 23 L5 21 L9 10 Z" fill="${INK}" ${RIM}/>
    <path d="M14.5 7.5 Q20 13.5 25.5 7.5" stroke="rgba(255,255,255,.45)" stroke-width="1.1" fill="none"/>
    <rect x="18.3" y="11.5" width=".9" height="5" fill="${SILVER}"/><rect x="20.8" y="11.5" width=".9" height="5" fill="${SILVER}"/>
    <circle cx="23.2" cy="18" r="1" fill="${RED}"/><circle cx="25.5" cy="18" r="1" fill="${RED}"/>
    <path d="M14 25 H26 L24.5 30.5 H15.5 Z" fill="none" stroke="rgba(255,255,255,.35)" stroke-width=".8"/>`,
  // Pop-up tee: an original tour-style tee — washed olive, an arched
  // wordmark-like row of blocks, three rings under it, a scuffed print.
  'tee-popup': `<path d="M13 8 L9 11 L6 17 L10 19 L11 16 V33 H29 V16 L30 19 L34 17 L31 11 L27 8 L24 11 H16 Z" fill="#6b6f57"/>
    <path d="M16 11 Q20 13 24 11" stroke="#575a46" stroke-width="1" fill="none"/>
    <path d="M6.6 16.6 L9.8 18.2 M33.4 16.6 L30.2 18.2" stroke="#575a46" stroke-width="1.2"/>
    ${[-3, -2, -1, 0, 1, 2, 3].map((k) => `<rect x="${19.15 + k * 2.1}" y="${15.2 + Math.abs(k) * Math.abs(k) * 0.28}" width="1.7" height="2.4" rx=".3" fill="${CREAM}"/>`).join('')}
    <circle cx="16.4" cy="23.6" r="2.1" fill="none" stroke="${CREAM}" stroke-width="1.1"/><circle cx="20" cy="23.6" r="2.1" fill="none" stroke="${CREAM}" stroke-width="1.1"/><circle cx="23.6" cy="23.6" r="2.1" fill="none" stroke="${CREAM}" stroke-width="1.1"/>
    <rect x="15" y="27.6" width="10" height=".8" fill="${CREAM}"/>
    <circle cx="14.6" cy="20.4" r=".4" fill="#575a46"/><circle cx="25" cy="19.8" r=".35" fill="#575a46"/><circle cx="21.6" cy="26.2" r=".35" fill="#575a46"/>
    <rect x="27.2" y="31" width="1.4" height="2" fill="${RED}"/>`,
  // Bandana: folded purple scarf, dotted print and a printed border.
  'bandana-purple': `<path d="M4 10 H36 L20 33 Z" fill="#7c5cd6"/>
    <path d="M7.5 12.2 H32.5 L20 30 Z" fill="none" stroke="#f2f0f6" stroke-width=".9" stroke-dasharray="1.6 1"/>
    <circle cx="14" cy="15" r="1.1" fill="#f2f0f6"/><circle cx="26" cy="15" r="1.1" fill="#f2f0f6"/><circle cx="20" cy="17" r="1.4" fill="#f2f0f6"/><circle cx="20" cy="23" r="1.1" fill="#f2f0f6"/>
    <path d="M4 10 L1.5 6.5 M36 10 L38.5 6.5" stroke="#7c5cd6" stroke-width="1.8" stroke-linecap="round"/>`,

  // ── Small goods ───────────────────────────────────────────────────────
  'bottle-souvenir': `<rect x="16.6" y="3" width="6.8" height="5" rx="1" fill="${RED}"/>
    <path d="M17 8 H23 V11 Q26 13 26 16 V35 A2 2 0 0 1 24 37 H16 A2 2 0 0 1 14 35 V16 Q14 13 17 11 Z" fill="${SILVER}"/>
    <rect x="15.6" y="17" width="1.4" height="17" rx=".7" fill="#ffffff"/>
    <rect x="14" y="23" width="12" height="4.6" fill="${SILVER_D}"/><rect x="16" y="24.8" width="8" height="1" fill="${RED}"/>`,
  // Keyrings: split ring + clasp + chain, then a bigger charm.
  'keyring-turntable': `${ringTop(13)}<rect x="9" y="13" width="22" height="20" rx="2.4" fill="${SILVER}"/>
    <circle cx="18" cy="23" r="6.6" fill="${INK}"/><circle cx="18" cy="23" r="4.4" fill="none" stroke="#3a3548" stroke-width=".8"/><circle cx="18" cy="23" r="2.2" fill="${RED}"/>
    <path d="M28 15.6 L25.2 24.6" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/><circle cx="28" cy="15.6" r="1.3" fill="${SILVER_D}"/>`,
  'keyring-headphones': `${ringTop(14)}<path d="M10.5 30 V25 A9.5 9.5 0 0 1 29.5 25 V30" stroke="${SILVER}" stroke-width="2.6" fill="none"/>
    <rect x="7.6" y="24" width="6.6" height="11" rx="2.8" fill="${RED}"/><rect x="25.8" y="24" width="6.6" height="11" rx="2.8" fill="${RED}"/>
    <rect x="9.2" y="26" width="1.4" height="7" rx=".7" fill="#ef6a73"/><rect x="27.4" y="26" width="1.4" height="7" rx=".7" fill="#ef6a73"/>`,
  'keyring-face': `${ringTop(13)}<path d="M20 13 L13 18 M20 13 L27 18" stroke="${SILVER}" stroke-width="1.1" stroke-dasharray="1.2 .6"/>
    <circle cx="12.5" cy="25.5" r="7.2" fill="#f3dcc6"/><circle cx="27.5" cy="25.5" r="7.2" fill="#f3dcc6"/>
    <path d="M5.3 24.4 A7.2 7.2 0 0 1 19.7 24.4 Z" fill="${INK}"/><path d="M20.3 24.4 A7.2 7.2 0 0 1 34.7 24.4 Z" fill="#7a3e1a"/>
    <circle cx="10.2" cy="26.6" r="1" fill="${INK}"/><circle cx="14.8" cy="26.6" r="1" fill="${INK}"/><path d="M10.6 29.4 Q12.5 31 14.4 29.4" stroke="${INK}" stroke-width=".9" fill="none"/>
    <circle cx="25.2" cy="26.6" r="1" fill="${INK}"/><circle cx="29.8" cy="26.6" r="1" fill="${INK}"/><path d="M25.6 29.4 Q27.5 31 29.4 29.4" stroke="${INK}" stroke-width=".9" fill="none"/>`,
  // Magnet set: a fortune-style magnet — white fish, red scarf, coin charms.
  'magnet-set': `<path d="M6 14 Q14 7 26 11 L34 7 L32 14 L34 21 L26 17 Q14 21 6 14 Z" fill="${WHITE}"/>
    <rect x="17" y="10" width="3.4" height="9" fill="${RED}"/><path d="M18.7 19 L17 24 L20.4 24 Z" fill="${RED}"/>
    <circle cx="10.5" cy="13" r=".9" fill="${INK}"/>
    <path d="M14 17.5 V31" stroke="${SILVER}" stroke-width=".9" stroke-dasharray="1.1 .6"/>
    <circle cx="14" cy="24" r="2" fill="${SILVER}"/><circle cx="14" cy="29" r="2" fill="${SILVER}"/><circle cx="14" cy="34" r="2" fill="${SILVER}"/>`,

  // ── Era paper and media ───────────────────────────────────────────────
  'poster-comeback': `<rect x="7" y="4" width="26" height="32" rx="1" fill="#efeae2"/>
    <circle cx="13.2" cy="20" r="4" fill="${RED}"/><circle cx="20" cy="20" r="4" fill="${RED}"/><circle cx="26.8" cy="20" r="4" fill="${RED}"/>
    <circle cx="13.2" cy="20" r="1.4" fill="#efeae2"/><circle cx="20" cy="20" r="1.4" fill="#efeae2"/><circle cx="26.8" cy="20" r="1.4" fill="#efeae2"/>
    <rect x="10" y="7" width="12" height="1.6" fill="${INK}"/><rect x="10" y="30" width="20" height="1.2" fill="#8e8a9e"/>`,
  // Arirang photocard: the era's look — a grey, curtained studio shot of a
  // suited figure (a silhouette, not a likeness), the three red rounds
  // across the bottom, a red corner.
  'pc-arirang': `<rect x="9.5" y="3.5" width="21" height="33" rx="1.8" fill="#f4f1ec"/>
    <rect x="11.5" y="5.5" width="17" height="23" rx=".8" fill="#8f8c95"/>
    <path d="M13.4 5.5 V28.5 M16.2 5.5 V28.5 M23.8 5.5 V28.5 M26.6 5.5 V28.5" stroke="#9d9aa3" stroke-width=".9"/>
    <rect x="11.5" y="24.5" width="17" height="4" fill="#77737d"/>
    <path d="M13.6 28.5 Q14 20.4 20 20 Q26 20.4 26.4 28.5 Z" fill="#2c2933"/>
    <path d="M18.4 20.2 L20 24.6 L21.6 20.2 Z" fill="#f4f1ec"/><path d="M19.4 21.4 L20 26 L20.6 21.4 Z" fill="${RED}"/>
    <circle cx="20" cy="15.6" r="3.8" fill="#3a3640"/>
    <circle cx="15.4" cy="32.4" r="2" fill="${RED}"/><circle cx="20" cy="32.4" r="2" fill="${RED}"/><circle cx="24.6" cy="32.4" r="2" fill="${RED}"/>
    <path d="M30.5 3.5 V9 L25 3.5 Z" fill="${RED}"/>`,
  'media-concert': `<rect x="8" y="5" width="24" height="31" rx="1.5" fill="${INK}" ${RIM}/>
    <rect x="8" y="5" width="3.2" height="31" fill="${RED}"/>
    <circle cx="22" cy="19" r="7.6" fill="${SILVER}"/><circle cx="22" cy="19" r="2.2" fill="${INK}"/>
    <rect x="14" y="30" width="15" height="1.4" fill="${SILVER_D}"/>`,
  'media-tour': `<rect x="8" y="5" width="24" height="31" rx="1.5" fill="${WHITE}"/>
    <rect x="8" y="5" width="3.2" height="31" fill="#3f6fd8"/>
    <circle cx="22" cy="19" r="7.6" fill="#3f6fd8"/><circle cx="22" cy="19" r="2.2" fill="${WHITE}"/>
    <rect x="14" y="30" width="15" height="1.4" fill="#8e8a9e"/>`,
}
