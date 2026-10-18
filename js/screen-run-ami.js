// RUN AMI — LAST CARD: the Game Room screen.
//
// Three phases, all decided by the server (runAmiState):
//   entry  — not in a room: Bomb status, Create Room, Join by code
//   lobby  — waiting room: code, seats, host's Start
//   match  — the table (run-ami-table.js)
//
// The browser keeps nothing authoritative. A refresh, a dropped connection
// or a second device all recover the same way: ask the server, which finds
// the agent's seat from their session. localStorage is not used.
//
// Updates: a Realtime nudge ({r, v} version numbers, run-ami-realtime.js)
// triggers a fetch of this seat's own view. While Realtime is not live —
// including while it is disabled — the screen polls every 4s whenever a
// lobby or match is open and the tab is visible. With Realtime live it
// still refreshes every 15s so connection states stay current.
//
// Actions carry a UUID. A network failure retries with the SAME UUID, so a
// request that actually landed is never applied twice.
//
// Connection: every request has a time limit. After two failed reads in a
// row, a read unanswered for 8s, or the browser reporting itself offline, a
// banner says the game is
// reconnecting — never that the player is disconnected, which only the
// server decides — and reads retry every 2s until one lands.
//
// In the background the screen keeps a slow heartbeat (every 10s) so
// switching tabs on a computer doesn't run down the 90s disconnect grace.
// Phones usually freeze background pages entirely; on return the screen
// refreshes at once (visibilitychange, pageshow, focus, online).

import { el, esc, showOverlay, hideOverlay } from './state.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'
import { goSettings } from './router.js'
import { openHowToPlay } from './run-ami-help.js'
import { armyBombCharge } from './army-bomb.js'
import { COLORS, COLOR_ORDER, errorText, isWildKind } from './run-ami-cards.js'
import { createTable } from './run-ami-table.js'
import { entryView, lobbyView } from './run-ami-rooms.js'
import { realtimeAvailable, subscribeRoom } from './run-ami-realtime.js'

const POLL_MS = 4_000
const RETRY_MS = 2_000
const HIDDEN_MS = 10_000
const LIVE_REFRESH_MS = 15_000
const REQUEST_TIMEOUT_MS = 12_000
const SLOW_MS = 8_000
const NETWORK_ERROR = 'Network error — check your connection'

let root = null
let body = null
let net = null
let view = null
let table = null
let rt = null
let rtTopic = null
let lastFetch = 0
let inFlight = null
let dirty = false
let ticker = null
let gameState = null
let readSeq = 0
let appliedSeq = 0
let failures = 0
let finaleTimer = null
let finaleShown = null

const say = errorText
const isNetworkError = (res) => res?.success === false && !res.view && /network/i.test(res.error || '')

/** call() with a time limit. A request that hangs is reported as a network
 *  error, so a stuck connection can't freeze polling. */
function timedCall(action, params) {
  let timer = null
  return Promise.race([
    call(action, params),
    new Promise((resolve) => { timer = setTimeout(() => resolve({ success: false, error: NETWORK_ERROR }), REQUEST_TIMEOUT_MS) }),
  ]).finally(() => clearTimeout(timer))
}

const NET_TEXT = {
  reconnecting: 'Connection lost — reconnecting…',
  offline: 'You’re offline. The game will reconnect when you’re back.',
}

function setNet(state) {
  if (!net) return
  net.hidden = state === 'ok'
  if (state !== 'ok') net.textContent = NET_TEXT[state]
  root?.classList.toggle('is-net-down', state !== 'ok')
}

function noteFailure() {
  failures++
  if (navigator.onLine === false) setNet('offline')
  else if (failures >= 2) setNet('reconnecting')
}

function noteSuccess() {
  failures = 0
  setNet('ok')
}

// What the entry/lobby renderers (run-ami-rooms.js) need from this controller.
const roomCtx = {
  get gameState() { return gameState },
  roomAction: (button, action, params) => roomAction(button, action, params),
}

export function renderRunAmi(container, state) {
  gameState = state
  if (root && root.isConnected && container.contains(root)) {
    if (view?.phase === 'entry') paint()
    return
  }
  teardownRunAmi()
  container.innerHTML = ''
  root = el('div', 'ra-screen')
  net = el('p', 'ra-net')
  net.setAttribute('role', 'status')
  net.setAttribute('aria-live', 'polite')
  net.hidden = true
  body = el('div', 'ra-body')
  root.append(net, body)
  container.appendChild(root)
  body.innerHTML = '<p class="ra-loading">Opening the Game Room…</p>'
  failures = 0
  ticker = setInterval(tick, 1000)
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onVisible)
  window.addEventListener('offline', onOffline)
  window.addEventListener('pageshow', onVisible)
  window.addEventListener('focus', onFocus)
  refresh()
}

