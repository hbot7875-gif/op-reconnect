// PC Giveaway — recording view (giveaway-wheel.html).
//
//   ?mode=test      Test spin. Picks in the browser with the same equal-odds
//                   rule as the server and saves nothing. Works on the draft
//                   or the frozen list. A small "TEST SPIN" tag shows.
//   ?mode=official  The official draw. Only on a frozen list. SPIN asks the
//                   server to pick (and store) the winner, then the wheel
//                   animates to that stored result. Once drawn, opening this
//                   view shows the stored winner on the stopped wheel and no
//                   SPIN button: a second official draw can't happen.
//
// The admin key comes from the admin page (same storage key as the other
// admin tools). No admin controls are drawn inside the 9:16 frame.
import { API_URL } from './api.js'
import { securePick } from '../supabase/functions/op-reconnect/lib/giveaway-rules.js'
import { TAU, spinDelta, easeOut, sliceColorIndex, indexUnderPointer } from './giveaway-wheel-math.js'

const $ = (id) => document.getElementById(id)
const params = new URLSearchParams(location.search)
const MODE = params.get('mode') === 'official' ? 'official' : 'test'
const GIVEAWAY_ID = params.get('id') || undefined
const COLORS = ['#9a86cf', '#5d4b8c', '#7a63b6'] // lavender, muted purple, soft violet
const R = 980
const SPIN_MS = 7500

let names = []
let angle = 0
let busy = false

function adminKey() { try { return localStorage.getItem('rc_admin_key') || '' } catch { return '' } }

async function call(action, extra = {}) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-region': 'ap-northeast-2' },
    body: JSON.stringify({ action, adminKey: adminKey(), giveawayId: GIVEAWAY_ID, ...extra }),
  })
  return res.json()
}

function notice(html) { $('notice').innerHTML = html; $('notice').classList.add('on') }

function fit() {
  const s = Math.min(innerWidth / 1080, innerHeight / 1920)
  $('stage').style.transform = `scale(${s})`
}

function draw() {
  const ctx = $('wheel').getContext('2d')
  const n = names.length
  const slice = TAU / n
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, 2 * R, 2 * R)
  ctx.translate(R, R)
  ctx.rotate(angle)
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI / 2 + i * slice - slice / 2
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, a0, a0 + slice); ctx.closePath()
    ctx.fillStyle = COLORS[sliceColorIndex(i, n)]; ctx.fill()
    ctx.strokeStyle = 'rgba(18,13,31,.45)'; ctx.lineWidth = 2.5; ctx.stroke()
    ctx.save(); ctx.rotate(a0 + slice / 2)
    ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(18,13,31,.55)'; ctx.shadowBlur = 6
    let fs = 42
    ctx.font = `600 ${fs}px Poppins, system-ui`
    while (ctx.measureText(names[i]).width > R - 190 && fs > 24) { fs--; ctx.font = `600 ${fs}px Poppins, system-ui` }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    ctx.fillText(names[i], R - 44, 0)
    ctx.restore()
  }
}

function spinTo(index) {
  return new Promise((resolve) => {
    const j = new Uint32Array(1); crypto.getRandomValues(j)
    const total = spinDelta(angle, index, names.length, 9, j[0] / 2 ** 32 - 0.5)
    const start = angle
    const t0 = performance.now()
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / SPIN_MS)
      angle = start + total * easeOut(t)
      draw()
      if (t < 1) requestAnimationFrame(frame)
      else setTimeout(resolve, 500)
    }
    requestAnimationFrame(frame)
  })
}

function showWinner(display, withConfetti = true) {
  const w = $('wname')
  w.textContent = `${display} 💜`
  let fs = 72
  w.style.fontSize = `${fs}px`
  while (w.scrollWidth > w.clientWidth && fs > 34) { fs -= 2; w.style.fontSize = `${fs}px` }
  $('card').classList.add('on')
  if (withConfetti) confetti()
}

