// Landmarks — the district's name decides what stands at the center of its
// scene. "Amber Gate" gets a gate, "Tae Pier" gets a pier, "Dazzledew
// Fountain" gets a fountain. Silhouette-first drawing in the scene's two house
// hues: dark shapes when the district is dead, gold/violet accents arriving
// with progress (p): first light ~0.35, second ~0.65, full glory ~0.9.
//
// Every draw function gets the same bag: ctx + { cx, gy, s, w, h, p, t, reduced }
// where s is the scene scale, gy the ground line, p progress 0..1, t ms time.

import { GOLD, VIO, SIL, glow, drawBunting } from './landmarks-kit.js'
import { EXTRA } from './landmarks-extra.js'

// Order matters: first match wins. Checked name-by-name against
// docs/op-reconnect-districts.md — word boundaries are load-bearing
// ("Trail" contains rail, "Courtyard" contains yard, "Garden" ends in den).
// Pier before temple keeps "Keep Swimming Lido" off the castle keep;
// ferris before park keeps "Playpark" and "Skatepark" in the funfair.
const TYPES = [
  [/lighthouse|cliff/i, 'lighthouse'],
  [/observator|planetarium|solarium|sunroom/i, 'observatory'],
  [/gate\b|torii|arch\b/i, 'gate'],
  [/station|terminal|terminus|depot|junction|platform|tramline|tram\b|\brail\b|railyard|interchange|\byard\b/i, 'station'],
  [/crossroads|crossing\b/i, 'crossroads'],
  [/bridge|overpass|underpass|causeway|skywalk|cloudwalk/i, 'bridge'],
  [/pier|wharf|marina|\bdocks?\b|jetty|boardwalk|quay|harbou?r|haven|\bbay\b|cove|shore|riverside|tidepool|reef|lido|ghat|ferry|lake\b|pond|sands\b|beach|dunes?\b/i, 'pier'],
  [/fountain|spring|falls|rapids|oasis/i, 'fountain'],
  [/carnival|funfair|carousel|ferris|circus|playpark|skatepark|roller|coaster|amusement/i, 'ferris'],
  [/garden|grove|meadow|park\b|field|glade|orchard|vineyard|willow|botanica|arboretum|greenhouse|conservatory|woods|trail\b|trailhead|evergreen|hollow|valley|maze|tulip|rose/i, 'park'],
  [/\bmill\b|foundry|forge|works\b|loom/i, 'mill'],
  [/cave|cavern|grotto|\bmines?\b|mineshaft|quarry|glacier|iceberg/i, 'cave'],
  [/stage|theat(er|re)|stadium|gymnasium|arena|amphi/i, 'stage'],
  [/clocktower|clock|bell tower|belfry|watchtower|turret|spire|tower\b|point\b|peak\b|hill\b|heights|lookout|overlook|skydeck|aerie|relay/i, 'tower'],
  [/palace|castle|keep\b|manor|mahal|haveli|abbey|temple|shrine|sanctum|chapel|cathedral|pavilion|monastery/i, 'temple'],
  [/gallery|museum|library|archive|hall\b|ballroom|chambers?\b|reading room|school|agency|vault|wing\b/i, 'hall'],
  [/plaza|square|courtyard|court\b|commons|promenade|parade|colonnade|monument/i, 'plaza'],
  [/caf[eé]|diner|bakery|patisserie|teahouse|cantina|records|parlou?r|inn\b|speakeasy|arcade|casino|bakehouse|kitchen|studio|atelier|apothecary|post office|booth|lounge|shop\b|store\b|emporium/i, 'shop'],
  [/house\b|villa|cottage|\bhuts?\b|loft|rowhouse|ranch|estate|veranda|terrace|warren|hearth|\bden\b|hideout|alcove|retreat/i, 'house'],
  // Market before street — a market IS a street, but the stalls are the
  // landmark and the road isn't.
  [/market|bazaar|chowk|souk|stalls?\b/i, 'market'],
  [/\blane\b|alley|boulevard|avenue|street|\brow\b|backstreet|corner|steps\b|\bwalk\b/i, 'street'],
]

export function landmarkType(name) {
  for (const [re, type] of TYPES) if (re.test(name || '')) return type
  return null
}

// Every shop-triggering keyword read as the same silhouette — small building,
// lamp, window — once you'd seen a handful. Same name-first idiom as
// landmarkType: the sub-look comes from what the place actually is, not a
// random roll, so "Kookieee Bakery" always looks like a bakery.
const SHOP_KINDS = [
  [/bakery|bakehouse|patisserie/i, 'bakery'],
  [/caf[eé]|diner|teahouse|kitchen|lounge/i, 'cafe'],
  [/cantina|speakeasy|arcade|casino/i, 'cantina'],
  [/parlou?r|studio|atelier|apothecary|records|booth|post office/i, 'parlor'],
]
export function shopKindOf(name) {
  for (const [re, kind] of SHOP_KINDS) if (re.test(name || '')) return kind
  return null
}

// The same lookup gives lists and peeks their icon, so a district reads the
// same way everywhere it appears.
const ICON = {
  gate: '⛩️', station: '🚉', crossroads: '🚦', bridge: '🌉', pier: '⚓',
  fountain: '⛲', park: '🌳', ferris: '🎡', mill: '🏭', cave: '⛰️',
  stage: '🎤', tower: '🗼', lighthouse: '🔦', observatory: '🔭',
  temple: '🛕', hall: '🏛️', plaza: '🏙️', shop: '☕', house: '🏠', street: '🏘️',
  market: '🎪',
}

export function districtIcon(name) {
  return ICON[landmarkType(name)] || '📍'
}

