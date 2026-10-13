// Jimin Birthday Room artwork. One composed SVG on a fixed 400x318 canvas (the room spans y 0-264; the
// wall above and floor below leave the stage title and meter their own space), so
// every prop keeps its floor contact and its distance to its neighbours at any
// phone width, instead of a pile of independently positioned boxes drifting
// apart. Pure markup: screen-world.js decides the band (the same 0/25/50/75/100
// restoration thresholds as before) and the continuous --sr-light value; this
// file only says what the room looks like at each band.
//
// Four zones, read left to right like a stage set:
//   left    sofa + cushions, floor lamp behind its arm, gift corner in front
//   center  coffee table on the rug: runner, cake, flowers
//   right   listening console: record player, moon lamp, floor speaker
//   back    window + curtains (the cool key light), message cards, string lights
// Light: the window's soft blue is the only light at 0%. The floor lamp (25%)
// becomes the warm dominant light; the moon lamp (75%) is the weaker accent.
//
// Original drawing only: no photos, album art, MV frames or likeness.

const SHADOW = (cx, cy, rx, ry, o = 1) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#srShadow)" opacity="${o}"/>`

const DEFS = `<defs>
  <linearGradient id="srWall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#151c2a"/><stop offset="1" stop-color="#1c2433"/></linearGradient>
  <linearGradient id="srFloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d1f26"/><stop offset="1" stop-color="#121419"/></linearGradient>
  <linearGradient id="srSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#132a46"/><stop offset=".72" stop-color="#3f6c95"/><stop offset="1" stop-color="#6f98bd"/></linearGradient>
  <radialGradient id="srWindowGlow"><stop offset="0" stop-color="#8fb6d8" stop-opacity=".34"/><stop offset="1" stop-color="#8fb6d8" stop-opacity="0"/></radialGradient>
  <linearGradient id="srBeam" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9cc0de" stop-opacity=".2"/><stop offset="1" stop-color="#9cc0de" stop-opacity="0"/></linearGradient>
  <radialGradient id="srWarm"><stop offset="0" stop-color="#ffdcae" stop-opacity=".62"/><stop offset=".45" stop-color="#f3c48f" stop-opacity=".2"/><stop offset="1" stop-color="#f3c48f" stop-opacity="0"/></radialGradient>
  <radialGradient id="srMoonGlow"><stop offset="0" stop-color="#f6efdc" stop-opacity=".55"/><stop offset="1" stop-color="#f6efdc" stop-opacity="0"/></radialGradient>
  <radialGradient id="srMoon" cx=".38" cy=".34"><stop offset="0" stop-color="#fffaf0"/><stop offset=".7" stop-color="#eadfc6"/><stop offset="1" stop-color="#cdbf9f"/></radialGradient>
  <radialGradient id="srGlow"><stop offset="0" stop-color="#ffd99a" stop-opacity=".75"/><stop offset=".35" stop-color="#ffd99a" stop-opacity=".22"/><stop offset="1" stop-color="#ffd99a" stop-opacity="0"/></radialGradient>
  <radialGradient id="srShadow"><stop offset="0" stop-color="#05070b" stop-opacity=".62"/><stop offset="1" stop-color="#05070b" stop-opacity="0"/></radialGradient>
  <radialGradient id="srVignette" cx=".5" cy=".55" r=".75"><stop offset=".55" stop-color="#05070c" stop-opacity="0"/><stop offset="1" stop-color="#05070c" stop-opacity=".78"/></radialGradient>
  <linearGradient id="srWood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b5241"/><stop offset="1" stop-color="#4a392d"/></linearGradient>
  <linearGradient id="srSofa" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a5f6a"/><stop offset="1" stop-color="#40454f"/></linearGradient>
  <linearGradient id="srSheer" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#d9e2ec" stop-opacity=".2"/><stop offset=".5" stop-color="#d9e2ec" stop-opacity=".09"/><stop offset="1" stop-color="#d9e2ec" stop-opacity=".2"/></linearGradient>
</defs>`

