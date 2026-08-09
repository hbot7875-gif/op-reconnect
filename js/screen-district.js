// District screen — one place's mission page. The active district gets the
// full live scene + mission board (districtFraction drives the lights); every
// other status (locked/available/restored/centerpiece) gets the same scene
// frozen at the fraction that status implies, so the place still feels real
// even before you've started restoring it.

import { el, esc, setState, toast, unlockAfter, showOverlay, hideOverlay } from './state.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'
import { goWard } from './router.js'
import { wardDisplayName, districtDisplayName } from './ward-tiles.js'
import { mountScene } from './scene.js'
import { districtFraction, renderBoard } from './ui-district.js'
import { playRestoration } from './celebrate.js'
import { itemTile, itemSheet, itemsAt, itemsInPack } from './items.js'

let teardown = null
let sceneFor = null
// The 90s poll re-renders with restoredNow still true, so remember which
// district already got its moment and never replay it.
let celebratedFor = null
let celebratedCellAward = null

export function renderDistrictScreen(container, state, wardId, districtId) {
  const mapD = (state.map?.districts || []).find((d) => d.id === districtId)
  if (!mapD) { goWard(wardId); return }

  const isLiveActive = mapD.status === 'active' && state.activeDistrict?.id === districtId

  if (sceneFor !== districtId) {
    if (teardown) { teardown(); teardown = null }
    container.innerHTML = ''

    const wrap = el('div', 'district-screen')
    const head = el('div', 'screen-head')
    const back = el('button', 'back-btn', 'Ward')
    back.onclick = (e) => goWard(wardId, { x: e.clientX, y: e.clientY })
    head.appendChild(back)
    wrap.appendChild(head)

    const stage = el('div', 'stage')
    stage.appendChild(el('div', 'stage-canvas'))
    const ov = el('div', 'stage-overlay')
    ov.innerHTML = `
      <div class="stage-top">
        <div class="stage-eyebrow"></div>
        <div class="stage-name"></div>
        <div class="stage-echo"></div>
      </div>
      <div class="stage-bottom">
        <div class="stage-power"><span class="pw-val">0%</span><span class="pw-lbl">POWER</span></div>
        <div class="stage-meter"><div class="stage-meter-fill"></div></div>
      </div>`
    stage.appendChild(ov)
    wrap.appendChild(stage)
    wrap.appendChild(el('div', 'board'))
    container.appendChild(wrap)

    const fixedFraction = { locked: 0, available: 0.05, restored: 1, centerpiece_dark: 0, centerpiece_lit: 1 }
    const isCenterpiece = mapD.status === 'centerpiece_dark' || mapD.status === 'centerpiece_lit'
    teardown = mountScene(
      stage.querySelector('.stage-canvas'),
      districtId,
      () => isLiveActive ? districtFraction(window.__rcState?.activeDistrict) : (fixedFraction[mapD.status] ?? 0),
      () => window.__rcState?.bomb?.charge || 0,
      mapD.name,
      () => itemsAt(window.__rcState || state, districtId),
      { wardId: mapD.wardId, centerpiece: isCenterpiece },
    )
    sceneFor = districtId
  }

  const eyebrowText = {
    locked: 'SEALED', available: 'OFFLINE', active: 'RESTORING',
    restored: 'ONLINE', centerpiece_dark: 'DORMANT', centerpiece_lit: 'AWAKE',
  }[mapD.status] || ''
  container.querySelector('.stage-name').textContent = districtDisplayName(mapD)
  // The agent this place is named for, on the hero — not hidden until you finish.
  container.querySelector('.stage-echo').textContent = mapD.echoOf ? `👤 ${mapD.echoOf}` : ''

  container.querySelector('.stage-eyebrow').textContent = eyebrowText

  const board = container.querySelector('.board')

  if (isLiveActive) {
    const d = state.activeDistrict
    const frac = districtFraction(d)
    const pct = Math.round(frac * 100)
    container.querySelector('.pw-val').textContent = pct + '%'
    container.querySelector('.stage-meter-fill').style.width = pct + '%'
    container.querySelector('.stage').classList.toggle('is-dark', pct < 34)
    renderBoard(board, d)
    const cellAward = d.chargeCellProgress?.earnedNow || 0
    const cellAwardKey = `${d.id}:${d.chargeCellProgress?.earnedThisDistrict || 0}`
    if (cellAward > 0 && celebratedCellAward !== cellAwardKey) {
      celebratedCellAward = cellAwardKey
      toast(`Charge Cell earned — tap your ARMY Bomb to add ${cellAward * 2} hours.`)
      const source = board.querySelector('.cell-progress')
      const target = document.querySelector('#tabbar [data-tab="resources"]')
      if (source && target && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const from = source.getBoundingClientRect()
        const to = target.getBoundingClientRect()
        const spark = el('div', 'cell-award-fly', '⚡')
        spark.style.left = `${from.left + from.width / 2}px`
        spark.style.top = `${from.top + from.height / 2}px`
        document.body.appendChild(spark)
        spark.animate([
          { transform: 'translate(-50%, -50%) scale(.65)', opacity: 0 },
          { transform: 'translate(-50%, -70%) scale(1.35)', opacity: 1, offset: .22 },
          { transform: `translate(calc(-50% + ${to.left + to.width / 2 - (from.left + from.width / 2)}px), calc(-50% + ${to.top + to.height / 2 - (from.top + from.height / 2)}px)) scale(.55)`, opacity: .9 },
        ], { duration: 1100, easing: 'cubic-bezier(.22,.8,.25,1)' }).finished.finally(() => spark.remove())
      }
    }
    if (d.reconnect) board.appendChild(reconnectPanel(d))
    board.appendChild(shelf(state, mapD))
    // Fires once, on the refresh that reports the district finished.
    if (d.restoredNow && celebratedFor !== d.id) {
      celebratedFor = d.id
      const ward = (state.map?.wards || []).find((w) => w.id === wardId)
      playRestoration(d, ward, state)
    }
    return
  }

  // Non-active statuses — no mission board yet, just the place and what it needs.
  const pct = Math.round((mapD.status === 'restored' || mapD.status === 'centerpiece_lit' ? 100 : 0))
  container.querySelector('.pw-val').textContent = pct + '%'
  container.querySelector('.stage-meter-fill').style.width = pct + '%'
  container.querySelector('.stage').classList.toggle('is-dark', pct < 34)

  board.innerHTML = ''
  const card = el('div', 'card board-card')

  if (mapD.status === 'locked') {
    const gate = unlockAfter(state.map?.wards || [], mapD.wardId)
    const ward = (state.map?.wards || []).find((w) => w.id === mapD.wardId)
    card.appendChild(el('div', 'sealed-note', `
      <span class="sn-lock">🔒</span>
      <div class="sn-title">Sealed</div>
      <p class="sn-body">${gate
        ? `${esc(districtDisplayName(mapD))} sits behind the grid wall. It opens when <b>${esc(wardDisplayName(gate))}</b> is whole${ward ? `, along with the rest of ${esc(wardDisplayName(ward))}` : ''}.`
        : `${esc(districtDisplayName(mapD))} opens later in the operation.`}</p>
    `))
    if (gate) {
      const go = el('button', 'btn btn-primary op-go', `Go to ${wardDisplayName(gate)}`)
      go.onclick = (e) => goWard(gate.id, { x: e.clientX, y: e.clientY })
      card.appendChild(go)
    }
  } else if (mapD.status === 'centerpiece_dark') {
    card.appendChild(el('p', 'muted', 'Nobody keeps this one. It stays dark until every district around it is back.'))
  } else if (mapD.status === 'centerpiece_lit') {
    card.appendChild(el('p', 'muted', 'The ward is whole. It watches over every agent who came before you.'))
  } else if (mapD.status === 'restored') {
    board.appendChild(card)
    board.appendChild(shelf(state, mapD))
    return
  } else {
    // available
    card.appendChild(el('p', 'muted', 'This place has been dark for years. Start it up and your streams bring it back.'))
    const go = el('button', 'btn btn-primary op-go', 'Light it up')
    go.onclick = async () => {
      go.disabled = true
      go.textContent = 'STARTING…'
      const res = await call('startDistrict', { agentNo: getAgentNo(), districtId })
      if (res.success) { setState(res); toast(`${districtDisplayName(mapD)} — you're on it`) }
      else {
        toast(friendly(res.error))
        go.disabled = false
        go.textContent = 'Light it up'
        // The message promises a refresh (someone/something else already
        // started this district) — make that true instead of leaving the
        // screen stale until the next 90s poll.
        if (res.error === 'district_already_started') {
          const fresh = await call('getGameState', { agentNo: getAgentNo() })
          if (fresh.success) setState(fresh)
        }
      }
    }
    card.appendChild(go)
  }

  board.appendChild(card)
}

