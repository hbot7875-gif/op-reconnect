// Every ward gets its own silhouette.
//
// The point: you should know which ward you're looking at with the title
// covered. Mono is dense towers, Happy is low and green, D-Day is a foundry,
// Golden has one spire that dwarfs everything, the Old Grid is squat brick.
// Shape and rhythm carry the identity — never colour, which stays reserved
// for state (gold restored / purple restoring / crimson breach).
//
// `h` and `w` take the building's deterministic random k (0..1) and return
// height in viewBox units and a width multiplier. `cap` is what sits on the
// roof. `decor` paints ward-level scenery behind the buildings.

const SVG_NS = 'http://www.w3.org/2000/svg'
export function n(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag)
  for (const k in attrs) node.setAttribute(k, attrs[k])
  return node
}

// Seeded from the ward id, so a ward's skyline is the same every render and
// on every machine. Lives here rather than in ward-tiles.js because the
// landing page draws these same silhouettes (dark) and must land on the
// identical building layout the player meets after signing in.
export function hashStr(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}
export function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PROFILES = {
  // dense, tall, narrow — a rainy downtown packed shoulder to shoulder
  mono: { h: (k) => 15 + k * 13, w: () => 0.72, cap: 'antenna', capOdds: 0.5 },

  // low and wide with trees between — a fairground town
  happy: { h: (k) => 7 + k * 8, w: () => 0.86, cap: 'flag', capOdds: 0.35, decor: 'trees' },

  // industrial: squat sheds, sawtooth roofs, chimneys
  dday: { h: (k) => 8 + k * 9, w: () => 0.92, cap: 'chimney', capOdds: 0.45, decor: 'smokestack' },

  // a concert bowl on the skyline
  hopeworld: { h: (k) => 8 + k * 9, w: () => 0.8, cap: 'dome', capOdds: 0.3, decor: 'stadium' },

  // luxury: tapered towers, one spire above them all
  golden: { h: (k) => 12 + k * 13, w: () => 0.66, cap: 'spire', capOdds: 0.55, decor: 'spire' },

  // residential blocks and trees
  friends: { h: (k) => 8 + k * 7, w: () => 0.88, cap: 'pitched', capOdds: 0.6, decor: 'trees' },

  // fallen sector: cranes over half-built frames
  muse: { h: (k) => 7 + k * 10, w: () => 0.78, cap: 'none', capOdds: 0, decor: 'cranes' },

  // fallen sector: broken, uneven, gap-toothed
  layover: { h: (k) => 6 + k * 11, w: () => 0.74, cap: 'broken', capOdds: 0.7 },

  // old brick: uniform, squat, repetitive
  oldgrid: { h: (k) => 7 + k * 5, w: () => 0.95, cap: 'flat', capOdds: 0 },

  // HT: one mast, nothing else. Now that the tile centres a single narrow
  // slot instead of stretching it across the whole width (ward-tiles.js's
  // MAX_SLOT), this wants to be tall — a narrow, short box reads as a stub,
  // a narrow tall one plus the 7-unit mast and its beacon reads as the relay
  // tower the ward is named after.
  'relay-zero': { h: (k) => 15 + k * 5, w: () => 0.7, cap: 'mast', capOdds: 1 },
}

const FALLBACK = { h: (k) => 9 + k * 12, w: () => 0.82, cap: 'antenna', capOdds: 0.3 }

export function profileFor(wardId) {
  return PROFILES[wardId] || FALLBACK
}