// ── Back wall ─────────────────────────────────────────────────────────────
const ROOM_SHELL = `
  <rect y="-34" width="400" height="212" fill="url(#srWall)"/>
  <rect y="171" width="400" height="7" fill="#232b39"/>
  <rect y="178" width="400" height="106" fill="url(#srFloor)"/>
  <path d="M0 196H400M0 218H400M0 244H400M0 270H400" stroke="#262932" stroke-width=".8"/>
  <ellipse cx="202" cy="100" rx="96" ry="78" fill="url(#srWindowGlow)"/>`

const WINDOW = `
  <g class="sr-window">
    <rect x="156" y="58" width="92" height="84" rx="2" fill="#0e1622" stroke="#2c3a51" stroke-width="2"/>
    <rect x="160" y="62" width="84" height="76" fill="url(#srSky)"/>
    <circle cx="224" cy="78" r="5.5" fill="#f2ead2" opacity=".9"/>
    <path d="M160 138V122h9v-6h8v9h10v-12h11v8h9v-5h12v10h8v-7h9v8h8v15Z" fill="#0d1a2b"/>
    <rect x="172" y="127" width="2" height="2" fill="#e9c98e" opacity=".7"/><rect x="214" y="123" width="2" height="2" fill="#e9c98e" opacity=".55"/>
    <path d="M202 62V138M160 100H244" stroke="#1a2536" stroke-width="2.4"/>
    <rect x="151" y="141" width="102" height="4" rx="1" fill="#2f3949"/>
  </g>
  <g class="sr-curtain">
    <path d="M134 52H270" stroke="#9c855a" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="133" cy="52" r="2.2" fill="#9c855a"/><circle cx="271" cy="52" r="2.2" fill="#9c855a"/>
    <path d="M138 53h26c-3 34 1 76 -4 116h-24c4-40 -1-82 2-116Z" fill="url(#srSheer)" stroke="#c9d4df" stroke-opacity=".16"/>
    <path d="M240 53h26c3 34 -2 76 2 116h-24c-5-40 -1-82 -4-116Z" fill="url(#srSheer)" stroke="#c9d4df" stroke-opacity=".16"/>
    <path d="M146 58c-1 36 2 72 -1 108M155 58c1 36 -2 72 1 108M250 58c2 36 -1 72 2 108M258 58c-1 36 2 72 -1 108" stroke="#d9e2ec" stroke-opacity=".08"/>
  </g>
  <path class="sr-moonbeam" d="M170 186H244L300 240H196Z" fill="url(#srBeam)"/>`

// Left wall finished piece — the only words in the room.
const MESSAGE_BOARD = `
  <g class="sr-birthday">
    <rect x="58" y="84" width="68" height="36" rx="1.2" fill="#d9ccb3" stroke="#8f7648" stroke-width="1.8"/>
    <rect x="61.5" y="87.5" width="61" height="29" fill="none" stroke="#b39d70" stroke-opacity=".5" stroke-width=".5"/>
    <text x="92" y="100" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="8.6" fill="#5f4744">Happy birthday,</text>
    <text x="92" y="112" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="9.6" fill="#86683a">Jimin</text>
  </g>`

const STRING_LIGHTS = (more) => {
  const bulbs = [[142, 54], [158, 58], [176, 61], [194, 62], [212, 62], [230, 60], [248, 57], [282, 52], [302, 55], [322, 57], [342, 56], [362, 53], [382, 49]]
  return `
  <g class="sr-string-lights">
    <path d="M136 51Q202 70 268 51Q330 64 394 46" fill="none" stroke="#5e5240" stroke-width=".8"/>
    ${bulbs.map(([x, y], i) => `<circle cx="${x}" cy="${y + 1.6}" r="${more ? 6 : 5}" fill="url(#srGlow)" opacity="${more ? .7 : .55}"/><circle class="sr-bulb${i % 3 === 0 ? ' is-slow' : ''}" cx="${x}" cy="${y + 1.6}" r="1.7" fill="#f6dda8"/>`).join('')}
  </g>`
}

