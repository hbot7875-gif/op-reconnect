import { buildModel, renderScene } from './scene.js'
import { districtDisplayName } from './ward-tiles.js'
import { redZoneTarget } from './red-zone-ui.js'
import {
  SHARE_URL, SHARE_URL_LABEL, districtCaption, districtImageLine,
  liveRedZoneCaption, liveRedZoneImageLine, successfulRedZoneCaption, successfulRedZoneImageLine,
} from './share-card-copy.js'

const W = 1080
const H = 1350
const DISPLAY = 'Orbitron, sans-serif'
const MONO = 'Share Tech Mono, monospace'
const BODY = 'Segoe UI, sans-serif'

function makeCanvas() {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  return c
}

async function fontsReady() {
  try { await document.fonts?.ready } catch { /* canvas falls back safely */ }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

function trackingText(ctx, text, x, y, tracking, align = 'left') {
  const previousAlign = ctx.textAlign
  ctx.textAlign = 'left'
  const chars = [...String(text)]
  const widths = chars.map((char) => ctx.measureText(char).width)
  const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, chars.length - 1) * tracking
  let cursor = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], cursor, y)
    cursor += widths[i] + tracking
  }
  ctx.textAlign = previousAlign
}

function fitOneLine(ctx, text, maxWidth, maxSize, minSize, weight = 800, family = DISPLAY) {
  let size = maxSize
  while (size > minSize) {
    ctx.font = `${weight} ${size}px ${family}`
    if (ctx.measureText(text).width <= maxWidth) break
    size -= 1
  }
  return size
}

/** Tracks, albums and mixed targets may be much longer than SWIM. Find the
 *  largest readable two-line layout, then permit a third line rather than
 *  clipping or breaking the rest of the composition. */
export function fitTargetLines(ctx, text, maxWidth, maxSize = 58, minSize = 34) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean)
  for (let size = maxSize; size >= minSize; size--) {
    ctx.font = `900 ${size}px ${DISPLAY}`
    const lines = wrapWords(ctx, words, maxWidth)
    if (lines.length <= 2 && lines.every((part) => ctx.measureText(part).width <= maxWidth)) return { size, lines }
  }
  const size = minSize
  ctx.font = `900 ${size}px ${DISPLAY}`
  const lines = wrapWords(ctx, words, maxWidth)
  if (lines.length > 3) {
    const kept = lines.slice(0, 3)
    while (ctx.measureText(`${kept[2]}…`).width > maxWidth && kept[2].includes(' ')) kept[2] = kept[2].replace(/\s+\S+$/, '')
    kept[2] += '…'
    return { size, lines: kept }
  }
  return { size, lines }
}

function wrapWords(ctx, words, maxWidth) {
  const lines = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = word } else line = next
  }
  if (line) lines.push(line)
  return lines
}

function drawSignature(ctx, centered = false) {
  ctx.fillStyle = '#8a839b'
  ctx.font = `500 22px ${MONO}`
  trackingText(ctx, 'RECONNECT · HOPETRACKER', centered ? W / 2 : 76, 1250, 4, centered ? 'center' : 'left')
  ctx.fillStyle = '#aaa3b8'
  // Still a quiet signature, but large enough to survive the 1080px card
  // being compressed down to a normal Story/WhatsApp phone width.
  ctx.font = `600 30px ${MONO}`
  trackingText(ctx, SHARE_URL_LABEL, centered ? W / 2 : 76, 1291, 2, centered ? 'center' : 'left')
}

function drawDistrictGradient(ctx) {
  const fade = ctx.createLinearGradient(0, 675, 0, 1110)
  fade.addColorStop(0, 'rgba(10,9,16,0)')
  fade.addColorStop(.36, 'rgba(10,9,16,.88)')
  fade.addColorStop(.62, '#0a0910')
  fade.addColorStop(1, '#0a0910')
  ctx.fillStyle = fade
  ctx.fillRect(0, 675, W, 675)
}