/* ── Reconnect goal ─────────────────────────────────────────────────────
   The third restoration goal, when the district has one — one of five
   flavors, frozen at random per agent (see districts.ts's freezeGoals()):
   a solo guess-the-answer puzzle (sotd/cipher/memory), or a co-op mechanic
   (connect/invite) reusing the same matchmaking machinery the old post-
   restoration "Reconnect Mission" bonus used, now gating restoration
   instead of following it. `d.reconnect` (from state.activeDistrict) is
   null unless this district actually has one assigned. */

const RECONNECT_ERRORS = {
  not_eligible: "You need to be actively restoring this district first.",
  not_available: 'Nothing to do here right now — refreshing…',
  no_open_mission: 'That mission just closed — refreshing…',
  mission_full: 'That mission just filled up.',
  mission_complete: 'That mission just finished.',
  mission_expired: 'That mission timed out — open a new one.',
  already_in_mission: "You're already in this mission.",
  invitee_not_eligible: "That agent isn't actively restoring this district.",
  invitee_required: 'Enter an agent number to invite.',
  cannot_invite_self: "You can't invite yourself.",
  not_in_mission: 'Open or join a mission before inviting someone.',
  no_pending_invite: "You don't have a pending invite here.",
  no_active_puzzle: 'Nothing to answer here right now.',
  already_solved: "You've already cracked this one.",
  no_attempts_left: "You're out of attempts on this one.",
  answer_required: 'Type an answer first.',
  youtube_url_required: "That doesn't look like a YouTube link — paste the full URL.",
}
function reconnectError(code) { return RECONNECT_ERRORS[code] || code || 'Something went wrong' }