// Cards hang from twine on the wall above the listening console, one group.
const MESSAGE_CARDS = (full) => `
  <g class="sr-message-cards">
    <path d="M282 78Q321 88 360 78" fill="none" stroke="#8d7a58" stroke-width=".7"/>
    <rect x="288" y="80" width="15" height="11" fill="#eadfca" transform="rotate(-6 295 85)"/>
    <rect x="306" y="83" width="14" height="10" fill="#d4a7a7" transform="rotate(4 313 88)"/>
    <rect x="324" y="83" width="15" height="11" fill="#b9cddd" transform="rotate(-3 331 88)"/>
    <rect x="342" y="80" width="13" height="10" fill="#efe4cf" transform="rotate(5 348 85)"/>
    <path d="M291 85h8M291 87.5h6M327 88h8M327 90.5h5" stroke="#7d6a62" stroke-width=".5" opacity=".7"/>
    ${full ? `
    <path d="M286 102Q322 111 358 102" fill="none" stroke="#8d7a58" stroke-width=".7"/>
    <rect x="292" y="104" width="13" height="10" fill="#d9c49a" transform="rotate(5 298 109)"/>
    <rect x="310" y="106" width="15" height="11" fill="#eadfca" transform="rotate(-4 317 111)"/>
    <rect x="329" y="106" width="13" height="10" fill="#d4a7a7" transform="rotate(3 335 111)"/>
    <rect x="346" y="103" width="11" height="9" fill="#b9cddd" transform="rotate(-6 351 107)"/>
    <path d="M313 111h8M313 113.5h6" stroke="#7d6a62" stroke-width=".5" opacity=".7"/>` : ''}
  </g>`

// ── Light ─────────────────────────────────────────────────────────────────
const FLOOR_LAMP = `
  <g class="sr-lamp">
    ${SHADOW(26, 213, 12, 2.6, .8)}
    <ellipse cx="26" cy="212" rx="8" ry="2" fill="#7f6b48"/>
    <path d="M26 211V106" stroke="#8f7a52" stroke-width="1.6"/>
    <path d="M13 104h26l-5-18H18Z" fill="#f1e2c4"/>
    <path d="M13 104h26" stroke="#d6c39a" stroke-width="1"/>
  </g>`

// ── Left zone ─────────────────────────────────────────────────────────────
const SOFA = `
  <g class="sr-bench">
    ${SHADOW(100, 213, 76, 6)}
    <rect x="42" y="144" width="116" height="42" rx="9" fill="url(#srSofa)"/>
    <rect x="36" y="176" width="128" height="24" rx="6" fill="#4b505b"/>
    <path d="M100 178V198" stroke="#3a3e48" stroke-width="1"/>
    <rect x="30" y="164" width="17" height="40" rx="7" fill="#474c57"/>
    <rect x="153" y="164" width="17" height="40" rx="7" fill="#474c57"/>
    <path d="M44 146H156" stroke="#6b717d" stroke-opacity=".5"/>
    <rect x="40" y="203" width="3" height="9" fill="#2b241e"/><rect x="157" y="203" width="3" height="9" fill="#2b241e"/>
    <rect x="52" y="152" width="27" height="23" rx="6" fill="#d8cbb3" transform="rotate(-8 65 163)"/>
    <rect x="121" y="155" width="25" height="21" rx="6" fill="#b4878a" transform="rotate(7 133 165)"/>
  </g>`

// Gift corner grows in the floor space in front of the sofa's left arm.
const GIFT = (x, y, w, h, body, ribbon) => `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.2" fill="${body}"/>
  <rect x="${x}" y="${y}" width="${w}" height="2.2" fill="#000" opacity=".12"/>
  <rect x="${x + w / 2 - 1.3}" y="${y}" width="2.6" height="${h}" fill="${ribbon}"/>
  <path d="M${x + w / 2} ${y}c-5 -5 -9 -1 -4 1M${x + w / 2} ${y}c5 -5 9 -1 4 1" fill="none" stroke="${ribbon}" stroke-width="1.6" stroke-linecap="round"/>`