/** Called by main.js whenever the screen changes away from RUN AMI. */
export function teardownRunAmi() {
  clearInterval(ticker)
  ticker = null
  clearTimeout(finaleTimer)
  finaleTimer = null
  document.removeEventListener('visibilitychange', onVisible)
  window.removeEventListener('online', onVisible)
  window.removeEventListener('offline', onOffline)
  window.removeEventListener('pageshow', onVisible)
  window.removeEventListener('focus', onFocus)
  rt?.close()
  rt = null
  rtTopic = null
  table?.destroy()
  table = null
  view = null
  root = null
  body = null
  net = null
}

function onVisible() {
  if (!document.hidden && root) refresh()
}

function onFocus() {
  if (root && Date.now() - lastFetch > RETRY_MS) refresh()
}

function onOffline() {
  if (root) setNet('offline')
}

function tick() {
  if (!root?.isConnected) { teardownRunAmi(); return }
  if (!view || view.phase === 'entry') return
  // A read still unanswered after 8s is a connection problem in all but name.
  if (inFlight && !document.hidden && Date.now() - lastFetch > SLOW_MS) setNet(navigator.onLine === false ? 'offline' : 'reconnecting')
  let every = rt?.isLive() ? LIVE_REFRESH_MS : POLL_MS
  if (failures) every = RETRY_MS
  if (document.hidden) every = HIDDEN_MS
  if (Date.now() - lastFetch >= every) refresh()
}

async function refresh() {
  if (inFlight) { dirty = true; return inFlight }
  lastFetch = Date.now()
  const seq = ++readSeq
  inFlight = timedCall('runAmiState', { agentNo: getAgentNo() })
  const res = await inFlight
  inFlight = null
  if (res?.success && res.view) {
    noteSuccess()
    // A slow answer that arrives after a newer one is older news: drop it.
    if (seq > appliedSeq) { appliedSeq = seq; apply(res.view) }
  } else {
    if (isNetworkError(res)) noteFailure()
    if (!view && body) body.innerHTML = `<p class="ra-loading">${esc(say(res?.error))}</p>`
  }
  if (dirty) { dirty = false; refresh() }
}

function syncRealtime() {
  const topic = view?.phase === 'entry' ? null : view?.room?.topic
  if (topic === rtTopic) return
  rt?.close()
  rt = null
  rtTopic = topic
  if (!topic || !realtimeAvailable()) return
  rt = subscribeRoom(topic, (nudge) => {
    if (!view) return
    if (!nudge || nudge.r !== view.room?.version || nudge.v !== view.version) refresh()
  })
}

function apply(next) {
  const prev = view
  view = next
  syncRealtime()
  // Holding the last play on screen: later reads just update `view`, and
  // the room appears with the newest one when the finale is done.
  if (finaleTimer && next.phase !== 'match') return
  if (finaleTimer) { clearTimeout(finaleTimer); finaleTimer = null }

  // The round ended while this table was open (any seat, spectators too):
  // show the final card and the winner first, once per match.
  const result = next.lastResult
  if (table && prev?.phase === 'match' && next.phase !== 'match' && result?.matchId && result.matchId !== finaleShown) {
    finaleShown = result.matchId
    hideOverlay()
    const ms = table.finale(result)
    finaleTimer = setTimeout(() => {
      finaleTimer = null
      if (!root) return
      table?.destroy()
      table = null
      paint()
    }, ms)
    return
  }

  if (next.phase === 'match') {
    if (!table || prev?.phase !== 'match') {
      table?.destroy()
      table = createTable(tableHandlers)
      body.innerHTML = ''
      body.appendChild(table.el)
    }
    table.update(next)
    return
  }
  if (table) { table.destroy(); table = null }
  paint()
}

function paint() {
  if (!body || !view) return
  body.innerHTML = ''
  body.appendChild(view.phase === 'lobby' ? lobbyView(view, roomCtx) : entryView(view, roomCtx))
}

