// RUN AMI — card artwork.
//
// Every face is an Era Poster: a header band in the card's game colour that
// carries the value and the colour's shape (● ▲ ■ ◆), and under it an
// original piece of artwork after one BTS album era. The artwork keeps its
// album's own palette; the game colour never enters it. Wilds split the
// header into all four colours.
//
// 0–9 run in release order (Map of the Soul : 7 lands on the 7); the five
// action cards carry eras whose idea fits the action. The back strings all
// sixteen eras together.
//
// Everything here returns SVG strings and touches no DOM, so it imports in
// Node for the tests. Each call gets fresh gradient and clip ids, because a
// card can be on screen several times at once (hand, discard, flights).

const COL = { r: '#ff5d52', y: '#f4b740', g: '#2fc48d', b: '#4a8dff' } // = --ra-r/y/g/b
const ORDER = ['r', 'y', 'g', 'b']
const INK = '#111'
const HB = 16 // header height, in a 62×88 card
let uid = 0
const nextId = () => `ra${(uid = (uid + 1) % 1e6)}`

const ERA_OF = {
  0: 'yf', 1: 'wings', 2: 'ynwa', 3: 'her', 4: 'tear', 5: 'answer', 6: 'persona', 7: 'mots7', 8: 'be', 9: 'proof',
  skip: 'dw', d2: 'hyyh', rev: 'swim', wild: 'ptd', wd4: 'arirang',
}
// One colour per era, release order, for the back
const JOURNEY = ['#d6202a', '#f4b6b2', '#7cc6ee', '#f4d000', '#111111', '#8fd3c5', '#a9c4ec', '#c3b2e3', '#e9a8cb', '#fa7ba2', '#2a64c5', '#f7f7f5', '#ffffff', '#f2621f', '#5c7f95', '#c8101c']
const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

/* ── Era artwork, each in a 100×100 box. Key content stays inside x 7–93,
      the part a card shows. ─────────────────────────────────────────── */
const lyGrad = (u, a, b, c) => `<linearGradient id="ly${u}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${a}"/><stop offset=".5" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>`
const lyMark = (u, x, y, han, fillHan) => `<text x="${x}" y="${y}" font-family="Jost" font-weight="200" font-size="13" letter-spacing="1" fill="none" stroke="url(#ly${u})" stroke-width=".55">LY</text>
  <text x="${x + 20}" y="${y - .5}" font-family="Noto Sans TC" font-weight="300" font-size="9.5" fill="${fillHan}">${han}</text>`