const GIFTS = (band) => {
  if (band < 25) return ''
  return `
  <g class="sr-gifts" transform="translate(40 237) scale(1.22) translate(-40 -237)">
    ${SHADOW(44, 238, band >= 75 ? 46 : band >= 50 ? 34 : 22, 4)}
    ${band >= 100 ? `<path d="M2 204h16l2 33H0Z" fill="#b99459"/><path d="M6 204c0-7 8-7 8 0" fill="none" stroke="#7d6640" stroke-width="1.2"/>` : ''}
    ${GIFT(16, 216, 27, 21, '#b27d84', '#e7d09e')}
    ${band >= 75 ? GIFT(20, 203, 19, 13, '#8ea8be', '#efe4cf') : ''}
    ${band >= 50 ? GIFT(46, 224, 21, 13, '#d4bd8a', '#b27d84') : ''}
    ${band >= 75 ? GIFT(70, 229, 16, 8.5, '#e7dcc6', '#9a7a45') : ''}
    ${band >= 100 ? `<path d="M68 229c4 -3 7 3 11 0s6 3 10 0" fill="none" stroke="#d4a7a7" stroke-width="1" stroke-linecap="round"/>` : ''}
  </g>`
}

// A black cat sitting in profile on the sofa seat, between the cushions:
// black against the grey upholstery reads at every stage without being lit
// like a prop. A cool window-light edge at 0%, the floor lamp's warm rim from
// 25%. Drawn on a 228 baseline and lifted onto the seat as one group.
const CAT_BODY = 'M88 228C86 220 87 212 93 208C95 206 97 202 98 198L98.6 191.4L101.8 195.4Q103.8 194.5 105.8 195.1L108.6 191.6L108.8 197.4C110.5 199.4 110.1 202.6 107.7 203.7C106.4 206 107.4 211 107.9 216L108.7 228Z'
const CAT = (band) => {
  const rim = band >= 25 ? '#f1cd98' : '#a9c2d8'
  return `
  <g class="sr-cat" transform="translate(4 -44)">
    ${SHADOW(99, 228.6, 15, 2.2)}
    <path d="${CAT_BODY}" fill="#25252b"/>
    <path d="M90 227.6C96 230.2 106 230.2 111.8 227.2C114.2 226 113.6 223.8 111.4 224.6" fill="none" stroke="#25252b" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M88.4 226C86.6 219 87.6 212 93 208.2C95.2 206.2 97 202.4 98 198.4L98.6 191.8" fill="none" stroke="${rim}" stroke-opacity="${band >= 25 ? .75 : .5}" stroke-width=".9" stroke-linecap="round"/>
    <path d="M101.8 195.4Q103.8 194.5 105.8 195.1" fill="none" stroke="${rim}" stroke-opacity=".4" stroke-width=".6"/>
  </g>`
}

// ── Center zone ───────────────────────────────────────────────────────────
const RUG = `<ellipse cx="184" cy="228" rx="118" ry="21" fill="#2a2429" stroke="#a87f80" stroke-opacity=".16"/>`

const TABLE = `
  <g class="sr-side-table">
    ${SHADOW(185, 241, 74, 5)}
    <path d="M124 206H246L254 216H116Z" fill="url(#srWood)"/>
    <path d="M124 206H246" stroke="#8a6c53" stroke-opacity=".7"/>
    <rect x="116" y="216" width="138" height="5" fill="#35291f"/>
    <rect x="123" y="221" width="4" height="19" fill="#2c221b"/><rect x="243" y="221" width="4" height="19" fill="#2c221b"/>
    <path d="M150 207H220L224 215H146Z" fill="#e7dcc6" opacity=".2"/>
  </g>`

