// The things you keep, standing in the place you keep them.
//
// ARMY's Corner under the scene lists everything you've placed. This puts a
// few of them into the street itself, arranged the way someone would really
// leave them: posters, prints and shirts on a wall at street level, the
// things that stand (a light stick, a plush, a mug) in a little group at the
// foot of that wall, a rug lying flat on the pavement in front. Each side of
// the landmark gets one such corner, so the props read as a place someone
// keeps rather than stickers spread along the road.
//
// The art is the SAME SVG the collection cards use (items-art.js), rasterised
// once per item and cached. Card CSS can't reach inside an <img>, so the
// palette is restated here and inlined into the SVG: shapes stay in one
// place, colours are stated twice on purpose. Each drawing is trimmed to its
// own shape, so the empty margin of the 40×40 icon never takes up street.

import { itemSceneArt } from './items-art.js'

// Mirrors .ia-* in css/reconnect.css.
const INK = {
  body: '#1d1834',
  bodyLegendary: '#2a1c12',
  purple: '#8b5cf6',
  gold: '#d9ad5f',
  shine: 'rgba(255,255,255,0.5)',
  hole: '#0a0910',
  spine: 'rgba(255,255,255,0.10)',
  line: 'rgba(255,255,255,0.22)',
  outline: 'rgba(255,255,255,0.35)',
  perf: 'rgba(255,255,255,0.3)',
  groove: 'rgba(255,255,255,0.14)',
}

// Where a kind goes. Anything not listed stands on the ground, the safe
// default: a new catalogue row places itself without a code change.
const WALL_KINDS = new Set(['poster', 'photocard', 'album', 'record', 'banner', 'ticket', 'magnet', 'apparel'])
const FLOOR_KINDS = new Set(['rug', 'tray'])        // lie flat on the pavement
const PLACE_BY_ID = { 'picket-image': 'stand', 'record-crate': 'stand' }
// Wall things that look wrong standing on the pavement (a shirt, a pennant, a
// ticket stood on end): without a facade nearby they stay out of the picture.
// Posters, prints and albums can be propped against the kerb instead.
const WALL_ONLY = new Set(['apparel', 'banner', 'ticket', 'magnet'])
// These two are light sources, so they earn a glow.
const LIT_KINDS = new Set(['lightstick', 'lightbox'])

// How tall each thing stands, in scene units (UNIT × scene height): a poster
// is about door height, a mug comes up to a plush's middle. Floor kinds are
// widths (they're seen lying down).
const UNIT = 0.085
const SIZE = {
  poster: 1.25, photocard: 0.8, ticket: 0.5, magnet: 0.6, album: 1.0, record: 1.0,
  apparel: 1.1, banner: 0.8, lightstick: 1.1, plush: 0.85, figure: 0.9, mug: 0.55,
  cushion: 0.75, keyring: 0.75, lightbox: 0.7, blanket: 0.65, rug: 2.0, tray: 1.4,
}
const SIZE_BY_ID = {
  'picket-image': 1.4, 'bottle-souvenir': 0.7, 'record-crate': 0.9,
  'lightstick-v4-full': 1.0, 'lightstick-hat': 0.85,
}
const MAX_WIDE = 1.7        // nothing gets wider than this many units

// Past this the street reads as clutter, not a home. Everything placed still
// shows in ARMY's Corner below the scene.
export const MAX_PROPS = 6
const PER_CORNER = 3        // upright things in one corner (a rug lies extra)
const GAP = 1.5             // px between neighbours in a group

const RARITY_RANK = { legendary: 0, rare: 1, common: 2 }

export function placementOf(item) {
  if (PLACE_BY_ID[item.itemId]) return PLACE_BY_ID[item.itemId]
  if (FLOOR_KINDS.has(item.kind)) return 'floor'
  if (WALL_KINDS.has(item.kind)) return 'wall'
  return 'stand'
}

const artCache = new Map()

function sceneKey(item) {
  return `${item.kind || 'unknown'}|${item.rarity || 'common'}|${item.kind === 'album' ? item.era || item.itemId || '' : item.itemId || ''}`
}

/**
 * One rasterised drawing per item + rarity (the palette is baked in), plus
 * the box its visible shape actually fills, so it can be drawn without the
 * icon's empty margin. The box comes from getBBox on a hidden copy: unlike
 * reading the pixels back, that works in every browser.
 */