const MOTIF = {
  dw(u) {
    const r = rng(7); let sc = ''
    for (let i = 0; i < 46; i++) { const x = r() * 110 - 5, y = r() * 110 - 5, a = r() * Math.PI, l = 6 + r() * 22; sc += `<path d="M${x.toFixed(1)} ${y.toFixed(1)}l${(Math.cos(a) * l).toFixed(1)} ${(Math.sin(a) * l).toFixed(1)}" stroke="#fff" stroke-opacity="${(.06 + r() * .14).toFixed(2)}" stroke-width="${(.15 + r() * .25).toFixed(2)}"/>` }
    let rays = ''; for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; rays += `<path d="M${50 + Math.cos(a) * 8.5} ${19 + Math.sin(a) * 8.5}L${50 + Math.cos(a) * 11.5} ${19 + Math.sin(a) * 11.5}" stroke="#c81e25" stroke-width=".6"/>` }
    return `<defs><filter id="sp${u}"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="3" seed="3"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1.9 0 0 0 -1.05"/></filter>
        <filter id="mk${u}"><feTurbulence type="fractalNoise" baseFrequency="2.2" numOctaves="1" seed="5" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale=".9"/></filter>
        <radialGradient id="vg${u}"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient></defs>
      <rect width="100" height="100" fill="#1c1c1c"/><rect width="100" height="100" filter="url(#sp${u})" opacity=".35"/>${sc}<rect width="100" height="100" fill="url(#vg${u})"/>
      ${rays}<path d="M45.5 13.5h9l1.5 2v9.5l-1.5 1.5h-9l-1.5 -1.5v-9.5z" fill="none" stroke="#c81e25" stroke-width=".8"/><rect x="46.6" y="16.4" width="6.8" height="3" fill="#c81e25"/>
      <text x="50" y="55" text-anchor="middle" font-family="Bebas Neue" font-size="26" textLength="66" lengthAdjust="spacingAndGlyphs" fill="#f3f3f3" style="filter:drop-shadow(0 .6px .4px rgba(0,0,0,.8))">DARK&amp;WILD</text>
      <text x="50" y="67" text-anchor="middle" font-family="Montserrat" font-weight="800" font-size="4.4" fill="#f3f3f3">WARNING!</text>
      <rect x="22" y="69.6" width="56" height="1.5" fill="#e8e8e8" opacity=".85"/><rect x="24" y="72.6" width="52" height="1.5" fill="#e8e8e8" opacity=".85"/>
      <path d="M33 70C29 61 51 57.5 66 60.5C79 63 77 75 61 77.5C51 79 40 78 35 75.5M61 77.5C56 80 49 82.5 43 84" fill="none" stroke="#d6202a" stroke-width="1.5" stroke-linecap="round" filter="url(#mk${u})"/>`
  },
  hyyh(u) { // Pt.1 above, Pt.2 below
    const ch = (x, y, s, f, st) => `<text x="${x}" y="${y}" font-family="Noto Sans TC" font-weight="900" font-size="${s}" fill="${f}" ${st || ''}>`
    return `<defs><filter id="bl${u}"><feGaussianBlur stdDeviation="3"/></filter><filter id="bb${u}"><feGaussianBlur stdDeviation="1.1"/></filter>
        <linearGradient id="sk${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe9f7"/><stop offset="1" stop-color="#6fc2ee"/></linearGradient>
        <clipPath id="t${u}"><rect width="100" height="50"/></clipPath><clipPath id="b${u}"><rect y="50" width="100" height="50"/></clipPath></defs>
      <g clip-path="url(#t${u})"><rect width="100" height="50" fill="#fcf1f0"/>
        <g filter="url(#bl${u})" opacity=".85"><ellipse cx="30" cy="34" rx="16" ry="9" fill="#f2a29d"/><ellipse cx="66" cy="20" rx="12" ry="7" fill="#f5b8b2"/><ellipse cx="78" cy="42" rx="10" ry="6" fill="#f2a29d"/></g>
        ${ch(30, 25, 18, '#fbf6f5', 'stroke="#d9cfcd" stroke-width=".35"')}花樣</text>${ch(30, 45.5, 18, '#fbf6f5', 'stroke="#d9cfcd" stroke-width=".35"')}年華</text>
        <text x="70" y="9" font-family="DM Serif Display" font-size="3.2" fill="#6b6060">pt.1</text></g>
      <g clip-path="url(#b${u})"><rect y="50" width="100" height="50" fill="url(#sk${u})"/>
        <g filter="url(#bb${u})" fill="#4d6576" opacity=".75"><path d="M22 62c6 -8 14 -6 12 2c6 -2 8 6 2 8c-6 4 -14 0 -14 -10z"/><path d="M74 84c4 -6 10 -4 9 2c4 0 5 4 1 6c-4 2 -10 0 -10 -8z"/><ellipse cx="80" cy="58" rx="5" ry="2.6" transform="rotate(-30 80 58)"/></g>
        <rect x="35.5" y="58" width="29" height="30" fill="none" stroke="#fff" stroke-width="1"/>
        ${ch(37.8, 72, 12, '#fff')}花樣</text>${ch(37.8, 85.5, 12, '#fff')}年華</text><text x="66.5" y="62.5" font-family="Montserrat" font-weight="700" font-size="4.2" fill="#fff">2</text></g>
      <path d="M0 50H100" stroke="#fff" stroke-width=".8"/>`
  },
  yf(u) {
    const cs = ['#f6d400', '#d9df1c', '#9ccc3a', '#44b56e', '#1fa7b4', '#2a86d0', '#1d4f9e', '#6cc6e8']
    let p = ''
    for (let i = 0; i < 9; i++) for (let j = 0; j < 10; j++) p += `<rect x="${27 + i * 4.4}" y="${24 + j * 4.6}" width="4.4" height="4.6" fill="${(i * 3 + j * 5) % 7 === 0 ? '#f8f6ec' : cs[Math.min(7, Math.max(0, Math.floor(i * .75 + j * .35 - 1 + ((i + j) % 2))))]}"/>`
    return `<rect width="100" height="100" fill="#f0f0ee"/>
      <clipPath id="bl${u}"><path d="M46 24C59 24 65 34 65 44C65 56 55 62 51.5 69H40.5C37 62 27 56 27 44C27 34 33 24 46 24Z"/></clipPath>
      <g clip-path="url(#bl${u})">${p}<rect x="26" y="63" width="42" height="7" fill="#e2552b"/><path d="M27 44Q46 54 65 44" stroke="rgba(0,0,0,.07)" fill="none" stroke-width="6"/><path d="M33 30Q30 44 36 58" stroke="rgba(255,255,255,.25)" fill="none" stroke-width="3"/></g>
      <path d="M41.5 69L43 75M50.5 69L49 75" stroke="#5e4a3a" stroke-width=".5"/><rect x="42.5" y="75" width="7" height="4.6" rx=".6" fill="#8a6440"/>
      <text x="84" y="13" text-anchor="end" font-family="Bebas Neue" font-size="9.5" letter-spacing="1.2" fill="#f6f6f4" stroke="#a9a9a6" stroke-width=".35">YOUNG</text>
      <text x="84" y="21.5" text-anchor="end" font-family="Bebas Neue" font-size="9.5" letter-spacing=".6" fill="#f6f6f4" stroke="#a9a9a6" stroke-width=".35">FOREVER</text>`
  },
  wings(u) {
    const r = rng(11); let gl = ''
    for (let i = 0; i < 26; i++) { const x = 21 + r() * 26, h = 6 + r() * 26; gl += `<rect x="${x.toFixed(1)}" y="${(45 + r() * 14).toFixed(1)}" width="${(.6 + r() * 2.4).toFixed(1)}" height="${h.toFixed(1)}" fill="${['#2a2a2a', '#7a7a7a', '#bdbdbd', '#4d4d4d', '#e2e2e2'][i % 5]}"/>` }
    return `<defs><pattern id="ch${u}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-38)"><rect width="7" height="7" fill="#111"/><rect y="2" width="7" height="2.4" fill="#f4f4f4"/></pattern>
        <radialGradient id="sm${u}" cx=".55" cy=".45"><stop offset="0" stop-color="#2a2a2a"/><stop offset=".85" stop-color="#0d0d0d"/><stop offset="1" stop-color="#444"/></radialGradient>
        <radialGradient id="sp${u}" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#7d7d7d"/><stop offset=".45" stop-color="#1b1b1b"/><stop offset="1" stop-color="#050505"/></radialGradient>
        <clipPath id="c3${u}"><circle cx="34" cy="57" r="13.5"/></clipPath></defs>
      <rect width="100" height="100" fill="#fbfbfb"/>
      <circle cx="34" cy="28" r="13.5" fill="url(#sm${u})"/><circle cx="66" cy="28" r="13.5" fill="url(#ch${u})"/>
      <g clip-path="url(#c3${u})"><rect x="20" y="43" width="28" height="28" fill="#9a9a9a"/>${gl}</g><circle cx="66" cy="57" r="13.5" fill="url(#sp${u})"/>
      <text x="50" y="83" text-anchor="middle" font-family="Montserrat" font-weight="700" font-size="9.5" letter-spacing="3" fill="#121212">WINGS</text>`
  },
  ynwa(u) {
    return `<defs><linearGradient id="sk${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe6ea"/><stop offset=".5" stop-color="#e8ecee"/><stop offset=".51" stop-color="#9ab6c6"/><stop offset=".7" stop-color="#7fa1b6"/><stop offset=".71" stop-color="#d9d2c6"/><stop offset="1" stop-color="#cfc6b8"/></linearGradient></defs>
      <rect width="100" height="100" fill="url(#sk${u})"/><rect width="27" height="100" fill="#8fd3c5"/>
      ${['YOU', 'NEVER', 'WALK', 'ALONE'].map((w, i) => `<text x="16.4" y="${8 + i * 3.4}" font-family="Montserrat" font-weight="800" font-size="2.7" fill="#e8534f">${w}</text>`).join('')}
      <rect x="35" y="30" width="50" height="2.4" fill="#3d3f40"/><path d="M36.5 32.4V70.5M83.5 32.4V70.5M52 32.4V58M68 32.4V58" stroke="#4a4c4d" stroke-width=".7"/>
      <rect x="36.5" y="56" width="47" height="11" fill="#7a4a32"/><rect x="36.5" y="56" width="47" height="11" fill="url(#sk${u})" opacity=".12"/>
      <rect x="38" y="66.5" width="44" height="1.4" fill="#6a4530"/><path d="M40 68V71M80 68V71" stroke="#5a3a28" stroke-width=".7"/><rect x="34" y="70.6" width="52" height="1.6" fill="#a99e8e"/>`
  },
  her(u) {
    return `<defs>${lyGrad(u, '#f3b9a6', '#eeaac4', '#e7a3b6')}<linearGradient id="ln${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fc1ef"/><stop offset=".5" stop-color="#c7aee0"/><stop offset="1" stop-color="#f1b3c6"/></linearGradient></defs>
      <rect width="100" height="100" fill="#f5f7fb"/>
      <path d="M58 22c-9 -5 -1 -14 8 -11s9 11 -1 13s-15 -6 -7 -13s21 -1 19 9s-16 10 -20 3s5 -15 14 -10s3 13 -7 10c-6 -2 -6 -8 0 -9" fill="none" stroke="url(#ln${u})" stroke-width=".9" stroke-linecap="round"/>
      <path d="M64 26c-3 10 6 15 2 25s-11 9 -7 17c3 7 9 8 6 16s-4 10 -3 16M62 57c-9 -7 -15 0 -10 5s11 -1 10 -5M0 76c22 -1 42 6 60 -3s14 -14 6 -15" fill="none" stroke="url(#ln${u})" stroke-width=".9" stroke-linecap="round"/>
      ${lyMark(u, 20, 62, '承', '#eeb0bd')}`
  },
  tear(u) {
    return `<defs>${lyGrad(u, '#b9a7dc', '#e6b4cf', '#f2c3b3')}<linearGradient id="ln${u}" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a6c6f0"/><stop offset=".5" stop-color="#d6b2e0"/><stop offset="1" stop-color="#f2c3b3"/></linearGradient></defs>
      <rect width="100" height="100" fill="#1d1f2a"/>
      <path d="M100 6c-16 -3 -40 1 -38 7s16 3 9 7s-28 1 -40 6s-2 7 12 5s32 3 26 15s-18 9 -16 21c1 6 8 7 5 13s-10 4 -10 12s5 6 4 12" fill="none" stroke="url(#ln${u})" stroke-width=".9" stroke-linecap="round"/>
      <path d="M60 60c-6 -4 -6 4 0 4s6 8 0 8" fill="none" stroke="url(#ln${u})" stroke-width=".9"/>
      ${lyMark(u, 20, 54, '轉', '#d8c3ea')}`
  },
  answer(u) {
    return `<defs><linearGradient id="an${u}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#f9c6b5"/><stop offset=".35" stop-color="#eea8c8"/><stop offset=".7" stop-color="#cbb4e6"/><stop offset="1" stop-color="#a6cdf0"/></linearGradient>${lyGrad(u, '#fff', '#fff', '#fff')}</defs>
      <rect width="100" height="100" fill="url(#an${u})"/>${lyMark(u, 31, 21, '結', '#fff')}
      <path d="M0 32c14 -6 30 2 32 14s-14 20 -4 28s24 6 30 -6s10 -26 -2 -28s-16 10 -16 20s-2 22 10 26s30 6 50 4" fill="none" stroke="#fff" stroke-width=".9" stroke-linecap="round"/>
      <path d="M46 44c6 -12 22 -14 26 -4s-8 22 -22 30" fill="none" stroke="#fff" stroke-width=".9" stroke-linecap="round"/>`
  },
  persona(u) {
    let grid = ''; for (let i = 1; i < 5; i++) grid += `<path d="M${i * 20} 14V100M0 ${14 + i * 18}H100" stroke="#fff" stroke-width=".2" opacity=".5"/>`
    return `<rect width="100" height="100" fill="#fa7ba2"/>${grid}
      <text x="30" y="9.5" font-family="Jost" font-weight="300" font-size="4" letter-spacing=".2" fill="#fff">MAP OF THE SOUL</text><text x="66.5" y="9.5" font-family="Jost" font-weight="500" font-size="4" letter-spacing=".2" fill="#fff">PERSONA</text>
      <path d="M50 38C46 22 26 20 20 32S28 54 40 66S54 86 46 100M50 38C54 24 74 20 80 32S72 54 60 66S46 86 54 100" fill="none" stroke="#fff" stroke-width=".7" stroke-linecap="round"/>
      <circle cx="62" cy="34" r=".9" fill="#fff"/><circle cx="38" cy="56" r=".9" fill="#fff"/>`
  },
  mots7(u) {
    let grid = ''; for (let i = 1; i < 5; i++) grid += `<path d="M${i * 20} 16V100M0 ${16 + i * 18}H100" stroke="#e4e4e4" stroke-width=".3"/>`
    const s = (c, w, dx, dy, o) => `<path d="M30 30H72L46 96" fill="none" stroke="${c}" stroke-width="${w}" stroke-linejoin="bevel" transform="translate(${dx} ${dy})" opacity="${o}" style="mix-blend-mode:multiply"/>`
    return `<rect width="100" height="100" fill="#fbfbfb"/>${grid}<path d="M0 46Q50 40 100 46" stroke="#e4e4e4" stroke-width=".3" fill="none"/>
      <text x="57" y="11" text-anchor="middle" font-family="Jost" font-weight="300" font-size="5" letter-spacing=".3" fill="#7d7d7d">MAP OF THE SOUL  7</text>
      ${s('#f6c4c0', 9, -4, 1, .55)}${s('#7cc4ec', 11, 2, -2, .75)}${s('#2a64c5', 8, 0, 0, .85)}${s('#19b3c9', 4, -3, 3, .7)}
      <path d="M33 26H70" stroke="#f6d22b" stroke-width="2.6" opacity=".9"/><path d="M44 98L49 86" stroke="#f39a26" stroke-width="3" opacity=".9"/><path d="M38 34L41 24" stroke="#f6d22b" stroke-width="1.4"/>`
  },
  be(u) {
    const r = rng(5); let lines = ''
    for (let i = 1; i < 5; i++) { let d = `M${24 + r() * 6} ${57 + i * 6.6}`; for (let j = 0; j < 14; j++) d += `q1.1 ${-2 - r() * 1.4} 2.2 0t${(1.6 + r()).toFixed(1)} ${(.6 - r() * 1.2).toFixed(1)}`; lines += `<path d="${d}" fill="none" stroke="#a7a7a3" stroke-width=".35" stroke-linecap="round"/>` }
    return `<rect width="100" height="100" fill="#f7f7f5"/>
      <text x="50" y="44" text-anchor="middle" font-family="Jost" font-weight="400" font-size="24" letter-spacing="-1" fill="#161616">BE</text>
      <text x="50" y="58" text-anchor="middle" font-family="La Belle Aurore" font-size="6" fill="#8e8e8a">life goes on</text>${lines}`
  },
  proof(u) {
    let s = ''
    for (let i = 0; i < 6; i++) {
      const t = i / 5, h = 84 - t * 50, x = 47 - i * 6.6, top = 50 - h / 2
      const p = (x0, dir, gid) => `<path d="M${x0} ${top + 5}L${x0 - dir * 5.6} ${top}V${top + h}L${x0} ${top + h - 5}Z" fill="url(#${gid}${u})"/>`
      s += p(x, 1, 'pl') + p(100 - x, -1, 'pr')
    }
    return `<defs><linearGradient id="pl${u}" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#8e8e8e"/><stop offset=".6" stop-color="#e6e6e6"/><stop offset="1" stop-color="#fff"/></linearGradient>
        <linearGradient id="pr${u}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8e8e8e"/><stop offset=".6" stop-color="#e6e6e6"/><stop offset="1" stop-color="#fff"/></linearGradient></defs>
      <rect width="100" height="100" fill="#000"/>${s}`
  },
  ptd(u) {
    const fl = (x, y, s, c) => { let d = ''; for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; d += `<circle cx="${x + Math.cos(a) * s * .62}" cy="${y + Math.sin(a) * s * .62}" r="${s * .42}"/>` } return `<g fill="${c}">${d}<circle cx="${x}" cy="${y}" r="${s * .72}"/></g>` }
    let burst = ''; for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; burst += `<path d="M${22 + Math.cos(a) * 1.5} ${24 + Math.sin(a) * 1.5}L${22 + Math.cos(a) * 5} ${24 + Math.sin(a) * 5}" stroke="#fff" stroke-width="1" stroke-linecap="round"/>` }
    return `<rect width="100" height="100" fill="#000"/>${fl(10, 4, 16, '#f4a21d')}${fl(88, 12, 20, '#f4a21d')}${burst}
      <path d="M64 12L66.4 21L75 23.5L66.4 26L64 35L61.6 26L53 23.5L61.6 21Z" fill="#4ee3a0"/>
      <text x="50" y="54" text-anchor="middle" font-family="Fredoka" font-weight="600" font-size="11" textLength="68" lengthAdjust="spacingAndGlyphs" fill="#f2621f">PERMISSION</text>
      <text x="50" y="65" text-anchor="middle" font-family="Fredoka" font-weight="600" font-size="11" textLength="68" lengthAdjust="spacingAndGlyphs" fill="#f2621f">TO DANCE</text>
      <text x="50" y="74" text-anchor="middle" font-family="Fredoka" font-weight="600" font-size="5.2" fill="#f2621f">ON STAGE – LIVE</text>
      <circle cx="28" cy="96" r="13" fill="#f2621f"/><path d="M38 86q3 -4 7 -1q4 -4 7 0q3 -3 5 1q-1 5 -6 3q-4 4 -8 0q-4 2 -5 -3z" fill="#74e2f5"/>${fl(88, 98, 14, '#fff')}<circle cx="88" cy="98" r="5" fill="#000"/>`
  },
  swim(u) {
    const sail = (pts, o = 1) => `<path d="${pts}" fill="url(#sl${u})" stroke="#cfc3a8" stroke-width=".3" opacity="${o}"/>`
    return `<defs><linearGradient id="sw${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#aebcc4"/><stop offset=".62" stop-color="#c6d0d4"/><stop offset=".63" stop-color="#557a90"/><stop offset="1" stop-color="#2f4b5e"/></linearGradient>
        <linearGradient id="sl${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6f0e2"/><stop offset=".6" stop-color="#e9dfc9"/><stop offset="1" stop-color="#cdbf9f"/></linearGradient></defs>
      <rect width="100" height="100" fill="url(#sw${u})"/>
      <text x="85" y="16" text-anchor="end" font-family="Cormorant Garamond" font-style="italic" font-weight="300" font-size="15" fill="#fff" opacity=".8">Swim</text>
      <path d="M40 6L44 64M60 10L62 62M26 30L14 70" stroke="#4d3d30" stroke-width=".6"/><path d="M14 66L44 40" stroke="#4d3d30" stroke-width=".4"/>
      ${sail('M41 8Q56 14 58 30Q50 28 42 30Z')}${sail('M42 31Q58 34 60 50Q51 47 43 49Z')}${sail('M61 12Q74 18 76 32Q69 30 61.6 31Z', .95)}${sail('M61.6 33Q76 36 78 50Q70 47 62 48Z', .95)}
      ${sail('M39 12L22 52Q32 40 40 34Z', .9)}${sail('M38 38L16 66Q30 56 40 52Z', .9)}
      <path d="M12 66Q40 60 88 58L80 72Q50 76 24 74Z" fill="#f4f1ea"/><path d="M14 67Q44 62 87 59.6" stroke="#7a6a58" stroke-width=".5" fill="none"/>
      ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<circle cx="${35 + i * 3.4}" cy="${55.6 - i * .25}" r=".95" fill="#2a2220"/><rect x="${34.1 + i * 3.4}" y="${56.5 - i * .25}" width="1.8" height="3.8" rx=".6" fill="${i % 2 ? '#2b2b2e' : '#3a3a3e'}"/>`).join('')}
      <text x="54" y="69.5" text-anchor="middle" font-family="Cormorant Garamond" font-style="italic" font-weight="400" font-size="4.4" fill="#6b5a48">Arirang</text>
      <path d="M0 80q8 -2.4 16 0t16 0t16 0t16 0t16 0t16 0M0 88q8 -2.4 16 0t16 0t16 0t16 0t16 0t16 0M0 95q8 -2.4 16 0t16 0t16 0t16 0t16 0t16 0" fill="none" stroke="#d7e2e8" stroke-width=".45" opacity=".55"/>`
  },
  arirang: (u) => arirang(u),
}

/* ARIRANG: seven suit silhouettes after the cover, four behind and three in
   front, with no faces, hair or member-specific detail, and the album's
   three red symbols rebuilt from its own geometry. */
function arirangMark(cx, cy, r, u) {
  const cap = 'M-1.3 -1.3H1.3V-.31H.96Q.72 -.47 .38 -.47H-1.3Z'
  const low = 'M-1.3 .39H.3Q.62 .39 .86 .48H1.3V1.3H-1.3Z'
  const sym = (dx, inner) => `<g transform="translate(${dx} 0)"><clipPath id="ac${u}${dx ? 3 : 2}"><circle r="1"/></clipPath><g clip-path="url(#ac${u}${dx ? 3 : 2})" fill="url(#rg${u})">${inner}</g></g>`
  return `<defs><radialGradient id="rg${u}" cx=".5" cy=".5" r=".62"><stop offset="0" stop-color="#9f0b22"/><stop offset=".55" stop-color="#c3102d"/><stop offset="1" stop-color="#e5183d"/></radialGradient></defs>
    <g transform="translate(${cx} ${cy}) scale(${r})" opacity=".96">
      <path d="M1 0A1 1 0 1 1 -1 0A1 1 0 1 1 1 0ZM.27 -.03A.3 .3 0 1 0 -.33 -.03A.3 .3 0 1 0 .27 -.03Z" fill="url(#rg${u})" fill-rule="evenodd" transform="translate(-2.17 0)"/>
      ${sym(0, `<path d="${cap}"/><rect x="-1.3" y="-.26" width="2.6" height=".52"/><path d="${low}"/>`)}
      ${sym(2.17, `<path d="${cap}"/><rect x="-1.3" y="-.26" width="1.215" height=".52"/><rect x=".063" y="-.26" width="1.237" height=".52"/><path d="${low}"/>`)}
    </g>`
}

const wood = (u, op = 1) => { let w = ''; for (let i = 0; i < 13; i++) w += `<rect x="${i * 8}" y="0" width="7.7" height="100" fill="${['#2c2724', '#342e2a', '#2f2a26'][i % 3]}" opacity="${op}"/><path d="M${i * 8 + 2.5} 0V100" stroke="rgba(0,0,0,.25)" stroke-width=".25"/>`; return w }
const fabric = (u) => `<pattern id="pin${u}" width="2.4" height="10" patternUnits="userSpaceOnUse"><rect width="2.4" height="10" fill="transparent"/><path d="M1.2 0V10" stroke="rgba(255,255,255,.1)" stroke-width=".22"/></pattern>
  <pattern id="hb${u}" width="3" height="3" patternUnits="userSpaceOnUse"><path d="M0 3L1.5 0L3 3" fill="none" stroke="rgba(255,255,255,.08)" stroke-width=".3"/></pattern>
  <pattern id="ck${u}" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 2H4M2 0V4" stroke="rgba(255,255,255,.07)" stroke-width=".3"/></pattern>`