const FLOWERS = (band) => {
  if (band < 25) return ''
  const blooms = [[230, 182, '#d3a1a3'], [238, 178, '#efe4cf'], [244, 184, '#c98d92']]
  if (band >= 75) blooms.push([234, 172, '#e0b8b4'], [246, 175, '#d3a1a3'], [226, 175, '#efe4cf'])
  if (band >= 100) blooms.push([240, 168, '#c98d92'], [222, 181, '#d8c08e'], [250, 181, '#efe4cf'])
  return `
  <g class="sr-vase">
    ${SHADOW(237, 210, 10, 1.6, .7)}
    <path d="M231 190h12l-1 19h-10Z" fill="#9fb8c9" fill-opacity=".32" stroke="#b8cad6" stroke-opacity=".45" stroke-width=".7"/>
    <path d="M235 190l-5 -8M237 190l1 -12M239 190l5 -6${band >= 75 ? 'M236 190l-2 -18M238 190l8 -15M234 190l-8 -15' : ''}" stroke="#6d8169" stroke-width=".9"/>
    ${band >= 50 ? '<path d="M232 186c-4-1 -6 1 -7 3c3 1 5 0 7-3ZM242 186c4-2 6 0 7 2c-3 1 -5 0 -7-2Z" fill="#647a63"/>' : ''}
    ${blooms.map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="3.6" fill="${c}"/><circle cx="${x}" cy="${y}" r="1.2" fill="#000" opacity=".12"/>`).join('')}
  </g>`
}

const CAKE = (complete) => `
  <g class="sr-cake" transform="translate(186 207) scale(1.16) translate(-186 -207)">
    <ellipse cx="186" cy="198" rx="40" ry="26" fill="url(#srWarm)" opacity=".35"/>
    ${SHADOW(186, 209, 22, 2.2)}
    <ellipse cx="186" cy="207" rx="19" ry="3" fill="#cdb88b"/>
    <rect x="183" y="203" width="6" height="4" fill="#b39c6e"/>
    <ellipse cx="186" cy="203" rx="17" ry="2.6" fill="#d8c59b"/>
    <rect x="172" y="186" width="28" height="17" rx="2" fill="#efe3cb"/>
    <rect x="172" y="196" width="28" height="3" fill="#c99599"/>
    <rect x="177" y="174" width="18" height="12" rx="1.6" fill="#f5ecda"/>
    <path d="M172 188q3.5 3 7 0t7 0t7 0t7 0" fill="none" stroke="#f8f1e3" stroke-width="1.4"/>
    <rect x="180.4" y="166" width="1.6" height="8" fill="#c8a86b"/><rect x="185.2" y="164" width="1.6" height="10" fill="#c8a86b"/><rect x="190" y="166" width="1.6" height="8" fill="#c8a86b"/>
    ${complete ? `
    <g class="sr-flames">
      <circle cx="186" cy="163" r="16" fill="url(#srGlow)"/>
      <ellipse class="sr-flame" cx="181.2" cy="164" rx="1.3" ry="2.2" fill="#ffd98f"/>
      <ellipse class="sr-flame is-slow" cx="186" cy="162" rx="1.3" ry="2.2" fill="#ffe2a6"/>
      <ellipse class="sr-flame" cx="190.8" cy="164" rx="1.3" ry="2.2" fill="#ffd98f"/>
    </g>
    <circle cx="176" cy="185" r="1.8" fill="#d3a1a3"/><circle cx="196" cy="185" r="1.8" fill="#efe4cf"/>
    <ellipse cx="150" cy="210" rx="8" ry="1.8" fill="#e7dcc6"/><ellipse cx="150" cy="209" rx="4" ry=".9" fill="#d3a1a3"/>
    <ellipse cx="214" cy="211" rx="7" ry="1.6" fill="#e7dcc6"/>` : ''}
  </g>`

// ── Right zone ────────────────────────────────────────────────────────────
const LISTENING = (band) => {
  const active = band >= 50
  const moonOn = band >= 75
  return `
  <g class="sr-music-corner${active ? ' is-playing' : ' is-quiet'}">
    ${SHADOW(324, 222, 48, 4)}
    ${SHADOW(380, 227, 16, 3)}
    <rect x="366" y="152" width="26" height="74" rx="2" fill="#262a32"/>
    <circle cx="379" cy="172" r="6.5" fill="#181b21" stroke="#3a3f49"/>
    <circle cx="379" cy="200" r="9.5" fill="#181b21" stroke="#3a3f49"/>
    ${active ? '<circle class="sr-cone" cx="379" cy="200" r="5.5" fill="none" stroke="#d8b878" stroke-opacity=".35"/>' : ''}
    <rect x="284" y="184" width="80" height="36" rx="1.5" fill="url(#srWood)"/>
    <path d="M284 184.5H364" stroke="#8a6c53" stroke-opacity=".75"/>
    <path d="M324 188V217" stroke="#33271f"/><circle cx="320" cy="203" r=".9" fill="#c8a86b"/><circle cx="328" cy="203" r=".9" fill="#c8a86b"/>
    <rect x="288" y="220" width="3" height="5" fill="#2b221b"/><rect x="357" y="220" width="3" height="5" fill="#2b221b"/>
    <rect x="292" y="175" width="42" height="9" rx="1.5" fill="#2b2a2f"/>
    ${active ? `
    <ellipse cx="309" cy="175" rx="13" ry="2.8" fill="#121216"/>
    <ellipse cx="309" cy="175" rx="3.4" ry=".9" fill="#c99599"/>
    <path d="M330 169L329 173L313 175.4" fill="none" stroke="#b9b2a4" stroke-width="1"/>
    <circle cx="331" cy="181" r=".9" fill="#d8b878"/>` : `
    <rect x="292" y="167" width="42" height="8" rx="1" fill="#a9bacb" fill-opacity=".1" stroke="#a9bacb" stroke-opacity=".25" stroke-width=".6"/>`}
    ${band >= 100 ? `
    <rect x="293" y="198" width="22" height="22" fill="#c99599" transform="rotate(-8 304 220)"/>
    <rect x="300" y="200" width="21" height="21" fill="#e7dcc6" transform="rotate(-3 310 221)"/>
    <circle cx="310.5" cy="210.5" r="5" fill="none" stroke="#9a7a45" stroke-width=".8"/>` : ''}
    <rect x="349" y="178" width="6" height="6" fill="#8a7653"/>
    <ellipse cx="352" cy="184" rx="8" ry="1.8" fill="#9c855a"/>
    ${moonOn ? '<circle cx="352" cy="166" r="30" fill="url(#srMoonGlow)" opacity=".8"/>' : ''}
    <circle cx="352" cy="166" r="11.5" fill="${moonOn ? 'url(#srMoon)' : '#5c5a55'}"/>
    <path d="M345 162c1.5-.8 3-1 4.4-.4M355 170c1.3.7 2.6.6 3.6-.2" stroke="${moonOn ? '#cdbf9f' : '#4a4843'}" stroke-width=".8" fill="none"/>
  </g>`
}

// ── Assemble ──────────────────────────────────────────────────────────────
export function serendipityRoomArt(band) {
  const firstLight = band >= 25
  const gettingReady = band >= 50
  const almostReady = band >= 75
  const complete = band >= 100
  return `<svg class="sr-art" viewBox="0 -34 400 318" preserveAspectRatio="xMidYMid slice" focusable="false" aria-hidden="true">
    ${DEFS}
    ${ROOM_SHELL}
    ${WINDOW}
    ${complete ? MESSAGE_BOARD : ''}
    ${almostReady ? MESSAGE_CARDS(complete) : ''}
    ${almostReady ? STRING_LIGHTS(complete) : ''}
    ${firstLight ? '<circle class="sr-warm-pool" cx="26" cy="100" r="170" fill="url(#srWarm)"/>' : ''}
    ${firstLight ? FLOOR_LAMP : ''}
    ${RUG}
    ${SOFA}
    ${LISTENING(band)}
    ${CAT(band)}
    ${TABLE}
    ${gettingReady ? CAKE(complete) : ''}
    ${FLOWERS(band)}
    ${GIFTS(band)}
    ${gettingReady ? '<rect class="sr-warm-wash" y="-34" width="400" height="318" fill="#f2b98a"/>' : ''}
    <rect class="sr-vignette" y="-34" width="400" height="318" fill="url(#srVignette)"/>
  </svg>`
}
