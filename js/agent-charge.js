// Personal Charge — BOTZ redesign Phase 3. Each agent's own ARMY Bomb
// charge, fed by Charge Cells or by lighting up a whole era's tracks in a
// week. Replaces the old shared "network power" reading for what actually
// keeps a restored district alive; the world screen's ARMY Bomb core widget
// still shows the network-wide visual (Red Zone etc.), this is the new,
// separate personal stat.

import { call } from './api.js'
import { el, esc, toast, hideOverlay, showOverlay } from './state.js'
import { getAgentNo } from './session.js'

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

  const status = el('div', 'ac-status' + (ac.isDark ? ' dark' : ''))
  // --fuel scales the ember animation below — a fresh feed reads as a real
  // flare-up, a bomb that's been running low reads as a dying fire, same
  // "intensity follows real state" rule the ARMY Bomb sphere already uses
  // (screen-world.js's --charge). 48h is a generous ceiling (12 Charge
  // Cells) so a single feed still visibly brightens it, not maxes it out.
  status.style.setProperty('--fuel', Math.max(0, Math.min(1, ac.hoursRemaining / 48)).toFixed(3))
  status.innerHTML = `
    <div class="ac-embers" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
    <div class="ac-hours">${fmtHours(ac.hoursRemaining)}</div>
    <div class="ac-label">${ac.isDark ? 'DARK — feed it before it costs you a district' : 'charged'}</div>
  `
  body.appendChild(status)

  if (ac.isDark) {
    body.appendChild(el('p', 'muted ac-warn',
      '7 days dark and your active district lapses back to available. 14 days and every restored district reverts — your XP stays banked either way.'))
  }

  const feedCard = el('div', 'ms-card')
  feedCard.innerHTML = `
    <div class="ms-card-head"><span class="ms-card-icon">⚡</span><span class="ms-card-title">Feed the Bomb</span></div>
    <p class="ms-card-body">You have ${ac.chargeCells} Charge Cell${ac.chargeCells === 1 ? '' : 's'}. Each one buys 4 hours.</p>
  `
  const feedBtn = el('button', 'btn btn-primary', 'Feed 1 Charge Cell')
  feedBtn.disabled = ac.chargeCells < 1
  feedBtn.onclick = async () => {
    feedBtn.disabled = true
    const res = await call('feedCharge', { agentNo: getAgentNo(), cells: 1 })
    if (!res.success) { toast(res.error || "Couldn't feed it"); feedBtn.disabled = false; return }
    toast('+4h charge')
    // Like tossing another log on — a brief flare on the status card before
    // the numbers themselves update, not just a toast.
    status.classList.add('feeding')
    setTimeout(() => loadAndPaint(body), 260)
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