function suitFront(x, y, s, tone, tie) {
  const P = (pts) => pts.map(([a, b]) => `${(x + a * s).toFixed(2)} ${(y + b * s).toFixed(2)}`).join('L')
  const lapel = (m) => `<path d="M${P([[-3.7 * m, 9], [-0.15 * m, 24.5], [-5.8 * m, 18], [-6.6 * m, 13], [-5.2 * m, 12.5], [-6 * m, 10.4]])}Z" fill="${tone}" stroke="rgba(0,0,0,.5)" stroke-width="${(.3 * s).toFixed(2)}"/>`
  return `<path d="M${P([[-3.7, 9], [0, 24.5], [3.7, 9]])}Z" fill="#ecebe7"/>
    <path d="M${P([[-1.05, 10.1], [1.05, 10.1], [.75, 12.1], [1.55, 21.6], [0, 23.6], [-1.55, 21.6], [-.75, 12.1]])}Z" fill="${tie}"/>
    <path d="M${P([[-2.7, 8.3], [-.3, 10.4], [-2.4, 12.6]])}Z" fill="#f6f5f2"/><path d="M${P([[2.7, 8.3], [.3, 10.4], [2.4, 12.6]])}Z" fill="#f6f5f2"/>
    ${lapel(1)}${lapel(-1)}`
}