function sceneArt(item) {
  const key = sceneKey(item)
  const hit = artCache.get(key)
  if (hit) return hit

  const rarity = item.rarity || 'common'
  const accent = rarity === 'common' ? INK.purple : INK.gold
  const body = rarity === 'legendary' ? INK.bodyLegendary : INK.body
  const style = `.ia-body{fill:${body}}.ia-accent{fill:${accent}}.ia-shine{fill:${INK.shine}}`
    + `.ia-hole{fill:${INK.hole}}.ia-spine{fill:${INK.spine}}.ia-line{fill:${INK.line}}`
    + `.ia-outline{fill:none;stroke:${INK.outline};stroke-width:2}`
    + `.ia-perf{stroke:${INK.perf};stroke-width:0.8;stroke-dasharray:1.6 1.6}`
    + `.ia-groove{fill:none;stroke:${INK.groove};stroke-width:1.4}`

  const raw = itemSceneArt(item)
  const vb = (raw.match(/viewBox="([^"]+)"/)?.[1] || '0 0 40 40').split(/[\s,]+/).map(Number)
  const [vx, vy, vw, vh] = vb.length === 4 && vb.every(Number.isFinite) ? vb : [0, 0, 40, 40]
  const box = measure(raw, [vx, vy, vw, vh])

  // Rasterised at 3 px per unit so the trimmed shape stays crisp at 2× DPR.
  const R = 3
  const svg = raw
    .replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="${vw * R}" height="${vh * R}" `)
    .replace(/^(<svg[^>]*>)/, `$1<style>${style}</style>`)

  const out = {
    img: null,
    // source rect in image pixels, and its aspect for layout
    sx: (box.x - vx) * R, sy: (box.y - vy) * R, sw: box.w * R, sh: box.h * R,
    aspect: box.w / box.h,
  }
  if (typeof Image !== 'undefined') {
    out.img = new Image()
    out.img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  }
  artCache.set(key, out)
  return out
}

let probe = null
/** The visible extent of a drawing, in its own units, clamped to its view. */
function measure(raw, [vx, vy, vw, vh]) {
  const full = { x: vx, y: vy, w: vw, h: vh }
  if (typeof document === 'undefined') return full
  try {
    if (!probe) {
      probe = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      probe.setAttribute('width', '0'); probe.setAttribute('height', '0')
      probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;overflow:hidden'
      document.body.appendChild(probe)
    }
    const inner = raw.replace(/^\s*<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
    probe.innerHTML = `<g>${inner}</g>`
    const bb = probe.firstChild.getBBox()
    probe.innerHTML = ''
    if (!bb || !bb.width || !bb.height) return full
    // Outlines are 2 units wide and getBBox ignores stroke: allow for it.
    const x0 = Math.max(vx, bb.x - 1), y0 = Math.max(vy, bb.y - 1)
    const x1 = Math.min(vx + vw, bb.x + bb.width + 1), y1 = Math.min(vy + vh, bb.y + bb.height + 1)
    return x1 - x0 > 1 && y1 - y0 > 1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : full
  } catch {
    return full
  }
}

/** A stable string for "are these the same items in the same order?" — cheap
 *  enough to check every frame, so a placed item shows up without a reload. */
export function propsKey(items) {
  return (items || []).map((i) => `${i.id}:${i.kind}:${i.rarity}`).join(',')
}

/**
 * Which placed items appear in the street when there are more than fit: one
 * of each thing (a second copy adds nothing to look at), then variety — one
 * of each kind before a second of any — rarest first within a kind. Backup
 * Passes are tools, not things on display: never in the street.
 */
export function pickShown(items, max = MAX_PROPS) {
  const seen = new Set()
  const groups = new Map()
  ;(items || []).forEach((it, idx) => {
    if (!it || it.kind === 'utility' || it.itemId === 'backup-pass') return
    const id = it.itemId || it.id
    if (seen.has(id)) return
    seen.add(id)
    const k = it.kind || 'unknown'
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push({ it, idx })
  })
  const rank = (x) => RARITY_RANK[x.it.rarity] ?? 3
  const lists = [...groups.values()].map((g) => g.sort((a, b) => rank(a) - rank(b) || a.idx - b.idx))
  lists.sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].idx - b[0].idx)
  const out = []
  for (let round = 0; out.length < max; round++) {
    let any = false
    for (const g of lists) {
      if (g[round]) { out.push(g[round].it); any = true; if (out.length >= max) break }
    }
    if (!any) break
  }
  return out
}

/** Drawn size in px: height for things upright, width for things lying down. */
function sizeOf(item, art, unit) {
  const units = SIZE_BY_ID[item.itemId] ?? SIZE[item.kind] ?? 0.75
  if (placementOf(item) === 'floor') {
    const w = units * unit
    return { w, h: Math.max(3, w * 0.36) }   // seen lying down, in perspective
  }
  let h = Math.max(7, units * unit)
  let w = h * art.aspect
  if (w > MAX_WIDE * unit) { w = MAX_WIDE * unit; h = w / art.aspect }
  return { w, h }
}

/**
 * Where each kept item goes. Two corners, one each side of the landmark (or
 * of the middle, when the district has none). A corner with a building gets
 * its wall things on that facade at street level; without one they stand
 * propped on the pavement with the rest. Standing things gather in a tight
 * row at the foot of the wall, a rug lies in front of them. Anything that
 * doesn't fit is left out of the picture (it's still in ARMY's Corner).
 */
export function layoutProps(items, m) {
  const list = pickShown(items, Infinity)
  if (!list.length || !m) return []

  const { w, h, groundY } = m
  const unit = h * UNIT
  const pad = 6
  const centerGap = m.landmark && m.landmark.type !== 'bridge' ? Math.min(w * 0.28, 120) : 0
  const segs = centerGap
    ? [[pad, w / 2 - centerGap], [w / 2 + centerGap, w - pad]]
    : [[pad, w * 0.42], [w * 0.58, w - pad]]

  const sides = segs.filter(([a, b]) => b - a > unit * 1.5).map(([a, b]) => {
    // The widest stretch of facade inside this side that is tall enough to
    // hang something on above the standing things.
    let facade = null
    for (const bl of m.buildings || []) {
      const x0 = Math.max(a, bl.x), x1 = Math.min(b, bl.x + bl.w)
      if (x1 - x0 < unit * 1.2 || bl.h < unit * 2.6) continue
      if (!facade || x1 - x0 > facade.x1 - facade.x0) facade = { x0, x1, top: bl.y }
    }
    return { a, b, facade, wall: [], stand: [], floor: [], wallW: 0, standW: 0, standH: 0 }
  })
  if (!sides.length) return []

  // Start on the side with a wall when there's something to hang; the second
  // corner only fills once the first is full, so a few items stay together.
  const wantsWall = list.some((i) => placementOf(i) === 'wall')
  const home = Math.max(0, sides.findIndex((s) => wantsWall && s.facade))
  const order = sides.length > 1 && home === 1 ? [sides[1], sides[0]] : sides
  // A rug's spot: under the corner, clear of the near-camera bench / bike /
  // post if one stands there. null when there's no clear spot.
  const fgX = m.fg && m.fg.kind !== 'none' && m.fg.kind !== 'railing' && m.fg.kind !== 'fence'
    ? (m.fg.flip ? w - m.fg.x * w : m.fg.x * w) : null
  const rugSpot = (side, rw) => {
    const anchor = side.facade ? (side.facade.x0 + side.facade.x1) / 2 : (side.a + side.b) / 2
    const lo = side.a + rw / 2, hi = side.b - rw / 2
    if (lo > hi) return null
    const cx = Math.max(lo, Math.min(hi, anchor))
    if (fgX === null || Math.abs(cx - fgX) >= rw / 2 + 16) return cx
    const l = fgX - 16 - rw / 2, r = fgX + 16 + rw / 2
    if (l >= lo && l <= hi) return l
    if (r >= lo && r <= hi) return r
    return null
  }
  const fits = (side, item, size) => {
    const place = placementOf(item)
    // A rug only goes where something already stands: alone it would just
    // be a ring on an empty road.
    if (place === 'floor') return side.floor.length === 0 && (side.wall.length || side.stand.length) && rugSpot(side, size.w) !== null ? 'floor' : null
    if (side.wall.length + side.stand.length >= PER_CORNER) return null
    if (place === 'wall' && side.facade && side.wallW + size.w + GAP <= side.facade.x1 - side.facade.x0 - 4) return 'wall'
    if (place === 'wall' && WALL_ONLY.has(item.kind)) return null
    return side.standW + size.w + GAP <= side.b - side.a - 4 ? 'stand' : null
  }

  // Upright things first, then a rug in front of a corner that has some;
  // one place in the cap is kept for the rug when there is one.
  const floors = list.filter((i) => placementOf(i) === 'floor')
  const uprights = list.filter((i) => placementOf(i) !== 'floor')
  let shown = 0
  let cap = MAX_PROPS - (floors.length ? 1 : 0)
  for (const item of [...uprights, null, ...floors]) {
    if (item === null) { cap = MAX_PROPS; continue }
    if (shown >= cap) continue
    const art = sceneArt(item)
    const size = sizeOf(item, art, unit)
    for (const side of order) {
      const slot = fits(side, item, size)
      if (!slot) continue
      shown++
      side[slot].push({ item, art, ...size })
      if (slot === 'wall') side.wallW += size.w + GAP
      if (slot === 'stand') { side.standW += size.w + GAP; side.standH = Math.max(side.standH, size.h) }
      break
    }
  }

  const out = []
  const lamps = (m.lamps || []).map((l) => l.x)
  // Where a row starts: centred on the corner, within [lo, hi], and off any
  // lamp post (something over a lamp post reads as a mistake). If it can't
  // clear one, the row gives up its last thing and tries again; whatever
  // drops out is still in ARMY's Corner.
  const placeRow = (row, lo, hi, anchor) => {
    const items = [...row]
    while (items.length) {
      const W = items.reduce((n, p) => n + p.w, 0) + GAP * (items.length - 1)
      const hit = (x) => lamps.find((lx) => lx > x - 2 && lx < x + W + 2)
      const x0 = Math.max(lo, Math.min(hi - W, anchor - W / 2))
      const lamp = hit(x0)
      if (lamp === undefined) return { x: x0, items }
      const left = lamp - 3 - W, right = lamp + 3
      if (left >= lo && hit(left) === undefined) return { x: left, items }
      if (right + W <= hi && hit(right) === undefined) return { x: right, items }
      items.pop()
    }
    return { x: lo, items }
  }
  for (const side of sides) {
    const anchor = side.facade ? (side.facade.x0 + side.facade.x1) / 2 : (side.a + side.b) / 2

    // Wall things: one row on the facade at street level, lifted just clear
    // of the standing things' heads so nothing hides behind anything.
    if (side.wall.length) {
      let { x, items } = placeRow(side.wall, side.facade.x0 + 2, side.facade.x1 - 2, anchor)
      const bottom = groundY - (side.standH ? side.standH + 2 : unit * 0.45)
      for (const p of items) {
        const y = Math.max(side.facade.top + 3, bottom - p.h)
        out.push({ item: p.item, art: p.art, x, y, w: p.w, h: p.h, place: 'wall', lit: false })
        x += p.w + GAP
      }
    }

    // Standing things: a tight group at the foot of the wall, tallest in
    // the middle so the group has a shape; nudged off a lamp post.
    if (side.stand.length) {
      const sorted = [...side.stand].sort((p, q) => q.h - p.h)
      const row = []
      sorted.forEach((p, i) => (i % 2 ? row.unshift(p) : row.push(p)))
      let { x, items } = placeRow(row, side.a + 2, side.b - 2, anchor)
      for (const p of items) {
        out.push({ item: p.item, art: p.art, x, y: groundY + 1 - p.h, w: p.w, h: p.h, place: 'stand', lit: LIT_KINDS.has(p.item.kind) })
        x += p.w + GAP
      }
    }

    // A rug lies on the pavement in front of the group.
    for (const p of side.floor) {
      const cx = rugSpot(side, p.w)
      const cy = groundY + (h - groundY) * 0.32
      out.push({ item: p.item, art: p.art, x: cx - p.w / 2, y: cy - p.h / 2, w: p.w, h: p.h, place: 'floor', lit: false })
    }
  }
  return out
}

/**
 * Draws the props. They arrive with the lights — nothing in a dead district,
 * fully there by the time it's most of the way back — so the reward reads as
 * the place coming alive rather than clip art dropped on top of it.
 */
export function drawProps(ctx, m, props, p, t, reduced) {
  if (!props || !props.length) return
  const a = Math.max(0, Math.min(1, (p - 0.25) / 0.45))
  if (a <= 0.01) return

  // Back to front: rugs under everything, then the wall, then what stands.
  const layer = { floor: 0, wall: 1, stand: 2 }
  const sorted = [...props].sort((x, y) => layer[x.place] - layer[y.place])
  for (const pr of sorted) {
    const { img, sx, sy, sw, sh } = pr.art
    if (!img || !img.complete || !img.naturalWidth) continue   // still decoding — next frame

    if (pr.lit) {
      const pulse = reduced ? 1 : 0.88 + 0.12 * Math.sin(t * 0.002 + pr.x)
      const cx = pr.x + pr.w / 2
      const cy = pr.y + pr.h * 0.3
      const r = pr.h * 1.3
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      glow.addColorStop(0, `rgba(196, 181, 253, ${0.3 * a * pulse})`)
      glow.addColorStop(1, 'rgba(196, 181, 253, 0)')
      ctx.fillStyle = glow
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
    }

    if (pr.place === 'stand') {
      // A contact shadow is what stops it looking pasted on.
      ctx.fillStyle = `rgba(0,0,0,${0.4 * a})`
      ctx.beginPath()
      ctx.ellipse(pr.x + pr.w / 2, m.groundY + 1.2, pr.w * 0.5 + 1, 1.6, 0, 0, Math.PI * 2)
      ctx.fill()
    } else if (pr.place === 'wall') {
      // Pasted flat on the facade: a hairline shadow under one edge.
      ctx.fillStyle = `rgba(0,0,0,${0.35 * a})`
      ctx.fillRect(pr.x + 0.8, pr.y + 0.8, pr.w, pr.h)
    }

    ctx.globalAlpha = a
    ctx.drawImage(img, sx, sy, sw, sh, pr.x, pr.y, pr.w, pr.h)
    ctx.globalAlpha = 1
  }
}
