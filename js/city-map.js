// The city, drawn from above.
//
// Deliberately top-down: a building seen from above is a rectangle, a road is
// a line, a river is a shape. That's vector design work, which code does well
// — unlike elevation views, which are painting, which code does badly. Three
// previous attempts failed on exactly that distinction.
//
// The map is one fixed city plan (nine wards tiling a river valley), not a
// procedural layout, so it's the same place every time you open it and you
// learn where your wards are. Restoration lights each ward's blocks
// individually, so a half-restored ward is visibly half-lit.

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
export const CITY_H = 62          // drawn city
export const CITY_H_ART = 56.3    // matches city-dark.webp at 1672x941

/** Where each ward sits on the illustrated map, as [x, y, radius] in viewBox
 *  units. Hand-placed against the artwork's islands — the centre plaza is left
 *  free because that's the ARMY Bomb. Order matches state.map.wards.
 *  Exported so landing-map.js can drop its own redacted markers onto the same
 *  islands without re-deriving the coordinates. */
export const ISLANDS = [
  [18, 10.5, 13], [47, 12, 12.5], [68, 12, 9],
  [88, 15, 9],    [20, 26, 12],   [68, 28, 9],
  [20, 43, 11],   [47, 43, 13],   [70, 44, 10],
]

/** Nine wards tiling the valley: three along the north bank, six south of the
 *  river. Edges are slightly off-square so the plan reads as a place rather
 *  than a spreadsheet. */
const ZONES = [
  { pts: [[0, 0], [34, 0], [33, 16.4], [0, 15.4]],          label: [3, 9] },
  { pts: [[34, 0], [67, 0], [68, 18.4], [33, 16.4]],        label: [37, 9] },
  { pts: [[67, 0], [100, 0], [100, 20.4], [68, 18.4]],      label: [70, 9] },

  { pts: [[0, 21.6], [32, 22.6], [31, 40.4], [0, 39.4]],    label: [3, 30] },
  { pts: [[32, 22.6], [66, 24], [65, 42], [31, 40.4]],      label: [35, 31] },
  { pts: [[66, 24], [100, 25.6], [100, 43.6], [65, 42]],    label: [69, 32] },

  { pts: [[0, 42], [30, 43], [29, 62], [0, 62]],            label: [3, 50] },
  { pts: [[30, 43], [64, 44.6], [63, 62], [29, 62]],        label: [33, 51] },
  { pts: [[64, 44.6], [100, 46.2], [100, 62], [63, 62]],    label: [67, 53] },
]

const RIVER = [[0, 15.4], [33, 16.4], [68, 18.4], [100, 20.4],
               [100, 25.6], [66, 24], [32, 22.6], [0, 21.6]]

const BRIDGES = [[14, 15.9, 3.2, 6.4], [50, 17.6, 3.2, 6.6], [83, 19.6, 3.2, 6.4]]

const pointsAttr = (pts) => pts.map((p) => p.join(',')).join(' ')

/** Map labels are tight, and every one of these is a ward, so the words that
 *  say so can go: "Sector Layover" → "Layover", "The Old Grid" → "Old Grid".
 *  The full name is always one row away in the ward list. */
function mapLabel(name) {
  return String(name || '')
    .replace(/\s+ward$/i, '')
    .replace(/^sector\s+/i, '')
    .replace(/^the\s+/i, '')
}

/** Block footprints on a loose street grid inside a ward, clipped to its
 *  outline. Sorted by a stable key so "40% restored" always lights the same
 *  40% of blocks rather than reshuffling on every poll. */
