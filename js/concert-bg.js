// The ARMY bomb ocean — a thin animated strip along the bottom of the
// landing page, on top of the real stadium photo (index.html's
// .crowd-photo). The photo carries the atmosphere now; this canvas's only
// job is the motion the photo can't give on its own — a moving lightstick
// field the way the actual pit looks from above.
//
// Used to be the whole background, full viewport, a few thousand dots
// standing in for the entire arena. A real photo of a real purple ocean
// beats any amount of drawn dots at that job, so the canvas got demoted to
// a foreground detail: short (see .crowd-strip's height), transparent, and
// layered over the photo rather than replacing it.
//
// What still makes it read as ARMY bombs rather than generic particles:
//   · Perspective within the strip. The top of the band reads as slightly
//     farther away, the bottom nearer — same idea as before, compressed
//     into a much smaller space.
//   · The wave. Real bomb syncs move in a slow band across the floor. A
//     travelling brightness wave does more for recognition than any amount
//     of per-dot detail.
//   · Restraint on colour. Purple only, plus a rare dim white — the same
//     two hues reconnect.css itself uses for "in progress." No gold: this
//     project's own rule is gold means restored/lit (reconnect.css's
//     header), and the landing hero's entire premise is that nothing here
//     has been restored yet. A gold lightstick in this scene would be
//     lying about what the player is looking at.
//
// Performance is a first-class concern: this is the first thing a phone
// loads. Count scales to the device, everything is one small canvas, and
// prefers-reduced-motion drops it to a single static frame.

const PURPLE = [167, 139, 250]
const PURPLE_DEEP = [139, 92, 246]
const PURPLE_DIM = [98, 78, 150]
const WHITE = [225, 220, 235]

function pick(rng) {
  // Mostly purple, skewed toward the dimmer tone — a network running on
  // fumes, not a full charge. White stays rare: the occasional phone
  // torch, never bright enough to read as "lit."
  const r = rng()
  if (r < 0.42) return PURPLE_DIM
  if (r < 0.78) return PURPLE
  if (r < 0.95) return PURPLE_DEEP
  return WHITE
}

