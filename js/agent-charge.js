// Personal Charge — BOTZ redesign Phase 3. Each agent's own ARMY Bomb
// charge, fed by Charge Cells or by lighting up a whole era's tracks in a
// week. Replaces the old shared "network power" reading for what actually
// keeps a restored district alive; the world screen's ARMY Bomb core widget
// still shows the network-wide visual (Red Zone etc.), this is the new,
// separate personal stat.

import { call } from './api.js'
import { el, esc, toast, hideOverlay, showOverlay, getState, setState } from './state.js'
import { getAgentNo } from './session.js'

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function fmtHours(h) {
  if (h <= 0) return '0h'
  const days = Math.floor(h / 24)
  const rem = Math.round(h % 24)
  if (days > 0) return `${days}d ${rem}h`
  return `${Math.round(h)}h`
}

async function loadAndPaint(body) {
  body.innerHTML = '<p class="muted">Reading the core…</p>'
  const res = await call('getAgentCharge', { agentNo: getAgentNo() })
  if (!res.success) {
    body.innerHTML = ''
    body.appendChild(el('p', 'muted', "Couldn't read your charge"))
    return
  }
  paint(body, res.charge)
}

function paint(body, ac) {
  body.innerHTML = ''

  // A brand-new agent who's never fed the Bomb reads as isDark:false with
  // hoursRemaining:0 (agent-charge.ts's charged_until stays null until a
  // first real charge exists to lose) — that combination is otherwise
  // impossible, since isDark flips true the instant real remaining hours
  // hit zero. Used to just say "0h / charged", which reads as broken, not
  // as "you haven't started yet."
  const neverFed = !ac.isDark && ac.hoursRemaining <= 0
  // The charging scene is a physical interaction, not another progress
  // card: a Cell launches from the Pack readout, locks into the handle, and
  // sends a visible energy pulse into the globe. Real remaining hours drive
  // the ambient brightness; the stronger motion only happens after a
  // confirmed manual feed.
  const stage = el('div', 'ac-stage' + (ac.isDark ? ' is-dark' : '') + (neverFed ? ' is-new' : ''))
  stage.style.setProperty('--fuel', Math.max(0, Math.min(1, ac.hoursRemaining / 48)).toFixed(3))
  stage.innerHTML = `
    <div class="ac-stage-stars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
    <div class="ac-bomb-glow" aria-hidden="true"></div>
    <div class="ac-personal-bomb" aria-hidden="true">
      <div class="ac-bomb-sphere">
        <span class="ac-bomb-fill"></span>
        <span class="ac-bomb-shine"></span>
        <span class="ac-bomb-logo">⟭⟬</span>
      </div>
      <div class="ac-bomb-collar"></div>
      <div class="ac-bomb-handle"><span class="ac-handle-energy"></span><i></i></div>
    </div>
    <div class="ac-cell-flight" aria-hidden="true"><span>⚡</span></div>
    <div class="ac-impact-sparks" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
    <div class="ac-reward" role="status" aria-live="polite"></div>
    <div class="ac-readout">
      <div class="ac-hours">${neverFed ? '—' : fmtHours(ac.hoursRemaining)}</div>
      <div class="ac-label">${ac.isDark ? 'DARK — feed it before it costs you a district'
        : neverFed ? 'not yet charged — feed it to start the clock' : 'charged'}</div>
    </div>
    <div class="ac-cell-source"><span>⚡</span><b class="ac-cell-count">${ac.chargeCells}</b><small>Charge Cells</small><em aria-hidden="true">−1</em></div>
  `
  body.appendChild(stage)

  if (ac.isDark) {
    body.appendChild(el('p', 'muted ac-warn',
      '7 days dark and your active district lapses back to available. 14 days and every restored district reverts — your XP stays banked either way.'))
  }

  const feedCard = el('div', 'ms-card')
  feedCard.innerHTML = `
    <div class="ms-card-head"><span class="ms-card-icon">⚡</span><span class="ms-card-title">Feed the Bomb</span></div>
    <p class="ms-card-body ac-feed-copy">You have ${ac.chargeCells} Charge Cell${ac.chargeCells === 1 ? '' : 's'}. Each one buys 4 hours.</p>
  `
  const feedBtn = el('button', 'btn btn-primary', 'Feed 1 Charge Cell')
  feedBtn.disabled = ac.chargeCells < 1
  feedBtn.onclick = async () => {
    feedBtn.disabled = true
    const res = await call('feedCharge', { agentNo: getAgentNo(), cells: 1 })
    if (!res.success) { toast(res.error || "Couldn't feed it"); feedBtn.disabled = false; return }
    for (const button of body.querySelectorAll('button')) button.disabled = true

    const nextHours = Math.max(0, (new Date(res.chargedUntil).getTime() - Date.now()) / 3_600_000)
    const land = () => {
      stage.classList.add('has-landed')
      stage.classList.remove('is-dark', 'is-new')
      stage.style.setProperty('--fuel', Math.max(0, Math.min(1, nextHours / 48)).toFixed(3))
      stage.querySelector('.ac-hours').textContent = fmtHours(nextHours)
      stage.querySelector('.ac-label').textContent = 'charged'
      stage.querySelector('.ac-cell-count').textContent = Math.max(0, ac.chargeCells - 1)
      stage.querySelector('.ac-reward').textContent = '+4 HOURS'
      const remainingCells = Math.max(0, ac.chargeCells - 1)
      body.querySelector('.ac-feed-copy').textContent = `You have ${remainingCells} Charge Cell${remainingCells === 1 ? '' : 's'}. Each one buys 4 hours.`

      // Keep the Pack wallet honest immediately instead of waiting for the
      // next 90-second game-state poll.
      const state = getState()
      if (state?.player) setState({
        ...state,
        player: { ...state.player, chargeCells: Math.max(0, (state.player.chargeCells || 0) - 1) },
      })
    }

    if (reducedMotion()) {
      land()
      toast('+4h charge')
      await loadAndPaint(body)
      return
    }

    stage.classList.add('is-feeding')
    await wait(720) // Cell reaches the handle: commit the visible state here.
    land()
    toast('+4h charge')
    await wait(680) // Let the globe flare and reward text finish before repaint.
    await loadAndPaint(body)
  }
  feedCard.appendChild(feedBtn)
  body.appendChild(feedCard)

  const autoCard = el('div', 'ms-card')
  autoCard.innerHTML = `
    <div class="ms-card-head"><span class="ms-card-icon">🔁</span><span class="ms-card-title">Auto-feed</span></div>
    <p class="ms-card-body">Spends Charge Cells from your Pack automatically the moment it runs dark.</p>
  `
  const autoBtn = el('button', 'btn ' + (ac.autoFeed ? 'btn-primary' : 'btn-ghost'), ac.autoFeed ? 'Auto-feed: ON' : 'Auto-feed: OFF')
  autoBtn.onclick = async () => {
    autoBtn.disabled = true
    const res = await call('setAutoFeed', { agentNo: getAgentNo(), on: !ac.autoFeed })
    autoBtn.disabled = false
    if (!res.success) { toast("Couldn't change that"); return }
    loadAndPaint(body)
  }
  autoCard.appendChild(autoBtn)
  body.appendChild(autoCard)

  const litCard = el('div', 'ms-card')
  litCard.innerHTML = `<div class="ms-card-head"><span class="ms-card-icon">🕯️</span><span class="ms-card-title">Lit-up Eras this week</span></div>`
  if (ac.litEras.length) {
    litCard.appendChild(el('p', 'ms-card-body', `${ac.litEras.length} era${ac.litEras.length === 1 ? '' : 's'} lit — each one already banked +10h charge.`))
  } else {
    litCard.appendChild(el('p', 'ms-card-body', "Stream every track in a whole era this week to light it up for +10h. Doesn't carry over — resets Monday."))
  }
  body.appendChild(litCard)
}

export function agentChargeSheet() {
  const sheet = el('div', 'sheet agent-charge')
  sheet.appendChild(el('div', 'eyebrow', '⚡ PERSONAL CHARGE'))
  const body = el('div', 'ac-body')
  sheet.appendChild(body)
  loadAndPaint(body)

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

export function openAgentCharge() {
  showOverlay(agentChargeSheet())
}
