// District screen — one place's mission page. The active district gets the
// full live scene + mission board (districtFraction drives the lights); every
// other status (locked/available/restored/centerpiece) gets the same scene
// frozen at the fraction that status implies, so the place still feels real
// even before you've started restoring it.

import { el, esc, setState, toast, unlockAfter, showOverlay, hideOverlay } from './state.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'
import { goWard } from './router.js'
import { wardDisplayName } from './ward-tiles.js'
import { mountScene } from './scene.js'
import { districtFraction, renderBoard } from './ui-district.js'
import { playRestoration } from './celebrate.js'
import { itemTile, itemSheet, itemsAt, itemsInPack } from './items.js'

let teardown = null
let sceneFor = null
// The 90s poll re-renders with restoredNow still true, so remember which
// district already got its moment and never replay it.
let celebratedFor = null
// "See it restored" — the scene runs at full power without touching the real
// numbers. Module-level so the scene's progress getter, made once per mount,
// reads the live value.
let previewOn = false

export function renderDistrictScreen(container, state, wardId, districtId) {
  const mapD = (state.map?.districts || []).find((d) => d.id === districtId)
  if (!mapD) { goWard(wardId); return }

  const isLiveActive = mapD.status === 'active' && state.activeDistrict?.id === districtId

  if (sceneFor !== districtId) {
    if (teardown) { teardown(); teardown = null }
    previewOn = false        // a new place starts on what's actually there
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
      </div>
      <button type="button" class="stage-preview" hidden></button>`
    stage.appendChild(ov)
    wrap.appendChild(stage)
    wrap.appendChild(el('div', 'board'))
    container.appendChild(wrap)

    const fixedFraction = { locked: 0, available: 0.05, restored: 1, centerpiece_dark: 0, centerpiece_lit: 1 }
    const isCenterpiece = mapD.status === 'centerpiece_dark' || mapD.status === 'centerpiece_lit'
    teardown = mountScene(
      stage.querySelector('.stage-canvas'),
      districtId,
      () => previewOn ? 1 : (isLiveActive ? districtFraction(window.__rcState?.activeDistrict) : (fixedFraction[mapD.status] ?? 0)),
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
  container.querySelector('.stage-name').textContent = mapD.name
  // The agent this place is named for, on the hero — not hidden until you finish.
  container.querySelector('.stage-echo').textContent = mapD.echoOf ? `👤 ${mapD.echoOf}` : ''

  // Preview — see the place at full power, with whatever you've kept there,
  // before you've finished it. The real numbers below never move; only the
  // scene does, and the eyebrow says so.
  const alreadyLit = mapD.status === 'restored' || mapD.status === 'centerpiece_lit'
  if (alreadyLit) previewOn = false
  const previewBtn = container.querySelector('.stage-preview')
  previewBtn.hidden = alreadyLit
  previewBtn.textContent = previewOn ? '← Back to now' : '✨ See it restored'
  previewBtn.onclick = () => { previewOn = !previewOn; renderDistrictScreen(container, state, wardId, districtId) }
  container.querySelector('.stage').classList.toggle('is-preview', previewOn)
  container.querySelector('.stage-eyebrow').textContent = previewOn ? 'PREVIEW' : eyebrowText

  const board = container.querySelector('.board')

  if (isLiveActive) {
    const d = state.activeDistrict
    const frac = districtFraction(d)
    const pct = Math.round(frac * 100)
    container.querySelector('.pw-val').textContent = pct + '%'
    container.querySelector('.stage-meter-fill').style.width = pct + '%'
    container.querySelector('.stage').classList.toggle('is-dark', pct < 34 && !previewOn)
    renderBoard(board, d)
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
  container.querySelector('.stage').classList.toggle('is-dark', pct < 34 && !previewOn)

  board.innerHTML = ''
  const card = el('div', 'card board-card')

  if (mapD.status === 'locked') {
    const gate = unlockAfter(state.map?.wards || [], mapD.wardId)
    const ward = (state.map?.wards || []).find((w) => w.id === mapD.wardId)
    card.appendChild(el('div', 'sealed-note', `
      <span class="sn-lock">🔒</span>
      <div class="sn-title">Sealed</div>
      <p class="sn-body">${gate
        ? `${esc(mapD.name)} sits behind the grid wall. It opens when <b>${esc(wardDisplayName(gate))}</b> is whole${ward ? `, along with the rest of ${esc(wardDisplayName(ward))}` : ''}.`
        : `${esc(mapD.name)} opens later in the operation.`}</p>
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
    board.appendChild(reconnectMissionCard(state, mapD))
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
      if (res.success) { setState(res); toast(`${mapD.name} — you're on it`) }
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

/* ── Reconnect Mission ──────────────────────────────────────────────────
   The cooperative bonus stage a district's own player unlocks once THEY'VE
   personally restored it — team up with other agents who've ALSO restored
   this exact district, everyone streams one shared track, everyone gets a
   bonus. Not every district has one (server says so via `available`), so
   this is fetched lazily rather than folded into the normal state poll —
   most districts will just quietly render nothing. */

const RECONNECT_ERRORS = {
  not_eligible: "You haven't restored this district yet.",
  mission_already_open: 'A mission is already open here — refreshing…',
  no_open_mission: 'That mission just closed — refreshing…',
  mission_full: 'That mission just filled up.',
  already_in_mission: "You're already in this mission.",
  invitee_not_eligible: "That agent hasn't restored this district yet.",
  invitee_required: 'Enter an agent number to invite.',
  cannot_invite_self: "You can't invite yourself.",
  not_in_mission: 'Join the mission before inviting someone.',
}
function reconnectError(code) { return RECONNECT_ERRORS[code] || code || 'Something went wrong' }

function reconnectMissionCard(state, mapD) {
  const box = el('div', 'card reconnect-card')
  box.hidden = true
  call('getReconnectMission', { agentNo: getAgentNo(), districtId: mapD.id }).then((res) => {
    if (!res?.success || !res.available) return // this district doesn't have one — stays hidden
    box.hidden = false
    paintReconnectCard(box, mapD, res)
  })
  return box
}

function paintReconnectCard(box, mapD, res) {
  const refresh = async () => {
    const fresh = await call('getReconnectMission', { agentNo: getAgentNo(), districtId: mapD.id })
    if (fresh?.success) paintReconnectCard(box, mapD, fresh)
  }

  box.innerHTML = ''
  box.appendChild(el('div', 'eyebrow', 'RECONNECT MISSION'))
  const m = res.mission

  if (m?.status === 'complete') {
    box.appendChild(el('p', 'muted', `Done — everyone streamed "${esc(m.trackLabel)}" together. Bonus banked.`))
    return
  }

  const me = getAgentNo()
  const myRow = m?.participants?.find((p) => p.agentNo === me)

  if (!m || m.status !== 'open') {
    box.appendChild(el('p', 'muted',
      `Team up with ${res.config.required} agents who've also restored ${esc(mapD.name)} — everyone streams "${esc(res.config.trackLabel)}" for a bonus.`))
    if (!res.eligible) {
      box.appendChild(el('div', 'dim', 'Finish this district yourself first.'))
    } else {
      const openBtn = el('button', 'btn btn-primary', 'Open a mission')
      openBtn.onclick = async () => {
        openBtn.disabled = true
        const r = await call('openReconnectMission', { agentNo: me, districtId: mapD.id })
        if (r.success) paintReconnectCard(box, mapD, { success: true, available: true, eligible: true, config: res.config, mission: r.mission })
        else { toast(reconnectError(r.error)); openBtn.disabled = false; if (r.error === 'mission_already_open') refresh() }
      }
      box.appendChild(openBtn)
    }
    return
  }

  // A mission is open — show live progress either way.
  const joined = m.participants.filter((p) => p.status === 'joined')
  const streamedCount = joined.filter((p) => p.streamed).length
  box.appendChild(el('div', 'goal-line', `
    <div class="pbar" style="flex:1"><div class="pfill${streamedCount === m.requiredAgents ? ' done' : ''}" style="width:${Math.round((joined.length / m.requiredAgents) * 100)}%"></div></div>
    <span class="count">${joined.length}/${m.requiredAgents} joined</span>
  `))
  box.appendChild(el('div', 'dim', `"${esc(m.trackLabel)}"${m.trackArtist ? ` — ${esc(m.trackArtist)}` : ''} · ${streamedCount}/${joined.length} streamed it so far`))

  const list = el('div', 'reconnect-roster')
  for (const p of m.participants) {
    list.appendChild(el('div', 'reconnect-agent' + (p.status === 'invited' ? ' is-pending' : ''), `
      <span>${esc(p.agentNo)}${p.agentNo === me ? ' (you)' : ''}</span>
      <span>${p.status === 'invited' ? 'invited' : p.streamed ? '✓ streamed' : 'waiting'}</span>
    `))
  }
  box.appendChild(list)

  if (myRow?.status === 'invited') {
    const row = el('div', 'reconnect-invite-actions')
    const accept = el('button', 'btn btn-primary', 'Accept')
    accept.onclick = async () => {
      accept.disabled = true
      const r = await call('respondReconnectInvite', { agentNo: me, districtId: mapD.id, accept: true })
      if (r.success) refresh(); else { toast(reconnectError(r.error)); accept.disabled = false }
    }
    const decline = el('button', 'btn btn-ghost', 'Decline')
    decline.onclick = async () => {
      decline.disabled = true
      const r = await call('respondReconnectInvite', { agentNo: me, districtId: mapD.id, accept: false })
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
        const r = await call('inviteReconnectMission', { agentNo: me, districtId: mapD.id, inviteeAgentNo })
        inviteBtn.disabled = false
        if (r.success) { toast(`Invited ${inviteeAgentNo}`); input.value = ''; refresh() }
        else toast(reconnectError(r.error))
      }
      inviteRow.append(input, inviteBtn)
      box.appendChild(inviteRow)
    }
  } else if (res.eligible && joined.length < m.requiredAgents) {
    const joinBtn = el('button', 'btn btn-primary', 'Join this mission')
    joinBtn.onclick = async () => {
      joinBtn.disabled = true
      const r = await call('joinReconnectMission', { agentNo: me, districtId: mapD.id })
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
      districtId: mapD.id, districtName: mapD.name,
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
  sheet.appendChild(el('h3', '', `Keep something at ${esc(mapD.name)}`))
  const grid = el('div', 'shelf-grid')
  for (const it of spare) {
    grid.appendChild(itemTile(it, (item) => showOverlay(itemSheet(item, {
      districtId: mapD.id, districtName: mapD.name,
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
  }[err] || err || 'Something went wrong'
}
