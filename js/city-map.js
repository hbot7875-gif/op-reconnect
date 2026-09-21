// The city, drawn from above.
//
// Deliberately top-down: a building seen from above is a rectangle, a road is
// a line, a river is a shape. That's vector design work, which code does well
// — unlike elevation views, which are painting, which code does badly. Three
// previous attempts failed on exactly that distinction.
//
// The plan is RADIAL, and that's the whole idea: Home Base sits dead centre
// with the ARMY Bomb inside it, and the seven city wards ring it like slices,
// each joined back to the core by a conduit that lights when that ward starts
// coming back. You are reconnecting the city outward from the relay, so the
// map should look like that.
//
// It replaced a 3x3 grid of quadrilaterals tiling a rectangle. No amount of
// block jitter, glow or landmark detail could stop that reading as a
// dashboard, because the geometry itself was a spreadsheet. Angular width is
// proportional to a ward's real district count, so Echo Quarter's 86 genuinely
// dominates the map the way its description says it should.

import { wardDisplayName } from './ward-tiles.js'
import { fmtLeftShort } from './countdown.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
export function n(tag, attrs, text) {
  const node = document.createElementNS(SVG_NS, tag)
  for (const k in attrs) node.setAttribute(k, attrs[k])
  if (text !== undefined) node.textContent = text
  return node
}

