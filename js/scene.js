// Procedural district scene. Each district's skyline is generated from a hash
// of its id, so all ~230 districts look distinct with no hand-drawn art, and
// the same district always renders identically. Progress (0..1) drives how
// much of the place is alive: windows, streetlights, sky warmth, rain.
//
// If the district's NAME says what kind of place it is (Gate, Pier, Fountain,
// Station…), that landmark stands center-stage — see landmarks.js. The
// skyline keeps its distance so the place the district is named for reads
// against clean sky.

import { landmarkType, drawLandmark, shopKindOf } from './landmarks.js'
import { layoutProps, drawProps, propsKey } from './scene-items.js'

function hashStr(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Weighted weather pools per ward — bias only, never a guarantee, so a ward
// still shows the occasional exception rather than one weather state stamped
// on every district in it. This is the ward's "atmosphere", the shape/decor
// counterpart in ward-profiles.js is its "silhouette" — together they carry
// ward identity without ever touching colour, which stays reserved for state
// (gold restored / violet charged / crimson breach).
const WEATHER_BASE = ['rain', 'rain', 'rain', 'drizzle', 'drizzle', 'fog', 'snow', 'clear']
const WARD_WEATHER = {
  mono: ['rain', 'rain', 'rain', 'rain', 'drizzle', 'drizzle', 'fog', 'snow'],
  happy: ['clear', 'clear', 'drizzle', 'rain', 'snow', 'gale', 'clear', 'drizzle'],
  dday: ['fog', 'overcast', 'overcast', 'fog', 'rain', 'gale', 'drizzle', 'snow'],
  hopeworld: ['drizzle', 'rain', 'clear', 'fog', 'snow', 'gale', 'overcast', 'rain'],
  golden: ['clear', 'clear', 'clear', 'snow', 'drizzle', 'fog', 'gale', 'clear'],
  friends: ['clear', 'drizzle', 'rain', 'fog', 'snow', 'gale', 'clear', 'overcast'],
  muse: ['fog', 'overcast', 'gale', 'rain', 'fog', 'drizzle', 'overcast', 'snow'],
  layover: ['gale', 'overcast', 'fog', 'rain', 'drizzle', 'snow', 'fog', 'gale'],
  oldgrid: WEATHER_BASE.concat(['overcast', 'gale']),
  'relay-zero': ['clear', 'clear', 'drizzle', 'fog', 'rain', 'snow', 'clear', 'gale'],
}
function weatherFor(districtId, wardId) {
  const pool = WARD_WEATHER[wardId] || WEATHER_BASE.concat(['overcast', 'gale'])
  return pool[hashStr(districtId + '|w') % pool.length]
}

/** Deterministic skyline + window layout for one district. */
export function buildModel(districtId, w, h, name = '', opts = {}) {
  const { wardId = '', centerpiece = false } = opts
  const rnd = mulberry32(hashStr(districtId))
  const groundY = h * 0.82
  const buildings = []
  const windows = []
  let x = -10

  // How much skyline each landmark clears for itself — the fix for every
  // thumbnail reading as "building · lamp · landmark · building". A pier owns
  // almost the whole frame; a tower wants the skyline crowding in around it
  // so its height reads. Composition is part of the landmark's identity.
  const CLEAR = {
    pier: 0.88, street: 0.82, station: 0.68, park: 0.6, ferris: 0.55,
    market: 0.78, crossroads: 0.5, hall: 0.48, temple: 0.48, stage: 0.5, mill: 0.5,
    fountain: 0.44, plaza: 0.42, cave: 0.6, shop: 0.34, house: 0.32,
    tower: 0.24, lighthouse: 0.26, observatory: 0.4,
  }
  // And how tall it stands. Towers dominate vertically, piers stay low —
  // without this everything lived in the middle 40% of the frame.
  const LIFT = { tower: 1.18, lighthouse: 1.14, ferris: 1.12, observatory: 1.05, pier: 0.9, street: 0.92, market: 0.95 }

  const lmType = landmarkType(name)
  const slotHW = lmType && lmType !== 'bridge' ? w * (CLEAR[lmType] ?? 0.3) : 0

  while (x < w + 10) {
    const bw = 28 + rnd() * 46
    if (slotHW && x + bw > w / 2 - slotHW && x < w / 2 + slotHW) {
      x = w / 2 + slotHW + 3 + rnd() * 8
      continue
    }
    const bh = h * (0.18 + rnd() * 0.42)
    const b = { x, w: bw, y: groundY - bh, h: bh, tone: 0.06 + rnd() * 0.05 }
    buildings.push(b)

    // window grid
    const cols = Math.max(1, Math.floor(bw / 13))
    const rows = Math.max(1, Math.floor(bh / 17))
    const padX = (bw - cols * 8) / (cols + 1)
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        if (rnd() < 0.12) continue // dark/boarded windows stay dark forever
        windows.push({
          x: b.x + padX + c * (8 + padX),
          y: b.y + 10 + r * 17,
          w: 6, h: 9,
          order: rnd(),                 // reveal order as progress climbs
          warm: rnd() < 0.72,           // warm vs cool light
          flick: rnd() < 0.06,          // a few flicker
          phase: rnd() * Math.PI * 2,
        })
      }
    }
    x += bw + 3 + rnd() * 8
  }
  windows.sort((a, b) => a.order - b.order)

  let lamps = []
  const lampCount = Math.max(3, Math.floor(w / 78))
  for (let i = 0; i < lampCount; i++) {
    lamps.push({ x: (i + 0.5) * (w / lampCount) + (rnd() - 0.5) * 14, order: rnd() })
  }
  if (slotHW) lamps = lamps.filter((l) => Math.abs(l.x - w / 2) > slotHW * 0.9)
  lamps.sort((a, b) => a.order - b.order)

  // Weather is per-district and stable. Every scene being heavy rain was the
  // single biggest reason 257 cards blurred together — this is the cheapest
  // way to give districts their own feel without touching the palette.
  // Rain stays the most common so the world still reads as one rainy city,
  // but the mix is biased per ward (see WARD_WEATHER) so wards get their own
  // atmosphere without touching colour, which stays reserved for state.
  const weather = weatherFor(districtId, wardId)

  const drops = weather === 'snow' || weather === 'gale' ? 55
    : weather === 'drizzle' ? 45
    : weather === 'overcast' ? 0
    : 90
  const rain = []
  for (let i = 0; i < drops; i++) {
    rain.push({ x: rnd() * w, y: rnd() * h, len: 6 + rnd() * 12, sp: 220 + rnd() * 260, off: rnd(), r: 0.6 + rnd() * 1.1 })
  }

  // Stars, only ever seen on nights the sky is actually clear.
  const stars = []
  for (let i = 0; i < 26; i++) stars.push({ x: rnd() * w, y: rnd() * groundY * 0.6, r: rnd() })

  // Birds come back when the place does — a few pixels each, but they're the
  // difference between a lit set and somewhere people live. Flock size and
  // pace vary per district — a fixed count of 4 flying the same arc was why
  // every restored district looked like the same stock footage.
  const birds = []
  const birdCount = 3 + Math.floor(rnd() * 4) // 3..6
  for (let i = 0; i < birdCount; i++) {
    birds.push({
      x: 0.05 + rnd() * 0.9, y: 0.06 + rnd() * 0.4, s: 0.6 + rnd() * 0.8,
      sp: 0.6 + rnd() * 0.8, ph: rnd() * 10,
    })
  }

  // A faint speckle so the sky gradient doesn't band — built once per model,
  // not per frame, and it's grey/white noise, not a colour, so it doesn't
  // touch the state palette either.
  const grain = document.createElement('canvas')
  grain.width = grain.height = 48
  const gctx = grain.getContext('2d')
  for (let i = 0; i < 70; i++) {
    const gx = rnd() * 48, gy = rnd() * 48, ga = 0.02 + rnd() * 0.04
    gctx.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${ga})` : `rgba(0,0,0,${ga})`
    gctx.fillRect(gx, gy, 1, 1)
  }

  // A near-camera layer so the scene isn't all on one plane — and it belongs
  // to the landmark rather than being a random fence. The foreground is part
  // of a category's identity: rope posts say pier before you see the pier.
  const FG_BY_TYPE = {
    park: 'bench', station: 'bench', plaza: 'railing', pier: 'ropes',
    temple: 'lantern', shop: 'bicycle', market: 'crates', hall: 'railing',
    stage: 'railing', house: 'fence', crossroads: 'fence', fountain: 'bench',
    observatory: 'fence', tower: 'fence', lighthouse: 'ropes', cave: 'crates',
  }
  const fgKind = lmType
    ? (FG_BY_TYPE[lmType] || ['fence', 'lamp', 'none'][hashStr(districtId + '|f') % 3])
    : ['fence', 'lamp', 'bench', 'none', 'none'][hashStr(districtId + '|f') % 5]
  const fg = { kind: fgKind, x: 0.08 + rnd() * 0.16, flip: rnd() < 0.5 }

  // `variant` is a stable 0-2 per district. Shop, street and plaza are the
  // most-reused archetypes — without this, your 15th shop district looks
  // pixel-identical to your first.
  const landmark = lmType ? {
    type: lmType,
    clock: /clock|bell|belfry/i.test(name),
    variant: hashStr(districtId + name) % 3,
    lift: LIFT[lmType] ?? 1,
    shopKind: lmType === 'shop' ? shopKindOf(name) : null,
  } : null
  return { buildings, windows, lamps, rain, stars, birds, fg, weather, groundY, w, h, landmark, wardId, centerpiece, grain }
}

export function renderScene(ctx, m, progress, t, reduced, charge = 0, props = []) {
  const { w, h, groundY } = m
  const p = Math.max(0, Math.min(1, progress))
  const c = Math.max(0, Math.min(1, charge))   // ARMY Bomb community charge
  ctx.clearRect(0, 0, w, h)

  // sky — cold dead blue when dark, warms toward restoration. The bomb's
  // charge lifts the whole sky violet, so a charged network visibly powers
  // every city on the grid, not just the one you're working on.
  const sky = ctx.createLinearGradient(0, 0, 0, groundY)
  sky.addColorStop(0, `rgb(${8 + p * 26 + c * 14}, ${8 + p * 10 + c * 4}, ${18 + p * 22 + c * 40})`)
  sky.addColorStop(1, `rgb(${16 + p * 52 + c * 20}, ${12 + p * 20 + c * 6}, ${28 + p * 30 + c * 52})`)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, groundY)

  // ARMY Bomb aura — a violet wash from above that breathes with the charge
  if (c > 0.01) {
    const pulse = reduced ? 1 : 0.86 + 0.14 * Math.sin(t * 0.0016)
    const aura = ctx.createRadialGradient(w / 2, -h * 0.15, 0, w / 2, -h * 0.15, h * 1.25)
    aura.addColorStop(0, `rgba(167, 139, 250, ${(0.05 + c * 0.30) * pulse})`)
    aura.addColorStop(1, 'rgba(167, 139, 250, 0)')
    ctx.fillStyle = aura
    ctx.fillRect(0, 0, w, groundY)
  }

  // Horizon glow grows with progress — warm gold, not crimson. Crimson is the
  // Red Zone colour now, and a district that's simply mid-restoration must not
  // read as an emergency.
  if (p > 0.02) {
    const glow = ctx.createRadialGradient(w / 2, groundY, 0, w / 2, groundY, w * 0.6)
    glow.addColorStop(0, `rgba(217, 173, 95, ${0.05 + p * 0.24})`)
    glow.addColorStop(1, 'rgba(217, 173, 95, 0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, w, groundY)
  }

  // Moonlight behind the landmark.
  //
  // Without this the silhouette (#0f0c1d) sits on a dark sky whose lower stop
  // is rgb(16,12,28) — one value apart, so at 0% the landmark vanished and
  // every dark district looked like empty rain. The backlight is strongest
  // when the place is dead and fades as the district's own light takes over,
  // so you can always answer "yes, this is still the same place".
  if (m.landmark) {
    const bx = w / 2, by = groundY - h * 0.16
    const back = ctx.createRadialGradient(bx, by, 0, bx, by, w * 0.44)
    back.addColorStop(0, `rgba(158,146,220,${(0.20 - p * 0.09).toFixed(3)})`)
    back.addColorStop(1, 'rgba(158,146,220,0)')
    ctx.fillStyle = back
    ctx.fillRect(0, 0, w, groundY)
  }

  // Centerpiece halo — a permanent gold+violet aura, independent of the ARMY
  // Bomb's charge, so a ward's one flagship place always reads as more than
  // just another district, dark or lit.
  if (m.centerpiece && m.landmark) {
    const bx = w / 2, by = groundY - h * 0.18
    const pulse = reduced ? 1 : 0.82 + 0.18 * Math.sin(t * 0.0011)
    const halo = ctx.createRadialGradient(bx, by, 0, bx, by, w * 0.5)
    halo.addColorStop(0, `rgba(217,173,95,${(0.16 * pulse).toFixed(3)})`)
    halo.addColorStop(0.55, `rgba(167,139,250,${(0.10 * pulse).toFixed(3)})`)
    halo.addColorStop(1, 'rgba(167,139,250,0)')
    ctx.fillStyle = halo
    ctx.fillRect(0, 0, w, groundY)
  }

  // Grain — a faint speckle over the sky so the gradient doesn't band.
  if (m.grain) {
    ctx.save()
    ctx.globalAlpha = 0.5
    ctx.fillStyle = ctx.createPattern(m.grain, 'repeat')
    ctx.fillRect(0, 0, w, groundY)
    ctx.restore()
  }

  // buildings
  for (const b of m.buildings) {
    ctx.fillStyle = `rgba(${Math.round(12 + b.tone * 90)}, ${Math.round(10 + b.tone * 70)}, ${Math.round(22 + b.tone * 110)}, 1)`
    ctx.fillRect(b.x, b.y, b.w, b.h)
    ctx.fillStyle = `rgba(255,255,255,${0.02 + p * 0.03})` // roofline catch-light
    ctx.fillRect(b.x, b.y, b.w, 1.5)
  }

  // windows — lit fraction tracks progress
  const litCount = Math.floor(m.windows.length * p)
  for (let i = 0; i < m.windows.length; i++) {
    const win = m.windows[i]
    const lit = i < litCount
    if (!lit) {
      ctx.fillStyle = 'rgba(255,255,255,0.030)'
      ctx.fillRect(win.x, win.y, win.w, win.h)
      continue
    }
    let a = 0.9
    if (win.flick && !reduced) a = 0.55 + 0.45 * Math.abs(Math.sin(t * 0.006 + win.phase))
    // Warm gold or violet — the two house hues. No cool blue: it was a third
    // family that made the scene read as generic sci-fi rather than ours.
    ctx.fillStyle = win.warm ? `rgba(255, 206, 130, ${a})` : `rgba(196, 181, 253, ${a * 0.85})`
    ctx.fillRect(win.x, win.y, win.w, win.h)
    ctx.fillStyle = win.warm ? `rgba(255, 190, 90, ${a * 0.16})` : `rgba(167, 139, 250, ${a * 0.16})`
    ctx.fillRect(win.x - 3, win.y - 3, win.w + 6, win.h + 6)
  }

  // ground
  ctx.fillStyle = `rgb(${6 + p * 12}, ${6 + p * 8}, ${12 + p * 14})`
  ctx.fillRect(0, groundY, w, h - groundY)
  ctx.fillStyle = `rgba(255,255,255,${0.04 + p * 0.06})`
  ctx.fillRect(0, groundY, w, 1)

  // The place the district is named for. Scaled up from h/190 — this is the
  // thing the district IS, so it should own the frame rather than sit in it.
  if (m.landmark) {
    const liftMul = (m.landmark.lift || 1) * (m.centerpiece ? 1.3 : 1)
    drawLandmark(ctx, m.landmark.type, {
      cx: w / 2, gy: groundY, s: (h / 158) * liftMul, w, h, p, t, reduced,
      clock: m.landmark.clock, variant: m.landmark.variant, wardId: m.wardId,
      shopKind: m.landmark.shopKind,
    })
  }

  // streetlights
  const lampsOn = Math.floor(m.lamps.length * p)
  for (let i = 0; i < m.lamps.length; i++) {
    const l = m.lamps[i]
    const on = i < lampsOn
    ctx.fillStyle = on ? 'rgba(255,214,150,0.85)' : 'rgba(255,255,255,0.10)'
    ctx.fillRect(l.x - 1, groundY - 24, 2, 24)
    ctx.beginPath()
    ctx.arc(l.x, groundY - 26, on ? 3.2 : 2.2, 0, Math.PI * 2)
    ctx.fill()
    if (on) {
      const cone = ctx.createRadialGradient(l.x, groundY - 26, 0, l.x, groundY - 26, 46)
      cone.addColorStop(0, 'rgba(255,206,130,0.30)')
      cone.addColorStop(1, 'rgba(255,206,130,0)')
      ctx.fillStyle = cone
      ctx.fillRect(l.x - 46, groundY - 72, 92, 92)
      // wet-street reflection
      ctx.fillStyle = 'rgba(255,206,130,0.10)'
      ctx.fillRect(l.x - 5, groundY, 10, (h - groundY) * 0.7)
    }
  }

  // what you keep here — after the streetlights so the props read as lit by
  // them, before the rain so the weather still falls in front of everything
  drawProps(ctx, m, props, p, t, reduced)

  // rain — heavy while the district is dead, clears as it comes back
  drawWeather(ctx, m, p, t, reduced)
  drawLife(ctx, m, p, t, reduced)
  drawForeground(ctx, m, p)
}

/** Whatever is falling — or not. Always thins as the district comes back. */
function drawWeather(ctx, m, p, t, reduced) {
  const { w, h, groundY, weather } = m
  const clear = 1 - p * 0.85          // how much weather is left

  // Stars only where the sky is actually clear, and they brighten with the
  // district: the sky itself is part of the restoration.
  if (weather === 'clear' || weather === 'snow') {
    for (const s of m.stars) {
      const tw = reduced ? 0.7 : 0.45 + 0.55 * Math.abs(Math.sin(t * 0.001 + s.x * 20))
      ctx.fillStyle = `rgba(214,205,255,${(0.10 + p * 0.5) * tw * (0.4 + s.r * 0.6)})`
      ctx.fillRect(s.x, s.y, 1.1, 1.1)
    }
  }

  if (weather === 'overcast') {
    // Just gloomy — heavier, flatter bands than fog and nothing falling. The
    // "nothing's wrong, it's just a grey day" option the palette was missing.
    for (let i = 0; i < 3; i++) {
      const y = groundY - i * (h * 0.1) - h * 0.05
      const g = ctx.createLinearGradient(0, y - h * 0.08, 0, y + h * 0.05)
      g.addColorStop(0, 'rgba(150,142,190,0)')
      g.addColorStop(0.5, `rgba(150,142,190,${((0.14 - i * 0.02) * clear).toFixed(3)})`)
      g.addColorStop(1, 'rgba(150,142,190,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, y - h * 0.08, w, h * 0.13)
    }
    return
  }

  if (weather === 'gale') {
    // Wind-blown flecks tumbling sideways — reuses the rain particle array so
    // it's free, but drawn as short rotating strokes instead of vertical rain.
    const n = Math.max(0, Math.round(m.rain.length * clear))
    ctx.fillStyle = `rgba(214,205,255,${(0.35 * clear).toFixed(3)})`
    for (const d of m.rain.slice(0, n)) {
      const x = reduced ? d.x : (d.x + (t / 1000) * d.sp * 0.9) % (w + 20) - 10
      const y = d.y + Math.sin((x + d.off * 100) * 0.03) * 6
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(reduced ? 0.4 : Math.sin(t * 0.004 + d.off * 6) * 0.6)
      ctx.fillRect(-d.len * 0.4, -0.6, d.len * 0.8, 1.2)
      ctx.restore()
    }
    return
  }

  if (weather === 'fog') {
    // Fog lifts rather than falls — bands thin and rise off the ground.
    for (let i = 0; i < 4; i++) {
      const y = groundY - i * (h * 0.07) - h * 0.02
      const drift = reduced ? 0 : Math.sin(t * 0.0003 + i) * w * 0.06
      const g = ctx.createLinearGradient(0, y - h * 0.06, 0, y + h * 0.03)
      g.addColorStop(0, 'rgba(188,180,225,0)')
      g.addColorStop(0.5, `rgba(188,180,225,${(0.10 - i * 0.015) * clear})`)
      g.addColorStop(1, 'rgba(188,180,225,0)')
      ctx.fillStyle = g
      ctx.fillRect(drift - w * 0.1, y - h * 0.06, w * 1.2, h * 0.09)
    }
    return
  }

  if (weather === 'snow') {
    const n = Math.max(0, Math.round(m.rain.length * clear))
    for (const d of m.rain.slice(0, n)) {
      const y = reduced ? d.y : (d.y + ((t / 1000) * d.sp * 0.22)) % h
      const x = reduced ? d.x : d.x + Math.sin((y + d.off * 100) * 0.05) * 4
      ctx.fillStyle = `rgba(226,222,250,${0.5 * clear})`
      ctx.beginPath(); ctx.arc(x, y, d.r, 0, Math.PI * 2); ctx.fill()
    }
    return
  }

  if (weather === 'clear') return

  const alpha = (weather === 'drizzle' ? 0.13 : 0.22) * clear
  const n = Math.max(0, Math.round(m.rain.length * clear))
  if (alpha <= 0.01 || !n) return
  ctx.strokeStyle = `rgba(198,190,235,${alpha})`
  ctx.lineWidth = 1
  ctx.beginPath()
  for (const d of m.rain.slice(0, n)) {
    const y = reduced ? d.y : (d.y + ((t / 1000) * d.sp)) % h
    const len = weather === 'drizzle' ? d.len * 0.55 : d.len
    ctx.moveTo(d.x, y)
    ctx.lineTo(d.x - 2, y + len)
  }
  ctx.stroke()
}

// Birds fly in calm weather, not through a storm — and since rain/snow/fog/
// gale are the more common states, this is also what stops every single
// restored card from showing the exact same bird animation. A rainy Mono
// Ward district reads as quiet; a clear Golden Ward one reads as alive.
const BIRD_WEATHER = new Set(['clear', 'overcast', 'drizzle'])

/** Small signs that someone lives here. Only once the place is mostly back. */
function drawLife(ctx, m, p, t, reduced) {
  if (p < 0.62 || !BIRD_WEATHER.has(m.weather)) return
  const { w, groundY } = m
  const a = Math.min(1, (p - 0.62) / 0.3)
  ctx.strokeStyle = `rgba(226,220,255,${0.5 * a})`
  ctx.lineWidth = 1.1
  for (const b of m.birds) {
    const drift = reduced ? 0 : (((t * 0.012 * b.sp) + b.ph * 40) % (w * 1.4)) - w * 0.2
    const x = (b.x * w + drift) % (w * 1.2) - w * 0.1
    const y = b.y * groundY
    const flap = reduced ? 2 : 1.4 + Math.abs(Math.sin(t * 0.004 * b.sp + b.x * 10 + b.ph)) * 1.6
    const s = 2.6 * b.s
    ctx.beginPath()
    ctx.moveTo(x - s, y); ctx.lineTo(x, y - flap); ctx.lineTo(x + s, y)
    ctx.stroke()
  }
}

/** One near-camera prop so the scene isn't all on a single plane. */
function drawForeground(ctx, m, p) {
  const { w, h, groundY, fg } = m
  if (!fg || fg.kind === 'none') return
  const y = h - 1
  const x = fg.flip ? w - fg.x * w : fg.x * w
  ctx.fillStyle = '#050409'          // darker than anything behind it

  if (fg.kind === 'fence') {
    const top = groundY + (h - groundY) * 0.42
    for (let i = -1; i < 9; i++) {
      const fx = x + i * (w * 0.075)
      if (fx < -4 || fx > w + 4) continue
      ctx.fillRect(fx, top, 2.2, y - top)
    }
    ctx.fillRect(0, top + 2, w, 2)
  } else if (fg.kind === 'lamp') {
    const top = groundY + (h - groundY) * 0.05
    ctx.fillRect(x - 1.6, top, 3.2, y - top)
    ctx.beginPath(); ctx.arc(x, top + 2, 4.2, 0, Math.PI * 2); ctx.fill()
    if (p > 0.4) {
      const g = ctx.createRadialGradient(x, top + 2, 0, x, top + 2, 26)
      g.addColorStop(0, `rgba(255,206,130,${0.22 * p})`)
      g.addColorStop(1, 'rgba(255,206,130,0)')
      ctx.fillStyle = g
      ctx.fillRect(x - 26, top - 24, 52, 52)
    }
  } else if (fg.kind === 'bench') {
    const top = groundY + (h - groundY) * 0.62
    ctx.fillRect(x - 13, top, 26, 2.6)
    ctx.fillRect(x - 13, top - 6, 26, 2)
    ctx.fillRect(x - 11, top + 2, 2, 6)
    ctx.fillRect(x + 9, top + 2, 2, 6)
  } else if (fg.kind === 'railing') {
    const top = groundY + (h - groundY) * 0.5
    ctx.fillRect(0, top, w, 2)
    ctx.fillRect(0, top + 5, w, 1.4)
    for (let i = 0; i < 10; i++) ctx.fillRect(i * (w / 9), top, 2, y - top)
  } else if (fg.kind === 'ropes') {
    // mooring posts with rope slung between them — reads as waterfront
    const top = groundY + (h - groundY) * 0.5
    const n = 4, gap = w / (n - 1)
    for (let i = 0; i < n; i++) ctx.fillRect(i * gap - 2, top, 4.5, y - top)
    ctx.strokeStyle = '#050409'
    ctx.lineWidth = 1.8
    for (let i = 0; i < n - 1; i++) {
      ctx.beginPath()
      ctx.moveTo(i * gap, top + 2)
      ctx.quadraticCurveTo(i * gap + gap / 2, top + 9, (i + 1) * gap, top + 2)
      ctx.stroke()
    }
  } else if (fg.kind === 'lantern') {
    // stone path markers — the temple approach
    const top = groundY + (h - groundY) * 0.55
    for (const o of [-1, 1]) {
      const lx = w / 2 + o * w * 0.34
      ctx.fillRect(lx - 3, top, 6, y - top)
      ctx.fillRect(lx - 5.5, top - 5, 11, 5)
      if (p > 0.5) {
        ctx.fillStyle = 'rgba(255,206,130,0.85)'
        ctx.fillRect(lx - 2.5, top - 4, 5, 3.5)
        ctx.fillStyle = '#050409'
      }
    }
  } else if (fg.kind === 'bicycle') {
    const top = groundY + (h - groundY) * 0.52
    ctx.beginPath(); ctx.arc(x - 7, top + 6, 5.4, 0, Math.PI * 2)
    ctx.arc(x + 8, top + 6, 5.4, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#0d0a18'
    ctx.beginPath(); ctx.arc(x - 7, top + 6, 3.2, 0, Math.PI * 2)
    ctx.arc(x + 8, top + 6, 3.2, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#050409'
    ctx.fillRect(x - 7, top, 15, 2)
    ctx.fillRect(x - 2, top - 4, 2, 8)
    ctx.fillRect(x + 6, top - 5, 2, 8)
  } else if (fg.kind === 'crates') {
    const top = groundY + (h - groundY) * 0.52
    ctx.fillRect(x - 12, top, 13, 13)
    ctx.fillRect(x + 3, top + 4, 10, 9)
    ctx.fillStyle = '#0d0a18'
    ctx.fillRect(x - 12, top + 5, 13, 1.6)
    ctx.fillRect(x + 3, top + 8, 10, 1.4)
  }
}

/** Mount a live scene into a container. Returns a cleanup function.
 *  `getItems` supplies whatever is kept in this district — pass it and the
 *  things you own stand in the street. */
export function mountScene(container, districtId, getProgress, getCharge = () => 0, name = '', getItems = () => [], opts = {}) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const canvas = document.createElement('canvas')
  canvas.className = 'district-canvas'
  container.innerHTML = ''
  container.appendChild(canvas)
  const ctx = canvas.getContext('2d')

  let model = null
  let raf = null
  let shown = 0            // eased progress, so gains animate in
  let props = []
  let laidOutFor = null    // the item set the current layout was built from

  function size() {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = container.clientWidth || 320
    const h = Math.round(Math.min(220, Math.max(150, w * 0.52)))
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    model = buildModel(districtId, w, h, name, opts)
    laidOutFor = null      // positions are model-relative — redo them
  }

  function frame(t) {
    const target = getProgress()
    shown += (target - shown) * 0.04          // ease toward real progress
    if (Math.abs(target - shown) < 0.002) shown = target

    // Placing something should show up straight away, so the item set is
    // re-checked each frame and only re-laid-out when it actually changed.
    const items = getItems() || []
    const key = propsKey(items)
    if (key !== laidOutFor) { props = layoutProps(items, model); laidOutFor = key }

    renderScene(ctx, model, shown, t, reduced, getCharge(), props)
    raf = requestAnimationFrame(frame)
  }

  size()
  const onResize = () => size()
  window.addEventListener('resize', onResize)
  raf = requestAnimationFrame(frame)

  // The scene keeps rendering at 60fps even while scrolled off-screen —
  // pause the rAF loop when the canvas isn't visible and resume on return.
  let io = null
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        if (raf === null) raf = requestAnimationFrame(frame)
      } else if (raf !== null) {
        cancelAnimationFrame(raf)
        raf = null
      }
    })
    io.observe(canvas)
  }

  return () => {
    if (raf !== null) cancelAnimationFrame(raf)
    window.removeEventListener('resize', onResize)
    if (io) io.disconnect()
  }
}