function arirang(u) {
  const fig = (x, y, s, tone, tex, tie) => {
    const body = `M${x - 13.2 * s} ${y + 60 * s}V${y + 15.5 * s}Q${x - 13.2 * s} ${y + 10.6 * s} ${x - 8.6 * s} ${y + 9.9 * s}L${x - 2.6 * s} ${y + 8.4 * s}H${x + 2.6 * s}L${x + 8.6 * s} ${y + 9.9 * s}Q${x + 13.2 * s} ${y + 10.6 * s} ${x + 13.2 * s} ${y + 15.5 * s}V${y + 60 * s}Z`
    const head = `<ellipse cx="${x}" cy="${y}" rx="${5.5 * s}" ry="${6.6 * s}"/>`
    const neck = `<rect x="${x - 2.4 * s}" y="${y + 4.6 * s}" width="${4.8 * s}" height="${4.6 * s}"/>`
    const shape = `${head}${neck}<path d="${body}"/>`
    return `<g>
      <g fill="${tone}" stroke="rgba(0,0,0,.45)" stroke-width=".45">${head}<path d="${body}"/></g><g fill="${tone}">${neck}</g>
      ${tex ? `<g fill="url(#${tex}${u})">${shape}</g>` : ''}
      <g fill="url(#lit${u})">${shape}</g>
      ${suitFront(x, y, s, tone, tie)}
    </g>`
  }
  return `<defs>${fabric(u)}
      <linearGradient id="lit${u}" x1="0" y1="0" x2="1" y2=".6"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient>
      <linearGradient id="fl${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset=".35" stop-color="#000" stop-opacity="0"/></linearGradient></defs>
    ${wood(u)}<rect width="100" height="100" fill="url(#fl${u})"/>
    ${fig(20, 22, 1, '#5f6065', 'ck', '#3a3b40')}${fig(40, 20, 1, '#505156', '', '#26272b')}${fig(60, 20, 1, '#66676c', 'pin', '#9fa0a6')}${fig(80, 22, 1, '#56575c', 'hb', '#2f3035')}
    ${fig(30, 39, 1.12, '#4f5055', 'pin', '#2a2b2f')}${fig(50, 37, 1.14, '#47484d', '', '#8e8f95')}${fig(70, 39, 1.12, '#5a5b60', 'pin', '#26272b')}
    ${arirangMark(50, 80, 11.2, u)}`
}