function hashStr(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const CITY_W = 100
export const CITY_H = 100         // square: a radial plan wants a square canvas
export const CITY_H_ART = 56.3    // matches city-dark.webp at 1672x941

const CX = 50, CY = 50
const CORE_R = 12                 // Home Base
const RING_IN = 16                // where the ward ring starts
const RING_OUT = 43               // ...and roughly where the coast is

/** Where each ward sits on the illustrated map, as [x, y, radius] in viewBox
 *  units. Hand-placed against the artwork's islands — the centre plaza is left
 *  free because that's the ARMY Bomb. Order matches state.map.wards.
 *  Exported so landing-map.js can drop its own redacted markers onto the same
 *  islands without re-deriving the coordinates. Used only by renderArtOverlay
 *  and the landing page; the drawn plan below is radial and ignores these. */
export const ISLANDS = [
  [18, 10.5, 13], [47, 12, 12.5], [68, 12, 9],
  [88, 15, 9],    [20, 26, 12],   [68, 28, 9],
  [20, 43, 11],   [47, 43, 13],   [70, 44, 10],
]

/** Home Base is the core, never a slice. Everything else rings it, clockwise
 *  from the top in story order. */
const CORE_WARD = 'relay-zero'
const RING_ORDER = ['mono', 'happy', 'dday', 'hopeworld', 'golden', 'friends', 'oldgrid']

const pt = (a, r) => [CX + Math.cos(a) * r, CY + Math.sin(a) * r]
const pointsAttr = (pts) => pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ')

/** A wavy coastline instead of a clean circle. Two sine terms at different
 *  frequencies give an irregular edge that's still smooth and — because it's
 *  a pure function of the angle — identical on every render. */
function coastR(a) {
  return RING_OUT + Math.sin(a * 3 + 0.7) * 2.6 + Math.sin(a * 5.3 + 2.1) * 1.5
}

/** One ward's slice, as a polygon: along the inner arc, then back along the
 *  coast. `gap` opens a small street between neighbouring wards. */
function wedgePts(a0, a1, gap = 0.02) {
  const s = a0 + gap, e = a1 - gap
  const steps = Math.max(5, Math.round((e - s) / 0.1))
  const out = []
  for (let i = 0; i <= steps; i++) out.push(pt(s + (e - s) * (i / steps), RING_IN))
  for (let i = steps; i >= 0; i--) {
    const a = s + (e - s) * (i / steps)
    out.push(pt(a, coastR(a)))
  }
  return out
}

/** Map labels are tight, and every one of these is a ward, so the words that
 *  say so can go: "Sector Layover" → "Layover", "The Old Grid" → "Old Grid".
 *  The full name is always one row away in the ward list. */
function mapLabel(name) {
  return String(name || '')
    .replace(/\s+ward$/i, '')
    .replace(/^sector\s+/i, '')
    .replace(/^the\s+/i, '')
}

/** Buildings laid out in POLAR space, so they fill a wedge properly and sit
 *  square-on to the ring roads. A cartesian grid clipped to a wedge threw most
 *  of its blocks away, which broke the one-block-per-district promise the
 *  moment a ward wasn't a rectangle. */
function polarBlocks(a0, a1, count, seed) {
  const span = a1 - a0
  const midR = (RING_IN + RING_OUT) / 2
  const radial = RING_OUT - RING_IN
  const arc = midR * span
  const rings = Math.max(1, Math.round(Math.sqrt(Math.max(1, count) * radial / Math.max(0.001, arc))))
  const per = Math.ceil(Math.max(1, count) / rings)
  const r = rng(seed)
  const out = []
  for (let i = 0; i < count; i++) {
    const ring = Math.floor(i / per), k = i % per
    const cellR = radial / rings, cellA = span / per
    const rr = RING_IN + cellR * (ring + 0.5) + (r() - 0.5) * cellR * 0.28
    const aa = a0 + cellA * (k + 0.5) + (r() - 0.5) * cellA * 0.28
    const long = r() < 0.2
    const w = Math.min(rr * cellA * 0.6, 2.3) * (long ? 1.5 : 1) * (0.62 + r() * 0.55)
    const h = Math.min(cellR * 0.52, 1.6) * (0.6 + r() * 0.6)
    const [x, y] = pt(aa, rr)
    out.push({
      x, y, w, h,
      rot: (aa * 180) / Math.PI + 90,
      // Fake elevation. Top-down can't show height, but a darker body behind
      // each roof reads as a building rather than a floor tile.
      lift: 0.25 + r() * 0.45,
    })
  }
  return { blocks: out, rings, per }
}

/** Ring roads and radial avenues, on the same grid the blocks were laid to. */
function streetsFor(g, a0, a1, rings, per) {
  const radial = RING_OUT - RING_IN
  for (let i = 1; i < rings; i++) {
    const rr = RING_IN + (radial / rings) * i
    const p0 = pt(a0, rr), p1 = pt(a1, rr)
    g.appendChild(n('path', {
      d: `M${p0[0].toFixed(2)} ${p0[1].toFixed(2)} A${rr.toFixed(2)} ${rr.toFixed(2)} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}`,
      class: 'cm-street', fill: 'none',
    }))
  }
  const avenues = Math.min(6, Math.max(1, Math.round((a1 - a0) / 0.35)))
  for (let i = 1; i < avenues; i++) {
    const a = a0 + ((a1 - a0) / avenues) * i
    const p0 = pt(a, RING_IN), p1 = pt(a, coastR(a))
    g.appendChild(n('line', {
      x1: p0[0].toFixed(2), y1: p0[1].toFixed(2), x2: p1[0].toFixed(2), y2: p1[1].toFixed(2),
      class: 'cm-street',
    }))
  }
}

/** One district's contribution to the map: is its block lit, mid-restore, or
 *  still dark. Mirrors ward-tiles.js's stateOf so a district reads the same
 *  whether you're looking at the skyline or the city plan. */
function blockClass(d) {
  if (!d) return ''
  if (d.status === 'restored' || d.status === 'centerpiece_lit') return ' lit'
  if (d.status === 'active') return ' now'
  return ''
}

/* ── landmarks ──────────────────────────────────────────────────────────
   The best thing about the illustrated maps we tried was that shape told you
   where you were before you read a word: the ferris wheel IS Happy Ward.
   Generated art couldn't give us that reliably — two images never came back
   the same — so the landmarks are drawn here, where they're exact and cheap
   and light up with their ward. */
const LANDMARKS = {
  // Mono — the Silent Observatory: a domed telescope between two towers.
  mono(g, x, y) {
    g.appendChild(n('rect', { x: x - 3.3, y: y - 2.2, width: 0.9, height: 4.4, class: 'cm-lm-s' }))
    g.appendChild(n('rect', { x: x + 2.4, y: y - 1.4, width: 0.9, height: 3.6, class: 'cm-lm-s' }))
    g.appendChild(n('circle', { cx: x, cy: y, r: 2.1, class: 'cm-lm-s' }))
    g.appendChild(n('path', { d: `M${x - 2.1} ${y} A2.1 2.1 0 0 1 ${x + 2.1} ${y}`, class: 'cm-lm-l' }))
  },
  // Happy — Festival Square: the ferris wheel.
  happy(g, x, y) {
    g.appendChild(n('circle', { cx: x, cy: y, r: 2.6, class: 'cm-lm-o' }))
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      g.appendChild(n('line', {
        x1: x, y1: y, x2: (x + Math.cos(a) * 2.6).toFixed(2), y2: (y + Math.sin(a) * 2.6).toFixed(2),
        class: 'cm-lm-spoke',
      }))
    }
    g.appendChild(n('circle', { cx: x, cy: y, r: 0.55, class: 'cm-lm-l' }))
  },
  // D-Day — the Midnight Foundry: three chimneys on a shed.
  dday(g, x, y) {
    g.appendChild(n('rect', { x: x - 3.4, y: y + 0.6, width: 6.8, height: 1.8, class: 'cm-lm-s' }))
    ;[[-2.2, 3.4], [0, 4.6], [2.2, 3.8]].forEach(([dx, h]) => {
      g.appendChild(n('rect', { x: x + dx - 0.45, y: y + 0.6 - h, width: 0.9, height: h, class: 'cm-lm-s' }))
      g.appendChild(n('circle', { cx: x + dx, cy: y + 0.6 - h, r: 0.42, class: 'cm-lm-l' }))
    })
  },
  // Hopeworld — the Sun Relay Tower over its concert bowl.
  hopeworld(g, x, y) {
    g.appendChild(n('ellipse', { cx: x, cy: y + 0.4, rx: 4.2, ry: 2.6, class: 'cm-lm-o' }))
    g.appendChild(n('ellipse', { cx: x, cy: y + 0.4, rx: 2.4, ry: 1.4, class: 'cm-lm-l' }))
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      g.appendChild(n('line', {
        x1: (x + Math.cos(a) * 2.4).toFixed(2), y1: (y + 0.4 + Math.sin(a) * 1.4).toFixed(2),
        x2: (x + Math.cos(a) * 4.2).toFixed(2), y2: (y + 0.4 + Math.sin(a) * 2.6).toFixed(2),
        class: 'cm-lm-spoke',
      }))
    }
  },
  // Golden — the Golden Spire, dwarfing everything around it.
  golden(g, x, y) {
    g.appendChild(n('polygon', { points: `${x},${y - 5.2} ${x + 1.5},${y + 2.4} ${x - 1.5},${y + 2.4}`, class: 'cm-lm-s' }))
    g.appendChild(n('polygon', { points: `${x},${y - 5.2} ${x + 0.6},${y - 1.2} ${x - 0.6},${y - 1.2}`, class: 'cm-lm-l' }))
    g.appendChild(n('circle', { cx: x, cy: y - 5.2, r: 0.5, class: 'cm-lm-l' }))
  },
  // Friends — the Evening Hearth: a row of porch lights.
  friends(g, x, y) {
    ;[-3, 0, 3].forEach((dx) => {
      g.appendChild(n('polygon', {
        points: `${x + dx},${y - 1.9} ${x + dx + 1.7},${y - 0.4} ${x + dx + 1.7},${y + 1.6} ${x + dx - 1.7},${y + 1.6} ${x + dx - 1.7},${y - 0.4}`,
        class: 'cm-lm-s',
      }))
      g.appendChild(n('circle', { cx: x + dx, cy: y + 0.5, r: 0.42, class: 'cm-lm-l' }))
    })
  },
  // Echo Quarter — the Echo Chamber: rings going out.
  oldgrid(g, x, y) {
    ;[1.5, 2.9, 4.3].forEach((r) => g.appendChild(n('circle', { cx: x, cy: y, r, class: 'cm-lm-o' })))
    g.appendChild(n('circle', { cx: x, cy: y, r: 0.7, class: 'cm-lm-l' }))
  },
}