export async function districtShareAsset(state, district, progress) {
  await fontsReady()
  const c = makeCanvas()
  const ctx = c.getContext('2d')
  const name = districtDisplayName(district).toUpperCase()
  const complete = progress >= 1
  const model = buildModel(district.id, W, 945, district.name, {
    wardId: district.wardId,
    centerpiece: district.status === 'centerpiece_dark' || district.status === 'centerpiece_lit',
  })
  renderScene(ctx, model, progress, 1200, true, Number(state?.bomb?.charge) || 0, [])
  drawDistrictGradient(ctx)
  ctx.fillStyle = '#8b5cf6'; ctx.globalAlpha = .68; ctx.fillRect(76, 867, 66, 3); ctx.globalAlpha = 1
  ctx.fillStyle = '#aaa3ba'; ctx.font = `500 25px ${MONO}`; trackingText(ctx, 'MY DISTRICT', 76, 923, 8)
  ctx.fillStyle = '#f2eff8'
  const nameSize = fitOneLine(ctx, name, 928, 58, 42)
  ctx.font = `800 ${nameSize}px ${DISPLAY}`; ctx.fillText(name, 76, 1004)
  ctx.fillStyle = complete ? '#e4b968' : '#a78bfa'; ctx.font = `700 39px ${MONO}`
  ctx.fillText(`${Math.round(progress * 100)}% RESTORED${complete ? ' ✦' : ''}`, 76, 1074)
  ctx.fillStyle = '#d8d2e3'; ctx.font = `400 34px ${BODY}`; ctx.fillText(districtImageLine(name, Math.round(progress * 100)), 76, 1154)
  drawSignature(ctx)
  const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'))
  return {
    blob, filename: `reconnect-${district.id}-${Math.round(progress * 100)}.png`,
    caption: districtCaption(name, Math.round(progress * 100)),
    title: `${districtDisplayName(district)} · ${Math.round(progress * 100)}% restored`, url: SHARE_URL,
  }
}

function bombGlow(ctx, x, y, radius, attack) {
  const glow = ctx.createRadialGradient(x, y, 20, x, y, radius * 1.9)
  const rgb = attack ? '201,47,69' : '139,92,246'
  glow.addColorStop(0, `rgba(${rgb},.72)`); glow.addColorStop(.4, `rgba(${rgb},.24)`); glow.addColorStop(1, `rgba(${rgb},0)`)
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, radius * 1.9, 0, Math.PI * 2); ctx.fill()
}