/** Small deterministic RNG so a reload doesn't reshuffle the whole crowd. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function startConcertBackground(canvas) {
  // alpha: true now — the canvas is a thin transparent overlay on the photo,
  // not an opaque full-screen background painting over it.
  const ctx = canvas.getContext('2d', { alpha: true })
  if (!ctx) return () => {}

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const lowEnd = (navigator.hardwareConcurrency || 4) <= 2

  let w = 0, h = 0, dpr = 1
  let bombs = []
  let raf = 0
  let running = true

  function build() {
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    w = canvas.clientWidth
    h = canvas.clientHeight
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const mobile = w < 768
    // The strip is short (24vh / 16vh mobile — see landing.css), so this is
    // a much smaller area than the old full-viewport version ever covered.
    // Counts tuned to roughly the same per-pixel density as before, not
    // scaled down to match the old absolute totals.
    const target = lowEnd ? 350 : mobile ? 650 : 1150
    const rng = mulberry32(20260802)
    bombs = []

    // No horizon line this time — the whole band is "the pit," close-up.
    // depth still runs 0 (nearest, biggest, brightest, at the BOTTOM edge)
    // to 1 (top of the strip, slightly farther/smaller, fading into the
    // photo above via the mask-image on .crowd-strip) — just so the strip
    // keeps a little of its own sense of depth rather than reading flat.
    for (let i = 0; i < target; i++) {
      const depth = Math.pow(rng(), 0.7)
      const y = h * (1 - Math.pow(depth, 1.15))

      // Wider than the frame so the crowd runs off both edges — an arena
      // has no visible left and right wall from the floor.
      const x = w * (-0.12 + rng() * 1.24)

      bombs.push({
        x, y, depth,
        r: (1 - depth * 0.55) * (mobile ? 2.4 : 3.1) + 0.5,
        color: pick(rng),
        // Per-bomb phase so the crowd never pulses in lockstep — a synced
        // arena still has thousands of slightly-off hands.
        phase: rng() * Math.PI * 2,
        speed: 0.6 + rng() * 0.8,
        sway: rng() * 2 - 1,
      })
    }
    // Far bombs first, so near ones overlap them correctly.
    bombs.sort((a, b) => b.depth - a.depth)
  }

  function drawArena() {
    // Transparent, on purpose — the photo underneath (index.html's
    // .crowd-photo) is the arena now. This canvas only ever adds the
    // lightstick dots on top of it; painting any background here would
    // black out the photo instead of layering over it.
    ctx.clearRect(0, 0, w, h)
  }

  function frame(now) {
    if (!running) return
    const t = now / 1000
    drawArena()

    // The travelling wave: a soft band of extra brightness crossing the
    // arena, the way a real bomb sync rolls through the floor.
    const wavePos = ((t * 0.13) % 1.6) - 0.3

    ctx.globalCompositeOperation = 'lighter'
    for (const b of bombs) {
      const nx = b.x / w
      const dist = Math.abs(nx - wavePos)
      const wave = Math.max(0, 1 - dist * 3.2)

      const breathe = 0.62 + 0.38 * Math.sin(t * b.speed + b.phase)
      const near = 1 - b.depth * 0.72
      // Dim enough to read as embers, not an active crowd — the network is
      // supposed to look broken here, not mid-concert. The wave still
      // passes through as a faint swell you'd only catch on a second look.
      const alpha = Math.min(1, (0.045 + breathe * 0.09 + wave * 0.13) * near)

      // Hands move. A tiny horizontal drift sells "held up by a person"
      // far better than a perfectly static grid would.
      const x = b.x + Math.sin(t * 0.5 + b.phase) * b.sway * (1 - b.depth) * 3.5
      const y = b.y + Math.cos(t * 0.36 + b.phase) * (1 - b.depth) * 1.6

      const [r, g, bl] = b.color
      const glowR = b.r * (3.6 + wave * 2.2)
      const glow = ctx.createRadialGradient(x, y, 0, x, y, glowR)
      glow.addColorStop(0, `rgba(${r},${g},${bl},${alpha * 0.55})`)
      glow.addColorStop(0.4, `rgba(${r},${g},${bl},${alpha * 0.16})`)
      glow.addColorStop(1, `rgba(${r},${g},${bl},0)`)
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(x, y, glowR, 0, Math.PI * 2)
      ctx.fill()

      // The bulb itself — a hot near-white core is what makes a point of
      // light look like a lamp instead of a coloured dot.
      ctx.fillStyle = `rgba(255,255,255,${alpha * 0.85})`
      ctx.beginPath()
      ctx.arc(x, y, b.r * 0.55, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = `rgba(${r},${g},${bl},${alpha})`
      ctx.beginPath()
      ctx.arc(x, y, b.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'

    // Feathers the strip's own bottom edge so the dots fade out rather than
    // ending on a hard line where the page's "below the fold" section
    // begins right underneath.
    const vig = ctx.createLinearGradient(0, h * 0.55, 0, h)
    vig.addColorStop(0, 'rgba(7,6,13,0)')
    vig.addColorStop(1, 'rgba(7,6,13,0.55)')
    ctx.fillStyle = vig
    ctx.fillRect(0, h * 0.55, w, h * 0.45)

    raf = requestAnimationFrame(frame)
  }

  function staticFrame() {
    drawArena()
    ctx.globalCompositeOperation = 'lighter'
    for (const b of bombs) {
      const near = 1 - b.depth * 0.72
      // Matched to the animated version's resting brightness (no wave, no
      // breathe swell) so reduced-motion users see the same dim scene.
      const alpha = Math.min(1, 0.14 * near)
      const [r, g, bl] = b.color
      const glowR = b.r * 3.6
      const glow = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, glowR)
      glow.addColorStop(0, `rgba(${r},${g},${bl},${alpha * 0.5})`)
      glow.addColorStop(1, `rgba(${r},${g},${bl},0)`)
      ctx.fillStyle = glow
      ctx.beginPath(); ctx.arc(b.x, b.y, glowR, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = `rgba(255,255,255,${alpha})`
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.6, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  let resizeTimer = null
  function onResize() {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      build()
      if (reduced) staticFrame()
    }, 180)
  }

  build()
  if (reduced) {
    staticFrame()
  } else {
    raf = requestAnimationFrame(frame)
  }
  window.addEventListener('resize', onResize)

  // A background animation has no business burning battery on a hidden tab.
  function onVisibility() {
    if (document.hidden) {
      running = false
      cancelAnimationFrame(raf)
    } else if (!reduced && !running) {
      running = true
      raf = requestAnimationFrame(frame)
    }
  }
  document.addEventListener('visibilitychange', onVisibility)

  return function stop() {
    running = false
    cancelAnimationFrame(raf)
    window.removeEventListener('resize', onResize)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
