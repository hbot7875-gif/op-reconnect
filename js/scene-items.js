// The things you keep, standing in the place you keep them.
//
// ARMY's Corner under the scene lists everything you've placed. This puts a
// few of them into the street itself as small decorations: a little group
// standing on the near pavement, a rug under it. They never reach above the
// ground line, so they can't cover the landmark, the train, a lamp post, or
// a window that lights up as the district is restored. Each side of the
// landmark gets at most one small group; anything that doesn't fit (or has
// no sensible way to stand on a pavement, like a shirt) stays out of the
// picture and is still in ARMY's Corner.
//
// The art is the SAME SVG the collection cards use (items-art.js), rasterised
// once per item and cached. Card CSS can't reach inside an <img>, so the
// palette is restated here and inlined into the SVG: shapes stay in one
// place, colours are stated twice on purpose. Each drawing is trimmed to its
// own shape, so the empty margin of the 40×40 icon never takes up street.

import { itemSceneArt } from './items-art.js'

// Mirrors .ia-* in css/reconnect.css, with the bodies lifted a step (as
// ARMY's Corner does): the card colour vanishes against a night pavement.
const INK = {
  body: '#352d5c',
  bodyLegendary: '#4a3420',
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

// Rugs and trays lie flat under the group. Shirts, banners, tickets and
// magnets have no natural way to stand on a pavement, so they stay in
// ARMY's Corner only. Everything else stands, posters and prints propped
// up like a street-stall display. A new catalogue kind stands by default.
const FLOOR_KINDS = new Set(['rug', 'tray'])
const CORNER_ONLY = new Set(['apparel', 'banner', 'ticket', 'magnet'])
const STAND_BY_ID = new Set(['picket-image'])      // a placard on a stick does stand
// These two are light sources, so they earn a glow.
const LIT_KINDS = new Set(['lightstick', 'lightbox'])

// Relative heights (a poster is the tallest thing at 1.25; a mug comes up to
// a plush's middle). The tallest has to fit between the ground line and the
// pavement the group stands on, which sets the scale.
const SIZE = {
  poster: 1.25, photocard: 0.8, album: 1.0, record: 1.0, lightstick: 1.1, plush: 0.85,
  figure: 0.9, mug: 0.6, cushion: 0.8, keyring: 0.75, lightbox: 0.75, blanket: 0.7,
  rug: 2.2, tray: 1.6,
}
const SIZE_BY_ID = {
  'picket-image': 1.25, 'bottle-souvenir': 0.75, 'record-crate': 0.95,
  'lightstick-v4-full': 1.05, 'lightstick-hat': 0.85,
}
const TALLEST = 1.25
const MAX_WIDE = 1.7        // nothing gets wider than this many units

// Past this the street reads as clutter, not a home. Everything placed still
// shows in ARMY's Corner below the scene.
export const MAX_PROPS = 6
const PER_CORNER = 3        // upright things in one group (a rug lies extra)
const GAP = 1               // px between neighbours in a group

const RARITY_RANK = { legendary: 0, rare: 1, common: 2 }

/** 'floor' (lies under the group), 'stand', or null (ARMY's Corner only). */
export function placementOf(item) {
  if (STAND_BY_ID.has(item.itemId)) return 'stand'
  if (FLOOR_KINDS.has(item.kind)) return 'floor'
  if (CORNER_ONLY.has(item.kind)) return null
  return 'stand'
}

/** Where the group stands: two-thirds of the way down the near pavement —
 *  drawn after the near-camera layer, so a fence or railing runs behind it —
 *  and the scale that keeps the tallest thing below the ground line. */
export function pavement(m) {
  const strip = m.h - m.groundY
  const base = m.groundY + strip * 0.66
  return { base, unit: (base - m.groundY - 1) / TALLEST }
}

/** The landmark's scale, as scene.js draws it. */
function landmarkScale(m) {
  return (m.h / 158) * (m.landmark?.lift || 1) * (m.centerpiece ? 1.3 : 1)
}

/** A pier has no pavement, only water: things stand on its deck instead,
 *  clear of the mooring posts and the lamps at each end. */
function pierDeck(m) {
  const s = landmarkScale(m), cx = m.w / 2, dw = 80 * s
  const posts = [-0.55, 0.15, 0.7].map((mo) => cx + mo * dw + 1.2 * s)
    .concat([-1, 1].map((e) => cx + e * (dw - 3 * s)))
  return {
    // Feet a little behind the deck's front edge, which hides them: they
    // stand ON the planks rather than balancing on the edge.
    base: m.groundY - 9 * s + 2.4 * s,
    clipY: m.groundY - 9 * s + 1.1 * s,
    halves: [[cx - dw + 6 * s, cx - 4 * s], [cx + 4 * s, cx + dw - 6 * s]],
    blocks: posts.map((x) => [x - 5, x + 5]),
  }
}

/** The near-camera props that stand where the group would: keep clear. */
function foregroundBlocks(m) {
  const fg = m.fg
  if (!fg || fg.kind === 'none') return []
  const x = fg.flip ? m.w - fg.x * m.w : fg.x * m.w
  switch (fg.kind) {
    case 'bench': return [[x - 16, x + 16]]
    case 'lamp': return [[x - 7, x + 7]]
    case 'bicycle': case 'crates': return [[x - 15, x + 16]]
    case 'lantern': return [-1, 1].map((o) => { const lx = m.w / 2 + o * m.w * 0.34; return [lx - 8, lx + 8] })
    default: return []       // fence / railing / ropes run the full width, in front
  }
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

/** Drawn size in px: height for things upright. */
function sizeOf(item, art, unit) {
  const units = SIZE_BY_ID[item.itemId] ?? SIZE[item.kind] ?? 0.8
  let h = Math.max(6, units * unit)
  let w = h * art.aspect
  if (w > MAX_WIDE * unit) { w = MAX_WIDE * unit; h = w / art.aspect }
  return { w, h }
}

/** The free stretches of pavement in [a, b] once the blocks are taken out. */
function freeRuns(a, b, blocks) {
  let runs = [[a, b]]
  for (const [x0, x1] of blocks) {
    runs = runs.flatMap(([r0, r1]) => (x1 <= r0 || x0 >= r1 ? [[r0, r1]] : [[r0, x0], [x1, r1]].filter(([p, q]) => q - p > 0)))
  }
  return runs
}

/**
 * Where each kept item goes: at most one small group each side of the
 * landmark (or of the middle, when the district has none), standing on the
 * near pavement, tallest in the middle, a rug under it. The first group
 * fills before the second starts, so a few things stay together. Anything
 * that doesn't fit is left out of the picture (it's still in ARMY's Corner).
 */
export function layoutProps(items, m) {
  const list = pickShown(items, Infinity).filter((i) => placementOf(i))
  if (!list.length || !m) return []

  const { w } = m
  const ground = pavement(m)
  const unit = ground.unit
  let base = ground.base
  let clipY = null
  const pad = 6
  const type = m.landmark?.type
  const centerGap = type && type !== 'bridge' ? Math.min(w * 0.28, 120) : 0
  let halves = centerGap
    ? [[pad, w / 2 - centerGap], [w / 2 + centerGap, w - pad]]
    : [[pad, w * 0.42], [w * 0.58, w - pad]]
  let blocks = foregroundBlocks(m)
  if (type === 'pier') {
    const deck = pierDeck(m)
    base = deck.base; halves = deck.halves; blocks = deck.blocks; clipY = deck.clipY
  } else if (type === 'bridge') {
    // the river runs under the span, between the two towers
    const s = landmarkScale(m)
    blocks = blocks.concat([[w / 2 - 62 * s - 8, w / 2 + 62 * s + 8]])
  }

  // Each side's spot is its widest clear run of pavement.
  const sides = halves.map(([a, b], i) => {
    const runs = freeRuns(a, b, blocks).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))
    const run = runs[0]
    return run && run[1] - run[0] > unit * 1.5
      ? { a: run[0], b: run[1], left: i === 0, stand: [], floor: null, standW: 0 }
      : null
  }).filter(Boolean)
  if (!sides.length) return []

  // Uprights first; one place in the cap is kept for a rug when there is one.
  const floors = list.filter((i) => placementOf(i) === 'floor')
  const uprights = list.filter((i) => placementOf(i) === 'stand')
  let shown = 0
  const cap = MAX_PROPS - (floors.length ? 1 : 0)
  for (const item of uprights) {
    if (shown >= cap) break
    const art = sceneArt(item)
    const size = sizeOf(item, art, unit)
    const side = sides.find((s) => s.stand.length < PER_CORNER && s.standW + size.w + GAP <= s.b - s.a - 4)
    if (!side) continue
    side.stand.push({ item, art, ...size })
    side.standW += size.w + GAP
    shown++
  }
  // A rug only goes under a group: alone it'd be a ring on an empty road.
  for (const item of floors) {
    if (shown >= MAX_PROPS) break
    const side = sides.find((s) => s.stand.length && !s.floor)
    if (!side) break
    side.floor = { item, art: sceneArt(item) }
    shown++
  }

  const out = []
  for (const side of sides) {
    if (!side.stand.length) continue
    const sorted = [...side.stand].sort((p, q) => q.h - p.h)
    const row = []
    sorted.forEach((p, i) => (i % 2 ? row.unshift(p) : row.push(p)))
    const W = side.standW - GAP
    // Toward the landmark end of the run, so it reads as part of the place.
    const room = side.b - side.a - W
    const x0 = side.a + room * (side.left ? 0.7 : 0.3)
    const cx = x0 + W / 2

    if (side.floor) {
      const { item, art } = side.floor
      const units = SIZE_BY_ID[item.itemId] ?? SIZE[item.kind] ?? 2
      const rw = Math.min(side.b - side.a, Math.max(units * unit, W + 8))
      const rh = Math.max(3, rw * 0.22)
      const rx = Math.max(side.a, Math.min(side.b - rw, cx - rw / 2))
      if (clipY === null) out.push({ item, art, x: rx, y: base - rh * 0.6, w: rw, h: rh, place: 'floor', lit: false })
    }
    let x = x0
    for (const p of row) {
      out.push({ item: p.item, art: p.art, x, y: base - p.h, w: p.w, h: p.h, place: 'stand', lit: LIT_KINDS.has(p.item.kind), clipY })
      x += p.w + GAP
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

  // Rugs first, then what stands on them.
  const sorted = [...props].sort((x, y) => (x.place === 'floor' ? 0 : 1) - (y.place === 'floor' ? 0 : 1))
  for (const pr of sorted) {
    const { img, sx, sy, sw, sh } = pr.art
    if (!img || !img.complete || !img.naturalWidth) continue   // still decoding — next frame

    if (pr.lit) {
      const pulse = reduced ? 1 : 0.88 + 0.12 * Math.sin(t * 0.002 + pr.x)
      const cx = pr.x + pr.w / 2
      const cy = pr.y + pr.h * 0.3
      const r = pr.h * 1.1
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      glow.addColorStop(0, `rgba(196, 181, 253, ${0.28 * a * pulse})`)
      glow.addColorStop(1, 'rgba(196, 181, 253, 0)')
      ctx.fillStyle = glow
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
    }

    if (pr.clipY != null) {
      // On a pier deck: the front edge of the planks hides the feet.
      ctx.save()
      ctx.beginPath(); ctx.rect(pr.x - 4, pr.y - pr.h, pr.w + 8, pr.clipY - pr.y + pr.h); ctx.clip()
      ctx.globalAlpha = a
      ctx.drawImage(img, sx, sy, sw, sh, pr.x, pr.y, pr.w, pr.h)
      ctx.restore()
      continue
    }

    if (pr.place === 'stand') {
      // A contact shadow is what stops it looking pasted on.
      ctx.fillStyle = `rgba(0,0,0,${0.45 * a})`
      ctx.beginPath()
      ctx.ellipse(pr.x + pr.w / 2, pr.y + pr.h, pr.w * 0.5 + 0.5, 1.3, 0, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.globalAlpha = a
    ctx.drawImage(img, sx, sy, sw, sh, pr.x, pr.y, pr.w, pr.h)
    ctx.globalAlpha = 1
  }
}
