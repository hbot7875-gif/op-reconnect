// MAMA Battle share poster — 1080×1350, drawn onto any 2D canvas context.
// Two layouts: the battle poster (both sides, below) and, for Round 2, one
// recruit poster per side (drawRecruitPoster) that links that side's page.
//
// One campaign-graphic structure, three colourways (approved):
//   MAMA VOTING BATTLE / HOOLIGANS {score} {line} / ALIENS {score} {line} /
//   {gap} VOTES APART / PICK A SIDE. VOTE FOR BTS. / link + LIVE time
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

/** V3 — a small LIVE (or SOON) sticker, tilted, in the top corner. */
function liveSticker(ctx, p, label = 'LIVE') {
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
  text(ctx, label, 39, 31, sans(800, 24), p.bg, { align: 'left', spacing: 2.4 })
  ctx.restore()
}

// ── the shared structure ────────────────────────────────────────────

/** One team's line, under that team's score: soft text, with the quote marks
 *  in the team colour so it reads as that team speaking. Shrinks to fit;
 *  never wraps. */
function teamLine(ctx, line, y, color, p) {
  const size = fitSize(ctx, `“${line}”`, 34, MAX_W, (px) => sans(700, px), 22)
  const font = sans(700, size)
  ctx.font = font
  const q1 = ctx.measureText('“').width
  const q2 = ctx.measureText('”').width
  const bw = ctx.measureText(line).width
  let x = CX - (q1 + bw + q2) / 2
  text(ctx, '“', x, y, font, color, { align: 'left' })
  x += q1
  text(ctx, line, x, y, font, p.soft, { align: 'left' })
  x += bw
  text(ctx, '”', x, y, font, color, { align: 'left' })
}

/** Draw one colourway. `v` is battleView(); `lines` are the team lines. */
export function drawPoster(ctx, style, v, lines) {
  const key = PALETTES[style] ? style : 'V1'
  const p = PALETTES[key]
  ctx.fillStyle = p.bg
  ctx.fillRect(0, 0, W, H)

  // The title shrinks to fit the poster's margins rather than overflow.
  const title = 'MAMA VOTING BATTLE'
  text(ctx, title, CX, 146, disp(fitSize(ctx, title, 92, MAX_W, disp, 60)), p.fg, { spacing: -3 })

  // Scores — or, before voting opens, agents on each side. Both share one
  // size so neither team looks stronger.
  const num = (t) => fmt(v.shown ? v.shown(t) : t.points)
  const scoreSize = Math.min(
    fitSize(ctx, num(v.h), 270, MAX_W, disp, 120),
    fitSize(ctx, num(v.a), 270, MAX_W, disp, 120),
  )
  // A thousands comma hangs below the baseline; keep each line clear of it.
  const comma = num(v.h).includes(',') || num(v.a).includes(',') ? Math.round(scoreSize * 0.12) : 0
  // TEAM / score / that team's line — HOOLIGANS speaks, then ALIENS replies.
  // With commas the stack runs taller, so it tightens a little to keep the
  // gap line clear of the call to action.
  const ends = {}
  let nameY = comma ? 224 : 236
  let lineY = 0
  for (const [team, color, line] of [[v.h, 'hoo', lines.hooligans], [v.a, 'ali', lines.aliens]]) {
    text(ctx, v.unit ? `${team.label} · ${v.unit}` : team.label, CX, nameY, disp(54), p[color], { spacing: 3 })
    const scoreY = nameY + 219
    const w = text(ctx, num(team), CX, scoreY, disp(scoreSize), p.fg, { spacing: -scoreSize * 0.06 })
    ends[team.id] = { right: CX + w / 2, top: scoreY - scoreSize * 0.72 }
    lineY = scoreY + 53 + comma
    teamLine(ctx, line, lineY, p[color], p)
    nameY = lineY + (comma ? 60 : 68)
  }

  // The gap — almost as loud as the scores.
  const gapTop = lineY + (comma ? 32 : 38)
  const gapSize = fitSize(ctx, v.gapLine, 92, MAX_W - 68, disp, 40)
  ctx.font = disp(gapSize)
  const gw = ctx.measureText(v.gapLine).width
  if (p.gapBg) {
    roundRect(ctx, CX - gw / 2 - 34, gapTop, gw + 68, 124, 6)
    ctx.fillStyle = p.gapBg
    ctx.fill()
  }
  const gapY = gapTop + 95
  text(ctx, v.gapLine, CX, gapY, disp(gapSize), p.gapFg, { spacing: -2 })

  for (const [i, line] of v.posterCta.entries()) {
    text(ctx, line, CX, 1156 + i * 80, disp(fitSize(ctx, line, 78, MAX_W, disp, 48)), p.fg, { spacing: -2 })
  }
  text(ctx, 'hopetrackers.org/battle', CX, 1288, sans(700, 30), p.soft)
  text(ctx, v.liveLine, CX, 1324, sans(600, 20), p.faint, { spacing: 1.6 })

  // One handmade touch, never more.
  if (key === 'V1' && v.leader && !v.winners?.length) {
    const e = ends[v.leader]
    star(ctx, Math.min(W - 70, e.right + 44), e.top + 18, 88, v.leader === 'hooligans' ? p.hoo : p.ali)
  }
  if (key === 'V2') scribble(ctx, CX, gapY + 26, Math.min(MAX_W, gw + 60), p.hoo)
  if (key === 'V3') liveSticker(ctx, p, v.phase === 'soon' ? 'SOON' : 'LIVE')
}

