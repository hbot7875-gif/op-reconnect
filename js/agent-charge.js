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
const CHARGE_CELL_HOURS = 2

function fmtHours(h) {
  if (h <= 0) return '0h'
  const days = Math.floor(h / 24)
  const rem = Math.round(h % 24)
  if (days > 0) return `${days}d ${rem}h`
  return `${Math.round(h)}h`
}

async function loadAndPaint(body, focusEraId = null) {
  body.innerHTML = '<p class="muted">Reading the core…</p>'
  const res = await call('getAgentCharge', { agentNo: getAgentNo() })
  if (!res.success) {
    body.innerHTML = ''
    body.appendChild(el('p', 'muted', "Couldn't read your charge"))
    return
  }
  paint(body, res.charge, focusEraId)
}

function paint(body, ac, focusEraId = null) {
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
    <div class="ac-era-flight" aria-hidden="true"><span>💜</span><b>ERA</b></div>
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
    <p class="ms-card-body ac-feed-copy">You have ${ac.chargeCells} Charge Cell${ac.chargeCells === 1 ? '' : 's'}. Each one adds ${CHARGE_CELL_HOURS} hours.</p>
    ${ac.chargeCellsEarned ? `<p class="dim ac-lifetime-copy">${ac.chargeCellsEarned} earned all-time · ${ac.chargeCellsSpent} fed so far</p>` : ''}
  `
  const feedBtn = el('button', 'btn btn-primary', 'Feed 1 Charge Cell')
  feedBtn.disabled = ac.chargeCells < 1
  feedBtn.onclick = async () => {
    feedBtn.disabled = true
    const res = await call('feedCharge', { agentNo: getAgentNo(), cells: 1 })
    if (!res.success) { toast(res.error || "Couldn't feed it"); feedBtn.disabled = false; return }
    for (const button of body.querySelectorAll('button')) button.disabled = true

    const hoursAdded = Number(res.hoursAdded) || CHARGE_CELL_HOURS
    const nextHours = Math.max(0, (new Date(res.chargedUntil).getTime() - Date.now()) / 3_600_000)
    const land = () => {
      stage.classList.add('has-landed')
      stage.classList.remove('is-dark', 'is-new')
      stage.style.setProperty('--fuel', Math.max(0, Math.min(1, nextHours / 48)).toFixed(3))
      stage.querySelector('.ac-hours').textContent = fmtHours(nextHours)
      stage.querySelector('.ac-label').textContent = 'charged'
      stage.querySelector('.ac-cell-count').textContent = Math.max(0, ac.chargeCells - 1)
      stage.querySelector('.ac-reward').textContent = `+${hoursAdded} HOURS`
      const remainingCells = Math.max(0, ac.chargeCells - 1)
      body.querySelector('.ac-feed-copy').textContent = `You have ${remainingCells} Charge Cell${remainingCells === 1 ? '' : 's'}. Each one adds ${hoursAdded} hours.`
      const lifetimeCopy = body.querySelector('.ac-lifetime-copy')
      if (lifetimeCopy) lifetimeCopy.textContent = `${ac.chargeCellsEarned || 0} earned all-time · ${(ac.chargeCellsSpent || 0) + 1} fed so far`

      // Keep the Pack wallet honest immediately instead of waiting for the
      // next 90-second game-state poll.
      const state = getState()
      if (state?.player) setState({
        ...state,
        player: { ...state.player, chargeCells: Math.max(0, (state.player.chargeCells || 0) - 1) },
        agentCharge: {
          ...(state.agentCharge || {}),
          hoursRemaining: nextHours,
          isDark: false,
          chargeCells: remainingCells,
        },
      })
    }

    if (reducedMotion()) {
      // No motion (translate/scale/rotate all skip here), but the landed
      // state — "charged", the new hour count, the "+N HOURS" reward text —
      // still needs a moment on screen before loadAndPaint below wipes and
      // rebuilds the sheet. Without this pause the whole thing repaints on
      // the very next tick, so nothing ever actually gets painted: the toast
      // ends up being the only feedback a reduced-motion agent ever sees.
      land()
      toast(`+${hoursAdded}h charge`)
      await wait(900)
      await loadAndPaint(body)
      return
    }

    stage.classList.add('is-feeding')
    await wait(720) // Cell reaches the handle: commit the visible state here.
    land()
    toast(`+${hoursAdded}h charge`)
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

  const eraCards = [...(ac.eraCards || [])].sort((a, b) =>
    a.id === focusEraId ? -1 : b.id === focusEraId ? 1 : 0)
  const ready = eraCards.filter((e) => e.status === 'lit').length
  const litCard = el('div', 'ms-card ac-era-inventory')
  litCard.innerHTML = `
    <div class="ms-card-head"><span class="ms-card-icon">🕯️</span><span class="ms-card-title">Weekly Era Cards</span></div>
    <p class="ms-card-body">${ready
      ? `${ready} emergency card${ready === 1 ? '' : 's'} ready. Each adds 10 hours.`
      : "Stream every track in an era this week to activate a +10h card. Cards reset Monday."}</p>
  `
  const rack = el('div', 'ac-era-rack')
  for (const card of eraCards) {
    const item = el('div', `ac-era-card era-${card.status}${card.id === focusEraId ? ' is-focused' : ''}`)
    item.innerHTML = `
      <span class="aec-icon">${card.icon}</span>
      <span class="aec-copy"><b>${esc(card.name)}</b><small>${card.status === 'lit' ? 'LIT · READY'
        : card.status === 'used' ? 'USED · RESETS MONDAY'
        : `${card.done}/${card.total} TRACKS · ${card.remaining} LEFT`}</small></span>
    `
    if (card.status === 'lit') {
      const use = el('button', 'aec-use', 'USE +10H')
      use.type = 'button'
      use.onclick = async () => {
        use.disabled = true
        const res = await call('useLitEra', { agentNo: getAgentNo(), eraId: card.id })
        if (!res.success) { toast(res.error === 'era_card_not_ready' ? 'That Era Card is no longer ready' : (res.error || "Couldn't use that card")); use.disabled = false; return }
        for (const button of body.querySelectorAll('button')) button.disabled = true

        const nextHours = Math.max(0, (new Date(res.chargedUntil).getTime() - Date.now()) / 3_600_000)
        const flight = stage.querySelector('.ac-era-flight')
        flight.querySelector('span').textContent = card.icon
        flight.querySelector('b').textContent = card.name
        item.classList.add('is-spending')

        const landEra = () => {
          stage.classList.add('has-landed')
          stage.classList.remove('is-dark', 'is-new')
          stage.style.setProperty('--fuel', Math.max(0, Math.min(1, nextHours / 48)).toFixed(3))
          stage.querySelector('.ac-hours').textContent = fmtHours(nextHours)
          stage.querySelector('.ac-label').textContent = 'charged'
          stage.querySelector('.ac-reward').textContent = '+10 HOURS'
          item.classList.remove('era-lit', 'is-spending')
          item.classList.add('era-used')
          item.querySelector('small').textContent = 'USED · RESETS MONDAY'
          use.remove()

          const state = getState()
          if (state?.agentCharge) setState({
            ...state,
            agentCharge: {
              ...state.agentCharge,
              hoursRemaining: nextHours,
              isDark: false,
              litEras: (state.agentCharge.litEras || []).filter((id) => id !== card.id),
              eraCards: (state.agentCharge.eraCards || []).map((e) => e.id === card.id ? { ...e, status: 'used' } : e),
            },
          })
        }

        if (reducedMotion()) {
          landEra()
          toast(`${card.name} powered the Bomb · +10h`)
          await loadAndPaint(body)
          return
        }

        stage.classList.add('is-era-feeding')
        await wait(760)
        landEra()
        toast(`${card.name} powered the Bomb · +10h`)
        await wait(720)
        await loadAndPaint(body)
      }
      item.appendChild(use)
    }
    rack.appendChild(item)
  }
  litCard.appendChild(rack)
  if (focusEraId) body.insertBefore(litCard, feedCard)
  else body.appendChild(litCard)
}

export function agentChargeSheet(focusEraId = null) {
  const sheet = el('div', 'sheet agent-charge')
  sheet.appendChild(el('div', 'eyebrow', '⚡ PERSONAL CHARGE'))
  const body = el('div', 'ac-body')
  sheet.appendChild(body)
  loadAndPaint(body, focusEraId)

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

export function openAgentCharge() {
  showOverlay(agentChargeSheet())
}