const DRAW = {
  gate(ctx, { cx, gy, s, p, t, reduced }) {
    const w2 = 44 * s, ph = 72 * s, pw = 9 * s
    ctx.fillStyle = SIL
    ctx.fillRect(cx - w2, gy - ph, pw, ph)
    ctx.fillRect(cx + w2 - pw, gy - ph, pw, ph)
    ctx.beginPath()
    ctx.moveTo(cx - w2 - 8 * s, gy - ph)
    ctx.quadraticCurveTo(cx, gy - ph - 26 * s, cx + w2 + 8 * s, gy - ph)
    ctx.lineTo(cx + w2 + 8 * s, gy - ph + 8 * s)
    ctx.quadraticCurveTo(cx, gy - ph - 17 * s, cx - w2 - 8 * s, gy - ph + 8 * s)
    ctx.closePath(); ctx.fill()
    ctx.fillRect(cx - w2, gy - ph + 17 * s, w2 * 2, 5 * s)
    if (p > 0.35) {
      const lit = p > 0.8 ? 3 : p > 0.55 ? 2 : 1
      for (let i = 0; i < lit; i++) {
        const lx = cx + (i - (lit - 1) / 2) * 27 * s
        const flick = reduced ? 1 : 0.82 + 0.18 * Math.abs(Math.sin(t * 0.0035 + i * 2.3))
        ctx.fillStyle = `rgba(${GOLD},${0.92 * flick})`
        ctx.fillRect(lx - 2 * s, gy - ph + 23 * s, 4 * s, 6.5 * s)
        glow(ctx, lx, gy - ph + 26 * s, 19 * s, GOLD, 0.32 * flick)
      }
    }
    if (p > 0.9) {
      ctx.strokeStyle = `rgba(${GOLD},0.75)`; ctx.lineWidth = 1.4 * s
      ctx.beginPath()
      ctx.moveTo(cx - w2 - 8 * s, gy - ph)
      ctx.quadraticCurveTo(cx, gy - ph - 26 * s, cx + w2 + 8 * s, gy - ph)
      ctx.stroke()
    }
  },

  // Silhouette test: a platform canopy on posts, a signal mast and rails on
  // the ground. A station should never be mistakable for a hall or a depot
  // with the lights off.
  station(ctx, { cx, gy, s, p, t, reduced, w: sw, wardId }) {
    const w = 138 * s, h = 40 * s, x = cx - w / 2, y = gy - h

    // rails running out of frame — the strongest "this is a station" cue
    ctx.fillStyle = 'rgba(255,255,255,0.10)'
    ctx.fillRect(0, gy - 2.5 * s, sw, 1.2 * s)
    ctx.fillRect(0, gy - 0.5 * s, sw, 1.2 * s)
    for (let tx = 0; tx < sw; tx += 9 * s) ctx.fillRect(tx, gy - 3 * s, 2 * s, 4 * s)

    ctx.fillStyle = SIL
    ctx.fillRect(x, y, w, h)

    // platform canopy: a long low roof on posts, overhanging both ends
    ctx.fillRect(x - 16 * s, y - 4 * s, w + 32 * s, 4.5 * s)
    ctx.beginPath()
    ctx.moveTo(x - 16 * s, y - 4 * s); ctx.lineTo(cx, y - 15 * s); ctx.lineTo(x + w + 16 * s, y - 4 * s)
    ctx.closePath(); ctx.fill()
    for (const px of [x - 12 * s, x + w + 8 * s]) ctx.fillRect(px, y - 4 * s, 3 * s, h + 4 * s)

    // signal mast off to one side
    const mx = x + w + 26 * s
    ctx.fillStyle = SIL
    ctx.fillRect(mx, gy - 34 * s, 2.6 * s, 34 * s)
    ctx.fillRect(mx - 3 * s, gy - 36 * s, 9 * s, 8 * s)
    // a real signal blinks rather than glowing flat
    const blinkOn = reduced ? true : Math.floor(t / 900) % 2 === 0
    ctx.fillStyle = p > 0.5 ? `rgba(${GOLD},${blinkOn ? 0.95 : 0.35})` : 'rgba(255,255,255,0.10)'
    ctx.beginPath(); ctx.arc(mx + 1.3 * s, gy - 32 * s, 2 * s, 0, Math.PI * 2); ctx.fill()
    if (p > 0.5 && blinkOn) glow(ctx, mx + 1.3 * s, gy - 32 * s, 14 * s, GOLD, 0.3)

    for (let i = 0; i < 4; i++) {
      const side = i < 2 ? -1 : 1, off = i % 2 ? 54 : 34
      const flick = reduced ? 1 : 0.85 + 0.15 * Math.abs(Math.sin(t * 0.003 + i * 1.6))
      ctx.fillStyle = p > 0.5 ? `rgba(${GOLD},${0.85 * flick})` : 'rgba(255,255,255,0.05)'
      ctx.fillRect(cx + side * off * s - 4 * s, y + 13 * s, 8 * s, 15 * s)
    }

    const aw = 24 * s, ah = 27 * s
    ctx.fillStyle = p > 0.35 ? `rgba(${GOLD},${0.45 + p * 0.4})` : 'rgba(255,255,255,0.06)'
    ctx.beginPath()
    ctx.moveTo(cx - aw / 2, gy); ctx.lineTo(cx - aw / 2, gy - ah + aw / 2)
    ctx.arc(cx, gy - ah + aw / 2, aw / 2, Math.PI, 0)
    ctx.lineTo(cx + aw / 2, gy); ctx.closePath(); ctx.fill()
    if (p > 0.35) glow(ctx, cx, gy - ah / 2, 30 * s, GOLD, 0.22)

    const cy = y - 19 * s
    ctx.fillStyle = '#181430'
    ctx.beginPath(); ctx.arc(cx, cy, 6.5 * s, 0, Math.PI * 2); ctx.fill()
    if (p > 0.65) {
      ctx.fillStyle = `rgba(${VIO},0.9)`
      ctx.beginPath(); ctx.arc(cx, cy, 5.2 * s, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = '#241d45'; ctx.lineWidth = 1.2 * s
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - 3.6 * s); ctx.moveTo(cx, cy); ctx.lineTo(cx + 2.8 * s, cy + s); ctx.stroke()
    }

    // The "wow": a train sliding through on the rails, and smoke off the
    // signal mast — only once the place is mostly back, so it reads as the
    // reward for finishing rather than something that was always there.
    if (p > 0.8) {
      const trainW = 44 * s, trainH = 15 * s, ty = gy - 3 * s - trainH
      // 0.15 parks it clear of the platform on open track — a frozen mid-
      // crossing frame (reduced motion) would read as smudged headlights.
      const cycle = reduced ? 0.15 : (t * 0.00014) % 1
      const trainX = -trainW + cycle * (sw + trainW * 2)
      ctx.fillStyle = SIL
      ctx.fillRect(trainX, ty, trainW, trainH)
      ctx.fillRect(trainX + trainW - 4 * s, ty - 2.5 * s, 3 * s, 2.5 * s)
      const winN = 5, winW = (trainW - 8 * s) / winN
      for (let i = 0; i < winN; i++) {
        ctx.fillStyle = `rgba(${GOLD},0.85)`
        ctx.fillRect(trainX + 4 * s + i * winW, ty + 3.5 * s, winW - 2 * s, 6 * s)
      }
      for (let i = 0; i < 3; i++) {
        const age = (t * 0.0002 + i / 3) % 1
        const smx = mx + 1.3 * s + Math.sin(age * 6) * 4 * s
        const smy = gy - 40 * s - age * 30 * s
        ctx.fillStyle = `rgba(200,195,220,${(0.18 * (1 - age)).toFixed(3)})`
        ctx.beginPath(); ctx.arc(smx, smy, (2 + age * 4) * s, 0, Math.PI * 2); ctx.fill()
      }
    }

    // Every ward's station carries a small hint of its own place — a
    // platform prop that says "you're in D-Day" or "you're in Golden"
    // even with the name covered.
    if (p > 0.4) {
      const px0 = x + 12 * s, py0 = gy - 2 * s
      if (wardId === 'mono') {
        // a telescope on the platform, pointed skyward
        ctx.fillStyle = SIL
        ctx.fillRect(px0 - 1 * s, py0 - 12 * s, 2 * s, 12 * s)
        ctx.save()
        ctx.translate(px0, py0 - 12 * s)
        ctx.rotate(-0.6)
        ctx.fillRect(-1.5 * s, -10 * s, 3 * s, 10 * s)
        ctx.restore()
        if (p > 0.6) glow(ctx, px0 + 5 * s, py0 - 20 * s, 10 * s, VIO, 0.2)
      } else if (wardId === 'dday') {
        // stacked freight crates
        ctx.fillStyle = SIL
        ctx.fillRect(px0, py0 - 9 * s, 11 * s, 9 * s)
        ctx.fillRect(px0 + 12 * s, py0 - 6 * s, 8 * s, 6 * s)
        ctx.fillStyle = '#0d0a18'
        ctx.fillRect(px0, py0 - 5 * s, 11 * s, 1.4 * s)
      } else if (wardId === 'hopeworld') {
        // a run of pennant flags along the canopy edge
        for (let i = 0; i < 5; i++) {
          const fx = x - 14 * s + i * 12 * s, fy = y - 3 * s
          ctx.fillStyle = i % 2 ? `rgba(${GOLD},0.8)` : `rgba(${VIO},0.75)`
          ctx.beginPath()
          ctx.moveTo(fx - 3 * s, fy); ctx.lineTo(fx + 3 * s, fy); ctx.lineTo(fx, fy + 5 * s)
          ctx.closePath(); ctx.fill()
        }
      } else if (wardId === 'golden') {
        // a strip of red carpet along the platform, canopy trimmed in gold
        ctx.fillStyle = `rgba(${GOLD},0.28)`
        ctx.fillRect(cx - aw, gy - 1.5 * s, aw * 2, 1.5 * s)
        ctx.strokeStyle = `rgba(${GOLD},0.5)`; ctx.lineWidth = 0.8 * s
        ctx.strokeRect(x - 16 * s, y - 4 * s, w + 32 * s, 4.5 * s)
      } else if (wardId === 'friends') {
        // planter boxes along the platform
        for (const ox of [px0, px0 + 16 * s]) {
          ctx.fillStyle = SIL
          ctx.fillRect(ox - 4 * s, py0 - 4 * s, 8 * s, 4 * s)
          ctx.fillStyle = `rgba(${VIO},0.6)`
          for (const fx of [-1.5, 1.5]) { ctx.beginPath(); ctx.arc(ox + fx * s, py0 - 5 * s, 1 * s, 0, Math.PI * 2); ctx.fill() }
        }
      } else if (wardId === 'oldgrid') {
        // a second, smaller vintage clock on the canopy edge
        const vx = x - 4 * s, vy = y - 2 * s
        ctx.fillStyle = '#181430'
        ctx.beginPath(); ctx.arc(vx, vy, 4 * s, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 0.7 * s
        ctx.beginPath(); ctx.arc(vx, vy, 4 * s, 0, Math.PI * 2); ctx.stroke()
      }
    }
  },

  bridge(ctx, { cx, gy, s, w, h, p, t, reduced }) {
    // haze the skyline back so the span reads in front of it
    ctx.fillStyle = 'rgba(6,5,13,0.38)'
    ctx.fillRect(0, 0, w, gy)
    const deckY = gy - 36 * s, topY = deckY - 48 * s
    const t1 = cx - 62 * s, t2 = cx + 62 * s
    ctx.fillStyle = SIL
    for (const tx of [t1, t2]) {
      ctx.fillRect(tx - 4 * s, topY, 8 * s, gy - topY)
      ctx.fillRect(tx - 6.5 * s, deckY - 2 * s, 13 * s, 6 * s)
    }
    ctx.fillRect(0, deckY, w, 6 * s)
    ctx.fillStyle = 'rgba(255,255,255,0.10)'
    ctx.fillRect(0, deckY, w, 1.2)
    ctx.strokeStyle = p > 0.65 ? `rgba(${GOLD},0.45)` : 'rgba(255,255,255,0.13)'
    ctx.lineWidth = 1.1 * s
    ctx.beginPath()
    ctx.moveTo(0, topY + 16 * s); ctx.quadraticCurveTo(t1 * 0.45, deckY, t1, topY)
    ctx.moveTo(t1, topY); ctx.quadraticCurveTo(cx, deckY + 2 * s, t2, topY)
    ctx.moveTo(t2, topY); ctx.quadraticCurveTo(t2 + (w - t2) * 0.55, deckY, w, topY + 16 * s)
    ctx.stroke()
    const n = 11, lit = Math.floor(n * p)
    for (let i = 0; i < n; i++) {
      const lx = (i + 0.5) * (w / n)
      const pulse = reduced ? 1 : 0.82 + 0.18 * Math.sin(t * 0.003 + i * 1.3)
      ctx.fillStyle = i < lit ? `rgba(${GOLD},${0.92 * pulse})` : 'rgba(255,255,255,0.10)'
      ctx.beginPath(); ctx.arc(lx, deckY - 3 * s, 1.9 * s, 0, Math.PI * 2); ctx.fill()
      if (i < lit) glow(ctx, lx, deckY - 3 * s, 14 * s, GOLD, 0.3 * pulse)
    }
    if (p > 0.9) for (const tx of [t1, t2]) {
      ctx.fillStyle = `rgba(${GOLD},0.95)`
      ctx.beginPath(); ctx.arc(tx, topY - 2 * s, 1.8 * s, 0, Math.PI * 2); ctx.fill()
      glow(ctx, tx, topY - 2 * s, 14 * s, GOLD, 0.35)
    }

    // A river underneath, with a boat drifting through — this was just
    // "brightness went up" before; now there's something happening under
    // the span too.
    if (p > 0.5) {
      const waterH = (h - gy) * 0.5
      ctx.fillStyle = '#0c0a1c'
      ctx.fillRect(t1, gy, t2 - t1, waterH)
      const drift = reduced ? (t2 - t1) * 0.4 : (t * 0.01) % (t2 - t1 + 60)
      const bx = t1 - 20 + drift, by = gy + waterH * 0.5
      if (bx > t1 - 14 && bx < t2 + 14) {
        ctx.fillStyle = '#0b0918'
        ctx.beginPath()
        ctx.moveTo(bx - 8 * s, by); ctx.lineTo(bx + 8 * s, by)
        ctx.lineTo(bx + 5 * s, by + 3.5 * s); ctx.lineTo(bx - 5 * s, by + 3.5 * s)
        ctx.closePath(); ctx.fill()
        ctx.fillRect(bx - 0.8 * s, by - 9 * s, 1.6 * s, 9 * s)
        ctx.fillStyle = `rgba(${GOLD},0.8)`
        ctx.beginPath(); ctx.arc(bx, by - 10 * s, 1.3 * s, 0, Math.PI * 2); ctx.fill()
      }
    }

    // Pennants strung along the near cable once the bridge is mostly lit,
    // waving instead of hanging stiff.
    if (p > 0.7) {
      const pn = 7
      for (let i = 1; i < pn; i++) {
        const f = i / pn
        const px = t1 + (t2 - t1) * f
        const py2 = (1 - f) ** 2 * topY + 2 * (1 - f) * f * (deckY + 2 * s) + f * f * topY
        const wave = reduced ? 3 * s : (3 + Math.sin(t * 0.0035 + i * 1.4)) * s
        ctx.fillStyle = i % 2 ? `rgba(${GOLD},0.7)` : `rgba(${VIO},0.7)`
        ctx.beginPath()
        ctx.moveTo(px, py2); ctx.lineTo(px + wave, py2 + 2 * s); ctx.lineTo(px, py2 + 4 * s)
        ctx.closePath(); ctx.fill()
      }
    }
  },

  pier(ctx, { cx, gy, s, w, h, p, t, reduced }) {
    // water sits a shade apart from plain ground so the horizon reads
    ctx.fillStyle = '#0c0a1c'
    ctx.fillRect(0, gy, w, h - gy)
    ctx.fillStyle = `rgba(${VIO},${0.12 + p * 0.08})`
    ctx.fillRect(0, gy, w, 1.2)
    ctx.strokeStyle = `rgba(${VIO},${0.09 + p * 0.09})`; ctx.lineWidth = 1
    for (let i = 0; i < 5; i++) {
      const wy = gy + 5 + i * ((h - gy - 9) / 5)
      const drift = reduced ? 0 : (t * 0.012 + i * 40) % 60
      ctx.beginPath()
      for (let wx = -60 + drift; wx < w; wx += 60) { ctx.moveTo(wx, wy); ctx.lineTo(wx + 26, wy) }
      ctx.stroke()
    }
    const dw = 80 * s, deckY = gy - 9 * s
    ctx.fillStyle = '#161231'          // lighter than SIL so it reads over water
    ctx.fillRect(cx - dw, deckY, dw * 2, 3.5 * s)
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    ctx.fillRect(cx - dw, deckY, dw * 2, 1)
    ctx.fillStyle = '#161231'
    for (let i = 0; i <= 5; i++) {
      const px = cx - dw + 3 * s + i * ((dw * 2 - 6 * s) / 5)
      ctx.fillRect(px - 1.4 * s, deckY + 3.5 * s, 2.8 * s, (h - gy) * 0.45 + (gy - deckY))
    }
    // a boat moored off the end, with its own reflection
    if (p > 0.5) {
      const bx = cx - dw - 22 * s, by = gy + (h - gy) * 0.30
      ctx.fillStyle = '#0b0918'
      ctx.beginPath()
      ctx.moveTo(bx - 11 * s, by); ctx.lineTo(bx + 11 * s, by)
      ctx.lineTo(bx + 7 * s, by + 4.5 * s); ctx.lineTo(bx - 7 * s, by + 4.5 * s)
      ctx.closePath(); ctx.fill()
      ctx.fillRect(bx - 0.9 * s, by - 13 * s, 1.8 * s, 13 * s)
      ctx.fillStyle = `rgba(${GOLD},0.8)`
      ctx.beginPath(); ctx.arc(bx, by - 14 * s, 1.6 * s, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = `rgba(${GOLD},0.12)`
      ctx.fillRect(bx - 2 * s, by + 5 * s, 4 * s, (h - by) * 0.5)
    }

    // mooring posts along the deck
    ctx.fillStyle = '#141029'
    for (const mo of [-0.55, 0.15, 0.7]) {
      ctx.fillRect(cx + mo * dw, deckY - 5 * s, 2.4 * s, 5 * s)
    }

    for (const end of [-1, 1]) {
      const lx = cx + end * (dw - 3 * s)
      ctx.fillStyle = 'rgba(255,255,255,0.14)'
      ctx.fillRect(lx - s, deckY - 13 * s, 2 * s, 13 * s)
      if (end === 1 ? p > 0.35 : p > 0.65) {
        const flick = reduced ? 1 : 0.85 + 0.15 * Math.abs(Math.sin(t * 0.0027 + end))
        ctx.fillStyle = `rgba(${GOLD},${0.95 * flick})`
        ctx.beginPath(); ctx.arc(lx, deckY - 15 * s, 2.4 * s, 0, Math.PI * 2); ctx.fill()
        glow(ctx, lx, deckY - 15 * s, 22 * s, GOLD, 0.4 * flick)
        ctx.fillStyle = `rgba(${GOLD},0.12)`
        ctx.fillRect(lx - 4 * s, gy, 8 * s, (h - gy) * 0.9)
      }
    }
  },

  fountain(ctx, { cx, gy, s, p, t, reduced, wardId }) {
    ctx.fillStyle = SIL
    ctx.beginPath(); ctx.ellipse(cx, gy - 4 * s, 46 * s, 8 * s, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillRect(cx - 3.5 * s, gy - 32 * s, 7 * s, 28 * s)
    ctx.beginPath(); ctx.ellipse(cx, gy - 32 * s, 15 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill()
    if (p > 0.35) {
      const a = 0.35 + p * 0.4
      ctx.strokeStyle = `rgba(${VIO},${a})`; ctx.lineWidth = 1.3 * s
      const arcs = []
      for (const dir of [-1, 1]) for (const rr of [22, 34]) {
        // a gentle sway on the arc's control point so the spray reads as
        // flowing, not a frozen decal — only the glow used to move.
        const sway = reduced ? 0 : Math.sin(t * 0.0022 + dir * rr) * 3 * s
        const p0 = { x: cx, y: gy - 34 * s }
        const p1 = { x: cx + dir * rr * s * 0.8, y: gy - 44 * s + sway }
        const p2 = { x: cx + dir * rr * s, y: gy - 8 * s }
        ctx.beginPath()
        ctx.moveTo(p0.x, p0.y)
        ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y)
        ctx.stroke()
        arcs.push({ p0, p1, p2 })
      }
      const tw = reduced ? 0.8 : 0.6 + 0.4 * Math.sin(t * 0.004)
      glow(ctx, cx, gy - 36 * s, 24 * s, VIO, 0.30 * tw)

      // droplets riding each arc — the difference between a wobbling decal
      // and water that's actually flowing.
      if (!reduced) for (let ai = 0; ai < arcs.length; ai++) {
        const { p0, p1, p2 } = arcs[ai]
        for (let k = 0; k < 2; k++) {
          const u = (t * 0.00055 + ai * 0.31 + k * 0.5) % 1
          const iu = 1 - u
          const dx = iu * iu * p0.x + 2 * iu * u * p1.x + u * u * p2.x
          const dy = iu * iu * p0.y + 2 * iu * u * p1.y + u * u * p2.y
          const fade = Math.sin(Math.PI * u)
          ctx.fillStyle = `rgba(${VIO},${(0.7 * fade).toFixed(3)})`
          ctx.beginPath(); ctx.arc(dx, dy, 1 * s, 0, Math.PI * 2); ctx.fill()
        }
      }
    }
    if (p > 0.9) glow(ctx, cx, gy - 10 * s, 40 * s, GOLD, 0.16)

    // Every ward gets its own fountain, the same way Mono's got orbiting
    // motes — "The foundry" gets a vent, "Sun belt" gets a sprinkler fan,
    // and so on, straight from the documented ward flavours.
    if (wardId === 'mono' && p > 0.5) {
      // astronomy motif — small motes orbiting the spray
      const oy = gy - 30 * s
      for (let i = 0; i < 3; i++) {
        const ang = (reduced ? 0 : t * 0.0006) + (i / 3) * Math.PI * 2
        const ox = cx + Math.cos(ang) * 20 * s, oyy = oy + Math.sin(ang) * 7 * s
        const rgb = i % 2 ? GOLD : VIO
        ctx.fillStyle = `rgba(${rgb},0.85)`
        ctx.beginPath(); ctx.arc(ox, oyy, 1.4 * s, 0, Math.PI * 2); ctx.fill()
        glow(ctx, ox, oyy, 9 * s, rgb, 0.28)
      }
    } else if (wardId === 'dday' && p > 0.4) {
      // "The foundry" — a vent pipe off the basin, venting steam instead
      // of decorative spray
      const vx = cx + 24 * s, vy = gy - 30 * s
      ctx.fillStyle = SIL
      ctx.fillRect(vx - 1.6 * s, vy, 3.2 * s, 10 * s)
      if (!reduced) for (let k = 0; k < 3; k++) {
        const rise = (t * 0.02 + k * 20) % 50
        ctx.fillStyle = `rgba(200,195,220,${(0.16 * (1 - rise / 50)).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(vx + Math.sin((t * 0.001 + k) * 2) * 2 * s, vy - rise * s * 0.6, (2 + rise * 0.05) * s, 0, Math.PI * 2)
        ctx.fill()
      }
      if (p > 0.6) {
        const pulse = reduced ? 1 : 0.7 + 0.3 * Math.abs(Math.sin(t * 0.0045))
        ctx.fillStyle = `rgba(${GOLD},${(0.8 * pulse).toFixed(3)})`
        ctx.beginPath(); ctx.arc(vx, vy + 4 * s, 1.6 * s, 0, Math.PI * 2); ctx.fill()
      }
    } else if (wardId === 'hopeworld' && p > 0.35) {
      // "Sun belt" — a wide low fan spray, like a stadium sprinkler
      const sway = reduced ? 0 : Math.sin(t * 0.0018) * 4 * s
      ctx.strokeStyle = `rgba(${VIO},${0.3 + p * 0.3})`; ctx.lineWidth = 1.1 * s
      for (const dir of [-1, 1]) {
        ctx.beginPath()
        ctx.moveTo(cx, gy - 34 * s)
        ctx.quadraticCurveTo(cx + dir * 46 * s, gy - 26 * s + sway, cx + dir * 50 * s, gy - 6 * s)
        ctx.stroke()
      }
      if (p > 0.6) glow(ctx, cx, gy - 24 * s, 46 * s, GOLD, 0.14)
    } else if (wardId === 'golden' && p > 0.4) {
      // "Luxury quarter" — a second, smaller tier above the basin
      const ty = gy - 40 * s
      ctx.fillStyle = SIL
      ctx.beginPath(); ctx.ellipse(cx, ty, 9 * s, 2.6 * s, 0, 0, Math.PI * 2); ctx.fill()
      if (p > 0.55) {
        const n = 6, lit = Math.floor(n * p)
        for (let i = 0; i < n; i++) {
          const a2 = (i / n) * Math.PI * 2
          const jx = cx + Math.cos(a2) * 9 * s, jy = ty + Math.sin(a2) * 2.6 * s
          ctx.fillStyle = i < lit ? `rgba(${GOLD},0.9)` : 'rgba(255,255,255,0.1)'
          ctx.beginPath(); ctx.arc(jx, jy, 1 * s, 0, Math.PI * 2); ctx.fill()
          if (i < lit) glow(ctx, jx, jy, 7 * s, GOLD, 0.26)
        }
      }
    } else if (wardId === 'friends' && p > 0.5) {
      // "Twilight homes" — a ring of small string lights around the rim,
      // the backyard-fountain version of the temple's hanging lanterns
      const n = 10
      for (let i = 0; i < n; i++) {
        const f = i / n
        const lx = cx + Math.cos(f * Math.PI * 2) * 42 * s, ly = gy - 4 * s + Math.sin(f * Math.PI * 2) * 7 * s
        const flick = reduced ? 1 : 0.8 + 0.2 * Math.abs(Math.sin(t * 0.003 + i * 1.9))
        ctx.fillStyle = `rgba(${GOLD},${(0.75 * flick).toFixed(3)})`
        ctx.beginPath(); ctx.arc(lx, ly, 1 * s, 0, Math.PI * 2); ctx.fill()
      }
    } else if (wardId === 'oldgrid' && p > 0.3) {
      // "Season one relics" — a weathered plaque and a crack, this fountain
      // has been here since before the network went dark
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 0.8 * s
      ctx.beginPath()
      ctx.moveTo(cx - 8 * s, gy - 26 * s); ctx.lineTo(cx - 2 * s, gy - 18 * s); ctx.lineTo(cx - 6 * s, gy - 10 * s)
      ctx.stroke()
      ctx.fillStyle = 'rgba(20,16,38,0.85)'
      ctx.fillRect(cx + 5 * s, gy - 22 * s, 9 * s, 6 * s)
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 0.6 * s
      ctx.strokeRect(cx + 5 * s, gy - 22 * s, 9 * s, 6 * s)
    }
  },

  park(ctx, { cx, gy, s, p, t, reduced, variant = 0, wardId }) {
    ctx.fillStyle = SIL
    for (const [off, r, th] of [[-58, 15, 26], [-28, 19, 34], [4, 13, 22], [34, 20, 36], [62, 14, 25]]) {
      const tx = cx + off * s
      ctx.fillRect(tx - 1.8 * s, gy - th * s, 3.6 * s, th * s)
      ctx.beginPath(); ctx.arc(tx, gy - th * s - r * s * 0.55, r * s, 0, Math.PI * 2); ctx.fill()
    }
    const px1 = cx - 52 * s, px2 = cx + 52 * s, py = gy - 40 * s
    ctx.fillStyle = 'rgba(255,255,255,0.10)'
    ctx.fillRect(px1 - s, py, 2 * s, gy - py)
    ctx.fillRect(px2 - s, py, 2 * s, gy - py)
    const n = 9, lit = Math.floor(n * p)
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n
      const lx = px1 + (px2 - px1) * f
      const ly = py + Math.sin(Math.PI * f) * 12 * s
      ctx.fillStyle = i < lit ? `rgba(${GOLD},0.9)` : 'rgba(255,255,255,0.08)'
      ctx.beginPath(); ctx.arc(lx, ly, 1.5 * s, 0, Math.PI * 2); ctx.fill()
      if (i < lit) glow(ctx, lx, ly, 9 * s, GOLD, 0.28)
    }
    if (p > 0.65 && !reduced) {
      ctx.fillStyle = `rgba(${GOLD},0.8)`
      for (let i = 0; i < 3; i++) {
        const fx = cx + Math.sin(t * 0.0006 + i * 2.1) * 55 * s
        const fy = gy - 20 * s + Math.sin(t * 0.0009 + i * 4.2) * 12 * s
        ctx.beginPath(); ctx.arc(fx, fy, 1.1 * s, 0, Math.PI * 2); ctx.fill()
      }
    }

    // Blooms along the path, and a couple of people strolling through once
    // the park is mostly back — the difference between "lights are on" and
    // "somewhere people actually go".
    if (p > 0.5) {
      const spots = [-40, -14, 18, 46]
      for (let i = 0; i < spots.length; i++) {
        const bx = cx + spots[i] * s, by = gy - 2 * s
        ctx.fillStyle = `rgba(${i % 2 ? VIO : GOLD},${(0.5 + p * 0.35).toFixed(3)})`
        ctx.beginPath(); ctx.arc(bx, by, 1.6 * s, 0, Math.PI * 2); ctx.fill()
      }
    }
    if (p > 0.75 && !reduced) {
      for (let i = 0; i < 2; i++) {
        const walk = (t * 0.00004 + i * 0.5) % 1
        const wx = px1 + (px2 - px1) * walk
        const wy = py + Math.sin(Math.PI * walk) * 12 * s + 2 * s
        ctx.fillStyle = 'rgba(20,16,38,0.8)'
        ctx.fillRect(wx - s, wy - 4 * s, 2 * s, 4 * s)
        ctx.beginPath(); ctx.arc(wx, wy - 5 * s, 1.1 * s, 0, Math.PI * 2); ctx.fill()
      }
    }

    // Happy Ward gets festive bunting over the canopy sometimes, not every
    // card (it piggybacks on `variant` so it's stable per district without
    // a second hash pass).
    if (wardId === 'happy' && variant === 0 && p > 0.4) {
      drawBunting(ctx, px1 - 10 * s, px2 + 10 * s, gy - 72 * s, p > 0.35, t, reduced, s, 8)
    }

    // One focal point off to the side, beyond the tree row — "trees, bench,
    // lights" was peaceful but empty. Which one a district gets is stable
    // per district (variant), so a park keeps its own identity.
    const fx0 = cx + 86 * s
    if (variant === 1) {
      // a gazebo
      const gw = 22 * s, top = gy - 30 * s
      ctx.fillStyle = SIL
      for (const px of [-1, 1]) ctx.fillRect(fx0 + px * gw * 0.4 - s, top, 2 * s, gy - top)
      ctx.beginPath()
      ctx.moveTo(fx0 - gw * 0.6, top); ctx.lineTo(fx0, top - 10 * s); ctx.lineTo(fx0 + gw * 0.6, top)
      ctx.closePath(); ctx.fill()
      if (p > 0.5) {
        ctx.fillStyle = `rgba(${GOLD},0.8)`
        ctx.beginPath(); ctx.arc(fx0, top + 6 * s, 1.6 * s, 0, Math.PI * 2); ctx.fill()
        glow(ctx, fx0, top + 6 * s, 16 * s, GOLD, 0.28)
      }
    } else if (variant === 2) {
      // a small reflective pond
      ctx.fillStyle = '#0c0a1c'
      ctx.beginPath(); ctx.ellipse(fx0, gy - 2 * s, 20 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill()
      if (p > 0.4 && !reduced) {
        for (let i = 0; i < 2; i++) {
          const age = (t * 0.0003 + i / 2) % 1
          ctx.strokeStyle = `rgba(${VIO},${(0.22 * (1 - age)).toFixed(3)})`
          ctx.lineWidth = 0.8 * s
          ctx.beginPath(); ctx.ellipse(fx0, gy - 2 * s, 5 * s + age * 13 * s, 1.3 * s + age * 3 * s, 0, 0, Math.PI * 2); ctx.stroke()
        }
      }
    } else {
      // a statue on a pedestal
      const top = gy - 8 * s
      ctx.fillStyle = SIL
      ctx.fillRect(fx0 - 7 * s, top, 14 * s, 8 * s)
      ctx.fillRect(fx0 - 2 * s, top - 16 * s, 4 * s, 16 * s)
      ctx.beginPath(); ctx.arc(fx0, top - 18 * s, 3 * s, 0, Math.PI * 2); ctx.fill()
      if (p > 0.5) glow(ctx, fx0, top - 12 * s, 16 * s, VIO, 0.22)
    }

    // Every ward's park carries its own accent on the far side from the
    // focal point — the same idea as the station's platform prop.
    if (p > 0.45) {
      const fx1 = cx - 86 * s, fy1 = gy - 2 * s
      if (wardId === 'mono') {
        // a crescent-moon sculpture on a low pedestal
        ctx.fillStyle = SIL
        ctx.fillRect(fx1 - 6 * s, fy1 - 4 * s, 12 * s, 4 * s)
        ctx.fillStyle = `rgba(${VIO},0.75)`
        ctx.beginPath(); ctx.arc(fx1, fy1 - 12 * s, 6 * s, 0.3, Math.PI * 1.6); ctx.fill()
        ctx.fillStyle = '#0c0a1c'
        ctx.beginPath(); ctx.arc(fx1 + 2.5 * s, fy1 - 12 * s, 5 * s, 0, Math.PI * 2); ctx.fill()
      } else if (wardId === 'dday') {
        // a utility box, humming
        ctx.fillStyle = SIL
        ctx.fillRect(fx1 - 5 * s, fy1 - 10 * s, 10 * s, 10 * s)
        const hum = reduced ? 1 : 0.7 + 0.3 * Math.abs(Math.sin(t * 0.005))
        ctx.fillStyle = `rgba(${GOLD},${(0.6 * hum).toFixed(3)})`
        ctx.fillRect(fx1 - 3 * s, fy1 - 7 * s, 6 * s, 1.6 * s)
      } else if (wardId === 'hopeworld') {
        // bleacher steps instead of a single bench
        ctx.fillStyle = SIL
        for (let i = 0; i < 3; i++) ctx.fillRect(fx1 - 12 * s, fy1 - (i + 1) * 3.4 * s, 24 * s, 3 * s)
      } else if (wardId === 'golden') {
        // an ornate garden bench
        ctx.fillStyle = SIL
        ctx.fillRect(fx1 - 13 * s, fy1 - 6 * s, 26 * s, 2.6 * s)
        ctx.strokeStyle = `rgba(${GOLD},0.55)`; ctx.lineWidth = 0.8 * s
        ctx.strokeRect(fx1 - 13 * s, fy1 - 6 * s, 26 * s, 2.6 * s)
        ctx.fillRect(fx1 - 11 * s, fy1 - 12 * s, 2 * s, 6 * s)
        ctx.fillRect(fx1 + 9 * s, fy1 - 12 * s, 2 * s, 6 * s)
      } else if (wardId === 'friends') {
        // a picnic blanket
        ctx.fillStyle = `rgba(${GOLD},0.35)`
        ctx.beginPath(); ctx.ellipse(fx1, fy1 - 1 * s, 12 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = `rgba(${VIO},0.3)`
        ctx.fillRect(fx1 - 12 * s, fy1 - 1.6 * s, 24 * s, 1.6 * s)
      } else if (wardId === 'oldgrid') {
        // an old stone well
        ctx.fillStyle = SIL
        ctx.beginPath(); ctx.ellipse(fx1, fy1 - 2 * s, 8 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill()
        ctx.fillRect(fx1 - 8 * s, fy1 - 8 * s, 16 * s, 6 * s)
        ctx.beginPath(); ctx.ellipse(fx1, fy1 - 8 * s, 8 * s, 2.4 * s, 0, 0, Math.PI * 2); ctx.fill()
      }
    }
  },

  ferris(ctx, { cx, gy, s, p, t, reduced }) {
    const hubY = gy - 56 * s, r = 42 * s
    ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.lineWidth = 2 * s
    ctx.beginPath(); ctx.moveTo(cx - 16 * s, gy); ctx.lineTo(cx, hubY); ctx.lineTo(cx + 16 * s, gy); ctx.stroke()
    ctx.lineWidth = 1.4 * s
    ctx.beginPath(); ctx.arc(cx, hubY, r, 0, Math.PI * 2); ctx.stroke()
    const spin = reduced ? 0 : t * 0.00012
    const n = 8, lit = Math.floor(n * p)
    for (let i = 0; i < n; i++) {
      const a = spin + (i / n) * Math.PI * 2
      const sx = cx + Math.cos(a) * r, sy = hubY + Math.sin(a) * r
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'
      ctx.beginPath(); ctx.moveTo(cx, hubY); ctx.lineTo(sx, sy); ctx.stroke()
      const rgb = i % 2 ? GOLD : VIO
      ctx.fillStyle = i < lit ? `rgba(${rgb},0.92)` : 'rgba(255,255,255,0.10)'
      ctx.beginPath(); ctx.arc(sx, sy, 2.4 * s, 0, Math.PI * 2); ctx.fill()
      if (i < lit) glow(ctx, sx, sy, 11 * s, rgb, 0.3)
    }
    ctx.fillStyle = p > 0.35 ? `rgba(${VIO},0.9)` : 'rgba(255,255,255,0.14)'
    ctx.beginPath(); ctx.arc(cx, hubY, 3 * s, 0, Math.PI * 2); ctx.fill()
  },

  tower(ctx, { cx, gy, s, p, t, reduced, clock }) {
    const th = 102 * s, tw = 15 * s
    ctx.fillStyle = SIL
    ctx.beginPath()
    ctx.moveTo(cx - tw, gy); ctx.lineTo(cx - tw * 0.62, gy - th)
    ctx.lineTo(cx + tw * 0.62, gy - th); ctx.lineTo(cx + tw, gy)
    ctx.closePath(); ctx.fill()
    // An observation deck, not a dome and not a beacon housing — this is what
    // stops tower / observatory / lighthouse reading as the same vertical
    // thing at thumbnail size.
    ctx.fillRect(cx - tw * 1.25, gy - th - 4 * s, tw * 2.5, 4 * s)
    ctx.fillRect(cx - tw * 0.95, gy - th - 7 * s, tw * 1.9, 3.5 * s)
    ctx.beginPath(); ctx.moveTo(cx - tw * 0.5, gy - th - 7 * s); ctx.lineTo(cx, gy - th - 18 * s); ctx.lineTo(cx + tw * 0.5, gy - th - 7 * s); ctx.closePath(); ctx.fill()
    if (clock) {
      const cy = gy - th * 0.74
      ctx.fillStyle = '#181430'
      ctx.beginPath(); ctx.arc(cx, cy, 7.5 * s, 0, Math.PI * 2); ctx.fill()
      if (p > 0.65) {
        ctx.fillStyle = `rgba(${VIO},0.9)`
        ctx.beginPath(); ctx.arc(cx, cy, 6 * s, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = '#241d45'; ctx.lineWidth = 1.2 * s
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - 4.2 * s); ctx.moveTo(cx, cy); ctx.lineTo(cx + 3 * s, cy + s); ctx.stroke()
      }
    }
    if (p > 0.35) {
      const pulse = reduced ? 1 : 0.75 + 0.25 * Math.sin(t * 0.003)
      ctx.fillStyle = `rgba(${GOLD},${0.9 * pulse})`
      ctx.beginPath(); ctx.arc(cx, gy - th - 12 * s, 2.4 * s, 0, Math.PI * 2); ctx.fill()
      glow(ctx, cx, gy - th - 12 * s, 22 * s, GOLD, 0.35 * pulse)
      // deck lights — the tower's own restoration tell
      for (const d of [-1, 1]) {
        ctx.fillStyle = `rgba(${GOLD},0.75)`
        ctx.fillRect(cx + d * tw * 0.95 - 1.2 * s, gy - th - 3.4 * s, 2.4 * s, 2.4 * s)
      }
    }
    if (p > 0.9) {
      ctx.strokeStyle = `rgba(${GOLD},0.4)`; ctx.lineWidth = s
      ctx.beginPath(); ctx.moveTo(cx - tw * 0.62, gy - th); ctx.lineTo(cx - tw, gy); ctx.moveTo(cx + tw * 0.62, gy - th); ctx.lineTo(cx + tw, gy); ctx.stroke()
    }
  },

  lighthouse(ctx, { cx, gy, s, p, t, reduced }) {
    const th = 88 * s, tw = 13 * s
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#171331' : SIL
      const y0 = gy - (th * (i + 1)) / 4, bh = th / 4
      const k0 = 1 - (i + 1) * 0.11, k1 = 1 - i * 0.11
      ctx.beginPath()
      ctx.moveTo(cx - tw * k1, y0 + bh); ctx.lineTo(cx - tw * k0, y0)
      ctx.lineTo(cx + tw * k0, y0); ctx.lineTo(cx + tw * k1, y0 + bh)
      ctx.closePath(); ctx.fill()
    }
    ctx.fillStyle = SIL
    ctx.fillRect(cx - 8 * s, gy - th - 9 * s, 16 * s, 9 * s)
    ctx.beginPath(); ctx.moveTo(cx - 8 * s, gy - th - 9 * s); ctx.lineTo(cx, gy - th - 18 * s); ctx.lineTo(cx + 8 * s, gy - th - 9 * s); ctx.closePath(); ctx.fill()
    const ly = gy - th - 4.5 * s
    if (p > 0.35) {
      ctx.fillStyle = `rgba(${GOLD},0.95)`
      ctx.fillRect(cx - 4 * s, gy - th - 8 * s, 8 * s, 7 * s)
      glow(ctx, cx, ly, 20 * s, GOLD, 0.4)
    }
    if (p > 0.5) {
      const a = reduced ? -0.5 : Math.sin(t * 0.0005) * 0.9
      const len = 130 * s
      const g = ctx.createLinearGradient(cx, ly, cx + Math.cos(a) * len, ly + Math.sin(a) * len * 0.3)
      g.addColorStop(0, `rgba(${GOLD},0.30)`); g.addColorStop(1, `rgba(${GOLD},0)`)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.moveTo(cx, ly)
      ctx.lineTo(cx + Math.cos(a) * len, ly + Math.sin(a) * len * 0.3 - 13 * s)
      ctx.lineTo(cx + Math.cos(a) * len, ly + Math.sin(a) * len * 0.3 + 13 * s)
      ctx.closePath(); ctx.fill()
    }
  },

  observatory(ctx, { cx, gy, s, p, t, reduced }) {
    const bw = 56 * s, bh = 26 * s, r = 30 * s
    ctx.fillStyle = SIL
    ctx.fillRect(cx - bw / 2, gy - bh, bw, bh)
    ctx.beginPath(); ctx.arc(cx, gy - bh, r, Math.PI, 0); ctx.fill()
    ctx.fillStyle = p > 0.65 ? `rgba(${VIO},0.85)` : 'rgba(255,255,255,0.06)'
    ctx.fillRect(cx - 2.5 * s, gy - bh - r, 5 * s, r * 0.85)
    if (p > 0.65) glow(ctx, cx, gy - bh - r * 0.6, 18 * s, VIO, 0.3)
    if (p > 0.9) {
      // the beam sweeps slowly, mirroring the lighthouse's angle animation —
      // a static cone was the one thing that made this read as a photo
      // rather than a place.
      const originX = cx, originY = gy - bh - r + 4 * s
      const a = reduced ? -1.3 : -1.3 + Math.sin(t * 0.00035) * 0.5
      const len = 110 * s
      const midX = originX + Math.cos(a) * len, midY = originY + Math.sin(a) * len
      const g = ctx.createLinearGradient(originX, originY, midX, midY)
      g.addColorStop(0, `rgba(${VIO},0.30)`); g.addColorStop(1, `rgba(${VIO},0)`)
      ctx.fillStyle = g
      const perpX = -Math.sin(a) * 12 * s, perpY = Math.cos(a) * 12 * s
      ctx.beginPath()
      ctx.moveTo(originX - 3 * s, originY)
      ctx.lineTo(midX - perpX, midY - perpY)
      ctx.lineTo(midX + perpX, midY + perpY)
      ctx.lineTo(originX + 3 * s, originY)
      ctx.closePath(); ctx.fill()
    }
  },

  plaza(ctx, { cx, gy, s, p, t, reduced, variant = 0, wardId }) {
    ctx.fillStyle = SIL
    ctx.beginPath()
    ctx.moveTo(cx - 6 * s, gy); ctx.lineTo(cx - 3 * s, gy - 62 * s)
    ctx.lineTo(cx + 3 * s, gy - 62 * s); ctx.lineTo(cx + 6 * s, gy)
    ctx.closePath(); ctx.fill()

    // The topper carries the monument's identity, so not every plaza is
    // the same slender obelisk.
    if (variant === 1) {
      // a statue: shoulders + head
      ctx.beginPath()
      ctx.moveTo(cx - 5 * s, gy - 62 * s); ctx.quadraticCurveTo(cx, gy - 70 * s, cx + 5 * s, gy - 62 * s)
      ctx.closePath(); ctx.fill()
      ctx.beginPath(); ctx.arc(cx, gy - 74 * s, 4 * s, 0, Math.PI * 2); ctx.fill()
    } else if (variant === 2) {
      // a clock face
      ctx.beginPath(); ctx.arc(cx, gy - 68 * s, 7 * s, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#181430'
      ctx.beginPath(); ctx.arc(cx, gy - 68 * s, 5.4 * s, 0, Math.PI * 2); ctx.fill()
      if (p > 0.5) {
        ctx.fillStyle = `rgba(${VIO},0.85)`
        ctx.beginPath(); ctx.arc(cx, gy - 68 * s, 4.2 * s, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = '#241d45'; ctx.lineWidth = s
        ctx.beginPath()
        ctx.moveTo(cx, gy - 68 * s); ctx.lineTo(cx, gy - 71 * s)
        ctx.moveTo(cx, gy - 68 * s); ctx.lineTo(cx + 2.4 * s, gy - 67 * s)
        ctx.stroke()
      }
      ctx.fillStyle = SIL
    } else {
      // the original obelisk tip
      ctx.beginPath(); ctx.moveTo(cx - 3 * s, gy - 62 * s); ctx.lineTo(cx, gy - 70 * s); ctx.lineTo(cx + 3 * s, gy - 62 * s); ctx.closePath(); ctx.fill()
    }
    for (const dir of [-1, 1]) {
      ctx.fillStyle = 'rgba(255,255,255,0.10)'
      ctx.fillRect(cx + dir * 40 * s - s, gy - 38 * s, 2 * s, 38 * s)
      ctx.fillStyle = p > 0.65 ? `rgba(${VIO},0.55)` : 'rgba(255,255,255,0.05)'
      ctx.beginPath()
      ctx.moveTo(cx + dir * 40 * s, gy - 38 * s)
      ctx.lineTo(cx + dir * (40 + 12) * s, gy - 33 * s)
      ctx.lineTo(cx + dir * 40 * s, gy - 28 * s)
      ctx.closePath(); ctx.fill()
    }
    if (p > 0.35) {
      for (const dir of [-1, 1]) {
        // uplights shimmer rather than holding one flat brightness
        const shimmer = reduced ? 1 : 0.8 + 0.2 * Math.sin(t * 0.0028 + (dir > 0 ? 1.6 : 0))
        const g = ctx.createLinearGradient(cx + dir * 26 * s, gy, cx, gy - 50 * s)
        g.addColorStop(0, `rgba(${GOLD},${(0.22 * shimmer).toFixed(3)})`); g.addColorStop(1, `rgba(${GOLD},0)`)
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.moveTo(cx + dir * 28 * s, gy); ctx.lineTo(cx + dir * 2 * s, gy - 66 * s)
        ctx.lineTo(cx + dir * 10 * s, gy - 66 * s); ctx.lineTo(cx + dir * 34 * s, gy)
        ctx.closePath(); ctx.fill()
      }
    }
    if (p > 0.9) glow(ctx, cx, gy - 68 * s, 16 * s, GOLD, 0.4)

    // Happy Ward gets festive bunting between the flag posts sometimes, not
    // every card (piggybacks on `variant`, same reasoning as park's).
    if (wardId === 'happy' && variant === 0 && p > 0.4) {
      drawBunting(ctx, cx - 44 * s, cx + 44 * s, gy - 44 * s, p > 0.35, t, reduced, s, 6)
    }
  },

  // Rated the weakest archetype in review — it read as a kiosk, a warehouse,
  // a garage. Rebuilt so nothing else can be mistaken for it: a wide glowing
  // display window under a scalloped awning, a sign hanging perpendicular
  // over the pavement, a door, and a planter. Variants change the awning and
  // the sign's side, not the shape's identity.
  shop(ctx, { cx, gy, s, p, t, reduced, variant = 0, shopKind = null }) {
    const w = 82 * s, h = 38 * s, x = cx - w / 2, y = gy - h
    const lit = p > 0.35, open = p > 0.65
    const flick = open ? (reduced ? 1 : 0.75 + 0.25 * Math.abs(Math.sin(t * 0.005))) : 0

    ctx.fillStyle = SIL
    ctx.fillRect(x, y, w, h)

    // display window — wide, low, and the brightest thing in the scene
    const winX = x + 5 * s, winW = w - 27 * s, winY = y + 13 * s, winH = h - 17 * s
    ctx.fillStyle = lit ? `rgba(${GOLD},${0.55 + p * 0.35})` : 'rgba(255,255,255,0.055)'
    ctx.fillRect(winX, winY, winW, winH)
    // mullions, so it reads as glass rather than a lit hole
    ctx.fillStyle = SIL
    ctx.fillRect(winX + winW / 3, winY, 1.6 * s, winH)
    ctx.fillRect(winX + (winW / 3) * 2, winY, 1.6 * s, winH)
    // goods on display: two dark blocks behind the glass
    if (lit) {
      ctx.fillStyle = 'rgba(20,16,38,0.75)'
      ctx.fillRect(winX + 3 * s, winY + winH - 9 * s, 7 * s, 6 * s)
      ctx.fillRect(winX + winW - 12 * s, winY + winH - 7 * s, 6 * s, 4 * s)
    }

    // door with a fanlight
    const dx = x + w - 19 * s
    ctx.fillStyle = lit ? `rgba(${GOLD},0.4)` : 'rgba(255,255,255,0.05)'
    ctx.fillRect(dx, y + 15 * s, 12 * s, h - 15 * s)
    ctx.fillStyle = SIL
    ctx.fillRect(dx, y + 15 * s, 12 * s, 1.6 * s)

    // THE AWNING. This is the one signal that separates a shop from a
    // warehouse at thumbnail size, so it spans the full frontage with an
    // overhang on both sides, and its stripes catch the light from the window
    // below — a dark awning just reads as another roof.
    const aL = x - 8 * s, aR = x + w + 8 * s, aW = aR - aL
    const ay = y + 8 * s, aDrop = 9 * s
    const warm = (k) => lit ? `rgba(${GOLD},${(0.30 + p * 0.34) * k})` : `rgba(255,255,255,${0.06 * k})`

    // support arms tucking it back into the facade
    ctx.fillStyle = SIL
    ctx.fillRect(aL + 3 * s, ay - 3 * s, 2 * s, 5 * s)
    ctx.fillRect(aR - 5 * s, ay - 3 * s, 2 * s, 5 * s)

    const n = 7, sw = aW / n
    for (let i = 0; i < n; i++) {
      const sx0 = aL + i * sw
      ctx.beginPath()
      ctx.moveTo(sx0, ay)
      ctx.lineTo(sx0 + sw, ay)
      if (variant === 1) {                       // straight hem
        ctx.lineTo(sx0 + sw, ay + aDrop)
        ctx.lineTo(sx0, ay + aDrop)
      } else if (variant === 2) {                // pointed hem
        ctx.lineTo(sx0 + sw, ay + aDrop * 0.6)
        ctx.lineTo(sx0 + sw / 2, ay + aDrop)
        ctx.lineTo(sx0, ay + aDrop * 0.6)
      } else {                                   // scalloped hem
        ctx.lineTo(sx0 + sw, ay + aDrop * 0.55)
        ctx.arc(sx0 + sw / 2, ay + aDrop * 0.55, sw / 2, 0, Math.PI)
      }
      ctx.closePath()
      // alternating stripes: one lit, one deep — high contrast is what makes
      // it legible when the whole thing is 80px wide
      ctx.fillStyle = i % 2 ? warm(1) : '#171230'
      ctx.fill()
    }
    // the lit hem line along the bottom edge
    ctx.fillStyle = warm(0.75)
    ctx.fillRect(aL, ay + aDrop * 0.52, aW, 1.4 * s)
    // light spilling from under the awning onto the pavement
    if (lit) glow(ctx, cx, ay + aDrop + 6 * s, 46 * s, GOLD, 0.16)

    // hanging sign, perpendicular to the front — the "shop" tell at a glance
    const side = variant === 2 ? -1 : 1
    const sx = side > 0 ? x + w : x
    ctx.fillStyle = 'rgba(255,255,255,0.16)'
    ctx.fillRect(side > 0 ? sx : sx - 12 * s, y - 11 * s, 12 * s, 1.4 * s)
    ctx.fillStyle = flick ? `rgba(${GOLD},${0.9 * flick})` : 'rgba(255,255,255,0.07)'
    ctx.fillRect(side > 0 ? sx + 3 * s : sx - 11 * s, y - 10 * s, 8 * s, 12 * s)
    if (flick) glow(ctx, side > 0 ? sx + 7 * s : sx - 7 * s, y - 4 * s, 20 * s, GOLD, 0.3 * flick)

    // planter on the pavement — the small human touch
    ctx.fillStyle = SIL
    ctx.fillRect(x - 7 * s, gy - 5 * s, 5 * s, 5 * s)
    if (open) {
      ctx.fillStyle = `rgba(${VIO},0.7)`
      ctx.beginPath(); ctx.arc(x - 4.5 * s, gy - 7 * s, 2.6 * s, 0, Math.PI * 2); ctx.fill()
    }

    if (lit) glow(ctx, cx - 6 * s, y + 26 * s, 30 * s, GOLD, 0.24)

    // Sub-type flourishes — same shell, so bakery/cafe/cantina/parlor stop
    // reading as "small building, lamp, window" once you've seen a handful.
    if (shopKind === 'bakery') {
      const chx = x + w * 0.18
      ctx.fillStyle = SIL
      ctx.fillRect(chx - 2 * s, y - 10 * s, 4 * s, 10 * s)
      if (open && !reduced) for (let i = 0; i < 3; i++) {
        const age = (t * 0.00025 + i / 3) % 1
        ctx.fillStyle = `rgba(200,195,220,${(0.16 * (1 - age)).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(chx + Math.sin(age * 5) * 3 * s, y - 12 * s - age * 22 * s, (1.6 + age * 3) * s, 0, Math.PI * 2)
        ctx.fill()
      }
      // a loaf glyph on the awning ridge
      ctx.fillStyle = lit ? `rgba(${GOLD},0.85)` : 'rgba(255,255,255,0.12)'
      ctx.beginPath(); ctx.ellipse(cx, ay - 4 * s, 7 * s, 3.4 * s, 0, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = SIL; ctx.lineWidth = 0.8 * s
      ctx.beginPath()
      ctx.moveTo(cx - 3.5 * s, ay - 4 * s); ctx.lineTo(cx - s, ay - 6 * s)
      ctx.moveTo(cx + s, ay - 6 * s); ctx.lineTo(cx + 3.5 * s, ay - 4 * s)
      ctx.stroke()
    } else if (shopKind === 'cafe') {
      // an outdoor table beside the entrance
      const tx0 = x + w + 14 * s
      ctx.fillStyle = SIL
      ctx.fillRect(tx0 - 0.8 * s, gy - 10 * s, 1.6 * s, 10 * s)
      ctx.beginPath(); ctx.ellipse(tx0, gy - 10 * s, 6 * s, 2 * s, 0, 0, Math.PI * 2); ctx.fill()
      for (const cdx of [-6, 6]) ctx.fillRect(tx0 + cdx * s - 0.6 * s, gy - 6 * s, 1.2 * s, 6 * s)
      if (open) {
        ctx.fillStyle = `rgba(${GOLD},0.6)`
        ctx.beginPath(); ctx.arc(tx0, gy - 11 * s, 1.6 * s, 0, Math.PI * 2); ctx.fill()
      }
    } else if (shopKind === 'cantina') {
      // a string of small lanterns under the awning
      if (open) for (let i = 0; i < 3; i++) {
        const lx = aL + aW * (0.2 + i * 0.3), ly2 = ay + aDrop + 5 * s
        const rgb = i % 2 ? VIO : GOLD
        ctx.fillStyle = `rgba(${rgb},0.85)`
        ctx.beginPath(); ctx.ellipse(lx, ly2, 2 * s, 2.6 * s, 0, 0, Math.PI * 2); ctx.fill()
        glow(ctx, lx, ly2, 10 * s, rgb, 0.25)
      }
    } else if (shopKind === 'parlor') {
      // a second planter, and a round accent window above the display glass
      ctx.fillStyle = SIL
      ctx.fillRect(x + w + 2 * s, gy - 5 * s, 5 * s, 5 * s)
      if (open) {
        ctx.fillStyle = `rgba(${GOLD},0.7)`
        ctx.beginPath(); ctx.arc(x + w + 4.5 * s, gy - 7 * s, 2.6 * s, 0, Math.PI * 2); ctx.fill()
      }
      ctx.fillStyle = lit ? `rgba(${VIO},0.55)` : 'rgba(255,255,255,0.05)'
      ctx.beginPath(); ctx.arc(x + w - 12 * s, y + 7 * s, 4 * s, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = SIL; ctx.lineWidth = 0.8 * s
      ctx.beginPath(); ctx.arc(x + w - 12 * s, y + 7 * s, 4 * s, 0, Math.PI * 2); ctx.stroke()
    }
  },

  temple(ctx, { cx, gy, s, p, t, reduced }) {
    const bw = 62 * s, bh = 30 * s
    ctx.fillStyle = SIL
    for (const dir of [-1, 1]) {
      const tx = cx + dir * (bw / 2 + 10 * s)
      ctx.fillRect(tx - 6 * s, gy - 58 * s, 12 * s, 58 * s)
      ctx.beginPath(); ctx.arc(tx, gy - 58 * s, 6 * s, Math.PI, 0); ctx.fill()
    }
    ctx.fillRect(cx - bw / 2, gy - bh, bw, bh)
    ctx.beginPath(); ctx.arc(cx, gy - bh, 24 * s, Math.PI, 0); ctx.fill()
    ctx.fillRect(cx - s, gy - bh - 24 * s - 7 * s, 2 * s, 7 * s)
    const aw = 16 * s, ah = 22 * s
    ctx.fillStyle = p > 0.35 ? `rgba(${GOLD},${0.5 + p * 0.35})` : 'rgba(255,255,255,0.06)'
    ctx.beginPath()
    ctx.moveTo(cx - aw / 2, gy); ctx.lineTo(cx - aw / 2, gy - ah + aw / 2)
    ctx.arc(cx, gy - ah + aw / 2, aw / 2, Math.PI, 0)
    ctx.lineTo(cx + aw / 2, gy); ctx.closePath(); ctx.fill()
    if (p > 0.35) glow(ctx, cx, gy - ah / 2, 24 * s, GOLD, 0.25)
    // hanging lanterns along the approach, swaying on their cords — the
    // temple's own sign of life, not just a lit shape.
    if (p > 0.6) {
      for (let i = 0; i < 4; i++) {
        const lo = [-1.35, -0.85, 0.85, 1.35][i]
        const lx = cx + lo * (bw / 2)
        const sway = reduced ? 0 : Math.sin(t * 0.0016 + i * 1.9) * 2 * s
        ctx.fillStyle = 'rgba(255,255,255,0.12)'
        ctx.fillRect(lx - 0.5 * s, gy - 26 * s, 1 * s, 6 * s)
        ctx.fillStyle = `rgba(${GOLD},0.85)`
        ctx.beginPath(); ctx.ellipse(lx + sway, gy - 18 * s, 2.4 * s, 3.2 * s, 0, 0, Math.PI * 2); ctx.fill()
        glow(ctx, lx + sway, gy - 18 * s, 11 * s, GOLD, 0.3)
      }
    }
    if (p > 0.9) {
      ctx.strokeStyle = `rgba(${VIO},0.6)`; ctx.lineWidth = 1.2 * s
      ctx.beginPath(); ctx.arc(cx, gy - bh, 24 * s, Math.PI, 0); ctx.stroke()
    }
  },
}

export function drawLandmark(ctx, type, opts) {
  const fn = DRAW[type] || EXTRA[type]
  if (fn) fn(ctx, opts)
}