function reconnectPanel(d) {
  const box = el('div', 'card reconnect-card')
  const r = d.reconnect
  if (r.variant === 'connect' || r.variant === 'invite') {
    call('getReconnectMission', { agentNo: getAgentNo(), districtId: d.id }).then((res) => {
      if (res?.success && res.available) paintMissionPanel(box, d, res)
    })
  } else {
    paintPuzzlePanel(box, d, r)
  }
  return box
}

/* — Puzzle variants (sotd / cipher / memory) — */

const PUZZLE_EYEBROW = { sotd: 'SONG OF THE DAY', cipher: 'CIPHER', memory: 'MEMORY FRAGMENT' }

function paintPuzzlePanel(box, d, r) {
  box.innerHTML = ''
  box.appendChild(el('div', 'eyebrow', PUZZLE_EYEBROW[r.variant] || 'ReConnect SIGNAL'))
  box.appendChild(el('p', 'muted', r.prompt || ''))

  if (r.done) {
    box.appendChild(el('div', 'dim', '✓ Cracked.'))
    return
  }
  if (r.attemptsLeft <= 0) {
    box.appendChild(el('div', 'dim', "Out of attempts — this one's stuck for this attempt."))
    return
  }

  const row = el('div', 'reconnect-invite-row')
  const input = el('input', 'ob-input')
  input.placeholder = r.variant === 'sotd' ? 'Paste the YouTube link' : 'Your answer'
  const submitBtn = el('button', 'btn btn-primary', 'Submit')
  submitBtn.onclick = async () => {
    const answer = input.value.trim()
    if (!answer) { toast(reconnectError(r.variant === 'sotd' ? 'youtube_url_required' : 'answer_required')); return }
    submitBtn.disabled = true
    const res = await call('submitReconnectPuzzleAnswer', { agentNo: getAgentNo(), districtId: d.id, answer })
    submitBtn.disabled = false
    if (!res.success) { toast(reconnectError(res.error)); return }
    toast(res.solved ? 'Correct — signal locked in.' : res.attemptsLeft > 0 ? 'Not quite — try again.' : "Out of attempts.")
    const fresh = await call('getGameState', { agentNo: getAgentNo() })
    if (fresh.success) setState(fresh)
  }
  row.append(input, submitBtn)
  box.appendChild(row)
  box.appendChild(el('div', 'dim', `${r.attemptsLeft} ${r.attemptsLeft === 1 ? 'try' : 'tries'} left`))
}

/* — Co-op variants (connect / invite) — */