/** Ward markers over the illustration. The artwork's buildings are pixels, so
 *  restoration can't light them individually the way the drawn city does —
 *  instead each island gains a warm glow that grows with its progress, which
 *  is what "the district got its power back" looks like from above anyway. */
export function renderArtOverlay(wards, onSelect) {
  const svg = n('svg', {
    class: 'city-art', viewBox: `0 0 ${CITY_W} ${CITY_H_ART}`, 'aria-hidden': 'true',
  })
  const defs = n('defs', {})
  for (const [id, rgb] of [['cm-g-lit', '217,173,95'], ['cm-g-active', '167,139,250'], ['cm-g-alert', '229,56,79']]) {
    const grad = n('radialGradient', { id })
    grad.appendChild(n('stop', { offset: '0%', 'stop-color': `rgb(${rgb})`, 'stop-opacity': '0.62' }))
    grad.appendChild(n('stop', { offset: '55%', 'stop-color': `rgb(${rgb})`, 'stop-opacity': '0.26' }))
    grad.appendChild(n('stop', { offset: '100%', 'stop-color': `rgb(${rgb})`, 'stop-opacity': '0' }))
    defs.appendChild(grad)
  }
  svg.appendChild(defs)

  wards.slice(0, ISLANDS.length).forEach((w, i) => {
    const [cx, cy, r] = ISLANDS[i]
    const p = w.totalCount > 0 ? w.restoredCount / w.totalCount : 0
    const locked = w.status === 'locked'
    const g = n('g', { class: `cm-mark ${w.status}` })

    if (!locked && p > 0) {
      g.appendChild(n('circle', {
        cx, cy, r: (r * (0.55 + p * 0.45)).toFixed(2),
        class: 'cm-glow', opacity: (0.35 + p * 0.65).toFixed(2),
      }))
    }
    g.appendChild(n('circle', { cx, cy, r, class: 'cm-hit' }))
    g.appendChild(n('text', { x: cx, y: cy, class: 'cm-mark-name' }, mapLabel(wardDisplayName(w))))
    g.appendChild(n('text', { x: cx, y: cy + 3.6, class: 'cm-mark-count' },
      locked ? 'sealed' : `${w.restoredCount}/${w.totalCount}`))

    if (!locked) {
      g.style.cursor = 'pointer'
      g.onclick = (e) => onSelect(w, { x: e.clientX, y: e.clientY })
    }
    svg.appendChild(g)
  })
  return svg
}

/** A tool's entry point on the map — deliberately NOT a wedge. Every wedge on
 *  this map means "real ward, real districts, real restore state"; Candy
 *  Star has none of that; it's a generator you use wherever you're already
 *  playing. Giving it a wedge would either steal angular width from wards
 *  whose size is supposed to track real district counts, or read as a ward
 *  that can never be restored. Drawn instead as a small satellite just
 *  outside the coastline — never overlaps a wedge at any angle, so it can't
 *  be mistaken for one — tethered back to the core with a dashed line, same
 *  idea as Home Base's own break from the wedge pattern (it's the reactor,
 *  not a restoration goal, so it isn't drawn as one either). */
function toolMarker(angle, icon, label, onClick, extraClass) {
  // r=49: clears the coastline (max ~46.7) with room to spare, and stays
  // inside the viewBox edge (55 units from centre in any direction, since
  // the canvas is square and PAD is uniform) once the halo's own radius is
  // added on top.
  const [mx, my] = pt(angle, 49)
  const [tx, ty] = pt(angle, RING_IN)
  const g = n('g', { class: 'cm-tool' + (extraClass ? ` ${extraClass}` : '') })
  g.appendChild(n('line', {
    x1: tx.toFixed(2), y1: ty.toFixed(2), x2: mx.toFixed(2), y2: my.toFixed(2), class: 'cm-tool-line',
  }))
  g.appendChild(n('circle', { cx: mx.toFixed(2), cy: my.toFixed(2), r: 5.6, class: 'cm-tool-halo' }))
  g.appendChild(n('circle', { cx: mx.toFixed(2), cy: my.toFixed(2), r: 3.8, class: 'cm-tool-body' }))
  g.appendChild(n('text', { x: mx.toFixed(2), y: (my + 1.3).toFixed(2), class: 'cm-tool-icon' }, icon))
  // 6.4, not 8.6: at 8.6 the label landed at radius ~40.4 and the ward
  // names sit at ~38.7, so Magic Shop's label printed on top of Mono's on a
  // real phone (measured at 375px: 1px apart vertically, fully overlapping
  // horizontally). Candy Star only looked fine because no ward label sits
  // under it. Pulling the label back toward its own icon clears that ring.
  //
  // A single centred line only works while mx has room on both sides — true
  // at ±π/2, where mx sits dead-centre. At the horizontal extremes (angle 0
  // or π, Candy Star/Magic Shop's spot) mx sits right by the viewBox edge,
  // so a one-line label either clips past that edge, or — if pushed inward
  // instead — runs straight into the ward sitting at that same angle's own
  // name (measured: "Magic Shop" landed flush on top of "D-Day"). Splitting
  // a two-word label onto two centred lines keeps each line's own footprint
  // small enough to clear both problems at once without moving off-centre.
  const nx = Math.cos(angle)
  const words = label.split(' ')
  if (Math.abs(nx) > 0.55 && words.length > 1) {
    g.appendChild(n('text', { x: mx.toFixed(2), y: (my + 5.7).toFixed(2), class: 'cm-tool-label' }, words[0]))
    g.appendChild(n('text', { x: mx.toFixed(2), y: (my + 8.1).toFixed(2), class: 'cm-tool-label' }, words.slice(1).join(' ')))
  } else {
    g.appendChild(n('text', { x: mx.toFixed(2), y: (my + 6.4).toFixed(2), class: 'cm-tool-label' }, label))
  }
  if (onClick) {
    g.style.cursor = 'pointer'
    g.onclick = (e) => onClick({ x: e.clientX, y: e.clientY })
  }
  return g
}

