// Shared drawing kit for the landmark modules (landmarks.js and
// landmarks-extra.js). Two house hues + the silhouette ink, nothing else.

export const GOLD = '255,206,130'
export const VIO = '196,181,253'
export const SIL = '#0f0c1d'                 // darker than any skyline building

export function glow(ctx, x, y, r, rgb, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, `rgba(${rgb},${a})`)
  g.addColorStop(1, `rgba(${rgb},0)`)
  ctx.fillStyle = g
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
}

/** A sagging line of pennant flags between two points — the market's
 *  bunting, generalised so festive wards can sprinkle it onto other
 *  landmarks without duplicating the curve+flag-loop math. */
export function drawBunting(ctx, x1, x2, y, lit, t, reduced, s, n = 9) {
  const sag = (x2 - x1) * 0.055
  ctx.strokeStyle = lit ? `rgba(${GOLD},0.35)` : 'rgba(255,255,255,0.12)'
  ctx.lineWidth = 1 * s
  ctx.beginPath()
  ctx.moveTo(x1, y)
  ctx.quadraticCurveTo((x1 + x2) / 2, y + sag, x2, y)
  ctx.stroke()
  for (let i = 0; i <= n; i++) {
    const f = i / n
    const fx = x1 + (x2 - x1) * f
    const fy = y + Math.sin(Math.PI * f) * sag
    const sway = reduced ? 0 : Math.sin(t * 0.002 + i) * 0.8 * s
    ctx.fillStyle = lit
      ? (i % 2 ? `rgba(${GOLD},0.8)` : `rgba(${VIO},0.75)`)
      : 'rgba(255,255,255,0.10)'
    ctx.beginPath()
    ctx.moveTo(fx - 2.4 * s + sway, fy)
    ctx.lineTo(fx + 2.4 * s + sway, fy)
    ctx.lineTo(fx + sway, fy + 5 * s)
    ctx.closePath(); ctx.fill()
  }
}