function confetti() {
  const c = $('fx'); const x = c.getContext('2d')
  const cols = ['#c9b8f2', '#9a86cf', '#7a63b6', '#efe8ff']
  const P = Array.from({ length: 80 }, () => ({
    x: Math.random() * 1080, y: -30 - Math.random() * 600, vx: (Math.random() - 0.5) * 1.6, vy: 2.4 + Math.random() * 2.4,
    r: Math.random() * TAU, vr: (Math.random() - 0.5) * 0.15, w: 8 + Math.random() * 8, h: 5 + Math.random() * 6,
    c: cols[Math.floor(Math.random() * cols.length)],
  }))
  const t0 = performance.now()
  const frame = (now) => {
    x.clearRect(0, 0, 1080, 1920)
    const el = now - t0
    const a = el > 5000 ? Math.max(0, 1 - (el - 5000) / 1500) : 0.85
    for (const p of P) {
      p.x += p.vx; p.y += p.vy; p.r += p.vr
      x.save(); x.globalAlpha = a; x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c
      x.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); x.restore()
    }
    if (el < 6500) requestAnimationFrame(frame)
    else x.clearRect(0, 0, 1080, 1920)
  }
  requestAnimationFrame(frame)
}

/** Stopped wheel with the stored winner under the pointer, no spin. */
function showStored(drawn) {
  angle = -drawn.winner_index * (TAU / names.length)
  draw()
  if (names[indexUnderPointer(angle, names.length)] !== drawn.winner_display) return notice('Stored draw does not match this list.')
  $('spin').hidden = true
  showWinner(drawn.winner_display, false)
}

async function onSpin() {
  if (busy) return
  busy = true
  $('spin').disabled = true
  if (MODE === 'test') {
    const { index } = securePick(names.length)
    await spinTo(index)
    showWinner(names[index])
    return
  }
  // Official: the server picks and stores the winner first.
  let res
  try { res = await call('adminGiveawayDraw') } catch { res = null }
  if (!res || !res.success) {
    // The request may have reached the server even if the answer didn't
    // arrive. Re-read: if a draw is stored, show exactly that.
    const state = await call('adminGiveawayWheel').catch(() => null)
    if (state?.success && state.drawn) { await spinTo(state.drawn.winner_index); return showWinner(state.drawn.winner_display) }
    busy = false; $('spin').disabled = false
    return notice(`The draw did not run (${(res && res.error) || 'network error'}). Nothing was saved. <a href="">Reload</a>`)
  }
  if (names[res.winnerIndex] !== res.winnerDisplay) return notice('Winner does not match the list on screen. Reload this view.')
  await spinTo(res.winnerIndex)
  showWinner(res.winnerDisplay)
}

async function init() {
  addEventListener('resize', fit); fit()
  if (!adminKey()) return notice('Open this view from the giveaway admin page.')
  let state
  try { state = await call('adminGiveawayWheel') } catch { return notice('Could not reach the server. <a href="">Retry</a>') }
  if (!state?.success) {
    if (state?.error === 'Unauthorized') return notice('Admin key rejected. Open this view from the giveaway admin page.')
    if (state?.error === 'unknown_giveaway') return notice('The list has not been prepared yet. Prepare it on the giveaway admin page first.')
    return notice(`Not available: ${state?.error || 'unknown error'}`)
  }
  names = state.names || []
  if (!names.length) return notice('No eligible members on the list yet.')
  $('team').textContent = `TEAM ${state.teamLabel}`
  if (document.fonts?.ready) await document.fonts.ready
  draw()

  if (MODE === 'test') {
    $('testTag').hidden = false
    $('spin').hidden = false
  } else if (state.status === 'drawn' && state.drawn) {
    showStored(state.drawn)
  } else if (state.status === 'frozen') {
    $('spin').hidden = false
  } else {
    return notice('The list is not frozen yet. Freeze it on the admin page before the official draw.')
  }
  $('spin').addEventListener('click', onSpin)
}

init()
