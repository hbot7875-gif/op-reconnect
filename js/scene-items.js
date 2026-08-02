// The things you keep, standing in the place you keep them.
//
// The shelf under the scene says what you own. This puts it in the street: a
// poster pasted on a wall, a banner strung across a facade, a light stick
// glowing on the pavement, a plush on a doorstep. It's the difference between
// a light you switched on and somewhere that's yours — two agents with the
// same map end up with visibly different cities.
//
// The art is the SAME SVG the collection cards use (items-art.js), rasterised
// once per kind+rarity and cached. Card CSS can't reach inside an <img>, so
// the palette is restated here and inlined into the SVG: shapes stay in one
// place, colours are stated twice on purpose.

import { itemArt } from './items-art.js'

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
}

// Flat things go on walls, everything else stands on the ground. Anything not
// listed falls through to the ground, which is the safe default — a new
// catalogue row draws itself without a code change, same rule as items-art.js.
const WALL_KINDS = new Set(['poster', 'photocard', 'album', 'record', 'banner', 'ticket', 'magnet'])
// These two are light sources, so they earn a glow on the pavement.
const LIT_KINDS = new Set(['lightstick', 'lightbox'])

const MAX_PROPS = 10   // past this the street reads as clutter, not a home

function hashStr(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}

const imgCache = new Map()

/** One rasterised drawing per kind+rarity — the palette is baked in. */
function itemImage(item) {
  const rarity = item.rarity || 'common'
  const key = `${item.kind || 'unknown'}|${rarity}`
  const hit = imgCache.get(key)
  if (hit) return hit

  const accent = rarity === 'common' ? INK.purple : INK.gold
  const body = rarity === 'legendary' ? INK.bodyLegendary : INK.body
  const style = `.ia-body{fill:${body}}.ia-accent{fill:${accent}}.ia-shine{fill:${INK.shine}}`
    + `.ia-hole{fill:${INK.hole}}.ia-spine{fill:${INK.spine}}.ia-line{fill:${INK.line}}`
    + `.ia-outline{fill:none;stroke:${INK.outline};stroke-width:2}`

  const svg = itemArt(item)
    .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" ')
    .replace(/^(<svg[^>]*>)/, `$1<style>${style}</style>`)

  const img = new Image()
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  imgCache.set(key, img)
  return img
}

/** A stable string for "are these the same items in the same order?" — cheap
 *  enough to check every frame, so a placed item shows up without a reload. */
export function propsKey(items) {
  return (items || []).map((i) => `${i.id}:${i.kind}:${i.rarity}`).join(',')
}

/**
 * Where each kept item stands. Flat things get a facade, everything else gets
 * a spot on the pavement, spread across whatever the landmark leaves free.
 * Positions come from the set as a whole, so they only shift when you add or
 * remove something; the small nudge that stops it reading as a row is keyed
 * off each item's own id, so that part never moves.
 */
export function layoutProps(items, m) {
  const list = (items || []).slice(0, MAX_PROPS)
  if (!list.length || !m) return []

  const { w, groundY } = m
  // Keep clear of whatever the district is named for — the landmark is the
  // reason the middle of the scene is empty.
  const centerGap = m.landmark && m.landmark.type !== 'bridge' ? Math.min(w * 0.28, 120) : 0
  const size = Math.max(16, Math.min(30, m.h * 0.15))
  const wallSize = size * 0.9
  const pad = 6

  // Tall enough to hang something on, and out of the landmark's way.
  const walls = m.buildings.filter((b) =>
    b.h > size * 2.2 && b.w > size * 1.1
    && (!centerGap || b.x + b.w < w / 2 - centerGap || b.x > w / 2 + centerGap))

  const onWall = (i) => WALL_KINDS.has(i.kind) && walls.length
  const wallItems = list.filter(onWall)
  const groundItems = list.filter((i) => !onWall(i))
  const out = []

  // One facade each, stacking down a wall only once every wall is taken.
  wallItems.forEach((item, i) => {
    const b = walls[i % walls.length]
    const tier = Math.floor(i / walls.length)
    const y = b.y + Math.max(5, b.h * 0.16) + tier * (wallSize + 5)
    if (y + wallSize > groundY - 4) return    // that wall is full
    out.push({ item, s: wallSize, x: b.x + (b.w - wallSize) / 2, y, wall: true, lit: false })
  })

  // The pavement, minus the landmark's slot: one or two usable runs, and the
  // ground items spaced evenly along their combined length.
  const segs = centerGap
    ? [[pad, w / 2 - centerGap], [w / 2 + centerGap, w - pad]]
    : [[pad, w - pad]]
  const spans = segs.map(([a, b]) => Math.max(0, b - a - size))
  const total = spans.reduce((n, s) => n + s, 0) || 1

  groundItems.forEach((item, i) => {
    let d = total * ((i + 0.5) / groundItems.length)
    let x = segs[0][0]
    for (let s = 0; s < segs.length; s++) {
      if (d <= spans[s] || s === segs.length - 1) { x = segs[s][0] + Math.min(d, spans[s]); break }
      d -= spans[s]
    }
    x += (hashStr(item.id || item.kind) % 13) - 6
    out.push({
      item,
      s: size,
      x: Math.max(pad, Math.min(w - size - pad, x)),
      y: groundY - size + 2,          // standing on the ground line
      wall: false,
      lit: LIT_KINDS.has(item.kind),
    })
  })

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

  for (const pr of props) {
    const img = itemImage(pr.item)
    if (!img.complete || !img.naturalWidth) continue   // still decoding — next frame

    if (pr.lit) {
      const pulse = reduced ? 1 : 0.88 + 0.12 * Math.sin(t * 0.002 + pr.x)
      const cx = pr.x + pr.s / 2
      const cy = pr.y + pr.s * 0.35
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, pr.s * 2.1)
      glow.addColorStop(0, `rgba(196, 181, 253, ${0.34 * a * pulse})`)
      glow.addColorStop(1, 'rgba(196, 181, 253, 0)')
      ctx.fillStyle = glow
      ctx.fillRect(cx - pr.s * 2.1, cy - pr.s * 2.1, pr.s * 4.2, pr.s * 4.2)
    }

    ctx.globalAlpha = a
    ctx.drawImage(img, pr.x, pr.y, pr.s, pr.s)
    ctx.globalAlpha = 1

    if (!pr.wall) {
      // A shadow is what stops it looking pasted on.
      ctx.fillStyle = `rgba(0,0,0,${0.35 * a})`
      ctx.beginPath()
      ctx.ellipse(pr.x + pr.s / 2, m.groundY + 1.5, pr.s * 0.42, pr.s * 0.11, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}