/** ARIRANG RE:CELEBRATE's map object — a tiny Gwanghwamun-inspired gate
 *  landmark at its own seam (see the placement comment where this is
 *  called), not a tool marker or a generic festival stage. Deliberately NOT
 *  built from toolMarker: a circle + dashed tether reads as a UI control
 *  sitting on the map (an app button), which is exactly wrong for "a real
 *  place recreated inside the City." Simplified, ReConnect-native shapes
 *  only — a wide hanok gate wall with arched openings, its iconic upturned
 *  roofline above, and a lit plaza with crowd lights out front — inspired
 *  by the comeback-day Gwanghwamun Square atmosphere, not a traced photo.
 *  `live` changes how MUCH of it is lit (dim/mid-rig before the event, fully
 *  alive once it opens) rather than hiding the venue behind a lock icon.
 *  @param angle    polar angle, radians (see pt() above)
 *  @param onClick  ({x,y}) => void
 *  @param live     whether the party has actually opened
 *  @param deadlineIso  ISO string the countdown label ticks down to
 *  @param complete     whether the event is now a permanent archive */
function partyVenue(angle, onClick, live, deadlineIso, complete = false) {
  // r=47, not the usual 49: this landmark's own roofline/glow reach further
  // off its anchor point than a toolMarker's halo does, and at the top seam
  // (mx=50, dead centre) that extra reach landed the roofline within 0.2
  // viewBox units of the top edge at r=49 — inside the safety margin on
  // paper, but not in practice. coastR at this exact angle is ~45.1 (well
  // under its ~46.7 max elsewhere), so 47 still clears the coastline with
  // room to spare while pulling the roofline back from the top edge.
  const [mx, my] = pt(angle, 47)
  const gx = (dx) => (mx + dx).toFixed(2)
  const gy = (dy) => (my + dy).toFixed(2)
  const g = n('g', { class: `cm-party ${live ? 'is-party-live' : 'is-party-setup'}${complete ? ' is-party-complete' : ''}` })

  // Historic gate standing INSIDE a modern comeback stage: a nested LED
  // frame and two light columns around it, red stage light washing the
  // stone from below, a few narrow beams reaching up, a sparse row of ARMY
  // Bombs out front. The building keeps its own warm stone/dark-tile colours;
  // only the light is red. No halo, no bloom, no outlines.
  const defs = n('defs', {})
  const grad = (id, stops) => {
    const lg = n('linearGradient', { id, x1: '0', y1: '0', x2: '0', y2: '1' })
    stops.forEach(([o, c]) => lg.appendChild(n('stop', { offset: o, 'stop-color': c })))
    defs.appendChild(lg)
  }
  grad('cm-party-stone', [['0', '#6f665d'], ['0.55', '#7d6a5f'], ['1', '#a2483f']])
  grad('cm-party-backdrop', [['0', '#060506'], ['0.7', '#12080a'], ['1', '#2a0c10']])
  grad('cm-party-beamfill', [['0', 'rgba(255,236,220,0)'], ['1', 'rgba(255,226,206,0.9)']])
  grad('cm-party-redbeam', [['0', 'rgba(214,52,70,0)'], ['1', 'rgba(232,70,96,0.95)']])
  // Red wash rising up the stone from the stage floor — light on the
  // building, fading out well before the roof so the roofline stays dark.
  const wash = n('linearGradient', { id: 'cm-party-wash', x1: '0', y1: '0', x2: '0', y2: '1' })
  wash.appendChild(n('stop', { offset: '0', 'stop-color': '#e8465e', 'stop-opacity': '0' }))
  wash.appendChild(n('stop', { offset: '1', 'stop-color': '#e8465e', 'stop-opacity': '0.75' }))
  defs.appendChild(wash)
  const radial = (id, stops) => {
    const rg = n('radialGradient', { id, cx: '0.5', cy: '0.5', r: '0.5' })
    stops.forEach(([o, c, a]) => rg.appendChild(n('stop', { offset: o, 'stop-color': c, 'stop-opacity': a })))
    defs.appendChild(rg)
  }
  // Localized light pool: red/pink spill onto the map around and below the
  // venue, and a haze behind the rig for the beams to read through. Radial
  // gradients with hard falloff, not a blur filter — so the light stays a
  // local pool and never smears over the architecture drawn on top.
  radial('cm-party-spill', [['0', '#ff4f72', '0.9'], ['0.3', '#e6405a', '0.5'], ['0.65', '#c8343f', '0.16'], ['1', '#c8343f', '0']])
  radial('cm-party-haze', [['0', '#ff6f92', '0.62'], ['0.5', '#d8364c', '0.24'], ['1', '#c8343f', '0']])
  radial('cm-party-core', [['0', '#ff5a78', '0.85'], ['0.45', '#e03a54', '0.38'], ['1', '#c8343f', '0']])
  g.appendChild(defs)

  // Light layers, all BEHIND the structure.
  g.appendChild(n('ellipse', { cx: gx(0), cy: gy(3.4), rx: 16, ry: 9, class: 'cm-party-spill' }))
  g.appendChild(n('ellipse', { cx: gx(0), cy: gy(-3.4), rx: 8.2, ry: 5.6, class: 'cm-party-haze' }))
  // Party open only: a concentrated red light pool right at the stage, so
  // the energy reads as coming from the venue rather than a wash under the
  // label, and the concert beams — red ones fanning high and outward, two
  // warm-white ones between them for contrast.
  g.appendChild(n('ellipse', { cx: gx(0), cy: gy(-2.2), rx: 7.4, ry: 4.6, class: 'cm-party-core cm-party-live-only' }))
  ;[[-5.6, -3.4, 'cm-party-redbeam', 13.5], [-4.6, -0.9, 'cm-party-beamfill', 11.5], [0, 0, 'cm-party-redbeam', 13],
    [4.6, 0.9, 'cm-party-beamfill', 11.5], [5.6, 3.4, 'cm-party-redbeam', 13.5]]
    .forEach(([bx, lean, fill, h], i) => {
      const beam = n('polygon', {
        points: `${gx(bx - 0.14)},${gy(-0.4)} ${gx(bx + 0.14)},${gy(-0.4)} ${gx(bx + lean + 0.6)},${gy(-h)} ${gx(bx + lean - 0.6)},${gy(-h)}`,
        class: `cm-party-skybeam ${fill === 'cm-party-redbeam' ? 'cm-party-skybeam-red' : 'cm-party-skybeam-white'} cm-party-live-only`,
        fill: `url(#${fill})`,
      })
      beam.style.setProperty('--i', String(i))
      g.appendChild(beam)
    })

  g.appendChild(n('ellipse', { cx: gx(0), cy: gy(1.0), rx: 6.0, ry: 0.8, class: 'cm-party-shadow' }))

  ;[-5.3, 5.3].forEach((cx) => {
    g.appendChild(n('rect', { x: gx(cx - 0.16), y: gy(-6.4), width: 0.32, height: 6.2, class: 'cm-party-column' }))
  })

  // Stage opening, darkest at the top so the roofline reads against it.
  g.appendChild(n('rect', { x: gx(-4.5), y: gy(-6.1), width: 9, height: 5.8, class: 'cm-party-void' }))

  // Narrow upward beams from the stage floor, behind the gate: warm white in
  // the middle, red either side.
  ;[[-3.3, 'cm-party-beam-red'], [0, 'cm-party-beam-white'], [3.3, 'cm-party-beam-red']].forEach(([bx, cls], i) => {
    const beam = n('polygon', {
      points: `${gx(bx - 0.12)},${gy(-0.4)} ${gx(bx + 0.12)},${gy(-0.4)} ${gx(bx + 0.45 * (bx >= 0 ? 1 : -1) + 0.3)},${gy(-5.9)} ${gx(bx + 0.45 * (bx >= 0 ? 1 : -1) - 0.3)},${gy(-5.9)}`,
      class: `cm-party-beam ${cls}`,
    })
    beam.style.setProperty('--i', String(i))
    g.appendChild(beam)
  })

  g.appendChild(n('rect', { x: gx(-3.3), y: gy(-2.5), width: 6.6, height: 2.2, class: 'cm-party-wall' }))
  ;[-1.6, 0, 1.6].forEach((ax) => {
    g.appendChild(n('path', {
      d: `M ${gx(ax - 0.4)} ${gy(-0.3)} L ${gx(ax - 0.4)} ${gy(-1.4)}
          A 0.4 0.4 0 0 1 ${gx(ax + 0.4)} ${gy(-1.4)} L ${gx(ax + 0.4)} ${gy(-0.3)} Z`,
      class: 'cm-party-arch',
    }))
  })
  g.appendChild(n('rect', { x: gx(-3.3), y: gy(-2.5), width: 6.6, height: 2.2, class: 'cm-party-wash', fill: 'url(#cm-party-wash)' }))

  // Two roof tiers with the eave tips kicking up, wooden pavilion between.
  g.appendChild(n('path', {
    d: `M ${gx(-3.9)} ${gy(-2.8)} Q ${gx(-3.3)} ${gy(-2.52)} ${gx(-2.8)} ${gy(-2.47)} L ${gx(2.8)} ${gy(-2.47)}
        Q ${gx(3.3)} ${gy(-2.52)} ${gx(3.9)} ${gy(-2.8)} L ${gx(3.1)} ${gy(-3.15)} L ${gx(-3.1)} ${gy(-3.15)} Z`,
    class: 'cm-party-roof',
  }))
  g.appendChild(n('rect', { x: gx(-2.5), y: gy(-3.62), width: 5.0, height: 0.47, class: 'cm-party-band' }))
  g.appendChild(n('path', {
    d: `M ${gx(-3.3)} ${gy(-3.88)} Q ${gx(-2.8)} ${gy(-3.64)} ${gx(-2.4)} ${gy(-3.6)} L ${gx(2.4)} ${gy(-3.6)}
        Q ${gx(2.8)} ${gy(-3.64)} ${gx(3.3)} ${gy(-3.88)} L ${gx(2.5)} ${gy(-4.35)} L ${gx(-2.5)} ${gy(-4.35)} Z`,
    class: 'cm-party-roof',
  }))

  // The modern rig: nested LED frame, top truss.
  g.appendChild(n('rect', { x: gx(-4.5), y: gy(-6.1), width: 9, height: 5.8, class: 'cm-party-frame' }))
  g.appendChild(n('rect', { x: gx(-4.1), y: gy(-5.7), width: 8.2, height: 5.4, class: 'cm-party-frame-in' }))
  g.appendChild(n('rect', { x: gx(-4.7), y: gy(-6.4), width: 9.4, height: 0.3, class: 'cm-party-truss' }))

  // Stage deck with a row of small red uplights along its lip.
  g.appendChild(n('rect', { x: gx(-5.8), y: gy(-0.3), width: 11.6, height: 0.5, class: 'cm-party-stage' }))
  g.appendChild(n('rect', { x: gx(-6.2), y: gy(0.2), width: 12.4, height: 0.3, class: 'cm-party-stage' }))
  ;[-3.6, -1.2, 1.2, 3.6].forEach((ux) => {
    g.appendChild(n('rect', { x: gx(ux - 0.22), y: gy(-0.36), width: 0.44, height: 0.12, class: 'cm-party-uplight' }))
  })

  // A sparse row of ARMY Bombs out front.
  ;[[-4.2, 0.95], [-2.5, 1.2], [-0.8, 0.95], [0.9, 1.2], [2.6, 0.95], [4.3, 1.15]].forEach(([dx, dy], i) => {
    const b = n('circle', { cx: gx(dx), cy: gy(dy), r: 0.17, class: 'cm-party-bomblight' })
    b.style.setProperty('--i', String(i))
    g.appendChild(b)
  })
  // A fuller crowd once doors open — a second row filling the gaps.
  ;[[-5.1, 1.5], [-3.35, 1.55], [-1.65, 1.5], [0.05, 1.55], [1.75, 1.5], [3.45, 1.55], [5.1, 1.45]].forEach(([dx, dy], i) => {
    const b = n('circle', { cx: gx(dx), cy: gy(dy), r: 0.15, class: 'cm-party-bomblight cm-party-live-only' })
    b.style.setProperty('--i', String(i + 6))
    g.appendChild(b)
  })
  // Small light particles hanging in the air around the venue — a few while
  // the lights warm up, a lot more once the party is on.
  const SPARKS = [
    [-6.8, -3.2, 0], [6.9, -2.6, 0], [-7.4, 0.6, 0], [7.2, 0.9, 0], [-5.9, -7.2, 0], [6.1, -7.6, 0],
    [-8.4, -5.0, 1], [8.3, -4.6, 1], [-7.9, -1.4, 1], [8.0, -0.8, 1], [-6.4, 2.2, 1], [6.6, 2.4, 1],
    [-3.2, -8.6, 1], [3.4, -8.8, 1], [0.2, -9.4, 1], [-9.2, -2.9, 1], [9.1, -3.3, 1], [-8.8, 1.8, 1],
    [8.7, 1.6, 1], [-4.8, -9.6, 1], [4.9, -9.9, 1], [-7.0, -8.4, 1], [7.1, -8.1, 1],
  ]
  SPARKS.forEach(([dx, dy, liveOnly], i) => {
    const sp = n('circle', {
      cx: gx(dx), cy: gy(dy), r: (0.09 + (i % 3) * 0.03).toFixed(2),
      class: `cm-party-spark cm-party-spark-${i % 3}${liveOnly ? ' cm-party-live-only' : ''}`,
    })
    sp.style.setProperty('--i', String(i))
    g.appendChild(sp)
  })

  // Once the event is archived, the animated concert rig settles into a
  // small gold completion seal. It keeps the landmark recognizable while
  // making it impossible to mistake the old stage for a live event.
  if (complete) {
    const seal = n('g', { class: 'cm-party-complete-mark', 'aria-hidden': 'true' })
    seal.appendChild(n('circle', { cx: gx(0), cy: gy(-5.15), r: 1.15 }))
    seal.appendChild(n('path', {
      d: `M ${gx(-0.48)} ${gy(-5.12)} L ${gx(-0.12)} ${gy(-4.76)} L ${gx(0.58)} ${gy(-5.53)}`,
    }))
    g.appendChild(seal)
  }


  const title = n('text', { x: gx(0), y: gy(3.9), class: 'cm-party-title' }, 'RE:CELEBRATE ✦')
  g.appendChild(title)

  const cd = n('text', { x: gx(0), y: gy(6.6), class: 'cm-party-countdown' })
  if (complete) {
    cd.appendChild(n('tspan', {}, 'COMPLETE ✦'))
  } else if (live) {
    cd.appendChild(n('tspan', {}, 'PARTY LIVE ✦'))
  } else {
    cd.appendChild(n('tspan', {}, 'PARTY IN '))
    const dyn = n('tspan', {}, deadlineIso ? fmtLeftShort(new Date(deadlineIso).getTime() - Date.now()) : '')
    if (deadlineIso) { dyn.dataset.deadline = deadlineIso; dyn.dataset.format = 'short' }
    cd.appendChild(dyn)
  }
  g.appendChild(cd)

  if (onClick) {
    g.style.cursor = 'pointer'
    g.onclick = (e) => onClick({ x: e.clientX, y: e.clientY })
  }
  return g
}