function paintMissionPanel(box, d, res) {
  const refresh = async () => {
    const fresh = await call('getReconnectMission', { agentNo: getAgentNo(), districtId: d.id })
    if (fresh?.success) paintMissionPanel(box, d, fresh)
  }

  box.innerHTML = ''
  box.appendChild(el('div', 'eyebrow', res.variant === 'invite' ? 'INVITE BACKUP' : 'CONNECT'))
  const m = res.mission
  const me = getAgentNo()

  if (m?.status === 'complete') {
    const done = m.sharedTrack
      ? `Done — ${esc(m.sharedTrack.label)} hit ${m.sharedTrack.target} between you. Reward lands once the district finishes.`
      : "Done — everyone's in. Reward lands once the district finishes."
    box.appendChild(el('p', 'muted', done))
    return
  }

  const myRow = m?.participants?.find((p) => p.agentNo === me)

  if (!m || m.status !== 'open') {
    const st = res.config.sharedTrack
    box.appendChild(el('p', 'muted', res.variant === 'invite'
      ? `Invite ${res.config.requiredAgents} agents who are also restoring ${esc(districtDisplayName(d))} to help out — no streaming needed from them, just a yes.`
      : st
        ? `Team up with ${res.config.requiredAgents} agents also restoring ${esc(districtDisplayName(d))} — together, stream ${esc(st.label)} ${st.target} times total. Everyone's plays count toward the same total.`
        : `Team up with ${res.config.requiredAgents} agents also restoring ${esc(districtDisplayName(d))} — everyone needs to keep streaming toward their own goals here.`))
    const openBtn = el('button', 'btn btn-primary', res.variant === 'invite' ? 'Start inviting' : 'Open a mission')
    openBtn.onclick = async () => {
      openBtn.disabled = true
      const r = await call('openReconnectMission', { agentNo: me, districtId: d.id })
      if (r.success) paintMissionPanel(box, d, { success: true, available: true, variant: res.variant, config: res.config, mission: r.mission })
      else { toast(reconnectError(r.error)); openBtn.disabled = false }
    }
    box.appendChild(openBtn)
    return
  }

  // A mission is open — show live progress either way.
  const joined = m.participants.filter((p) => p.status === 'joined')
  const streamedCount = joined.filter((p) => p.streamed).length
  box.appendChild(el('div', 'goal-line', `
    <div class="pbar" style="flex:1"><div class="pfill${joined.length === m.requiredAgents ? ' done' : ''}" style="width:${Math.round((joined.length / m.requiredAgents) * 100)}%"></div></div>
    <span class="count">${joined.length}/${m.requiredAgents} joined</span>
  `))
  if (res.variant === 'connect' && m.sharedTrack) {
    const st = m.sharedTrack
    const pct = Math.min(100, Math.round((st.progress / Math.max(1, st.target)) * 100))
    box.appendChild(el('div', 'goal-line', `
      <div class="pbar" style="flex:1"><div class="pfill${st.progress >= st.target ? ' done' : ''}" style="width:${pct}%"></div></div>
      <span class="count">${st.progress}/${st.target}</span>
    `))
    box.appendChild(el('div', 'dim', `${esc(st.label)} — everyone's own plays since joining, added together`))
  } else if (res.variant === 'connect') {
    box.appendChild(el('div', 'dim', `${streamedCount}/${joined.length} have streamed toward their own goals since joining`))
  }

  const list = el('div', 'reconnect-roster')
  for (const p of m.participants) {
    const statusText = p.status === 'invited' ? 'invited' : res.variant === 'connect' ? (p.streamed ? '✓ streamed' : 'waiting') : '✓ joined'
    list.appendChild(el('div', 'reconnect-agent' + (p.status === 'invited' ? ' is-pending' : ''), `
      <span>${esc(p.agentNo)}${p.agentNo === me ? ' (you)' : ''}</span>
      <span>${statusText}</span>
    `))
  }
  box.appendChild(list)

  if (myRow?.status === 'invited') {
    const row = el('div', 'reconnect-invite-actions')
    const accept = el('button', 'btn btn-primary', 'Accept')
    accept.onclick = async () => {
      accept.disabled = true
      const r = await call('respondReconnectInvite', { agentNo: me, districtId: d.id, accept: true })
      if (r.success) refresh(); else { toast(reconnectError(r.error)); accept.disabled = false }
    }
    const decline = el('button', 'btn btn-ghost', 'Decline')
    decline.onclick = async () => {
      decline.disabled = true
      const r = await call('respondReconnectInvite', { agentNo: me, districtId: d.id, accept: false })
      if (r.success) refresh(); else { decline.disabled = false }
    }
    row.append(accept, decline)
    box.appendChild(row)
  } else if (myRow?.status === 'joined') {
    if (joined.length < m.requiredAgents) {
      const inviteRow = el('div', 'reconnect-invite-row')
      const input = el('input', 'ob-input')
      input.placeholder = 'Invite by agent number'
      const inviteBtn = el('button', 'btn btn-ghost', 'Invite')
      inviteBtn.onclick = async () => {
        const inviteeAgentNo = input.value.trim()
        if (!inviteeAgentNo) { toast(reconnectError('invitee_required')); return }
        inviteBtn.disabled = true
        const r = await call('inviteReconnectMission', { agentNo: me, districtId: d.id, inviteeAgentNo })
        inviteBtn.disabled = false
        if (r.success) { toast(`Invited ${inviteeAgentNo}`); input.value = ''; refresh() }
        else toast(reconnectError(r.error))
      }
      inviteRow.append(input, inviteBtn)
      box.appendChild(inviteRow)
    }
  } else if (res.variant === 'connect' && joined.length < m.requiredAgents) {
    const joinBtn = el('button', 'btn btn-primary', 'Join this mission')
    joinBtn.onclick = async () => {
      joinBtn.disabled = true
      const r = await call('joinReconnectMission', { agentNo: me, districtId: d.id })
      if (r.success) refresh(); else { toast(reconnectError(r.error)); joinBtn.disabled = false }
    }
    box.appendChild(joinBtn)
  }
}