function drawBomb(ctx, { x = 540, y = 490, radius = 145, attack = false, restored = 0 }) {
  bombGlow(ctx, x, y, radius, attack)
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.clip()
  const glass = ctx.createRadialGradient(x - radius * .34, y - radius * .38, 8, x, y, radius * 1.2)
  glass.addColorStop(0, attack ? 'rgba(120,52,65,.40)' : 'rgba(226,215,255,.70)')
  glass.addColorStop(.38, attack ? 'rgba(38,15,23,.82)' : 'rgba(142,91,233,.82)')
  glass.addColorStop(1, attack ? 'rgba(5,4,8,.96)' : 'rgba(55,25,104,.92)')
  ctx.fillStyle = glass; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
  if (attack) {
    const frac = Math.max(0, Math.min(1, restored))
    const liquidTop = y - radius + frac * radius * 2
    const liquid = ctx.createLinearGradient(0, liquidTop, 0, y + radius)
    liquid.addColorStop(0, '#c92f45'); liquid.addColorStop(.55, '#a82539'); liquid.addColorStop(1, '#5e1122')
    ctx.fillStyle = liquid; ctx.fillRect(x - radius, liquidTop, radius * 2, y + radius - liquidTop)
    ctx.fillStyle = '#bd2b42'; ctx.beginPath(); ctx.ellipse(x, liquidTop, radius * 1.03, 11, 0, 0, Math.PI * 2); ctx.fill()
  }
  const shine = ctx.createLinearGradient(0, y - radius * .8, 0, y - radius * .25)
  shine.addColorStop(0, 'rgba(255,255,255,.34)'); shine.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = shine; ctx.save(); ctx.translate(x - 55, y - 62); ctx.rotate(-.45)
  ctx.beginPath(); ctx.ellipse(0, 0, 48, 22, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore()
  ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.ellipse(x + 78, y - 55, 21, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore()
  ctx.strokeStyle = attack ? 'rgba(159,139,146,.48)' : 'rgba(226,205,166,.52)'; ctx.lineWidth = 4
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke()
  ctx.fillStyle = '#f7f1ff'; ctx.font = `800 72px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.fillText('⟭⟬', x, y + 24); ctx.textAlign = 'left'
  const handleTop = y + radius - 3
  const handle = ctx.createLinearGradient(x - 30, 0, x + 30, 0)
  handle.addColorStop(0, '#050505'); handle.addColorStop(.5, '#252525'); handle.addColorStop(1, '#050505')
  ctx.fillStyle = handle; roundRect(ctx, x - 30, handleTop, 60, 205, 27); ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 3; ctx.stroke()
  ctx.fillStyle = '#050505'; roundRect(ctx, x - 20, handleTop + 38, 40, 62, 19); ctx.fill()
  ctx.strokeStyle = '#353535'; ctx.lineWidth = 3; ctx.stroke()
  ctx.fillStyle = '#292929'; roundRect(ctx, x - 13, handleTop + 145, 26, 9, 5); ctx.fill()
}

function redZoneTargetLabel(defuse) {
  const target = redZoneTarget(defuse)
  if (target.entries.length === 1 && target.entries[0].kind === 'album') return `${target.entries[0].name} ALBUM`
  return target.short
}

function redZoneBase(danger) {
  const c = makeCanvas(); const ctx = c.getContext('2d')
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#09070e'); bg.addColorStop(.52, danger ? '#11070d' : '#120e20'); bg.addColorStop(1, '#08070d')
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)
  return { c, ctx }
}

function drawCenteredTracking(ctx, text, y, size, color, spacing, weight = 700) {
  ctx.fillStyle = color; ctx.font = `${weight} ${size}px ${MONO}`; trackingText(ctx, text, W / 2, y, spacing, 'center')
}

export async function liveRedZoneShareAsset(defuse, capturedAt = Date.now()) {
  await fontsReady()
  const frozen = structuredClone(defuse)
  const { c, ctx } = redZoneBase(true)
  drawCenteredTracking(ctx, '🚨 CITY UNDER ATTACK', 112, 27, '#ff9baa', 6)
  ctx.fillStyle = '#f2eff8'; ctx.font = `900 54px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.fillText('RED ZONE', W / 2, 198)
  const restored = Math.max(0, Math.min(1, Number(frozen.progress) / Math.max(1, Number(frozen.target))))
  drawBomb(ctx, { attack: true, restored })
  const targetLabel = redZoneTargetLabel(frozen)
  const fitted = fitTargetLines(ctx, `STREAM ${targetLabel.toUpperCase()}`, 870)
  const titleTop = 790; const lineHeight = fitted.size * 1.16
  ctx.textAlign = 'center'; ctx.fillStyle = '#f2eff8'; ctx.font = `900 ${fitted.size}px ${DISPLAY}`
  fitted.lines.forEach((line, i) => ctx.fillText(line, W / 2, titleTop + i * lineHeight))
  const progressY = titleTop + fitted.lines.length * lineHeight + 44
  ctx.font = `700 43px ${MONO}`
  ctx.fillText(`${Number(frozen.progress).toLocaleString()} / ${Number(frozen.target).toLocaleString()} ${redZoneTarget(frozen).unit.toUpperCase()}`, W / 2, progressY)
  const timerY = progressY + 96
  const msLeft = Math.max(0, new Date(frozen.activeUntil || frozen.endsAt).getTime() - capturedAt)
  const totalSeconds = Math.floor(msLeft / 1000)
  const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, '0')
  const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')
  const ss = String(totalSeconds % 60).padStart(2, '0')
  ctx.fillStyle = '#ff9baa'; ctx.font = `700 46px ${MONO}`; ctx.fillText(`${hh}:${mm}:${ss}`, W / 2, timerY)
  drawCenteredTracking(ctx, 'LEFT', timerY + 39, 19, '#8f879a', 5, 500)
  ctx.fillStyle = '#d8d2e3'; ctx.font = `400 31px ${BODY}`
  ctx.fillText(liveRedZoneImageLine({ progress: frozen.progress, target: frozen.target, activeFrom: frozen.activeFrom, activeUntil: frozen.activeUntil || frozen.endsAt, capturedAt }), W / 2, timerY + 104)
  drawSignature(ctx, true)
  const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'))
  return {
    blob, filename: 'reconnect-red-zone-live.png', title: 'ReConnect · City under attack', url: SHARE_URL,
    caption: liveRedZoneCaption({ progress: frozen.progress, target: frozen.target, targetLabel, msLeft }),
  }
}

export async function successfulRedZoneShareAsset(resolved) {
  await fontsReady()
  const frozen = structuredClone(resolved)
  const { c, ctx } = redZoneBase(false)
  // CITY SAFE + DEFUSED is stronger without a redundant RED ZONE CLEARED line.
  ctx.fillStyle = '#f2eff8'; ctx.font = `900 62px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.fillText('CITY SAFE ✦', W / 2, 164)
  drawBomb(ctx, { y: 510, radius: 145, attack: false, restored: 1 })
  ctx.textAlign = 'center'; ctx.fillStyle = '#e4b968'; ctx.font = `700 43px ${MONO}`
  ctx.fillText(`${Number(frozen.progress).toLocaleString()} / ${Number(frozen.target).toLocaleString()} STREAMS`, W / 2, 905)
  ctx.fillStyle = '#f2eff8'; ctx.font = `900 58px ${DISPLAY}`; ctx.fillText('DEFUSED', W / 2, 1004)
  ctx.fillStyle = '#d8d2e3'; ctx.font = `400 34px ${BODY}`; ctx.fillText(successfulRedZoneImageLine(), W / 2, 1090)
  drawSignature(ctx, true)
  const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'))
  return {
    blob, filename: 'reconnect-red-zone-defused.png', title: 'ReConnect · City safe', url: SHARE_URL,
    caption: successfulRedZoneCaption(frozen),
  }
}