function blocksFor(zone, seed) {
  const xs = zone.pts.map((p) => p[0]), ys = zone.pts.map((p) => p[1])
  const x0 = Math.min(...xs), x1 = Math.max(...xs)
  const y0 = Math.min(...ys), y1 = Math.max(...ys)
  const r = rng(seed)
  const out = []
  for (let x = x0 + 1.4; x < x1 - 1; x += 4.1) {
    for (let y = y0 + 1.4; y < y1 - 1; y += 3.3) {
      if (r() < 0.12) continue                     // gaps: yards, lots, squares
      const w = 1.7 + r() * 1.5
      const h = 1.2 + r() * 1.1
      out.push({ x: x + r() * 0.7, y: y + r() * 0.5, w, h, k: r() })
    }
  }
  out.sort((a, b) => a.k - b.k)
  return out
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

    // the glow itself — grows and brightens with restoration
    if (!locked && p > 0) {
      g.appendChild(n('circle', {
        cx, cy, r: (r * (0.55 + p * 0.45)).toFixed(2),
        class: 'cm-glow', opacity: (0.35 + p * 0.65).toFixed(2),
      }))
    }
    // invisible hit area so the whole island is tappable
    g.appendChild(n('circle', { cx, cy, r, class: 'cm-hit' }))

    g.appendChild(n('text', { x: cx, y: cy, class: 'cm-mark-name' }, mapLabel(w.name)))
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

/**
 * @param wards     state.map.wards
 * @param onSelect  (ward, {x,y}) => void
 */
export function renderCityMap(wards, onSelect) {
  const svg = n('svg', {
    class: 'city-map', viewBox: `0 0 ${CITY_W} ${CITY_H}`, 'aria-hidden': 'true',
  })
  const defs = n('defs', {})
  svg.appendChild(defs)

  // land
  svg.appendChild(n('rect', { x: 0, y: 0, width: CITY_W, height: CITY_H, class: 'cm-land' }))

  const list = wards.slice(0, ZONES.length)

  list.forEach((w, i) => {
    const zone = ZONES[i]
    const p = w.totalCount > 0 ? w.restoredCount / w.totalCount : 0
    const locked = w.status === 'locked'

    const clipId = `cm-clip-${i}`
    const clip = n('clipPath', { id: clipId })
    clip.appendChild(n('polygon', { points: pointsAttr(zone.pts) }))
    defs.appendChild(clip)

    const g = n('g', { class: `cm-ward ${w.status}` })
    g.appendChild(n('polygon', { points: pointsAttr(zone.pts), class: 'cm-zone' }))

    const blocks = blocksFor(zone, hashStr(w.id))
    const litCount = locked ? 0 : Math.round(blocks.length * p)
    const gb = n('g', { 'clip-path': `url(#${clipId})` })
    blocks.forEach((b, bi) => {
      gb.appendChild(n('rect', {
        x: b.x.toFixed(2), y: b.y.toFixed(2),
        width: b.w.toFixed(2), height: b.h.toFixed(2),
        rx: 0.25, class: 'cm-block' + (bi < litCount ? ' lit' : ''),
      }))
    })
    g.appendChild(gb)

    // ward outline last so it sits above its own blocks
    g.appendChild(n('polygon', { points: pointsAttr(zone.pts), class: 'cm-edge' }))

    if (!locked) {
      g.style.cursor = 'pointer'
      g.onclick = (e) => onSelect(w, { x: e.clientX, y: e.clientY })
    }
    svg.appendChild(g)
  })

  // river over the land, under the labels
  const river = n('g', { class: 'cm-river-g' })
  river.appendChild(n('polygon', { points: pointsAttr(RIVER), class: 'cm-river' }))
  for (const [x, y, w, h] of BRIDGES) {
    river.appendChild(n('rect', { x, y, width: w, height: h, class: 'cm-bridge' }))
  }
  svg.appendChild(river)

  // labels on top of everything
  list.forEach((w, i) => {
    const [lx, ly] = ZONES[i].label
    const g = n('g', { class: `cm-label ${w.status}` })
    g.appendChild(n('text', { x: lx, y: ly, class: 'cm-name' }, mapLabel(w.name)))
    g.appendChild(n('text', { x: lx, y: ly + 4.2, class: 'cm-count' },
      w.status === 'locked' ? 'sealed' : `${w.restoredCount}/${w.totalCount}`))
    svg.appendChild(g)
  })

  return svg
}
