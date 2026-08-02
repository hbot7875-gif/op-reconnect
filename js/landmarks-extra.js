// Second shelf of landmarks — the archetypes the world map's names demanded
// once every district in docs/op-reconnect-districts.md was checked against
// the keyword table: streets and alleys, halls and galleries, houses, caves,
// stages, mills, crossroads. Same rules as landmarks.js: silhouette first,
// gold/violet accents arriving with progress (~0.35 / ~0.65 / ~0.9).

import { GOLD, VIO, SIL, glow } from './landmarks-kit.js'

export const EXTRA = {
  // A row of small facades under a string of lights — lanes, alleys,
  // boulevards, markets. Half the map lives on a street like this.
  // Reviewed as "a row of small buildings". Rebuilt so the ROAD is the
  // landmark: a crossing, a centre line, a traffic light and a parked car
  // in the foreground. The facades are set back and become context.
  street(ctx, { cx, gy, s, p, t, reduced, w: sw, h: sh, variant = 0 }) {
    const road = sh - gy

    // facades, pushed back and lower so they frame rather than dominate
    const F = [[-78, 28, 24], [-46, 24, 30], [-16, 30, 22], [18, 26, 28], [48, 28, 25]]
    ctx.fillStyle = SIL
    for (const [ox, fw, fh] of F) ctx.fillRect(cx + ox * s, gy - fh * s, fw * s, fh * s)

    // pavement edge
    ctx.fillStyle = 'rgba(255,255,255,0.09)'
    ctx.fillRect(0, gy, sw, 1.2 * s)

    // zebra crossing — the single clearest "this is a street" signal
    ctx.fillStyle = `rgba(255,255,255,${0.10 + p * 0.16})`
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(cx - 26 * s + i * 9.5 * s, gy + road * 0.10, 5.5 * s, road * 0.30)
    }
    // centre line running out of frame
    ctx.fillStyle = `rgba(255,255,255,${0.07 + p * 0.07})`
    for (let dx = 0; dx < sw; dx += 15 * s) ctx.fillRect(dx, gy + road * 0.60, 8 * s, 1.5 * s)

    // traffic light on the kerb
    const tx = cx + 52 * s
    ctx.fillStyle = SIL
    ctx.fillRect(tx, gy - 30 * s, 2.6 * s, 30 * s)
    ctx.fillRect(tx - 2.6 * s, gy - 39 * s, 8 * s, 10 * s)
    if (p > 0.4) {
      // cycles instead of holding one fixed colour — a traffic light that
      // never changes reads as a lamp, not a signal.
      const cycling = reduced ? variant % 2 : Math.floor(t / 2200) % 2
      const on = cycling ? GOLD : VIO
      ctx.fillStyle = `rgba(${on},0.95)`
      ctx.beginPath(); ctx.arc(tx + 1.3 * s, gy - 34 * s, 2 * s, 0, Math.PI * 2); ctx.fill()
      glow(ctx, tx + 1.3 * s, gy - 34 * s, 13 * s, on, 0.3)
    }

    // parked car in the foreground — near-camera, so it reads as depth
    const carX = cx - 58 * s
    ctx.fillStyle = '#0a0814'
    ctx.fillRect(carX, gy + road * 0.42, 30 * s, 6 * s)
    ctx.beginPath()
    ctx.moveTo(carX + 5 * s, gy + road * 0.42)
    ctx.lineTo(carX + 10 * s, gy + road * 0.42 - 5 * s)
    ctx.lineTo(carX + 21 * s, gy + road * 0.42 - 5 * s)
    ctx.lineTo(carX + 25 * s, gy + road * 0.42)
    ctx.closePath(); ctx.fill()
    ctx.beginPath(); ctx.arc(carX + 8 * s, gy + road * 0.42 + 6 * s, 2.4 * s, 0, Math.PI * 2)
    ctx.arc(carX + 22 * s, gy + road * 0.42 + 6 * s, 2.4 * s, 0, Math.PI * 2); ctx.fill()
    if (p > 0.6) {
      ctx.fillStyle = `rgba(${GOLD},0.7)`
      ctx.fillRect(carX + 27 * s, gy + road * 0.42 + 1 * s, 3 * s, 2 * s)
    }
    F.forEach(([ox, fw], i) => {
      const on = p > 0.2 + i * 0.14
      ctx.fillStyle = on ? `rgba(${GOLD},0.85)` : 'rgba(255,255,255,0.05)'
      ctx.fillRect(cx + (ox + fw / 2 - 3) * s, gy - 12 * s, 6 * s, 12 * s)
      if (on) glow(ctx, cx + (ox + fw / 2) * s, gy - 6 * s, 12 * s, GOLD, 0.22)
    })
    const x1 = cx - 74 * s, x2 = cx + 76 * s, py = gy - 46 * s
    const n = 11, lit = Math.floor(n * p)
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n
      const lx = x1 + (x2 - x1) * f
      const ly = py + Math.sin(Math.PI * f) * 9 * s
      ctx.fillStyle = i < lit ? `rgba(${GOLD},0.9)` : 'rgba(255,255,255,0.08)'
      ctx.beginPath(); ctx.arc(lx, ly, 1.4 * s, 0, Math.PI * 2); ctx.fill()
      if (i < lit) glow(ctx, lx, ly, 8 * s, GOLD, 0.28)
    }
    if (p > 0.65) {
      ctx.fillStyle = `rgba(${VIO},0.8)`
      ctx.fillRect(cx - 38 * s, gy - 30 * s, 4 * s, 11 * s)
      glow(ctx, cx - 36 * s, gy - 25 * s, 10 * s, VIO, 0.3)
    }
  },

  // Markets are visually chaotic and that's the point — a run of tent
  // canopies at mismatched heights, bunting strung between the poles, crates
  // on the ground. Nothing here is aligned, which is exactly what separates
  // it from the tidy rectangles of shop and hall.
  market(ctx, { cx, gy, s, p, t, reduced, variant = 0 }) {
    const lit = p > 0.4, busy = p > 0.65
    const STALLS = [
      [-62, 30, 26], [-30, 26, 32], [-2, 30, 24], [28, 26, 30], [56, 24, 27],
    ]

    // back wall of low buildings, barely there — the stalls are the landmark
    ctx.fillStyle = '#12101f'
    ctx.fillRect(cx - 80 * s, gy - 22 * s, 160 * s, 22 * s)

    for (const [ox, sw2, sh2] of STALLS) {
      const x = cx + ox * s, top = gy - sh2 * s
      // poles
      ctx.fillStyle = SIL
      ctx.fillRect(x, top, 1.8 * s, sh2 * s)
      ctx.fillRect(x + sw2 * s - 1.8 * s, top, 1.8 * s, sh2 * s)
      // canopy — a peaked tent, scalloped along its edge
      ctx.beginPath()
      ctx.moveTo(x - 4 * s, top + 7 * s)
      ctx.lineTo(x + (sw2 / 2) * s, top - 5 * s)
      ctx.lineTo(x + sw2 * s + 4 * s, top + 7 * s)
      ctx.closePath()
      ctx.fillStyle = '#241c46'
      ctx.fill()
      const n = 4, cw = (sw2 * s + 8 * s) / n
      for (let i = 0; i < n; i++) {
        ctx.beginPath()
        ctx.arc(x - 4 * s + (i + 0.5) * cw, top + 7 * s, cw / 2, 0, Math.PI)
        ctx.fillStyle = i % 2 ? '#2c2252' : '#191330'
        ctx.fill()
      }
      // counter + goods
      ctx.fillStyle = SIL
      ctx.fillRect(x, gy - 9 * s, sw2 * s, 3 * s)
      if (lit) {
        ctx.fillStyle = `rgba(${GOLD},${0.45 + p * 0.3})`
        ctx.fillRect(x + 3 * s, gy - 8 * s, sw2 * s - 6 * s, 2 * s)
        ctx.fillStyle = `rgba(${VIO},0.6)`
        for (let g = 0; g < 3; g++) {
          ctx.beginPath()
          ctx.arc(x + (5 + g * 7) * s, gy - 11 * s, 1.7 * s, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      // a lantern hung from the peak
      if (busy) {
        const lx = x + (sw2 / 2) * s
        ctx.fillStyle = `rgba(${GOLD},0.9)`
        ctx.beginPath(); ctx.ellipse(lx, top + 1 * s, 2 * s, 2.7 * s, 0, 0, Math.PI * 2); ctx.fill()
        glow(ctx, lx, top + 1 * s, 13 * s, GOLD, 0.32)
      }
    }

    // A couple of shoppers browsing the stalls once the market's busy —
    // everything else here already moves (bunting sway, lanterns), the
    // stalls themselves were the one thing that never looked visited.
    if (busy && !reduced) {
      for (const i of [0, 3]) {
        const [ox, sw2] = STALLS[i]
        const px2 = cx + ox * s + sw2 * s * 0.5 + Math.sin(t * 0.0007 + i) * 4 * s
        const py2 = gy - 2 * s
        ctx.fillStyle = 'rgba(20,16,38,0.8)'
        ctx.fillRect(px2 - s, py2 - 4 * s, 2 * s, 4 * s)
        ctx.beginPath(); ctx.arc(px2, py2 - 5 * s, 1.1 * s, 0, Math.PI * 2); ctx.fill()
      }
    }

    // bunting strung the whole way across
    const by = gy - 40 * s
    ctx.strokeStyle = lit ? `rgba(${GOLD},0.35)` : 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 1 * s
    ctx.beginPath()
    ctx.moveTo(cx - 84 * s, by)
    ctx.quadraticCurveTo(cx, by + 9 * s, cx + 84 * s, by)
    ctx.stroke()
    for (let i = 0; i < 11; i++) {
      const f = i / 10
      const fx = cx - 84 * s + f * 168 * s
      const fy = by + Math.sin(Math.PI * f) * 9 * s
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

    if (lit) glow(ctx, cx, gy - 16 * s, 60 * s, GOLD, 0.16)
  },

  // Columned civic front — galleries, museums, libraries, ballrooms.
  // The colonnade and the stepped base are what stop this reading as another
  // rectangle: real columns standing proud of the facade, with a dome above.
  hall(ctx, { cx, gy, s, p, t, reduced }) {
    const w = 96 * s, h = 38 * s, x = cx - w / 2, y = gy - h

    // stepped base
    ctx.fillStyle = SIL
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(x - (10 - i * 3) * s, gy - (2 + i * 2.4) * s, w + (20 - i * 6) * s, 2.6 * s)
    }
    ctx.fillRect(x, y, w, h - 6 * s)

    // pediment + dome
    ctx.beginPath(); ctx.moveTo(x - 9 * s, y); ctx.lineTo(cx, y - 15 * s); ctx.lineTo(x + w + 9 * s, y); ctx.closePath(); ctx.fill()
    ctx.beginPath(); ctx.arc(cx, y - 14 * s, 13 * s, Math.PI, 0); ctx.fill()
    ctx.fillRect(cx - 1.2 * s, y - 33 * s, 2.4 * s, 6 * s)

    // columns standing proud, with gaps you can see through
    const cols = 5, span = w - 16 * s, cw = 6.5 * s
    for (let i = 0; i < cols; i++) {
      const gx = x + 8 * s + i * ((span - cw) / (cols - 1))
      ctx.fillStyle = SIL
      ctx.fillRect(gx, y + 3 * s, cw, h - 9 * s)
      ctx.fillRect(gx - 1.2 * s, y + 3 * s, cw + 2.4 * s, 2 * s)
      ctx.fillRect(gx - 1.2 * s, gy - 8 * s, cw + 2.4 * s, 2 * s)
    }
    // light behind the colonnade, so the gaps glow rather than the wall
    if (p > 0.35) {
      ctx.fillStyle = `rgba(${GOLD},${0.35 + p * 0.35})`
      for (let i = 0; i < cols - 1; i++) {
        const gx = x + 8 * s + i * ((span - cw) / (cols - 1)) + cw
        ctx.fillRect(gx, y + 10 * s, ((span - cw) / (cols - 1)) - cw, h - 22 * s)
      }
      glow(ctx, cx, gy - 18 * s, 34 * s, GOLD, 0.24)
    }
    // rose window in the pediment — civic, and unmistakably not a school
    ctx.fillStyle = p > 0.5 ? `rgba(${GOLD},0.8)` : '#151129'
    ctx.beginPath(); ctx.arc(cx, y - 6 * s, 3.4 * s, 0, Math.PI * 2); ctx.fill()

    // flag on the finial, rippling — the building is open and someone
    // raised it, and a stiff painted triangle never read as cloth.
    if (p > 0.65) {
      const wave = reduced ? 0 : Math.sin(t * 0.004) * 1.6 * s
      ctx.fillStyle = `rgba(${VIO},0.85)`
      ctx.beginPath(); ctx.arc(cx, y - 34 * s, 2.2 * s, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = `rgba(${GOLD},0.75)`
      ctx.beginPath()
      ctx.moveTo(cx + 1.2 * s, y - 33 * s)
      ctx.quadraticCurveTo(cx + 6 * s, y - 31.5 * s + wave, cx + 11 * s, y - 30.5 * s)
      ctx.quadraticCurveTo(cx + 6 * s, y - 29 * s + wave, cx + 1.2 * s, y - 28 * s)
      ctx.closePath(); ctx.fill()
    }
  },

  // A cottage with a chimney — houses, villas, huts, hideouts.
  house(ctx, { cx, gy, s, p, t, reduced }) {
    const w = 50 * s, h = 26 * s, x = cx - w / 2, y = gy - h
    ctx.fillStyle = SIL
    ctx.fillRect(x, y, w, h)
    ctx.beginPath(); ctx.moveTo(x - 6 * s, y); ctx.lineTo(cx, y - 19 * s); ctx.lineTo(x + w + 6 * s, y); ctx.closePath(); ctx.fill()
    ctx.fillRect(cx + 11 * s, y - 15 * s, 6 * s, 12 * s)
    for (const d of [-1, 1]) {
      ctx.fillStyle = p > 0.35 ? `rgba(${GOLD},0.88)` : 'rgba(255,255,255,0.05)'
      ctx.fillRect(cx + d * 15 * s - 4 * s, y + 8 * s, 8 * s, 9 * s)
      if (p > 0.35) glow(ctx, cx + d * 15 * s, y + 12 * s, 12 * s, GOLD, 0.25)
    }
    ctx.fillStyle = p > 0.65 ? `rgba(${GOLD},0.75)` : '#151129'
    ctx.fillRect(cx - 3.5 * s, gy - 12 * s, 7 * s, 12 * s)
    if (p > 0.65 && !reduced) {
      for (let k = 0; k < 3; k++) {
        const rise = (t * 0.018 + k * 22) % 60
        ctx.fillStyle = `rgba(196,181,253,${0.16 * (1 - rise / 60)})`
        ctx.beginPath()
        ctx.arc(cx + 14 * s + Math.sin((t * 0.001 + k) * 2) * 2 * s, y - 17 * s - rise * s * 0.5, (2 + rise * 0.05) * s, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    if (p > 0.9) glow(ctx, cx, y + 4 * s, 34 * s, GOLD, 0.15)
  },

  // A hillside mouth with crystals — caves, mines, quarries.
  cave(ctx, { cx, gy, s, p, t, reduced }) {
    ctx.fillStyle = SIL
    ctx.beginPath(); ctx.moveTo(cx - 70 * s, gy); ctx.quadraticCurveTo(cx, gy - 78 * s, cx + 70 * s, gy); ctx.closePath(); ctx.fill()
    ctx.fillStyle = '#050409'
    ctx.beginPath(); ctx.moveTo(cx - 20 * s, gy); ctx.quadraticCurveTo(cx, gy - 36 * s, cx + 20 * s, gy); ctx.closePath(); ctx.fill()
    if (p > 0.35) {
      const crystals = [[-9, 8], [0, 12], [8, 7]]
      for (let i = 0; i < crystals.length; i++) {
        const [ox, ch] = crystals[i]
        const tw = reduced ? 0.85 : 0.65 + 0.35 * Math.abs(Math.sin(t * 0.0026 + i * 2.4))
        ctx.fillStyle = `rgba(${VIO},${(0.85 * tw).toFixed(3)})`
        ctx.beginPath()
        ctx.moveTo(cx + (ox - 2.5) * s, gy); ctx.lineTo(cx + ox * s, gy - ch * s); ctx.lineTo(cx + (ox + 2.5) * s, gy)
        ctx.closePath(); ctx.fill()
      }
      glow(ctx, cx, gy - 8 * s, 20 * s, VIO, 0.3)
    }
    if (p > 0.65) {
      ctx.fillStyle = 'rgba(255,255,255,0.14)'
      ctx.fillRect(cx - 27 * s, gy - 14 * s, 1.8 * s, 14 * s)
      ctx.fillStyle = `rgba(${GOLD},0.95)`
      ctx.beginPath(); ctx.arc(cx - 26 * s, gy - 16 * s, 2.2 * s, 0, Math.PI * 2); ctx.fill()
      glow(ctx, cx - 26 * s, gy - 16 * s, 16 * s, GOLD, 0.35)
    }
    if (p > 0.9) glow(ctx, cx, gy - 12 * s, 34 * s, VIO, 0.28)
  },

  // Platform, truss, crossing spotlights — stages, theaters, stadiums.
  // At full restore the crowd comes back: a purple ocean of lightsticks.
  stage(ctx, { cx, gy, s, p, t, reduced }) {
    const w = 92 * s
    ctx.fillStyle = SIL
    ctx.fillRect(cx - w / 2, gy - 9 * s, w, 9 * s)
    for (const d of [-1, 1]) ctx.fillRect(cx + d * w / 2 - (d > 0 ? 2 : 3) * s, gy - 58 * s, 5 * s, 58 * s)
    ctx.fillRect(cx - w / 2 - 3 * s, gy - 58 * s, w + 6 * s, 4 * s)
    // Each spotlight sweeps on its own phase — a wider, slower search rather
    // than a small synchronized wobble, so it reads as two lights hunting
    // the stage independently.
    for (const [d, rgb, thr, ph] of [[-1, GOLD, 0.35, 0], [1, VIO, 0.65, 1.8]]) {
      if (p <= thr) continue
      const sway = reduced ? 0 : Math.sin(t * 0.0007 + ph) * 22 * s
      const bx = cx + d * (w / 2 - 6 * s), by = gy - 52 * s
      const txx = cx - d * 16 * s + sway
      const g = ctx.createLinearGradient(bx, by, txx, gy - 6 * s)
      g.addColorStop(0, `rgba(${rgb},0.34)`); g.addColorStop(1, `rgba(${rgb},0)`)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.moveTo(bx, by)
      ctx.lineTo(txx - 14 * s, gy - 6 * s)
      ctx.lineTo(txx + 14 * s, gy - 6 * s)
      ctx.closePath(); ctx.fill()
      ctx.fillStyle = `rgba(${rgb},0.9)`
      ctx.beginPath(); ctx.arc(bx, by, 2 * s, 0, Math.PI * 2); ctx.fill()
    }
    if (p > 0.9) {
      for (let i = 0; i < 12; i++) {
        const lx = cx - 54 * s + i * (108 * s / 11)
        const bob = reduced ? 0 : Math.sin(t * 0.003 + i * 1.7) * 1.5 * s
        ctx.fillStyle = `rgba(${VIO},0.9)`
        ctx.beginPath(); ctx.arc(lx, gy - 2 * s + bob, 1.3 * s, 0, Math.PI * 2); ctx.fill()
        glow(ctx, lx, gy - 2 * s + bob, 6 * s, VIO, 0.3)
      }
    }
  },

  // Industrial block with a chimney and a gear window — mills, foundries.
  mill(ctx, { cx, gy, s, p, t, reduced }) {
    const w = 64 * s, h = 34 * s, x = cx - w / 2, y = gy - h
    ctx.fillStyle = SIL
    ctx.fillRect(x, y, w, h)
    for (let i = 0; i < 3; i++) {
      const rx = x + i * (w / 3)
      ctx.beginPath(); ctx.moveTo(rx, y); ctx.lineTo(rx + w / 6, y - 10 * s); ctx.lineTo(rx + w / 3, y); ctx.closePath(); ctx.fill()
    }
    ctx.fillRect(x + w - 4 * s, y - 30 * s, 9 * s, 30 * s)
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = p > 0.35 ? `rgba(${GOLD},0.8)` : 'rgba(255,255,255,0.05)'
      ctx.fillRect(x + 8 * s + i * 13 * s, y + h - 14 * s, 8 * s, 7 * s)
    }
    const wx = x + 18 * s, wy = y + 11 * s
    ctx.fillStyle = p > 0.65 ? `rgba(${VIO},0.85)` : '#151129'
    ctx.beginPath(); ctx.arc(wx, wy, 6.5 * s, 0, Math.PI * 2); ctx.fill()
    if (p > 0.65) {
      // the gear turns — a static spoked circle read as a window, not
      // machinery doing anything.
      const spin = reduced ? 0 : t * 0.0004
      ctx.strokeStyle = '#241d45'; ctx.lineWidth = 1.1 * s
      ctx.beginPath()
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI + spin
        ctx.moveTo(wx - Math.cos(a) * 6 * s, wy - Math.sin(a) * 6 * s)
        ctx.lineTo(wx + Math.cos(a) * 6 * s, wy + Math.sin(a) * 6 * s)
      }
      ctx.stroke()
      glow(ctx, wx, wy, 16 * s, VIO, 0.28)
      if (!reduced) for (let k = 0; k < 3; k++) {
        const rise = (t * 0.016 + k * 20) % 55
        ctx.fillStyle = `rgba(196,181,253,${0.14 * (1 - rise / 55)})`
        ctx.beginPath(); ctx.arc(x + w + 0.5 * s, y - 32 * s - rise * s * 0.5, (2.4 + rise * 0.06) * s, 0, Math.PI * 2); ctx.fill()
      }
    }
    if (p > 0.9) {
      ctx.fillStyle = `rgba(${GOLD},0.5)`
      ctx.fillRect(x, y - 1 * s, w, 1.2 * s)
    }
  },

  // A signpost where the roads meet — crossings and crossroads.
  crossroads(ctx, { cx, gy, s, p, t, reduced, wardId }) {
    ctx.fillStyle = 'rgba(255,255,255,0.16)'
    ctx.fillRect(cx - 1.6 * s, gy - 56 * s, 3.2 * s, 56 * s)
    const signs = [[-1, 48, 24], [1, 41, 20], [-1, 33, 17], [1, 25, 22], [-1, 17, 15]]
    const lit = Math.floor(signs.length * p)
    signs.forEach(([d, sy, len], i) => {
      const y = gy - sy * s, L = len * s
      const rgb = i % 2 ? VIO : GOLD
      ctx.fillStyle = i < lit ? `rgba(${rgb},0.82)` : '#1a1533'
      ctx.beginPath()
      ctx.moveTo(cx, y - 3 * s); ctx.lineTo(cx + d * L, y - 3 * s)
      ctx.lineTo(cx + d * (L + 5 * s), y); ctx.lineTo(cx + d * L, y + 3 * s)
      ctx.lineTo(cx, y + 3 * s)
      ctx.closePath(); ctx.fill()
      if (i < lit) glow(ctx, cx + d * L * 0.6, y, 9 * s, rgb, 0.2)
    })
    if (p > 0.35) {
      if (wardId === 'mono') {
        // An armillary ring instead of a plain lit ball — Mono's
        // compass-in-the-sky motif, flagged as the weakest landmark
        // otherwise being interchangeable with every other crossroads.
        const ringY = gy - 60 * s
        const spin = reduced ? 0.4 : (t * 0.0004) % (Math.PI * 2)
        ctx.strokeStyle = `rgba(${GOLD},0.85)`; ctx.lineWidth = 1 * s
        ctx.beginPath()
        ctx.ellipse(cx, ringY, 7 * s, 7 * s * Math.abs(Math.cos(spin)) + 1.5 * s, spin, 0, Math.PI * 2)
        ctx.stroke()
        ctx.strokeStyle = `rgba(${VIO},0.7)`
        ctx.beginPath()
        ctx.ellipse(cx, ringY, 7 * s, 7 * s * Math.abs(Math.cos(spin + Math.PI / 2)) + 1.5 * s, spin + Math.PI / 2, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = `rgba(${GOLD},0.95)`
        ctx.beginPath(); ctx.arc(cx, ringY, 2 * s, 0, Math.PI * 2); ctx.fill()
        glow(ctx, cx, ringY, 18 * s, GOLD, 0.32)
      } else if (wardId === 'dday') {
        // "The foundry" — a hazard beacon instead of a plain light,
        // alternating amber/violet like a real warning light.
        const flash = reduced ? true : Math.floor(t / 500) % 2 === 0
        const rgb = flash ? GOLD : VIO
        ctx.fillStyle = `rgba(${rgb},0.9)`
        ctx.fillRect(cx - 3 * s, gy - 64 * s, 6 * s, 5 * s)
        ctx.beginPath(); ctx.arc(cx, gy - 60 * s, 2.4 * s, 0, Math.PI * 2); ctx.fill()
        if (flash) glow(ctx, cx, gy - 60 * s, 20 * s, rgb, 0.35)
      } else if (wardId === 'hopeworld') {
        // "Sun belt" — a small lit scoreboard readout above the post.
        const digits = 3, litD = Math.floor(digits * p)
        for (let i = 0; i < digits; i++) {
          const dx2 = cx + (i - 1) * 6 * s
          ctx.fillStyle = i < litD ? `rgba(${GOLD},0.9)` : 'rgba(255,255,255,0.1)'
          ctx.fillRect(dx2 - 2 * s, gy - 64 * s, 4 * s, 6 * s)
        }
        if (litD > 0) glow(ctx, cx, gy - 61 * s, 20 * s, GOLD, 0.28)
      } else if (wardId === 'golden') {
        // "Luxury quarter" — an ornate lamp with a scrollwork ring.
        ctx.strokeStyle = `rgba(${GOLD},0.6)`; ctx.lineWidth = 0.9 * s
        ctx.beginPath(); ctx.arc(cx, gy - 60 * s, 5 * s, 0, Math.PI * 2); ctx.stroke()
        ctx.fillStyle = `rgba(${GOLD},0.95)`
        ctx.beginPath(); ctx.arc(cx, gy - 60 * s, 2.4 * s, 0, Math.PI * 2); ctx.fill()
        glow(ctx, cx, gy - 60 * s, 20 * s, GOLD, 0.36)
      } else if (wardId === 'friends') {
        // "Twilight homes" — a hanging planter box beneath the light.
        ctx.fillStyle = `rgba(${GOLD},0.95)`
        ctx.beginPath(); ctx.arc(cx, gy - 60 * s, 2.4 * s, 0, Math.PI * 2); ctx.fill()
        glow(ctx, cx, gy - 60 * s, 18 * s, GOLD, 0.35)
        ctx.fillStyle = SIL
        ctx.fillRect(cx - 5 * s, gy - 52 * s, 10 * s, 4 * s)
        if (p > 0.6) {
          ctx.fillStyle = `rgba(${VIO},0.6)`
          for (const fx of [-3, 0, 3]) { ctx.beginPath(); ctx.arc(cx + fx * s, gy - 53 * s, 1.2 * s, 0, Math.PI * 2); ctx.fill() }
        }
      } else if (wardId === 'oldgrid') {
        // "Season one relics" — an old hexagonal lamp with an irregular,
        // aged flicker rather than a clean pulse.
        const flick = reduced ? 1 : (Math.sin(t * 0.02) > 0.3 ? 1 : 0.4)
        ctx.fillStyle = `rgba(${GOLD},${(0.85 * flick).toFixed(3)})`
        ctx.beginPath()
        for (let k = 0; k < 6; k++) {
          const a3 = (k / 6) * Math.PI * 2
          const hx = cx + Math.cos(a3) * 3 * s, hy = gy - 60 * s + Math.sin(a3) * 3 * s
          k === 0 ? ctx.moveTo(hx, hy) : ctx.lineTo(hx, hy)
        }
        ctx.closePath(); ctx.fill()
        if (flick > 0.5) glow(ctx, cx, gy - 60 * s, 16 * s, GOLD, 0.3 * flick)
      } else {
        const flick = reduced ? 1 : 0.85 + 0.15 * Math.abs(Math.sin(t * 0.0032))
        ctx.fillStyle = `rgba(${GOLD},${0.95 * flick})`
        ctx.beginPath(); ctx.arc(cx, gy - 60 * s, 2.4 * s, 0, Math.PI * 2); ctx.fill()
        glow(ctx, cx, gy - 60 * s, 18 * s, GOLD, 0.35 * flick)
      }
    }
    if (p > 0.9) {
      ctx.strokeStyle = `rgba(${VIO},0.4)`; ctx.lineWidth = 1.1 * s
      ctx.beginPath(); ctx.ellipse(cx, gy - 1.5 * s, 26 * s, 4.5 * s, 0, 0, Math.PI * 2); ctx.stroke()
      if (wardId === 'mono') {
        // a faint compass rose radiating on the ground
        ctx.strokeStyle = `rgba(${VIO},0.28)`; ctx.lineWidth = s
        for (let i = 0; i < 8; i++) {
          const ang = (i / 8) * Math.PI * 2
          ctx.beginPath()
          ctx.moveTo(cx, gy - 1.5 * s)
          ctx.lineTo(cx + Math.cos(ang) * 24 * s, gy - 1.5 * s + Math.sin(ang) * 4 * s)
          ctx.stroke()
        }
      }
    }
  },
}
