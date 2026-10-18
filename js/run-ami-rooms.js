// RUN AMI — the entry and lobby screens.
//
// Pure rendering for the two non-table phases, moved out of
// screen-run-ami.js unchanged. Each takes the server's view plus `ctx`:
//   ctx.gameState  — the app state, for the agent's real Bomb meter
//   ctx.roomAction — the controller's create/join/start/leave sender

import { el, esc, showOverlay, hideOverlay } from './state.js'
import { goSettings } from './router.js'
import { howToPlayButton } from './run-ami-help.js'
import { armyBombCharge } from './army-bomb.js'
import { openAgentCharge } from './agent-charge.js'
import { badgeThumb } from './badge-art.js'
import { resultLine } from './run-ami-cards.js'

/* ── Bomb status (real Bomb state, no game-only percentage) ─────────── */

function bombBlock(active, ctx) {
  const { frac } = armyBombCharge(ctx.gameState?.agentCharge)
  const box = el('div', `ra-bomb-status ${active ? 'is-active' : 'is-dark'}`)
  box.innerHTML = `
    <div class="ra-bomb-row">
      <span class="ra-bomb-label">ARMY Bomb</span>
      <b>${active ? 'ACTIVE ⚡' : 'DARK'}</b>
    </div>
    <span class="ra-bomb-meter" style="--charge:${active ? frac.toFixed(3) : 0}" aria-hidden="true"><i></i></span>
    <p>${active ? 'Your Bomb powers access to the Game Room.' : 'Recharge your ARMY Bomb to enter RUN AMI.'}</p>`
  if (!active) {
    const recharge = el('button', 'btn btn-primary ra-recharge', 'Recharge ARMY Bomb')
    recharge.type = 'button'
    recharge.onclick = () => openAgentCharge()
    box.appendChild(recharge)
  }
  return box
}

function header(backLabel, onBack) {
  const head = el('header', 'ra-head')
  const back = el('button', 'ra-back', `← ${esc(backLabel)}`)
  back.type = 'button'
  back.onclick = onBack
  head.append(back, el('div', 'ra-brand', '<b>RUN AMI</b><span>LAST CARD</span>'))
  return head
}

/* ── Entry ──────────────────────────────────────────────────────────── */

export function entryView(view, ctx) {
  const wrap = el('div', 'ra-entry')
  wrap.appendChild(header('Settings', () => goSettings()))
  wrap.appendChild(el('p', 'ra-lede', 'A last-card game for agents. 2–4 players, one room code.'))
  wrap.appendChild(howToPlayButton())
  // Dropped from a round that ended while you were away: say how it went.
  if (view.lastResult) wrap.appendChild(resultCard(view.lastResult))
  const active = !!view.me.bombActive
  wrap.appendChild(bombBlock(active, ctx))

  const create = el('button', 'btn btn-primary ra-create', 'Create room')
  create.type = 'button'
  create.disabled = !active
  create.onclick = () => ctx.roomAction(create, 'runAmiCreateRoom', {})

  const form = el('form', 'ra-join')
  form.innerHTML = `
    <label for="raCode">Join with a room code</label>
    <div class="ra-join-row">
      <input id="raCode" name="code" inputmode="text" autocomplete="off" autocapitalize="characters"
        spellcheck="false" maxlength="7" placeholder="AMI7K2" ${active ? '' : 'disabled'}>
      <button class="btn ra-join-btn" type="submit" ${active ? '' : 'disabled'}>Join</button>
    </div>`
  form.onsubmit = (e) => {
    e.preventDefault()
    const code = form.querySelector('input').value
    ctx.roomAction(form.querySelector('button'), 'runAmiJoinRoom', { code })
  }
  wrap.append(create, form)
  wrap.appendChild(el('p', 'ra-note', 'Playing costs no charge. An active Bomb is your key to the room.'))
  return wrap
}

/* ── Lobby ──────────────────────────────────────────────────────────── */

export function lobbyView(view, ctx) {
  const wrap = el('div', 'ra-lobby')
  wrap.appendChild(header('Leave', () => confirmLeaveLobby(ctx)))

  const code = el('div', 'ra-room-code')
  code.innerHTML = `<span>Room code</span><b>${esc(view.room.code)}</b>`
  const copy = el('button', 'ra-copy', 'Copy')
  copy.type = 'button'
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(view.room.code); copy.textContent = 'Copied' } catch { copy.textContent = view.room.code }
    setTimeout(() => { copy.textContent = 'Copy' }, 1500)
  }
  code.appendChild(copy)
  wrap.appendChild(code)

  if (view.lastResult) wrap.appendChild(resultCard(view.lastResult))

  const list = el('ol', 'ra-seats')
  for (let i = 0; i < 4; i++) {
    const p = view.players[i]
    const li = el('li', p ? `ra-seat${p.connected ? ' is-connected' : ''}` : 'ra-seat is-empty')
    li.innerHTML = p ? `
      ${p.avatar ? `<img class="ra-avatar" src="${esc(badgeThumb(p.avatar))}" alt="" width="40" height="40" loading="lazy">` : `<span class="ra-avatar is-initial" aria-hidden="true">${esc(p.name.slice(0, 1).toUpperCase())}</span>`}
      <b>${esc(p.name)}${p.isMe ? ' <small>(you)</small>' : ''}</b>
      <span class="ra-seat-tags">${p.isHost ? '<i>Host</i>' : ''}<em>${p.connected ? 'Ready ✓' : 'Reconnecting…'}</em></span>`
      : '<span class="ra-avatar is-empty" aria-hidden="true"></span><b>Waiting…</b>'
    list.appendChild(li)
  }
  wrap.appendChild(list)

  if (view.room.isHost) {
    const start = el('button', 'btn btn-primary ra-start', 'Start game')
    start.type = 'button'
    start.disabled = !view.room.canStart
    start.onclick = () => ctx.roomAction(start, 'runAmiStart', {})
    wrap.appendChild(start)
    wrap.appendChild(el('p', 'ra-note', view.room.canStart
      ? `${view.players.length} agents ready.`
      : 'Share the code. You need at least 2 agents.'))
  } else {
    wrap.appendChild(el('p', 'ra-note', 'Waiting for the host to start.'))
  }
  if (!view.me.bombActive) wrap.appendChild(bombBlock(false, ctx))
  wrap.appendChild(howToPlayButton())
  return wrap
}

function resultCard(r) {
  const card = el('div', `ra-result${r.youWon ? ' is-win' : ''}`)
  card.innerHTML = `<span>Last round</span><b>${esc(resultLine(r))}</b>`
  if (r.youDropped) card.appendChild(el('p', 'ra-result-note', 'You lost connection for too long, so you were out of that round and left the room. Join again with the code.'))
  return card
}

function confirmLeaveLobby(ctx) {
  const sheet = el('div', 'sheet ra-sheet')
  sheet.append(el('h3', '', 'Leave this room?'), el('p', 'muted', 'You can rejoin with the code while it stays open.'))
  const leave = el('button', 'btn btn-primary', 'Leave room')
  leave.onclick = async () => { hideOverlay(); await ctx.roomAction(null, 'runAmiLeaveRoom', {}) }
  const stay = el('button', 'btn btn-ghost', 'Stay')
  stay.onclick = hideOverlay
  sheet.append(leave, stay)
  showOverlay(sheet)
}