/**
 * The whole city, drawn, with one block per district and Home Base at the
 * centre of it.
 *
 * @param wards      state.map.wards
 * @param districts  state.map.districts — every district, so each one owns a
 *                   block that lights when THAT district comes back. Pass an
 *                   empty array and it falls back to lighting `restoredCount`
 *                   blocks per ward.
 * @param onSelect   (ward, {x,y}) => void
 * @param homeFraction  0..1 — how far YOUR OWN Home Base restoration has
 *                      gotten, driving the ring at the centre. Deliberately
 *                      not state.bomb.charge: that's the network-wide pooled
 *                      charge every agent shares, and showing it here read as
 *                      personal progress when it wasn't — an agent with zero
 *                      streams saw a lit ring because other agents had been
 *                      streaming. This ring is solo, same number as the
 *                      "NOW RESTORING" card's own percentage.
 * @param onCandyStar  ({x,y}) => void — optional. Draws the Candy Star tool
 *                     marker (see toolMarker above) when passed, flanking the
 *                     ring's west side.
 * @param onMagicShop  ({x,y}) => void — optional. Same tool-marker treatment,
 *                     flanking the ring's east side: a real world destination
 *                     you GO to (buy Wings, claim a Ticket), not inventory —
 *                     that stays in Agent Pack.
 * @param onVma        ({x,y}) => void — optional. A temporary live-event
 *                     marker, not a permanent tool like the two above — see
 *                     its own placement comment below.
 * @param vmaPulse     whether to pulse the VMA marker gold (Power Hour /
 *                     Double Day) rather than its plain resting purple.
 * @param onGoldenCorner ({x,y}) => void — optional birthday-room location.
 * @param goldenProgress 0..1 — gently lights its map marker with the room.
 * @param onParty      ({x,y}) => void — optional. The ARIRANG RE:CELEBRATE
 *                     pre-event venue (see partyVenue above and
 *                     arirang-recelebrate.js), holding the ring's top seam —
 *                     see its own placement comment below.
 * @param partyLive    whether the party has actually opened yet — swaps the
 *                     venue from "being set up" to fully lit.
 * @param partyDeadlineIso  ISO string the venue's countdown label ticks
 *                          down to. Ignored once partyLive is true.
 * @param partyComplete     whether the venue should read as an archive.
 */
