// The restoration moment.
//
// This is the payoff for a day (or three) of streaming, so it gets a real
// sequence instead of a toast: the district's own scene relights in front of
// you, the power comes back in stages, the signal runs home to the ARMY Bomb,
// and only then does the guardian's memory open.
//
// Every beat is a thing that actually happened — lights, streetlights, the
// signal reaching the core — so the ceremony is describing real progress
// rather than decorating a number. Tap anywhere to skip to the end; nobody
// should be held hostage by an animation they've seen forty times.

import { el, esc, showOverlay, joinNames } from './state.js'
import { mountScene } from './scene.js'
import { openShare } from './share.js'
import { itemArt, RARITY, itemsAt } from './items.js'
import { wardDisplayName } from './ward-tiles.js'

const REDUCED = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const buzz = (pattern) => { try { navigator.vibrate?.(pattern) } catch {} }

/**
 * @param d      the restored district (state.activeDistrict)
 * @param ward   its ward from state.map.wards, if known
 * @param state  full game state — used for the bomb reading only
 * @param onDone called when the player dismisses it
 */
export function playRestoration(d, ward, state, onDone) {
  const overlay = document.getElementById('overlay')
  const reduced = REDUCED()
  const wardWhole = !!ward && ward.totalCount > 0 && ward.restoredCount >= ward.totalCount

  overlay.innerHTML = ''
  overlay.hidden = false
  const cel = el('div', 'cel' + (wardWhole ? ' is-ward' : ''))

  // ── the place, relighting ──
  const stage = el('div', 'cel-stage')
  const canvasBox = el('div', 'cel-canvas')
  stage.appendChild(canvasBox)
  stage.appendChild(el('div', 'cel-sparks'))
  cel.appendChild(stage)

  const body = el('div', 'cel-body')
  body.appendChild(el('div', 'cel-eyebrow', 'RESTORATION SEQUENCE'))
  const title = el('div', 'cel-title', esc(d.name))
  body.appendChild(title)

  const beatBox = el('div', 'cel-beats')
  const BEATS = [
    ['💡', 'Power restored'],
    ['🏮', 'Street lights on'],
    ['📡', 'Signal routed to the ARMY Bomb'],
  ]
  const beatNodes = BEATS.map(([icon, label]) => {
    const b = el('div', 'cel-beat', `<span class="cb-i">${icon}</span><span class="cb-l">${esc(label)}</span><span class="cb-ok">✓</span>`)
    beatBox.appendChild(b)
    return b
  })
  body.appendChild(beatBox)

  const banner = el('div', 'cel-banner', wardWhole
    ? `<span class="cel-flag">${esc(wardDisplayName(ward))} is whole</span>`
    : '<span class="cel-flag">District restored</span>')
  body.appendChild(banner)

  body.appendChild(rewards(d, state))

  // The drop. This is the reward people actually came for, so it gets its own
  // beat rather than a line in a list.
  const drop = d.itemDropped
  if (drop) {
    const r = RARITY[drop.rarity] || RARITY.common
    const box = el('div', `cel-drop ${r.cls}`)
    box.innerHTML = `
      <div class="cd-label">You found something</div>
      <div class="cd-art">${itemArt(drop)}</div>
      <div class="cd-name">${esc(drop.name)}</div>
      <div class="cd-rarity">${esc(r.label)}</div>
      ${drop.blurb ? `<div class="cd-blurb">${esc(drop.blurb)}</div>` : ''}
      <div class="cd-where">It's in your Pack — keep it anywhere you've restored.</div>
    `
    body.appendChild(box)
  }

  const reveal = el('div', 'cel-reveal')
  if (d.echoOf) reveal.appendChild(el('div', 'cel-guardian', `<span>👤 Guardian</span><b>${esc(d.echoOf)}</b>`))
  if (d.memory) reveal.appendChild(el('div', 'file-body', esc(d.memory)))
  // Echo Quarter lights up four at once (one per season-one team) — see
  // joinNames in screen-ward.js's ward-foot line for the same pattern.
  if (wardWhole && ward.centerpieces?.length) {
    const names = joinNames(ward.centerpieces.map((c) => c.name))
    const verb = ward.centerpieces.length > 1 ? 'are' : 'is'
    reveal.appendChild(el('div', 'cel-centerpiece', `${esc(names)} ${verb} awake`))
  }
  // Peak moment, so the share sits right here rather than three taps away.
  const actions = el('div', 'cel-actions')
  const share = el('button', 'btn btn-ghost cel-share', '📤 Share this')
  share.onclick = () => showOverlay(openShare(state))
  const close = el('button', 'btn btn-primary cel-go', 'Nice')
  close.onclick = () => { overlay.hidden = true; overlay.innerHTML = ''; onDone?.() }
  actions.append(share, close)
  reveal.appendChild(actions)
  body.appendChild(reveal)

  cel.appendChild(body)
  overlay.appendChild(cel)

  // The scene ramps from wherever it was to fully lit.
  let shown = 0.05
  // Whatever is already kept here relights along with the place.
  const teardown = mountScene(canvasBox, d.id, () => shown, () => state?.bomb?.charge || 0, d.name,
    () => itemsAt(state, d.id),
    { wardId: d.wardId, centerpiece: d.status === 'centerpiece_dark' || d.status === 'centerpiece_lit' })

  /* ── the sequence ── */
  const timers = []
  const at = (ms, fn) => timers.push(setTimeout(fn, reduced ? Math.min(ms, 120) : ms))
  let ramp = null

  const lightUp = () => {
    if (reduced) { shown = 1; return }
    const t0 = performance.now()
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 1700)
      shown = 0.05 + 0.95 * (1 - Math.pow(1 - k, 3))
      if (k < 1) ramp = requestAnimationFrame(tick)
    }
    ramp = requestAnimationFrame(tick)
  }

  at(250, lightUp)
  at(700, () => { beatNodes[0].classList.add('on'); buzz(18) })
  at(1500, () => { beatNodes[1].classList.add('on'); buzz(18) })
  at(2300, () => {
    beatNodes[2].classList.add('on')
    cel.classList.add('signal')
    buzz([24, 40, 24])
  })
  at(3100, () => {
    banner.classList.add('on')
    cel.classList.add('flash')
    if (!reduced) sparks(stage.querySelector('.cel-sparks'), wardWhole ? 26 : 16)
    buzz(wardWhole ? [30, 60, 30, 60, 80] : [40, 60, 40])
  })
  at(3700, () => body.querySelector('.cel-rewards')?.classList.add('on'))
  at(4100, () => body.querySelector('.cel-drop')?.classList.add('on'))
  at(4600, () => reveal.classList.add('on'))

  // Skip: land on the end state immediately.
  const finish = () => {
    for (const t of timers) clearTimeout(t)
    timers.length = 0
    if (ramp) cancelAnimationFrame(ramp)
    shown = 1
    beatNodes.forEach((b) => b.classList.add('on'))
    banner.classList.add('on')
    body.querySelector('.cel-rewards')?.classList.add('on')
    body.querySelector('.cel-drop')?.classList.add('on')
    reveal.classList.add('on')
    cel.classList.add('signal')
  }
  stage.onclick = finish
  body.onclick = (e) => { if (e.target === body || e.target.closest('.cel-beats')) finish() }

  // The overlay owns the canvas; stop the loop when it goes away.
  const observer = new MutationObserver(() => {
    if (overlay.hidden || !overlay.contains(cel)) { teardown?.(); observer.disconnect() }
  })
  observer.observe(overlay, { childList: true, attributes: true, attributeFilter: ['hidden'] })
}