/* ── Faces ──────────────────────────────────────────────────────────── */

function shape(c, x, y, s) {
  if (c === 'r') return `<circle cx="${x}" cy="${y}" r="${s}" fill="${INK}"/>`
  if (c === 'y') return `<path d="M${x} ${y - s * 1.1}L${x + s * 1.15} ${y + s * .9}H${x - s * 1.15}Z" fill="${INK}"/>`
  if (c === 'g') return `<rect x="${x - s * .9}" y="${y - s * .9}" width="${s * 1.8}" height="${s * 1.8}" fill="${INK}"/>`
  return `<path d="M${x} ${y - s * 1.25}L${x + s * 1.05} ${y}L${x} ${y + s * 1.25}L${x - s * 1.05} ${y}Z" fill="${INK}"/>`
}

// The header value, drawn as geometry so every action reads the same in
// any font: a numeral, ⊘ Skip, ⇄ Reverse, +2, ✦ Wild, +4 Wild Draw Four.
function value(k, x, y) {
  const txt = (t, size) => `<text x="${x}" y="${y + size * .36}" text-anchor="middle" font-family="Outfit, sans-serif" font-weight="900" font-size="${size}" letter-spacing="${t.length > 1 ? -.05 * size : 0}" fill="${INK}">${t}</text>`
  const line = (d, w) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`
  const s = 16
  if (/^[0-9]$/.test(k)) return txt(k, 19)
  if (k === 'd2') return txt('+2', s * .84)
  if (k === 'wd4') return txt('+4', s * .84)
  if (k === 'skip') { const r = s * .3; return line(`M${x + r} ${y}A${r} ${r} 0 1 1 ${x - r} ${y}A${r} ${r} 0 1 1 ${x + r} ${y}ZM${x - r * .7} ${y + r * .7}L${x + r * .7} ${y - r * .7}`, s * .12) }
  if (k === 'rev') { const a = s * .32, b = s * .15, h = s * .12; return line(`M${x - a} ${y - b}H${x + a}M${x + a - h} ${y - b - h}L${x + a} ${y - b}L${x + a - h} ${y - b + h}M${x + a} ${y + b}H${x - a}M${x - a + h} ${y + b - h}L${x - a} ${y + b}L${x - a + h} ${y + b + h}`, s * .11) }
  const q = s * .4, t = s * .09 // wild: a four-point star
  return `<path d="M${x} ${y - q}Q${x + t} ${y - t} ${x + q} ${y}Q${x + t} ${y + t} ${x} ${y + q}Q${x - t} ${y + t} ${x - q} ${y}Q${x - t} ${y - t} ${x} ${y - q}Z" fill="${INK}"/>`
}

const svg = (body) => `<svg class="ra-card-art" viewBox="0 0 62 88" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${body}</svg>`

/** The face for { c, k }. `c` is 'r' | 'y' | 'g' | 'b', or 'w' for wilds. */
export function cardFaceSvg(c, k) {
  const u = nextId()
  const era = MOTIF[ERA_OF[k]]
  const band = c === 'w'
    ? ORDER.map((cc, i) => `<rect x="${i * 15.5}" width="15.5" height="${HB}" fill="${COL[cc]}"/>`).join('')
    : `<rect width="62" height="${HB}" fill="${COL[c] || '#888'}"/>`
  return svg(`<clipPath id="c${u}"><rect y="${HB}" width="62" height="${88 - HB}"/></clipPath>
    <rect width="62" height="88" fill="#000"/>
    ${era ? `<g clip-path="url(#c${u})"><g transform="translate(-5 ${HB}) scale(.72)">${era(u)}</g></g>` : ''}
    ${band}<rect y="${HB - .5}" width="62" height=".5" fill="rgba(0,0,0,.35)"/>
    ${value(String(k), 9.6, HB / 2 + .3)}${c === 'w' ? '' : shape(c, 23.6, HB / 2, 3)}`)
}

/** The back: sixteen era colours in one band, WAR OF CARDS on top. The
 *  plate is wider than the old two-word RUN AMI; textLength holds each line
 *  inside it whatever the font's real widths turn out to be. */
export function cardBackSvg() {
  const stripes = JOURNEY.map((a, i) => `<rect x="${-40 + i * 9}" y="-20" width="9" height="140" fill="${a}"/>`).join('')
  return svg(`<g transform="rotate(28 31 44)">${stripes}</g><rect x="6" y="30" width="50" height="28" rx="5" fill="${INK}"/>
    <text x="31" y="42" text-anchor="middle" font-family="Outfit, sans-serif" font-weight="900" font-size="9.5" textLength="38" lengthAdjust="spacingAndGlyphs" fill="#fff">WAR OF</text>
    <text x="31" y="52.6" text-anchor="middle" font-family="Outfit, sans-serif" font-weight="900" font-size="9.5" textLength="38" lengthAdjust="spacingAndGlyphs" fill="#fff">CARDS</text>`)
}