/**
 * One side's recruit poster. `rv` is recruitView(); `line` is that side's
 * line. Same three colourways and the same one-handmade-touch rule:
 *   MAMA VOTING BATTLE · ROUND 2 / {TEAM} / ARE RECRUITING | NEED YOU /
 *   "line" / {agents | score} {caption} / two hype lines / {when} /
 *   JOIN {TEAM}. VOTE FOR BTS. / that side's link
 */
export function drawRecruitPoster(ctx, style, rv, line) {
  const key = PALETTES[style] ? style : 'V1'
  const p = PALETTES[key]
  const tc = rv.team.id === 'aliens' ? p.ali : p.hoo
  const live = rv.phase === 'open'
  ctx.fillStyle = p.bg
  ctx.fillRect(0, 0, W, H)

  const kicker = 'MAMA VOTING BATTLE · ROUND 2'
  text(ctx, kicker, CX, 108, sans(800, fitSize(ctx, kicker, 32, MAX_W, (px) => sans(800, px), 20)), p.soft, { spacing: 4 })

  // The side's name is the poster.
  const nameSize = fitSize(ctx, rv.team.label, 200, MAX_W, disp, 96)
  const nameW = text(ctx, rv.team.label, CX, 300, disp(nameSize), tc, { spacing: -nameSize * 0.04 })
  const rest = rv.shout.replace(rv.team.label, '').trim()
  text(ctx, rest, CX, 390, disp(fitSize(ctx, rest, 76, MAX_W, disp, 44)), p.fg, { spacing: -1 })
  teamLine(ctx, line, 450, tc, p)

  // Agents ready (and new this round), or once voting runs, the score.
  const big = fmt(live ? rv.team.points : rv.team.agents)
  const bigSize = fitSize(ctx, big, 170, MAX_W, disp, 90)
  text(ctx, big, CX, 650, disp(bigSize), p.fg, { spacing: -bigSize * 0.05 })
  const caption = live ? `${rv.team.label} VOTES · ${rv.standing}` : `${rv.team.agents === 1 ? 'AGENT' : 'AGENTS'} READY · ${rv.recruitsLine}`
  text(ctx, caption, CX, 712, sans(800, fitSize(ctx, caption, 32, MAX_W, (px) => sans(800, px), 20)), tc, { spacing: 2 })

  for (const [i, h] of rv.hype.entries()) {
    text(ctx, h, CX, 832 + i * 78, disp(fitSize(ctx, h, 70, MAX_W, disp, 40)), p.fg, { spacing: -2 })
  }

  // When: the opening, or the time left.
  const when = live ? `${(rv.left || '').toUpperCase()} · EVERY VOTE COUNTS` : rv.opens ? `VOTING OPENS ${rv.opens.toUpperCase()}` : 'VOTING OPENS SOON'
  const whenSize = fitSize(ctx, when, 40, MAX_W - 68, (px) => sans(800, px), 24)
  ctx.font = sans(800, whenSize)
  const ww = ctx.measureText(when).width
  roundRect(ctx, CX - ww / 2 - 30, 950, ww + 60, 74, 6)
  ctx.fillStyle = tc
  ctx.fill()
  text(ctx, when, CX, 999, sans(800, whenSize), p.bg, { spacing: 1.5 })

  // The recruit bonus, when this round has one.
  if (rv.bonusShort) {
    const b = `★ ${rv.bonusShort}`
    text(ctx, b, CX, 1072, sans(800, fitSize(ctx, b, 30, MAX_W, (px) => sans(800, px), 20)), tc, { spacing: 1 })
  }
  for (const [i, c] of rv.teamCta.entries()) {
    text(ctx, c, CX, 1146 + i * 80, disp(fitSize(ctx, c, 78, MAX_W, disp, 48)), i === 0 ? tc : p.fg, { spacing: -2 })
  }
  text(ctx, rv.hostPath, CX, 1288, sans(700, fitSize(ctx, rv.hostPath, 30, MAX_W, (px) => sans(700, px), 20)), p.soft)
  text(ctx, `${rv.liveLine} · UNOFFICIAL ARMY FAN PROJECT`, CX, 1324, sans(600, 18), p.faint, { spacing: 1.4 })

  // One handmade touch, never more.
  if (key === 'V1') star(ctx, Math.min(W - 70, CX + nameW / 2 + 40), 300 - nameSize * 0.62, 84, tc)
  if (key === 'V2') scribble(ctx, CX, 314, Math.min(MAX_W, nameW + 40), tc)
  if (key === 'V3') liveSticker(ctx, p, live ? 'LIVE' : 'SOON')
}