/* ── what you earned ── */

function rewards(d, state) {
  const box = el('div', 'cel-rewards')
  const rows = []

  // Only ever show numbers the server actually sent.
  if (Number.isFinite(d.xpAwarded)) rows.push(['⚡', `+${d.xpAwarded} XP`])
  else if (Number.isFinite(d.rewardXp)) rows.push(['⚡', `+${d.rewardXp} XP`])

  const streams = countStreams(d)
  if (streams > 0) rows.push(['🎧', `${streams.toLocaleString()} streams routed`])

  const charge = state?.bomb?.charge
  if (Number.isFinite(charge)) rows.push(['🔋', `ARMY Bomb at ${Math.round(charge * 100)}%`])

  if (!rows.length) return box
  for (const [icon, label] of rows) {
    box.appendChild(el('div', 'cel-reward', `<span>${icon}</span><span>${esc(label)}</span>`))
  }
  return box
}

function countStreams(d) {
  let n = 0
  for (const g of d.trackGoals || []) n += Math.min(g.progress || 0, g.target || 0)
  return n
}

/* ── sparks ── */

function sparks(host, count) {
  if (!host) return
  for (let i = 0; i < count; i++) {
    const s = document.createElement('i')
    s.className = 'cel-spark' + (i % 3 === 0 ? ' violet' : '')
    s.style.left = (5 + Math.random() * 90).toFixed(1) + '%'
    s.style.animationDelay = (Math.random() * 0.5).toFixed(2) + 's'
    s.style.animationDuration = (1.5 + Math.random() * 1.2).toFixed(2) + 's'
    host.appendChild(s)
    setTimeout(() => s.remove(), 3200)
  }
}
