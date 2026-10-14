// MAMA Battle share poster — 1080×1350, drawn onto any 2D canvas context.
//
// One campaign-graphic structure, three colourways (approved):
//   MAMA BATTLE / HOOLIGANS {score} / ALIENS {score} / {gap} VOTES APART /
//   the two team lines / PICK A SIDE. VOTE FOR BTS. / link + LIVE time
// Exactly one handmade touch per colourway:
//   V1 black  — a doodled star by the leading score (dropped when tied)
//   V2 cream  — a scribbled underline under the gap line
//   V3 purple — a small tilted LIVE sticker
//
// Pure drawing: the words come from battleView() (battle-share-rules.js) and
// the team lines from the share sheet; nothing here fetches or changes data.
// battle-poster-render.js loads the self-hosted fonts and makes the PNG.

export const W = 1080
export const H = 1350
export const FONT_DISPLAY = 'RC Poster Display' // Montserrat 900 (self-hosted)
export const FONT_SANS = 'RC Poster Sans'       // Inter 600/700/800 (self-hosted)

export const PALETTES = {
  V1: { bg: '#111013', fg: '#f7f1e6', hoo: '#ff6a2b', ali: '#2fc6ad', soft: 'rgba(247,241,230,.7)', faint: 'rgba(247,241,230,.45)', gapBg: '#ff6a2b', gapFg: '#111013' },
  V2: { bg: '#f3ebdd', fg: '#151214', hoo: '#e2531a', ali: '#0e8a76', soft: '#4f463e', faint: '#7d7268', gapBg: null, gapFg: '#151214' },
  V3: { bg: '#2b1f4d', fg: '#f7f1e6', hoo: '#ff7a3d', ali: '#3fd6bd', soft: 'rgba(247,241,230,.74)', faint: 'rgba(247,241,230,.5)', gapBg: '#f7f1e6', gapFg: '#2b1f4d' },
}
const LIVE_RED = '#ff4d5e'
const SANS_STACK = `"${FONT_SANS}", Inter, system-ui, sans-serif`
const DISP_STACK = `"${FONT_DISPLAY}", Montserrat, system-ui, sans-serif`
const disp = (px) => `900 ${px}px ${DISP_STACK}`
const sans = (w, px) => `${w} ${px}px ${SANS_STACK}`
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US')
const CX = W / 2
const MAX_W = W - 140