async function roomAction(button, action, params) {
  if (button) button.disabled = true
  const res = await timedCall(action, { agentNo: getAgentNo(), ...params })
  if (button && root) button.disabled = false
  if (isNetworkError(res)) noteFailure()
  else if (res) noteSuccess()
  if (res?.view) apply(res.view)
  if (!res?.success) notice(say(res?.error))
}

function notice(text) {
  if (!body) return
  body.querySelector('.ra-notice')?.remove()
  const n = el('p', 'ra-notice', esc(text))
  n.setAttribute('role', 'status')
  body.firstElementChild?.appendChild(n)
}

/* ── Match actions ──────────────────────────────────────────────────── */

async function act(type, extra = {}) {
  const actionId = crypto.randomUUID()
  table?.setBusy(true)
  let res = null
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await timedCall('runAmiAct', { agentNo: getAgentNo(), type, actionId, ...extra })
    if (!isNetworkError(res)) break
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)))
  }
  table?.setBusy(false)
  if (isNetworkError(res)) {
    // It may still have landed (only the answer was lost). Say so plainly
    // and let the next read show what actually happened.
    noteFailure()
    setNet(navigator.onLine === false ? 'offline' : 'reconnecting')
    table?.flashPrivate('Connection problem — checking your move…')
    refresh()
    return res
  }
  noteSuccess()
  if (res?.view) { appliedSeq = readSeq; apply(res.view) }
  if (!res?.success && res?.error && res.error !== 'stale') table?.flashPrivate(say(res.error))
  if (res?.error === 'stale') refresh()
  return res
}

function chooseColor(onPick) {
  const sheet = el('div', 'sheet ra-sheet ra-color-sheet')
  sheet.appendChild(el('h3', '', 'Choose a colour'))
  const grid = el('div', 'ra-color-grid')
  for (const c of COLOR_ORDER) {
    const b = el('button', `ra-color-pick is-${c}`, `<i aria-hidden="true">${COLORS[c].shape}</i>${esc(COLORS[c].name)}`)
    b.type = 'button'
    b.onclick = () => { hideOverlay(); onPick(c) }
    grid.appendChild(b)
  }
  const cancel = el('button', 'btn btn-ghost', 'Cancel')
  cancel.onclick = hideOverlay
  sheet.append(grid, cancel)
  showOverlay(sheet)
}

function playCard(cardId, card, runAmi) {
  const send = (color) => {
    table?.clearSelection()
    // A registered call shows as the persistent RUN AMI ✓ chip (from the
    // server's view), so no extra note here.
    act('play', { cardId, color, runAmi })
  }
  if (card && isWildKind(card.k)) chooseColor(send)
  else send(undefined)
}

const tableHandlers = {
  onPlay: (cardId, card) => playCard(cardId, card, false),
  onDraw: () => act('draw'),
  onPass: () => act('pass'),
  // With a playable card selected, RUN AMI plays it and calls in the same
  // action. With nothing selected, it is a call on its own — registered by
  // the server only inside the grace window after a 2 → 1 play. Either way
  // the control behaves identically whatever the hand size, so pressing it
  // tells nobody anything.
  onRunAmi: (cardId, card) => {
    if (cardId) { playCard(cardId, card, true); return }
    act('call').then((res) => {
      if (res?.reply?.runAmi !== 'called') table?.flashPrivate('Nothing to call')
    })
  },
  onCatch: () => act('catch').then((res) => {
    if (res?.reply) table?.flashPrivate(res.reply.caught ? 'Caught! +2' : 'Nothing to catch')
  }),
  onExit: () => {
    const sheet = el('div', 'sheet ra-sheet')
    sheet.append(el('h3', '', 'Leave this round?'), el('p', 'muted', 'You will be out of this round. The others play on.'))
    const leave = el('button', 'btn btn-primary', 'Leave round')
    leave.onclick = async () => { hideOverlay(); await roomAction(null, 'runAmiLeaveRoom', {}); goSettings() }
    const stay = el('button', 'btn btn-ghost', 'Keep playing')
    stay.onclick = hideOverlay
    sheet.append(leave, stay)
    showOverlay(sheet)
  },
  onHelp: () => openHowToPlay(),
  onDeadline: () => refresh(),
  bombLabel: () => {
    const c = armyBombCharge(gameState?.agentCharge)
    return c.isDark || c.neverFed ? 'ARMY Bomb · DARK' : 'ARMY Bomb · ACTIVE ⚡'
  },
}