/** Roof furniture for one building. `cls` carries the lit/dark state. */
export function drawCap(g, kind, x, y, w, cls) {
  const mid = x + w / 2
  if (kind === 'antenna' || kind === 'mast') {
    const h = kind === 'mast' ? 7 : 3.4
    g.appendChild(n('rect', { x: (mid - 0.12).toFixed(2), y: (y - h).toFixed(2), width: 0.24, height: h, class: `wta ${cls}` }))
    if (kind === 'mast') {
      g.appendChild(n('circle', { cx: mid.toFixed(2), cy: (y - h).toFixed(2), r: 0.55, class: `wt-beacon ${cls}` }))
    }
  } else if (kind === 'spire') {
    g.appendChild(n('polygon', {
      points: `${(mid - w * 0.22).toFixed(2)},${y.toFixed(2)} ${mid.toFixed(2)},${(y - 5.5).toFixed(2)} ${(mid + w * 0.22).toFixed(2)},${y.toFixed(2)}`,
      class: `wtb ${cls}`,
    }))
  } else if (kind === 'pitched') {
    g.appendChild(n('polygon', {
      points: `${x.toFixed(2)},${y.toFixed(2)} ${mid.toFixed(2)},${(y - 2.2).toFixed(2)} ${(x + w).toFixed(2)},${y.toFixed(2)}`,
      class: `wtb ${cls}`,
    }))
  } else if (kind === 'dome') {
    g.appendChild(n('path', {
      d: `M ${x.toFixed(2)} ${y.toFixed(2)} A ${(w / 2).toFixed(2)} ${(w / 2).toFixed(2)} 0 0 1 ${(x + w).toFixed(2)} ${y.toFixed(2)} Z`,
      class: `wtb ${cls}`,
    }))
  } else if (kind === 'chimney') {
    g.appendChild(n('rect', { x: (x + w * 0.62).toFixed(2), y: (y - 4).toFixed(2), width: (w * 0.2).toFixed(2), height: 4, class: `wtb ${cls}` }))
  } else if (kind === 'flag') {
    g.appendChild(n('rect', { x: (mid - 0.1).toFixed(2), y: (y - 3).toFixed(2), width: 0.2, height: 3, class: `wta ${cls}` }))
    g.appendChild(n('polygon', {
      points: `${mid.toFixed(2)},${(y - 3).toFixed(2)} ${(mid + 1.5).toFixed(2)},${(y - 2.4).toFixed(2)} ${mid.toFixed(2)},${(y - 1.8).toFixed(2)}`,
      class: `wtb ${cls}`,
    }))
  } else if (kind === 'broken') {
    // bite a notch out of the roofline
    g.appendChild(n('polygon', {
      points: `${x.toFixed(2)},${y.toFixed(2)} ${(x + w * 0.45).toFixed(2)},${(y + 1.8).toFixed(2)} ${(x + w * 0.5).toFixed(2)},${y.toFixed(2)}`,
      class: 'wt-notch',
    }))
  }
}

/** Ward-level scenery, drawn behind the buildings. */
export function drawDecor(g, kind, GROUND, rng, litCls) {
  if (kind === 'trees') {
    for (let i = 0; i < 7; i++) {
      const x = 4 + rng() * 92, h = 3.5 + rng() * 2.5
      g.appendChild(n('rect', { x: (x - 0.2).toFixed(2), y: (GROUND - h).toFixed(2), width: 0.4, height: h, class: 'wt-decor' }))
      g.appendChild(n('circle', { cx: x.toFixed(2), cy: (GROUND - h - 1).toFixed(2), r: (1.4 + rng() * 0.7).toFixed(2), class: 'wt-decor leaf' }))
    }
  } else if (kind === 'cranes') {
    for (const x of [18, 58, 84]) {
      const top = GROUND - 24
      g.appendChild(n('rect', { x: (x - 0.2).toFixed(2), y: top.toFixed(2), width: 0.4, height: 24, class: 'wt-decor' }))
      g.appendChild(n('rect', { x: (x - 7).toFixed(2), y: top.toFixed(2), width: 14, height: 0.4, class: 'wt-decor' }))
      g.appendChild(n('rect', { x: (x + 5).toFixed(2), y: top.toFixed(2), width: 0.25, height: 4, class: 'wt-decor' }))
    }
  } else if (kind === 'smokestack') {
    g.appendChild(n('rect', { x: 88, y: (GROUND - 30).toFixed(2), width: 2.4, height: 30, class: 'wt-decor solid' }))
    g.appendChild(n('rect', { x: 87.4, y: (GROUND - 30).toFixed(2), width: 3.6, height: 1.2, class: 'wt-decor solid' }))
  } else if (kind === 'stadium') {
    g.appendChild(n('path', {
      d: `M 30 ${GROUND} A 20 20 0 0 1 70 ${GROUND} Z`, class: 'wt-decor solid',
    }))
    for (const x of [32, 50, 68]) {
      g.appendChild(n('rect', { x: (x - 0.2).toFixed(2), y: (GROUND - 26).toFixed(2), width: 0.4, height: 8, class: 'wt-decor' }))
      g.appendChild(n('circle', { cx: x.toFixed(2), cy: (GROUND - 26).toFixed(2), r: 0.7, class: `wt-beacon ${litCls}` }))
    }
  } else if (kind === 'spire') {
    const top = GROUND - 34
    g.appendChild(n('polygon', {
      points: `47,${GROUND} 49,${top} 51,${GROUND}`, class: 'wt-decor solid',
    }))
    g.appendChild(n('circle', { cx: 49, cy: top.toFixed(2), r: 0.8, class: `wt-beacon ${litCls}` }))
  }
}