function text(ctx, s, x, y, font, color, { align = 'center', spacing = 0 } = {}) {
  ctx.font = font
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'alphabetic'
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`
  ctx.fillText(s, x, y)
  const w = ctx.measureText(s).width
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'
  return w
}

/** Largest size ≤ px at which `s` fits in maxWidth (never below min). */
function fitSize(ctx, s, px, maxWidth, font, min = 24) {
  let size = px
  ctx.font = font(size)
  while (size > min && ctx.measureText(s).width > maxWidth) {
    size -= 2
    ctx.font = font(size)
  }
  return size
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// ── the one handmade touch per colourway ────────────────────────────

/** V1 — a four-point doodled star, slightly tilted. */
function star(ctx, cx, cy, size, color) {
  const s = size / 2
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(-0.21)
  ctx.beginPath()
  ctx.moveTo(0, -s)
  ctx.bezierCurveTo(s * 0.06, -s * 0.4, s * 0.25, -s * 0.12, s, 0)
  ctx.bezierCurveTo(s * 0.25, s * 0.12, s * 0.06, s * 0.4, 0, s)
  ctx.bezierCurveTo(-s * 0.06, s * 0.4, -s * 0.25, s * 0.12, -s, 0)
  ctx.bezierCurveTo(-s * 0.25, -s * 0.12, -s * 0.06, -s * 0.4, 0, -s)
  ctx.fillStyle = color
  ctx.fill()
  ctx.restore()
}

/** V2 — one marker stroke under the gap line. */
function scribble(ctx, cx, y, w, color) {
  const x = cx - w / 2
  ctx.beginPath()
  ctx.moveTo(x + 8, y + 4)
  ctx.bezierCurveTo(x + w * 0.2, y - 12, x + w * 0.38, y + 14, x + w * 0.56, y)
  ctx.bezierCurveTo(x + w * 0.74, y - 12, x + w * 0.9, y - 4, x + w - 8, y + 6)
  ctx.strokeStyle = color
  ctx.lineWidth = 12
  ctx.lineCap = 'round'
  ctx.stroke()
}

/** V3 — a small LIVE sticker, tilted, in the top corner. */
function liveSticker(ctx, p) {
  ctx.save()
  ctx.translate(W - 158, 14)
  ctx.rotate(0.14)
  roundRect(ctx, 0, 0, 124, 44, 8)
  ctx.fillStyle = p.fg
  ctx.fill()
  ctx.beginPath()
  ctx.arc(24, 22, 6, 0, Math.PI * 2)
  ctx.fillStyle = LIVE_RED
  ctx.fill()
  text(ctx, 'LIVE', 39, 31, sans(800, 24), p.bg, { align: 'left', spacing: 2.4 })
  ctx.restore()
}

// ── the shared structure ────────────────────────────────────────────

/** The two team lines: on one line when they fit, else one line each.
 *  Each line shrinks to fit rather than wrapping — never more than two. */
function teamLines(ctx, lines, p) {
  const a = `“${lines.hooligans}”`
  const b = `“${lines.aliens}”`
  const one = `${a}  ·  ${b}`
  ctx.font = sans(700, 34)
  if (ctx.measureText(one).width <= MAX_W) {
    text(ctx, one, CX, 1036, sans(700, 34), p.soft)
    return
  }
  for (const [s, y] of [[a, 1032], [b, 1072]]) {
    const size = fitSize(ctx, s, 32, MAX_W, (px) => sans(700, px))
    text(ctx, s, CX, y, sans(700, size), p.soft)
  }
}

/** Draw one colourway. `v` is battleView(); `lines` are the team lines. */
export function drawPoster(ctx, style, v, lines) {
  const key = PALETTES[style] ? style : 'V1'
  const p = PALETTES[key]
  ctx.fillStyle = p.bg
  ctx.fillRect(0, 0, W, H)

  text(ctx, 'MAMA BATTLE', CX, 146, disp(92), p.fg, { spacing: -3 })

  // Both scores share one size so neither team looks stronger.
  const scoreSize = Math.min(
    fitSize(ctx, fmt(v.h.points), 270, MAX_W, disp, 120),
    fitSize(ctx, fmt(v.a.points), 270, MAX_W, disp, 120),
  )
  const rows = [[v.h, 'hoo', 255, 479], [v.a, 'ali', 589, 813]]
  const ends = {}
  for (const [team, color, nameY, scoreY] of rows) {
    text(ctx, team.label, CX, nameY, disp(54), p[color], { spacing: 3 })
    const w = text(ctx, fmt(team.points), CX, scoreY, disp(scoreSize), p.fg, { spacing: -scoreSize * 0.06 })
    ends[team.id] = { right: CX + w / 2, top: scoreY - scoreSize * 0.72 }
  }

  // The gap — almost as loud as the scores.
  const gapSize = fitSize(ctx, v.gapLine, 92, MAX_W - 68, disp, 40)
  ctx.font = disp(gapSize)
  const gw = ctx.measureText(v.gapLine).width
  if (p.gapBg) {
    roundRect(ctx, CX - gw / 2 - 34, 862, gw + 68, 128, 6)
    ctx.fillStyle = p.gapBg
    ctx.fill()
  }
  text(ctx, v.gapLine, CX, 958, disp(gapSize), p.gapFg, { spacing: -2 })

  teamLines(ctx, lines, p)
  text(ctx, v.posterCta[0], CX, 1156, disp(78), p.fg, { spacing: -2 })
  text(ctx, v.posterCta[1], CX, 1236, disp(78), p.fg, { spacing: -2 })
  text(ctx, 'hopetrackers.org/battle', CX, 1288, sans(700, 30), p.soft)
  text(ctx, v.liveLine, CX, 1324, sans(600, 20), p.faint, { spacing: 1.6 })

  // One handmade touch, never more.
  if (key === 'V1' && v.leader && !v.winners?.length) {
    const e = ends[v.leader]
    star(ctx, Math.min(W - 70, e.right + 44), e.top + 18, 88, v.leader === 'hooligans' ? p.hoo : p.ali)
  }
  if (key === 'V2') scribble(ctx, CX, 984, Math.min(MAX_W, gw + 60), p.hoo)
  if (key === 'V3') liveSticker(ctx, p)
}