/* ── The shelf ──────────────────────────────────────────────────────────
   A restored district is somewhere you keep things. This is the difference
   between a light you switched on and a place that's yours: two agents with
   the same map still have different cities. */

function shelf(state, mapD) {
  const kept = itemsAt(state, mapD.id)
  const wrap = el('section', 'shelf')
  wrap.appendChild(el('div', 'shelf-head', `
    <span class="shelf-title">Kept here</span>
    <span class="shelf-count">${kept.length || 'empty'}</span>
  `))

  const grid = el('div', 'shelf-grid')
  for (const it of kept) {
    grid.appendChild(itemTile(it, (item) => showOverlay(itemSheet(item, {
      districtId: mapD.id, districtName: districtDisplayName(mapD),
    }))))
  }

  const spare = itemsInPack(state)
  const add = el('button', 'shelf-add')
  add.innerHTML = `<span class="sa-plus">+</span><span class="sa-lbl">${spare.length ? 'Place something' : 'Nothing spare'}</span>`
  add.disabled = !spare.length
  add.onclick = () => showOverlay(placeSheet(state, mapD, spare))
  grid.appendChild(add)

  wrap.appendChild(grid)
  if (!kept.length) {
    wrap.appendChild(el('div', 'dim shelf-empty',
      'Restore districts to find things worth keeping — albums, posters, photocards. Rarely, a ticket.'))
  }
  return wrap
}

/** Pick something out of the Pack to put here. */
function placeSheet(state, mapD, spare) {
  const sheet = el('div', 'sheet')
  sheet.appendChild(el('div', 'eyebrow', 'FROM YOUR PACK'))
  sheet.appendChild(el('h3', '', `Keep something at ${esc(districtDisplayName(mapD))}`))
  const grid = el('div', 'shelf-grid')
  for (const it of spare) {
    grid.appendChild(itemTile(it, (item) => showOverlay(itemSheet(item, {
      districtId: mapD.id, districtName: districtDisplayName(mapD),
    }))))
  }
  sheet.appendChild(grid)
  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

export function teardownDistrictScreen() {
  if (teardown) { teardown(); teardown = null; sceneFor = null }
}

function friendly(err) {
  return {
    district_already_active: 'Finish the one you\'re on first — one at a time.',
    district_already_restored: 'This one\'s already online.',
    ward_locked: 'This ward\'s still sealed — finish the one before it.',
    district_unavailable: 'You can\'t start this one directly.',
    district_already_started: 'Already started — refreshing…',
    district_not_configured: 'This district has no goals assigned yet — check back soon.',
  }[err] || err || 'Something went wrong'
}