export function renderCityMap(wards, districts, onSelect, homeFraction, onCandyStar, onMagicShop, onVma, vmaPulse, onGoldenCorner, goldenProgress = 0, onParty, partyLive = false, partyDeadlineIso = null, partyComplete = false) {
  const PAD = 5
  const svg = n('svg', {
    class: 'city-map', 'aria-hidden': 'true',
    viewBox: `${-PAD} ${-PAD} ${CITY_W + PAD * 2} ${CITY_H + PAD * 2}`,
  })
  const defs = n('defs', {})
  svg.appendChild(defs)

  // Bloom over a copy of the lit roofs rather than a glow per element — 248
  // individually-filtered rects would cost far more for the same picture.
  const blur = n('filter', { id: 'cm-bloom', x: '-30%', y: '-30%', width: '160%', height: '160%' })
  blur.appendChild(n('feGaussianBlur', { stdDeviation: '1.1' }))
  defs.appendChild(blur)

  svg.appendChild(n('rect', {
    x: -PAD, y: -PAD, width: CITY_W + PAD * 2, height: CITY_H + PAD * 2, class: 'cm-sea',
  }))

  // the island itself, one closed coastline around the whole ring
  const coast = []
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * Math.PI * 2
    coast.push(pt(a, coastR(a) + 1.6))
  }
  svg.appendChild(n('polygon', { points: pointsAttr(coast), class: 'cm-shore' }))
  const land = coast.map((_, i) => {
    const a = (i / 180) * Math.PI * 2
    return pt(a, coastR(a))
  })
  svg.appendChild(n('polygon', { points: pointsAttr(land), class: 'cm-land' }))

  const all = districts || []
  const byId = (id) => wards.find((w) => w.id === id)
  const ring = RING_ORDER.map(byId).filter(Boolean)
  const core = byId(CORE_WARD)

  // Angular width tracks real district count, so Echo Quarter's 86 dominates
  // the map exactly as much as it dominates the city.
  const totalD = ring.reduce((a, w) => a + Math.max(1, w.totalCount || 1), 0) || 1
  const bloom = n('g', { filter: 'url(#cm-bloom)', class: 'cm-bloom' })
  const conduits = n('g', { class: 'cm-conduits' })
  const labels = []

  let a = -Math.PI / 2
  for (const w of ring) {
    const span = (Math.max(1, w.totalCount || 1) / totalD) * Math.PI * 2
    const a0 = a, a1 = a + span
    a = a1
    const locked = w.status === 'locked'
    const mid = (a0 + a1) / 2

    const mine = all.filter((d) => d.wardId === w.id)
      .sort((x, y) => String(x.id).localeCompare(String(y.id)))
    const count = Math.max(mine.length, w.totalCount || 0, 1)

    const pts = wedgePts(a0, a1)
    const clipId = `cm-clip-${w.id}`
    const clip = n('clipPath', { id: clipId })
    clip.appendChild(n('polygon', { points: pointsAttr(pts) }))
    defs.appendChild(clip)

    const g = n('g', { class: `cm-ward ${w.status}` })
    g.appendChild(n('polygon', { points: pointsAttr(pts), class: 'cm-zone' }))

    const fallbackLit = mine.length ? -1
      : (locked ? 0 : Math.round(count * (w.totalCount > 0 ? w.restoredCount / w.totalCount : 0)))

    const { blocks, rings, per } = polarBlocks(a0, a1, count, hashStr(w.id))

    const streets = n('g', { 'clip-path': `url(#${clipId})` })
    streetsFor(streets, a0, a1, rings, per)
    g.appendChild(streets)

    const gb = n('g', { 'clip-path': `url(#${clipId})` })
    const gl = n('g', { 'clip-path': `url(#${clipId})` })
    blocks.forEach((b, bi) => {
      const cls = locked ? ''
        : mine.length ? blockClass(mine[bi])
        : (bi < fallbackLit ? ' lit' : '')
      const base = {
        x: (b.x - b.w / 2).toFixed(2), width: b.w.toFixed(2), height: b.h.toFixed(2), rx: 0.22,
        transform: `rotate(${b.rot.toFixed(1)} ${b.x.toFixed(2)} ${b.y.toFixed(2)})`,
      }
      gb.appendChild(n('rect', { ...base, y: (b.y - b.h / 2).toFixed(2), class: 'cm-body' + cls }))
      gb.appendChild(n('rect', { ...base, y: (b.y - b.h / 2 - b.lift).toFixed(2), class: 'cm-block' + cls }))
      if (cls) {
        gl.appendChild(n('rect', { ...base, y: (b.y - b.h / 2 - b.lift).toFixed(2), class: 'cm-block' + cls }))
      }
    })
    g.appendChild(gb)
    if (gl.childNodes.length) bloom.appendChild(gl)

    // Landmark inner, label outer. Both sat at mid-radius before, which put
    // the ferris wheel directly underneath the word "Happy" — the landmarks
    // were being drawn correctly the whole time and simply couldn't be seen.
    const lm = LANDMARKS[w.id]
    if (lm) {
      const lg = n('g', { class: 'cm-lm' })
      const [lx, ly] = pt(mid, RING_IN + (RING_OUT - RING_IN) * 0.36)
      lm(lg, lx, ly)
      g.appendChild(lg)
    }

    g.appendChild(n('polygon', { points: pointsAttr(pts), class: 'cm-edge' }))

    if (!locked) {
      g.style.cursor = 'pointer'
      g.onclick = (e) => onSelect(w, { x: e.clientX, y: e.clientY })
    }
    svg.appendChild(g)

    // The conduit back to the core: this ward's line to the ARMY Bomb, lit
    // only as far as the ward has actually come back.
    const [ix, iy] = pt(mid, CORE_R)
    const [ox, oy] = pt(mid, RING_IN)
    conduits.appendChild(n('line', {
      x1: ix.toFixed(2), y1: iy.toFixed(2), x2: ox.toFixed(2), y2: oy.toFixed(2),
      class: `cm-conduit ${w.status}`,
    }))

    labels.push({ w, at: pt(mid, RING_IN + (RING_OUT - RING_IN) * 0.84) })
  }

  svg.appendChild(conduits)
  svg.appendChild(bloom)

  /* ── the core: Home Base, with the ARMY Bomb inside it ─────────────── */
  const progress = Math.max(0, Math.min(1, homeFraction || 0))
  // Every other ward is sealed at the start, so the core is the only thing
  // on the map actually worth tapping — is-open drives a slow pulse and a
  // "START HERE" tag so that's obvious without reading the hint line above
  // the map. Once Home Base itself is restored, it quiets down like any
  // other lit ward.
  const stillOpen = !!core && core.status !== 'restored'
  const coreG = n('g', { class: `cm-core ${core?.status || 'active'}${stillOpen ? ' is-open' : ''}` })
  coreG.appendChild(n('circle', { cx: CX, cy: CY, r: CORE_R + 2.2, class: 'cm-core-halo' }))
  coreG.appendChild(n('circle', { cx: CX, cy: CY, r: CORE_R, class: 'cm-core-land' }))
  coreG.appendChild(n('circle', { cx: CX, cy: CY, r: CORE_R, class: 'cm-core-edge' }))
  // progress ring — YOUR OWN Home Base restoration, not the shared network
  // charge (see homeFraction's doc comment above).
  const CIRC = 2 * Math.PI * (CORE_R - 2.2)
  coreG.appendChild(n('circle', {
    cx: CX, cy: CY, r: CORE_R - 2.2, class: 'cm-core-ring-bg',
  }))
  coreG.appendChild(n('circle', {
    cx: CX, cy: CY, r: CORE_R - 2.2, class: 'cm-core-ring',
    transform: `rotate(-90 ${CX} ${CY})`,
    'stroke-dasharray': `${(CIRC * progress).toFixed(2)} ${CIRC.toFixed(2)}`,
  }))
  coreG.appendChild(n('circle', { cx: CX, cy: CY, r: 3.4, class: 'cm-core-bomb' }))
  coreG.appendChild(n('text', { x: CX, y: CY + 7.4, class: 'cm-core-name' }, 'HOME BASE'))
  if (stillOpen) {
    coreG.appendChild(n('text', { x: CX, y: CY + 10.4, class: 'cm-core-tag' }, 'START HERE'))
  }
  if (core) {
    coreG.style.cursor = 'pointer'
    coreG.onclick = (e) => onSelect(core, { x: e.clientX, y: e.clientY })
  }
  svg.appendChild(coreG)

  // labels on top of everything
  for (const { w, at } of labels) {
    const g = n('g', { class: `cm-label ${w.status}` })
    g.appendChild(n('text', { x: at[0].toFixed(2), y: at[1].toFixed(2), class: 'cm-name' }, mapLabel(wardDisplayName(w))))
    g.appendChild(n('text', { x: at[0].toFixed(2), y: (at[1] + 3.4).toFixed(2), class: 'cm-count' },
      w.status === 'locked' ? 'sealed' : `${w.restoredCount}/${w.totalCount}`))
    svg.appendChild(g)
  }

  // The seam where the ward ring closes (Old Grid back to Mono) is the one
  // angle guaranteed not to cut across the middle of a wedge's label — same
  // reasoning wardless placement gets elsewhere in this file. ARIRANG
  // RE:CELEBRATE's venue takes that seam now, alone and dead-centre (see
  // partyVenue's own comment for why it isn't a toolMarker): a temporary
  // event reads better holding the map's one clean top slot than tucked off
  // to a side, and Candy Star/Magic Shop don't need that seam to read as a
  // pair — flanking the ring left/right does that just as well.
  if (onParty) {
    svg.appendChild(partyVenue(-Math.PI / 2, onParty, partyLive, partyDeadlineIso, partyComplete))
  }

  // Candy Star and Magic Shop flank the ring at its two horizontal extremes
  // — two real "go here" world locations, clearly a pair, each with a full
  // side of the island to itself. Suggestions used to sit in the old top
  // cluster too; it moved to the City ••• menu (screen-world.js's
  // commandTools) since it was never a place, just a feedback form — see
  // suggestions.js. toolMarker's label now grows away from whichever edge
  // it's nearest (see its own comment) specifically so it can sit here
  // without the text clipping past the viewBox.
  if (onCandyStar) svg.appendChild(toolMarker(Math.PI, '🍬', 'Candy Star', onCandyStar))
  if (onMagicShop) svg.appendChild(toolMarker(0, '🏪', 'Magic Shop', onMagicShop))

  // The bottom seam, symmetric with the top one RE:CELEBRATE now holds — a
  // temporary event marker sharing a side with a permanent utility would
  // read as equally routine, so VMA/Golden Corner get this side entirely.
  if (onVma) svg.appendChild(toolMarker(Math.PI / 2 - (onGoldenCorner ? 0.20 : 0), '⚡', 'VMA', onVma, vmaPulse ? 'is-vma-pulse' : ''))
  if (onGoldenCorner) {
    const marker = toolMarker(Math.PI / 2 + (onVma ? 0.20 : 0), '🐰', 'Golden Corner', onGoldenCorner,
      goldenProgress >= 1 ? 'is-golden-complete' : goldenProgress > 0 ? 'is-golden-live' : 'is-golden-dark')
    marker.style.setProperty('--golden-progress', String(Math.max(0, Math.min(1, goldenProgress))))
    svg.appendChild(marker)
  }

  return svg
}
