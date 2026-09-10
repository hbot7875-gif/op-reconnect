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
import { districtPercent } from './district-progress.js'
import { playRestoration } from './celebrate.js'
import { itemTile, itemSheet, itemsAt, itemsInPack } from './items.js'
import { trackEngagementOnce } from './engagement.js'
import { reconnectPlayerNext } from './reconnect-player-ui.js'
import { openPlaylistVault } from './playlist-vault-sheet.js'
import { renderHud } from './ui-hud.js'
import { wardPopulation, knownDistrictPopulation } from './ward-population.js'
import { chatThread, updateChatThread } from './chat-thread.js'
import { getReconnectChatSeen, markReconnectChatSeen,
  reconnectChatUnreadCount, reconnectChatBadgeText } from './reconnect-chat-unread.js'
import { openShare } from './share.js'
import { questShareSheet } from './quest-share.js'
import { warmShareArtwork } from './share-scene-image.js'

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
        <div class="stage-echo-row">
          <div class="stage-echo"></div>
          <button type="button" class="stage-agents" hidden></button>
        </div>
      </div>
      <div class="stage-bottom">
        <div class="stage-power"><span class="pw-val">0%</span><span class="pw-lbl">RESTORED</span></div>
        <div class="stage-meter" role="progressbar" aria-label="District restoration progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="stage-meter-fill"></div></div>
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
  const head = container.querySelector('.screen-head')
  const canShareDistrict = isLiveActive || mapD.status === 'restored' || mapD.status === 'centerpiece_lit'
  let shareDistrict = head?.querySelector('.district-share-btn')
  if (canShareDistrict && !shareDistrict) {
    shareDistrict = el('button', 'district-share-btn', '↗ Share')
    head.appendChild(shareDistrict)
  }
  if (shareDistrict) {
    if (!canShareDistrict) shareDistrict.remove()
    else shareDistrict.onclick = () => showOverlay(openShare(window.__rcState || state, { districtId }))
  }
  if (canShareDistrict) warmShareArtwork(state, mapD)
  container.querySelector('.stage-name').textContent = districtDisplayName(mapD)
  // The agent this place is named for, on the hero — not hidden until you finish.
  container.querySelector('.stage-echo').textContent = mapD.echoOf ? `👤 ${mapD.echoOf}` : ''
  // Warm the ward's roster counts, then repaint — the button should show
  // the real "restoring this district" number even on a first visit.
  const agentsButton = container.querySelector('.stage-agents')
  paintAgentsHere(agentsButton, state, districtId, wardId)
  wardPopulation(wardId).then(() => {
    if (agentsButton?.isConnected) paintAgentsHere(agentsButton, state, districtId, wardId)
  })

  container.querySelector('.stage-eyebrow').textContent = eyebrowText

  const board = container.querySelector('.board')

  if (isLiveActive) {
    const d = state.activeDistrict
    const frac = districtFraction(d)
    const pct = districtPercent(d)
    container.querySelector('.pw-val').textContent = pct + '%'
    container.querySelector('.stage-meter-fill').style.width = pct + '%'
    container.querySelector('.stage-meter').setAttribute('aria-valuenow', String(pct))
    container.querySelector('.stage').classList.toggle('is-dark', pct < 34)
    // Built here (screen-district.js owns the interactive open/invite/accept
    // flow) but handed to renderBoard so it can be positioned right after
    // Track Mission instead of tacked on after every other card — see
    // renderBoard's own comment. Only when there's an unfinished reconnect
    // goal to actually show; a finished one gets a quiet compact row from
    // renderBoard itself with nothing left to interact with.
    const mountedReconnectBox = board.querySelector('.reconnect-card')
    const pageScrollBeforeBoardRefresh = document.scrollingElement?.scrollTop ?? 0
    const focusedComposer = mountedReconnectBox?.querySelector('.reconnect-chat-composer input:focus')
    const composerSelection = focusedComposer
      ? { start: focusedComposer.selectionStart, end: focusedComposer.selectionEnd }
      : null
    const reconnectBox = d.reconnect && !d.reconnect.done
      ? (mountedReconnectBox || reconnectPanel(d))
      : null
    const vaultBox = districtVaultCard(districtId, districtDisplayName(mapD))
    renderBoard(board, d, { reconnectBox, vaultBox })
    if (focusedComposer?.isConnected) {
      focusedComposer.focus({ preventScroll: true })
      if (composerSelection?.start != null) {
        focusedComposer.setSelectionRange(composerSelection.start, composerSelection.end)
      }
    }
    // The existing panel was moved—not recreated—so its composer, draft,
    // focus and disclosure state survive. Refresh its changing mission data
    // after it is safely back in the board.
    if (mountedReconnectBox && reconnectBox) reconnectBox.refreshMission?.()
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
    board.appendChild(shelf(state, mapD))
    // The shelf changes the board's final height. Restore only after every
    // section is back, otherwise the browser clamps to the shorter interim
    // page and the player visibly jumps upward on each poll.
    if (document.scrollingElement) document.scrollingElement.scrollTop = pageScrollBeforeBoardRefresh
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
  container.querySelector('.stage-meter').setAttribute('aria-valuenow', String(pct))
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

/* ── Who's here ─────────────────────────────────────────────────────────
   Real presence (feed.ts's getOnlineNow — same last-90s-poll signal City's
   own "active now" already uses), filtered to this one district instead of
   the whole map. Already respects appear_offline server-side: an agent
   hiding never reaches state.onlineNow at all, so there's nothing extra to
   filter here for that. No agent numbers ever shown, only codenames. */

function districtAgentsHere(state, districtId) {
  const myCodename = state.player?.codename || null
  return (state.onlineNow?.agents || [])
    .filter((a) => a.districtId === districtId)
    .map((a) => ({ codename: a.codename, isMe: myCodename != null && a.codename === myCodename }))
}

function paintAgentsHere(button, state, districtId, wardId) {
  if (!button) return
  const agents = districtAgentsHere(state, districtId)
  const online = Number(state.onlineNow?.districtCounts?.[districtId]) || agents.length
  // Everyone restoring this district, not just whoever is online. Gating
  // the button on presence hid the roster exactly when it is most useful —
  // a district whose agents are all offline is the one you most want to
  // signal. Falls back to the presence count until the roster arrives.
  const roster = knownDistrictPopulation(wardId, districtId)
  const count = roster || online
  const unread = Number(state.districtMessages?.unreadByDistrict?.[districtId]) || 0
  if (!count && !unread) { button.hidden = true; return }
  button.hidden = false
  button.innerHTML = `<span aria-hidden="true">👥</span> ${count}${unread ? `<i>${unread}</i>` : ''}`
  button.setAttribute('aria-label', `${count} agent${count === 1 ? '' : 's'} restoring this district${unread ? `, ${unread} unread message${unread === 1 ? '' : 's'}` : ''}`)
  button.onclick = () => showOverlay(agentsHereSheet(state, districtId, button, wardId))
}

function districtMessageError(code) {
  return ({
    message_required: 'Type a message first.',
    agent_not_here: 'That agent just left this district.',
    cannot_message_self: "That's you.",
    message_rate_limited: 'Too many signals at once — wait a few minutes.',
  })[code] || "Couldn't send that signal — try again."
}

function districtMessageComposer(districtId, codename) {
  const form = el('div', 'agent-signal-composer')
  const input = el('input', 'ob-input')
  input.type = 'text'
  input.maxLength = 240
  input.placeholder = `Message ${codename}`
  input.setAttribute('aria-label', `Message ${codename}`)
  const send = el('button', 'agent-signal-send', 'Send')
  const submit = async () => {
    const message = input.value.trim()
    if (!message) return
    input.disabled = send.disabled = true
    send.textContent = 'SENDING…'
    const res = await call('sendDistrictMessage', { agentNo: getAgentNo(), districtId, codename, message })
    if (res.success) {
      toast(`Signal sent to ${codename}`)
      form.remove()
      return
    }
    input.disabled = send.disabled = false
    send.textContent = 'Send'
    toast(districtMessageError(res.error))
  }
  send.onclick = submit
  input.onkeydown = (e) => { if (e.key === 'Enter') submit() }
  form.append(input, send)
  requestAnimationFrame(() => input.focus())
  return form
}

function paintDistrictPresence(body, data, districtId) {
  body.innerHTML = ''
  const agents = data.agents || []
  if (!agents.length) body.appendChild(el('p', 'muted', 'No agents are restoring this district yet.'))
  for (const agent of agents) {
    // The roster is everyone with this district active, online or not, so
    // the dot now says who is live rather than being decoration on a list
    // that was online-only by definition.
    const row = el('div', `agent-here-row${agent.online ? ' is-online' : ''}`)
    row.innerHTML = `
      <span class="agent-here-dot" title="${agent.online ? 'Online now' : 'Offline'}"></span>
      <span class="agent-here-who"><b>${esc(agent.codename)}</b>${agent.isMe ? '<span class="agent-here-you">You</span>' : ''}</span>
      <span class="agent-here-progress"><b>${Math.max(0, Math.min(100, Number(agent.restored) || 0))}%</b><small>restored</small></span>
    `
    if (!agent.isMe) {
      const message = el('button', 'agent-here-message', 'Message')
      message.onclick = () => {
        const old = row.nextElementSibling
        if (old?.classList.contains('agent-signal-composer')) { old.remove(); return }
        body.querySelector('.agent-signal-composer')?.remove()
        row.after(districtMessageComposer(districtId, agent.codename))
      }
      row.appendChild(message)
    }
    body.appendChild(row)
  }

  if (data.inbox?.length) {
    body.appendChild(el('div', 'agent-signal-title', 'MESSAGES FOR YOU'))
    const visibleNames = new Set(agents.filter((a) => !a.isMe).map((a) => a.codename))
    for (const message of data.inbox) {
      const row = el('div', `agent-signal${message.unread ? ' is-unread' : ''}`)
      row.innerHTML = `<b>${esc(message.codename)}</b><span>${esc(message.body)}</span>`
      if (visibleNames.has(message.codename)) {
        const reply = el('button', 'agent-signal-reply', 'Reply')
        reply.onclick = () => {
          body.querySelector('.agent-signal-composer')?.remove()
          row.after(districtMessageComposer(districtId, message.codename))
        }
        row.appendChild(reply)
      }
      body.appendChild(row)
    }
  }
}

function agentsHereSheet(state, districtId, sourceButton, wardId) {
  const sheet = el('div', 'sheet agents-here-sheet')
  sheet.appendChild(el('div', 'eyebrow', 'AGENTS IN THIS DISTRICT'))
  sheet.appendChild(el('p', 'agents-here-note', 'Everyone restoring this district. A lit dot means online now — you can signal anyone here either way.'))
  const body = el('div', 'agents-here-body')
  body.appendChild(el('p', 'muted', 'Checking who is here…'))
  sheet.appendChild(body)
  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  call('getDistrictPresence', { agentNo: getAgentNo(), districtId }).then((res) => {
    if (!res.success) { body.innerHTML = ''; body.appendChild(el('p', 'muted', "Couldn't check right now.")); return }
    paintDistrictPresence(body, res, districtId)
    if (state.districtMessages?.unreadByDistrict) {
      state.districtMessages.unreadByDistrict[districtId] = 0
      // Opening this sheet marks them read on the server, so the HUD bell
      // has to lose them now. The count is mutated in place rather than
      // through setState (no re-render of the screen behind this sheet
      // mid-read), which means nothing notifies the HUD — repaint it here
      // or the global badge keeps the old number until the next poll.
      const hud = document.getElementById('hud')
      if (hud) renderHud(hud, state)
    }
    paintAgentsHere(sourceButton, state, districtId, wardId)
  })
  return sheet
}

/* ── District Playlist Vault ────────────────────────────────────────────
   A compact entry into the shared Vault sheet (playlist-vault-sheet.js),
   pre-scoped to this district's real goal catalog keys. The count is fetched
   once per district visit and cached for the session — it's a real number
   (candy-star.ts's district match, not a guess), not worth re-fetching on
   every 90s poll re-render the way the rest of this screen refreshes. */

const vaultCountCache = new Map()

function districtVaultCard(districtId, districtName) {
  const card = el('button', 'district-vault-card')
  card.type = 'button'
  const cached = vaultCountCache.get(districtId)
  const countLabel = (n) => `${n} playlist${n === 1 ? '' : 's'} available`
  // A secondary shortcut, not a second feature card: title, one real number,
  // and the way in. The count is already scoped to this district (the
  // 'relevant' view below), and the sheet it opens names the district, so
  // saying so again here was noise.
  card.innerHTML = `
    <div class="dv-head"><span class="dv-icon">🎧</span><span class="dv-title">Playlist Vault</span></div>
    <div class="dv-foot"><span class="dv-count">${typeof cached === 'number' ? esc(countLabel(cached)) : 'Loading…'}</span><span class="dv-open">OPEN →</span></div>
  `
  card.onclick = () => openPlaylistVault({ districtId, districtName })
  if (typeof cached !== 'number') {
    call('getCandyPlaylistLibrary', { agentNo: getAgentNo(), view: 'relevant', districtId, limit: 1 }).then((res) => {
      if (!res?.success) return
      const total = Number(res.total) || 0
      vaultCountCache.set(districtId, total)
      const countEl = card.querySelector('.dv-count')
      if (countEl) countEl.textContent = countLabel(total)
    })
  }
  return card
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
  already_completed: "You've already finished this together — refreshing…",
  already_paired_elsewhere: "You're already teamed up with someone else here — decline this invite first if you want to switch.",
  invitee_not_eligible: "That agent isn't actively restoring this district.",
  invitee_retired: "That agent has retired and can't accept invites anymore — pick someone else.",
  invitee_required: 'Enter an agent number to invite.',
  cannot_invite_self: "You can't invite yourself.",
  not_in_mission: 'Open or join a mission before inviting someone.',
  no_pending_invite: "You don't have a pending invite here.",
  invite_expired: 'That invite expired after a day unanswered — ask them to send a new one.',
  target_required: 'Something went wrong picking who to remove.',
  cannot_remove_self: "You can't remove yourself — decline or leave isn't available here.",
  // Leaving is allowed now (see removeReconnectParticipant's isLeaving), so
  // cannot_remove_self should no longer reach a player; kept above only so an
  // older cached client still shows words rather than a raw error code.
  not_mission_creator: 'Only whoever opened this mission can remove someone from it.',
  already_contributed: "They're still streaming toward this — you can't remove someone who's helping, but you can leave if you'd rather team up elsewhere.",
  no_active_puzzle: 'Nothing to answer here right now.',
  already_solved: "You've already cracked this one.",
  no_attempts_left: "You're out of attempts on this one.",
  answer_required: 'Type an answer first.',
  youtube_url_required: "That doesn't look like a YouTube link — paste the full URL.",
  message_required: 'Type something first.',
}
function reconnectError(code) { return RECONNECT_ERRORS[code] || code || 'Something went wrong' }

function reconnectPanel(d) {
  const box = el('div', 'card reconnect-card')
  trackEngagementOnce(`reconnect:${d.id}`, 'reconnect_opened', { screen: 'district', districtId: d.id })
  const r = d.reconnect
  if (r.variant === 'connect' || r.variant === 'invite') {
    // call() never throws — a dropped connection resolves to
    // {success:false, error:'Network error...'} rather than rejecting (see
    // api.js). That means a flaky mobile connection used to leave this box
    // permanently blank: nothing painted the box on failure, nothing told
    // the player anything went wrong, and nothing ever retried. One real
    // report showed exactly that — an empty bordered box under "ReConnect
    // Mission," reachable on a phone showing a single, weak WiFi bar. The
    // server side turned out to be completely healthy; this was the whole
    // bug. Show a loading state immediately, and turn a failure into a
    // message with a real Retry button instead of permanent silence.
    box.appendChild(el('p', 'muted', 'Loading your mission…'))
    const load = () => call('getReconnectMission', { agentNo: getAgentNo(), districtId: d.id }).then((res) => {
      if (res?.success && res.available) { paintMissionPanel(box, d, res); return }
      box.innerHTML = ''
      box.appendChild(el('p', 'muted', reconnectError(res?.error) || "Couldn't load this — check your connection."))
      const retry = el('button', 'btn btn-ghost', 'Retry')
      retry.onclick = () => { box.innerHTML = ''; box.appendChild(el('p', 'muted', 'Loading your mission…')); load() }
      box.appendChild(retry)
    })
    box.refreshMission = load
    load()
  } else {
    paintPuzzlePanel(box, d, r)
  }
  return box
}

function reconnectMissionBlock(title, body) {
  return el('section', 'reconnect-core reconnect-mission-core', `
    <span>MISSION</span><b>${esc(title || 'ReConnect Quest')}</b>
    ${body ? `<p>${body}</p>` : ''}`)
}

function reconnectTeamBlock(body) {
  return el('section', 'reconnect-core reconnect-team-core', `<span>TEAM</span><b>${body}</b>`)
}

function reconnectNextBlock(title, body = '') {
  return el('section', 'reconnect-next', `<span>NEXT STEP</span><b>${title}</b>${body ? `<p>${body}</p>` : ''}`)
}

function reconnectDisclosure(label, content, open = false) {
  const details = el('details', 'reconnect-disclosure')
  details.open = open
  details.append(el('summary', '', label), content)
  return details
}

/* — Puzzle variants (sotd / cipher / memory) — */

const PUZZLE_EYEBROW = { sotd: 'SONG OF THE DAY', cipher: 'CIPHER', memory: 'MEMORY FRAGMENT' }

function paintPuzzlePanel(box, d, r) {
  box.innerHTML = ''
  box.appendChild(el('div', 'eyebrow', PUZZLE_EYEBROW[r.variant] || 'ReConnect SIGNAL'))
  box.appendChild(reconnectMissionBlock(d.reconnect?.label || 'ReConnect Quest', esc(r.prompt || 'Crack the signal.')))
  box.appendChild(reconnectTeamBlock('Solo signal'))

  if (r.done) {
    box.appendChild(reconnectNextBlock('Quest complete — finish the district'))
    return
  }
  if (r.attemptsLeft <= 0) {
    box.appendChild(reconnectNextBlock('No attempts left — ask for help'))
    const help = el('a', 'btn btn-ghost reconnect-help-link', 'Ask for help in ReConnect GC')
    help.href = 'https://ig.me/j/AbZYVFwKMMuh1zzV/'
    help.target = '_blank'
    help.rel = 'noopener noreferrer'
    box.appendChild(help)
    return
  }

  box.appendChild(reconnectNextBlock('Submit your answer', `${r.attemptsLeft} ${r.attemptsLeft === 1 ? 'try' : 'tries'} left`))
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
  box.appendChild(el('div', 'reconnect-primary-action')).appendChild(row)
}

/* — Co-op variants (connect / invite) — */

/** How long someone's been waiting for a partner, capped at "1 day+".
 *  Deliberately doesn't count past a day: the real numbers run to nearly a
 *  week, and "waiting 6 days" reads as an accusation aimed at whoever's
 *  reading it rather than a nudge to help. Past 24h the exact figure adds
 *  nothing actionable — they're stuck either way. */
function waitedLabel(waitingSince) {
  if (!waitingSince) return 'waiting'
  const mins = Math.max(0, Math.floor((Date.now() - new Date(waitingSince).getTime()) / 60000))
  if (mins < 60) return 'just opened'
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `waiting ${hours}h`
  return 'waiting 1 day+'
}

function reconnectQuestSignature(res) {
  const mission = res.mission ? { ...res.mission } : null
  if (mission) {
    delete mission.messages
    delete mission.messageCount
  }
  return JSON.stringify({
    available: res.available,
    variant: res.variant,
    config: res.config,
    idleThreshold: res.idleThreshold,
    mission,
  })
}

function refreshMountedMissionChat(box, mission) {
  const disclosure = box.querySelector(':scope > .reconnect-chat-disclosure')
  if (!disclosure || disclosure.dataset.missionId !== mission?.id) return
  const chat = disclosure.querySelector('.reconnect-chat')
  updateChatThread(chat, mission.messages, { emptyText: 'No messages yet — say hi to your team.' })
  const unread = reconnectChatUnreadCount(mission.messageCount, getReconnectChatSeen(mission.id))
  const badge = reconnectChatBadgeText(unread)
  const summary = disclosure.querySelector(':scope > summary')
  if (summary) summary.innerHTML = `Team Chat${badge ? ` <span class="reconnect-chat-badge">${esc(badge)} new</span>` : ''}`
  if (disclosure.open) {
    markReconnectChatSeen(mission.id, mission.messageCount)
    disclosure.querySelector('.reconnect-chat-badge')?.remove()
  }
}

function refreshMountedMissionDeadline(box, mission) {
  const host = box.querySelector('.reconnect-problems')
  if (!host) return
  let deadline = host.querySelector('.reconnect-mission-deadline')
  const msLeft = mission?.expiresAt ? new Date(mission.expiresAt).getTime() - Date.now() : Infinity
  const daysLeft = Math.ceil(msLeft / 86400000)
  if (!Number.isFinite(daysLeft) || daysLeft > 3) {
    deadline?.remove()
    return
  }
  const urgent = daysLeft <= 2
  const text = daysLeft <= 0 ? 'Last day for this mission'
    : daysLeft === 1 ? '<b>1 day</b> left for this mission'
    : `<b>${daysLeft} days</b> left for this mission`
  const html = `<span class="deadline-kind">Team mission expires</span><span>⏳ ${text} — after that it expires and any invites are lost.</span>`
  if (!deadline) {
    deadline = el('div', 'board-deadline reconnect-mission-deadline')
    host.prepend(deadline)
  }
  deadline.className = 'board-deadline reconnect-mission-deadline' + (urgent ? ' is-urgent' : '')
  if (deadline.innerHTML !== html) deadline.innerHTML = html
}

function paintMissionPanel(box, d, res) {
  const nextSignature = reconnectQuestSignature(res)
  if (box.dataset.questSignature === nextSignature) {
    refreshMountedMissionChat(box, res.mission)
    refreshMountedMissionDeadline(box, res.mission)
    return
  }
  box.dataset.questSignature = nextSignature

  const disclosureKey = (node) => {
    const text = node.querySelector(':scope > summary')?.textContent?.trim() || ''
    return text.startsWith('Team Chat') ? 'Team Chat' : text
  }
  const openDisclosures = new Set(
    [...box.querySelectorAll('details[open]')].map(disclosureKey).filter(Boolean),
  )
  const expandedChecklists = new Set(
    [...box.querySelectorAll('.reconnect-agent-toggle[aria-expanded="true"]')]
      .map((toggle) => toggle.closest('.reconnect-agent')?.dataset.agentCodename)
      .filter(Boolean),
  )
  const pageScroll = document.scrollingElement?.scrollTop ?? 0
  const restoreViewState = () => {
    for (const disclosure of box.querySelectorAll('details')) {
      if (openDisclosures.has(disclosureKey(disclosure))) disclosure.open = true
    }
    for (const row of box.querySelectorAll('.reconnect-agent[data-agent-codename]')) {
      if (!expandedChecklists.has(row.dataset.agentCodename)) continue
      row.querySelector('.reconnect-agent-toggle')?.setAttribute('aria-expanded', 'true')
      const detail = row.querySelector('.reconnect-checklist-detail')
      if (detail) detail.hidden = false
    }
    if (document.scrollingElement) document.scrollingElement.scrollTop = pageScroll
  }

  // Preserve the live Team Chat node across mission repaints. Progress,
  // roster and messages can all update without replacing the composer the
  // player may currently be typing into.
  const existingChatDisclosure = box.querySelector(':scope > .reconnect-chat-disclosure')
  const existingChat = existingChatDisclosure?.dataset.missionId === res.mission?.id
    ? existingChatDisclosure
    : null
  const focusedChatInput = existingChat?.querySelector('.reconnect-chat-composer input:focus')
  const chatSelection = focusedChatInput
    ? { start: focusedChatInput.selectionStart, end: focusedChatInput.selectionEnd }
    : null
  if (existingChat) existingChat.remove()

  const refresh = async () => {
    const fresh = await call('getReconnectMission', { agentNo: getAgentNo(), districtId: d.id })
    if (fresh?.success) paintMissionPanel(box, d, fresh)
  }

  box.innerHTML = ''
  box.appendChild(el('div', 'eyebrow', res.variant === 'invite' ? 'INVITE BACKUP' : 'CONNECT'))
  const m = res.mission
  const me = getAgentNo()
  if (['open', 'complete'].includes(m?.status) && m.participants?.some(p => p.isMe && p.status === 'joined')) {
    const shareQuest = el('button', 'reconnect-quest-share', '↗ Share Quest')
    shareQuest.onclick = () => showOverlay(questShareSheet(d.id))
    box.appendChild(shareQuest)
  }
  const sharedProgressRatio = m?.sharedTrack
    ? Number(m.sharedTrack.progress || 0) / Math.max(1, Number(m.sharedTrack.target || 0))
    : 0
  box.classList.toggle('is-near-complete', m?.status === 'open' && sharedProgressRatio >= 0.8)
  box.classList.toggle('is-complete', m?.status === 'complete')

  if (m?.status === 'complete') {
    // Name the partner. An agent who got here by ACCEPTING an invite never
    // sent one themselves, so a bare "everyone's in" reads as the mission
    // completing on its own — one player reported exactly that ("I didn't
    // invite anyone but it's completed"). Saying who they teamed up with
    // makes the other half of the flow visible after the fact.
    const others = (m.participants || []).filter((p) => !p.isMe && p.status === 'joined')
    const withWho = others.length ? ` with ${others.map((p) => esc(p.codename)).join(' and ')}` : ''
    const missionBody = m.sharedTrack
      ? `Team up and take ${esc(m.sharedTrack.label)} to ${m.sharedTrack.target} combined plays.`
      : m.checklist
        ? `Build a team of ${m.requiredAgents} agents. Each agent streams all ${m.checklist.total} tracks once.`
        : 'Complete this district ReConnect Quest together.'
    box.appendChild(reconnectMissionBlock(d.reconnect?.label || 'ReConnect Quest', missionBody))
    box.appendChild(reconnectTeamBlock(`${esc(m.participants.filter((p) => p.status === 'joined').map((p) => p.isMe ? 'You' : p.codename).join(' + ') || 'Team complete')}`))
    const completeScoreline = el('section', 'reconnect-coop-progress reconnect-complete-progress')
    const joinedCount = m.participants.filter((p) => p.status === 'joined').length
    const completeScores = el('div', 'reconnect-scoreline')
    completeScores.appendChild(el('div', 'reconnect-score', `<b>${joinedCount}<i>/ ${m.requiredAgents}</i></b><span>ARMY together</span>`))
    if (m.sharedTrack) {
      completeScores.appendChild(el('div', 'reconnect-score', `<b>${m.sharedTrack.progress}<i>/ ${m.sharedTrack.target}</i></b><span>signal complete</span>`))
    } else if (m.checklist) {
      completeScores.appendChild(el('div', 'reconnect-score', `<b>${joinedCount}<i>/ ${joinedCount}</i></b><span>lists cleared</span>`))
    }
    completeScoreline.appendChild(completeScores)
    box.appendChild(completeScoreline)
    box.appendChild(reconnectNextBlock('Quest complete — finish the district',
      m.sharedTrack ? `${esc(m.sharedTrack.label)} reached ${m.sharedTrack.target} combined plays${withWho}.`
        : m.checklist ? `Everyone cleared all ${m.checklist.total} tracks${withWho}.`
        : `You teamed up${withWho}.`))
    return
  }

  const myRow = m?.participants?.find((p) => p.isMe)

  if (!m || m.status !== 'open') {
    const st = res.config.sharedTrack
    const cl = res.config.checklist
    const missionBody = res.variant === 'invite'
      ? `Build a ${res.config.requiredAgents}-agent team in ${esc(districtDisplayName(d))}.`
      : st
        ? `Build a ${res.config.requiredAgents}-agent team, then stream ${esc(st.label)} to ${st.target} combined plays.`
        : cl
          ? `Build a team of ${res.config.requiredAgents} agents. Each agent streams all ${cl.tracks.length} tracks once.`
          : `Build a ${res.config.requiredAgents}-agent team and stream your active district goals.`
    box.appendChild(reconnectMissionBlock(d.reconnect?.label || 'ReConnect Quest', missionBody))
    box.appendChild(reconnectTeamBlock(`You · ${Math.max(0, res.config.requiredAgents - 1)} open seat${res.config.requiredAgents - 1 === 1 ? '' : 's'}`))
    box.appendChild(reconnectNextBlock('Open this quest to find teammates'))
    const moreBody = el('div', 'reconnect-details-body')
    const how = el('details', 'reconnect-how')
    how.innerHTML = `<summary>How this mission works</summary><p>${res.variant === 'invite'
      ? 'Invite active agents here. Their acceptance completes the team step—no extra streaming is needed.'
      : st
        ? `After everyone accepts, stream ${esc(st.label)}. Every team member's plays add up until the shared total reaches ${st.target}.`
        : cl
          ? `After everyone accepts, each team member streams every track on the list at least once — on their own, nothing pools between teammates.`
          : 'After everyone accepts, each team member streams at least one of their own active district goals.'}</p>`
    moreBody.appendChild(how)
    // Who's already standing here, BEFORE committing to open anything. The
    // pickable list used to appear only after opening a mission, so this
    // screen — the one everybody sees first — could never say whether
    // anyone was actually around to team up with. "Open a mission" reads as
    // a shot in the dark without it, and as answering someone with it.
    const waiting = el('p', 'muted reconnect-waiting-now')
    moreBody.appendChild(waiting)
    call('getInviteCandidates', { agentNo: me, districtId: d.id }).then((res2) => {
      const n = res2?.success ? (res2.candidates?.length || 0) : 0
      if (n) {
        waiting.innerHTML = n === 1
          ? `<b>1 agent is waiting for a partner here right now.</b> Open a mission to invite them.`
          : `<b>${n} agents are waiting for a partner here right now.</b> Open a mission to invite one.`
        return
      }
      // Nobody free yet — say so only if there's a real reason more people
      // are coming (see getInviteCandidates), otherwise stay quiet rather
      // than announcing an empty list nobody asked about yet.
      if (res2?.stillOnHomeBase) {
        waiting.textContent = `Nobody's free to team up with yet — ${res2.stillOnHomeBase} `
          + `${res2.stillOnHomeBase === 1 ? 'agent is' : 'agents are'} still restoring Home Base and will be able to join here once they finish.`
      } else {
        waiting.remove()
      }
    })

    const openBtn = el('button', 'btn btn-primary', res.variant === 'invite' ? 'Start inviting' : 'Open a mission')
    openBtn.onclick = async () => {
      openBtn.disabled = true
      const r = await call('openReconnectMission', { agentNo: me, districtId: d.id })
      if (r.success) paintMissionPanel(box, d, { success: true, available: true, variant: res.variant, config: res.config, mission: r.mission })
      else { toast(reconnectError(r.error)); openBtn.disabled = false }
    }
    box.appendChild(el('div', 'reconnect-primary-action')).appendChild(openBtn)
    box.appendChild(reconnectDisclosure('Details', moreBody))
    return
  }

  // A mission is open — show live progress either way. "Ready" (joined) is
  // its own state, separate from "streamed" — a joined agent who hasn't
  // streamed yet is still fully counted toward the team, just with nothing
  // to show on the shared total yet. Leading with a plain-language status
  // line before the bars, because "1/2 joined" reads as a fraction to parse,
  // not a sentence to understand at a glance.
  // Someone whose own attempt here lapsed can't contribute or even open this
  // mission, so they don't count toward a ready team — otherwise the panel
  // claims "2 of 2 ready" for a pairing that can never finish.
  const joined = m.participants.filter((p) => p.status === 'joined' && !p.leftDistrict)
  const dropped = m.participants.filter((p) => p.status === 'joined' && p.leftDistrict)
  // An expired invite is not pending — nobody is going to answer it. Kept
  // separate so the "only N more acceptances needed" line below doesn't
  // count on a reply that can never come.
  const pending = m.participants.filter((p) => p.status === 'invited' && !p.inviteExpired)
  const expired = m.participants.filter((p) => p.status === 'invited' && p.inviteExpired)
  const need = Math.max(0, m.requiredAgents - joined.length)
  const idlers = m.participants.filter((p) => p.status === 'joined' && p.idle && !p.isMe && !p.leftDistrict)
  const teamNames = joined.map((p) => p.isMe ? 'You' : esc(p.codename))
  const teamOpen = Math.max(0, m.requiredAgents - joined.length)
  const teamCopy = `${teamNames.join(' + ') || 'You'}${teamOpen ? ` · ${teamOpen} open seat${teamOpen === 1 ? '' : 's'}` : ''}`
  const missionBody = res.variant === 'invite'
    ? `Build a ${m.requiredAgents}-agent team in ${esc(districtDisplayName(d))}.`
    : m.sharedTrack
      ? `Team up and take ${esc(m.sharedTrack.label)} to ${m.sharedTrack.target} combined plays.`
      : m.checklist
        ? `Build a team of ${m.requiredAgents} agents. Each agent streams all ${m.checklist.total} tracks once.`
        : `Team up and stream active goals in ${esc(districtDisplayName(d))}.`
  box.appendChild(reconnectMissionBlock(d.reconnect?.label || 'ReConnect Quest', missionBody))
  box.appendChild(reconnectTeamBlock(teamCopy))
  const problemHost = el('div', 'reconnect-problems')
  box.appendChild(problemHost)

  // The mission's own 7-day clock — returned by the server (m.expiresAt) but
  // never shown anywhere until now. The DISTRICT's deadline already gets a
  // loud ⏳ banner the instant it's close (ui-district.js's board-deadline);
  // a stalled mission has the exact same shape of "this goes away soon" risk
  // and got none of that visibility — someone could watch an invite sit
  // unanswered for days with no idea the whole mission was about to expire
  // out from under them. Same class, same wording pattern, so it reads as
  // the same kind of warning a player has already learned to notice.
  refreshMountedMissionDeadline(box, m)

  const next = reconnectPlayerNext({
    variant: res.variant, myStatus: myRow?.status, need,
    pendingNames: pending.map((p) => p.codename), expiredCount: expired.length,
    idleCount: idlers.length, isCreator: m.isCreator, cipher: m.cipher,
    sharedTrack: m.sharedTrack, checklist: m.checklist, myChecklistDone: myRow?.streams,
  })
  const nextTitle = esc(next.title)
  const nextBody = esc(next.body)
  const progressHost = el('section', 'reconnect-coop-progress')
  const scoreline = el('div', 'reconnect-scoreline')
  scoreline.appendChild(el('div', 'reconnect-score', `
    <b>${joined.length}<i>/ ${m.requiredAgents}</i></b><span>ARMY here</span>
  `))
  progressHost.appendChild(scoreline)
  progressHost.appendChild(labeledBar('Team signal', `${joined.length}/${m.requiredAgents}`,
    Math.round((joined.length / m.requiredAgents) * 100), need === 0))

  if (res.variant === 'connect' && m.sharedTrack) {
    const st = m.sharedTrack
    const pct = Math.min(100, Math.round((st.progress / Math.max(1, st.target)) * 100))
    scoreline.appendChild(el('div', 'reconnect-score', `
      <b>${st.progress}<i>/ ${st.target}</i></b><span>streams together</span>
    `))
    progressHost.appendChild(labeledBar(`Combined ${esc(st.label)} streams`, `${st.progress}/${st.target}`,
      pct, st.progress >= st.target))
    progressHost.appendChild(el('p', 'muted reconnect-together-note', `Every teammate's qualifying ${esc(st.label)} plays join this total.`))
  } else if (res.variant === 'connect' && m.checklist) {
    const total = m.checklist.total
    const myDone = Math.min(total, Number(myRow?.streams) || 0)
    const clearedCount = joined.filter((p) => Math.min(total, Number(p.streams) || 0) >= total).length
    scoreline.appendChild(el('div', 'reconnect-score', `
      <b>${clearedCount}<i>/ ${joined.length}</i></b><span>lists cleared</span>
    `))
    progressHost.appendChild(labeledBar('Your playlist progress', `${myDone}/${total} tracks`,
      Math.round((myDone / Math.max(1, total)) * 100), myDone >= total))
    progressHost.appendChild(el('p', 'muted reconnect-together-note', `Everyone clears the playlist once on their own.`))
    const playlistUrl = String(res.config.checklist?.playlistUrl || '')
    if (/^https:\/\/open\.spotify\.com\/playlist\//i.test(playlistUrl)) {
      const playlist = el('a', 'reconnect-playlist-link', '<span aria-hidden="true">♫</span><span><b>THIS IS RM</b><small>Open the mission playlist on Spotify</small></span><i aria-hidden="true">↗</i>')
      playlist.href = playlistUrl
      playlist.target = '_blank'
      playlist.rel = 'noopener noreferrer'
      progressHost.appendChild(playlist)
    }
  } else if (res.variant === 'connect') {
    const streamedCount = joined.filter((p) => p.streamed).length
    scoreline.appendChild(el('div', 'reconnect-score', `
      <b>${streamedCount}<i>/ ${joined.length}</i></b><span>signals sent</span>
    `))
    progressHost.appendChild(el('p', 'muted reconnect-together-note', `${streamedCount}/${joined.length} have streamed toward their own goals here since joining.`))
  }
  box.appendChild(progressHost)

  const nextBlock = reconnectNextBlock(nextTitle, nextBody)
  box.appendChild(nextBlock)
  const primaryHost = el('div', 'reconnect-primary-action')
  box.appendChild(primaryHost)

  // Phase two, once the streaming target is hit and the goal carries a
  // cipher sequence (see reconnect-missions.ts's refreshMission) — the
  // whole team shares one prompt and one attempt pool, so this is deliberately
  // placed right above the team chat: solving it is meant to happen there,
  // not alone.
  if (res.variant === 'connect' && m.cipher) {
    const cipherPanel = el('div', 'reconnect-cipher-panel')
    cipherPanel.appendChild(el('div', 'eyebrow', 'CIPHER'))
    cipherPanel.appendChild(el('p', 'muted', `Cipher ${m.cipher.index + 1} of ${m.cipher.total} — talk it out, then submit one answer together.`))
    cipherPanel.appendChild(el('p', 'muted', m.cipher.prompt))
    if (m.cipher.attemptsLeft <= 0) {
      const help = el('a', 'btn btn-ghost reconnect-help-link', 'Ask for help in ReConnect GC')
      help.href = 'https://ig.me/j/AbZYVFwKMMuh1zzV/'
      help.target = '_blank'
      help.rel = 'noopener noreferrer'
      cipherPanel.appendChild(help)
    } else {
      const cipherRow = el('div', 'reconnect-invite-row reconnect-cipher-action')
      const cipherInput = el('input', 'ob-input')
      cipherInput.placeholder = 'Your answer'
      const cipherSubmit = el('button', 'btn btn-primary', 'Submit')
      cipherSubmit.onclick = async () => {
        const answer = cipherInput.value.trim()
        if (!answer) { toast(reconnectError('answer_required')); return }
        cipherSubmit.disabled = true
        const r = await call('submitReconnectMissionCipherAnswer', { agentNo: me, districtId: d.id, answer })
        cipherSubmit.disabled = false
        if (!r.success) { toast(reconnectError(r.error)); return }
        if (r.solved) toast(r.allSolved ? 'Cracked it — mission complete!' : `Cracked it — ${r.cipherIndex}/${r.ciphersTotal} down, on to the next one.`)
        else toast(r.attemptsLeft > 0 ? 'Not quite — try again.' : "Out of attempts on this one.")
        refresh()
      }
      cipherRow.append(cipherInput, cipherSubmit)
      cipherPanel.appendChild(cipherRow)
      cipherPanel.appendChild(el('div', 'dim', `${m.cipher.attemptsLeft} ${m.cipher.attemptsLeft === 1 ? 'try' : 'tries'} left on this cipher, shared across the team`))
    }
    primaryHost.appendChild(cipherPanel)
  }

  // The one thing the sender would otherwise never learn: their invite ran
  // out. Without this the name just disappeared from the roster (it used to
  // be hard-deleted) and they'd be left wondering whether they'd imagined
  // inviting anyone. Says plainly that the slot is theirs to use again.
  if (expired.length && need > 0) {
    const who = expired.map((p) => esc(p.codename)).join(', ')
    problemHost.appendChild(el('p', 'muted reconnect-expired-note',
      expired.length === 1
        ? `${who} didn't reply within a day, so that invite expired — the slot's free again, invite someone else below.`
        : `${who} didn't reply within a day, so those invites expired — the slots are free again, invite someone else below.`))
  }

  // The other way a teammate silently stops counting: their own 7-day
  // restoration window on this district ran out, which deletes their attempt
  // and leaves them unable to see this mission at all. Without this the
  // partner just watches the shared total stop moving forever.
  if (dropped.length) {
    const who = dropped.map((p) => esc(p.codename)).join(', ')
    problemHost.appendChild(el('p', 'muted reconnect-expired-note',
      `${who} ran out of time restoring this district, so they can't contribute here until they start it again. You're free to team up with someone else${need > 0 ? ' below' : ''}.`))
  }

  // A teammate who's gone quiet. Named plainly so the person still playing
  // knows the stall isn't their own doing and has a way out — either drop
  // them (creator) or leave (anyone). Deliberately never says anything about
  // someone streaming *less*: only silence is called out, so nobody gets
  // pressured for playing at their own pace.
  if (idlers.length) {
    const who = idlers.map((p) => esc(p.codename)).join(', ')
    // On the final day the bar for "gone quiet" drops to a single day (see
    // idleThresholdFor) — say so, otherwise dropping someone who only missed
    // yesterday looks arbitrary next to the usual couple-of-days wording.
    const urgent = res.idleThreshold === 1
    problemHost.appendChild(el('p', 'muted reconnect-expired-note',
      `${who} ${idlers.length === 1 ? "hasn't" : "haven't"} streamed ${urgent ? 'today' : 'in a couple of days'}. `
      + (urgent ? "You're on the last day here, so you don't have to wait them out. " : '')
      + (m.isCreator
        ? 'You can drop them below and invite someone else, or give them more time — nothing is lost either way.'
        : "You can leave this mission and team up with someone else if you'd rather not wait.")))
  }

  // Only relevant while a slot is still open — once the team's full, extra
  // pending invites can't do anything either way.
  if (pending.length && need > 0) {
    box.appendChild(el('p', 'muted',
      `Only ${need} more acceptance${need === 1 ? '' : 's'} needed to fill the team — any other pending invites can stay pending or expire on their own.`))
  }

  const list = el('div', 'reconnect-roster')
  for (const p of m.participants) {
    // Three separate states, not one blended one: still-pending, ready
    // (joined) with nothing counted yet, and ready with a real number.
    const statusText = p.inviteExpired ? 'No reply &middot; expired'
      : p.leftDistrict ? 'Ran out of time here'
      : p.status === 'invited' ? 'Invite pending'
      : p.idle ? `Quiet ${p.quietDays >= 3 ? '3+' : p.quietDays} day${p.quietDays === 1 ? '' : 's'}${p.streams ? ` &middot; ${p.streams}${m.checklist ? `/${m.checklist.total} tracks` : ` stream${p.streams === 1 ? '' : 's'}`}` : ''}`
      : res.variant === 'invite' ? '✓ Ready'
      : m.checklist ? `Ready &middot; ${p.streams ?? 0}/${m.checklist.total} tracks`
      : `Ready &middot; ${p.streams ?? 0} stream${(p.streams ?? 0) === 1 ? '' : 's'}`
    // A checklist goal's roster can expand each row into that agent's own
    // tick-list — any teammate's, not just your own, since the aggregate
    // count next to their name already tells the whole team the same
    // information; this just breaks it out by track. Only offered once
    // refreshMission has actually computed a per-track array for them
    // (joined + counted this pass), same guard collectionBadgeIds-style
    // features use for "don't render a toggle with nothing to show."
    const checklistTracks = m.checklist && Array.isArray(p.checklistTracks) ? p.checklistTracks : null
    const trackList = res.config.checklist?.tracks || []
    const row = el('div', 'reconnect-agent'
      + (checklistTracks ? ' has-checklist' : '')
      + (p.status === 'invited' ? ' is-pending' : '')
      + (p.idle ? ' is-idle' : '')
      + (p.inviteExpired || p.leftDistrict ? ' is-expired' : ''))
    row.dataset.agentCodename = p.codename
    const head = el('div', 'reconnect-agent-head')
    let toggle = null
    if (checklistTracks) {
      const done = Math.min(m.checklist.total, Number(p.streams) || 0)
      toggle = el('button', 'reconnect-agent-toggle', `
        <span class="reconnect-agent-identity"><b>${esc(p.codename)}${p.isMe ? ' <small>(you)</small>' : ''}</b><small>${p.idle ? `Quiet ${p.quietDays >= 3 ? '3+' : p.quietDays} day${p.quietDays === 1 ? '' : 's'}` : 'Tap to view checklist'}</small></span>
        <span class="reconnect-agent-progress"><b>${done}<i>/</i>${m.checklist.total}</b><small>tracks</small></span>
        <span class="reconnect-agent-chevron" aria-hidden="true">⌄</span>
      `)
      toggle.type = 'button'
      toggle.setAttribute('aria-expanded', 'false')
      toggle.setAttribute('aria-label', `${p.codename}: ${done} of ${m.checklist.total} tracks. Show checklist`)
      head.appendChild(toggle)
    } else {
      head.innerHTML = `<span>${esc(p.codename)}${p.isMe ? ' (you)' : ''}</span><span>${statusText}</span>`
    }
    row.appendChild(head)
    if (checklistTracks) {
      const detail = el('div', 'reconnect-checklist-detail')
      detail.hidden = true
      const done = Math.min(m.checklist.total, Number(p.streams) || 0)
      detail.innerHTML = `<div class="reconnect-checklist-summary"><span>${esc(p.codename)}'s checklist</span><b>${done} of ${m.checklist.total} complete</b></div>
        <div class="reconnect-checklist-mini"><i style="width:${Math.round((done / Math.max(1, m.checklist.total)) * 100)}%"></i></div>
        <ul class="reconnect-checklist-list">${
          trackList.map((t, i) => `<li class="${checklistTracks[i] ? 'is-done' : ''}"><span>${String(i + 1).padStart(2, '0')}</span><i aria-hidden="true">${checklistTracks[i] ? '✓' : '○'}</i><b>${esc(t.label)}</b></li>`).join('')
        }</ul>`
      toggle.onclick = () => {
        const opening = detail.hidden
        if (opening) {
          list.querySelectorAll('.reconnect-checklist-detail').forEach((other) => { other.hidden = true })
          list.querySelectorAll('.reconnect-agent-toggle').forEach((other) => { other.setAttribute('aria-expanded', 'false') })
        }
        detail.hidden = !opening
        toggle.setAttribute('aria-expanded', String(!detail.hidden))
        toggle.setAttribute('aria-label', `${p.codename}: ${done} of ${m.checklist.total} tracks. ${detail.hidden ? 'Show' : 'Hide'} checklist`)
      }
      row.appendChild(detail)
    }
    const msg = el('div', 'reconnect-row-msg')
    // Only the mission creator sees this, and only next to someone who
    // hasn't contributed anything yet — server already enforces both, this
    // is just not offering a button that would only come back as an error.
    // Still-pending vs. already-joined reads as two different actions even
    // though the server call is the same one either way.
    if (m.isCreator && p.removable) {
      const removeBtn = el('button', 'reconnect-remove',
        p.inviteExpired ? 'Clear'
          : p.status === 'invited' ? 'Cancel invite'
          : p.leftDistrict ? 'Clear'
          : p.idle ? 'Drop' : 'Remove')
      removeBtn.onclick = async (e) => {
        e.stopPropagation() // sits inside the same clickable head as the checklist toggle
        const action = p.status === 'invited' ? 'Cancel this invitation?' : `Remove ${p.codename} from this mission?`
        if (!window.confirm(`${action}\n\nThey will no longer count toward this ReConnect team.`)) return
        removeBtn.disabled = true
        msg.textContent = ''
        msg.classList.remove('is-error')
        const r = await call('removeReconnectParticipant', { agentNo: me, districtId: d.id, targetAgentNo: p.agentNo })
        if (r.success) {
          toast(p.inviteExpired ? `Cleared the expired invite to ${p.codename}`
            : p.status === 'invited' ? `Cancelled the invite to ${p.codename}` : `Removed ${p.codename}`)
          refresh()
        } else {
          msg.textContent = reconnectError(r.error)
          msg.classList.add('is-error')
          removeBtn.disabled = false
        }
      }
      head.appendChild(removeBtn)
    }
    // Your own way out, whoever opened the mission. The creator already had
    // levers; an agent who accepted an invite had none at all and could only
    // wait out the 7-day expiry.
    if (p.isMe && p.canLeave && p.status === 'joined') {
      const leaveBtn = el('button', 'reconnect-remove', 'Leave')
      leaveBtn.onclick = async (e) => {
        e.stopPropagation() // sits inside the same clickable head as the checklist toggle
        if (!window.confirm('Leave this ReConnect mission?\n\nYour team membership will be removed and you will need to team up again.')) return
        leaveBtn.disabled = true
        msg.textContent = ''
        msg.classList.remove('is-error')
        const r = await call('removeReconnectParticipant', { agentNo: me, districtId: d.id, targetAgentNo: p.agentNo })
        if (r.success) { toast('Left the mission — you can team up with someone else now'); refresh() }
        else {
          msg.textContent = reconnectError(r.error)
          msg.classList.add('is-error')
          leaveBtn.disabled = false
        }
      }
      head.appendChild(leaveBtn)
    }
    list.append(row, msg)
  }
  box.appendChild(list)

  if (myRow?.status === 'invited') {
    const inviteNote = el('p', 'muted', res.variant === 'invite'
      ? "You've been invited to team up here — accepting alone completes your part, no streaming needed."
      : m.sharedTrack
        ? `You've been invited to team up here. Accept to join — once you do, stream ${esc(m.sharedTrack.label)} along with everyone else here until you've hit ${m.sharedTrack.target} between you.`
        : m.checklist
          ? `You've been invited to team up here. Accept to join — then stream every one of the ${m.checklist.total} playlist tracks once on your own.`
          : "You've been invited to team up here. Accept to join — once you do, stream toward your own goals here at least once.")
    box.appendChild(inviteNote)
    const row = el('div', 'reconnect-invite-actions')
    const accept = el('button', 'btn btn-primary', 'Accept')
    accept.onclick = async () => {
      accept.disabled = true
      const r = await call('respondReconnectInvite', { agentNo: me, districtId: d.id, accept: true })
      if (r.success) refresh(); else { toast(reconnectError(r.error)); accept.disabled = false }
    }
    const decline = el('button', 'btn btn-ghost', 'Decline')
    decline.onclick = async () => {
      if (!window.confirm('Decline this ReConnect invitation?\n\nThe sender can then invite someone else.')) return
      decline.disabled = true
      const r = await call('respondReconnectInvite', { agentNo: me, districtId: d.id, accept: false })
      if (r.success) refresh(); else { decline.disabled = false }
    }
    accept.classList.add('reconnect-main-action')
    primaryHost.appendChild(accept)
    row.appendChild(decline)
    box.appendChild(row)
  } else if (myRow?.status === 'joined') {
    // A live pending invite already reserves that open seat. Do not offer a
    // second primary invite action while the screen says to wait for the
    // first response; only recruit when uncovered seats remain.
    if (need > pending.length) {
      // A <select> of codenames read as "pick an option from a menu," which
      // is why 20 agents could sit here for days each waiting on a partner
      // while every one of them was visible to all the others the whole
      // time. Same call, same data — rendered as a queue of real people who
      // are stuck, each with their own button, so the screen says "these
      // agents need someone" instead of "choose an agent…".
      const intro = el('p', 'muted', 'Loading who needs a partner…')
      box.appendChild(intro)
      const waitList = el('div', 'reconnect-waitlist')
      box.appendChild(waitList)
      // Optional — becomes the first line of the mission's shared thread
      // (see the chat section below), so "hey, let's team up!" and
      // whatever comes after it are one continuous conversation.
      const noteInput = el('input', 'ob-input')
      noteInput.placeholder = 'Add a message (optional)'
      noteInput.maxLength = 240
      box.appendChild(noteInput)
      const inviteMsg = el('div', 'reconnect-row-msg')
      box.appendChild(inviteMsg)

      call('getInviteCandidates', { agentNo: me, districtId: d.id }).then((res2) => {
        if (!res2?.success) { intro.textContent = "Couldn't load who's free — try again."; return }
        if (!res2.candidates?.length) {
          intro.remove()
          noteInput.remove()
          const emptyCopy = {
            agents_still_on_home_base: `${res2.stillOnHomeBase} ${res2.stillOnHomeBase === 1 ? 'agent is' : 'agents are'} still at Home Base. They can join after reaching this district.`,
            no_matching_agents: 'Nobody else has this ReConnect goal here yet.',
            everyone_completed: 'Everyone else with this goal has already completed it.',
            everyone_busy: 'Compatible agents are already teamed up or answering another invite.',
          }[res2.emptyReason] || "Nobody's free to invite right now."
          waitList.appendChild(el('p', 'muted reconnect-empty-reason', emptyCopy))

          const alertBtn = el('button', 'btn btn-ghost reconnect-alert-toggle',
            res2.alertActive ? '🔔 Partner alert is on' : '🔔 Tell me when someone is free')
          alertBtn.onclick = async () => {
            alertBtn.disabled = true
            const active = !res2.alertActive
            const r = await call('setReconnectMatchAlert', { agentNo: me, districtId: d.id, active })
            if (!r.success) { alertBtn.disabled = false; inviteMsg.textContent = reconnectError(r.error); return }
            res2.alertActive = active
            alertBtn.disabled = false
            alertBtn.className = 'btn btn-ghost reconnect-alert-toggle'
            alertBtn.textContent = active ? '🔔 Partner alert is on' : '🔔 Tell me when someone is free'
            toast(active ? "We'll ring the bell when a partner is available." : 'Partner alert turned off')
          }
          primaryHost.appendChild(alertBtn)
          return
        }
        const n = res2.candidates.length
        const onlineCount = res2.candidates.filter((c) => c.online).length
        // Named up front, not just left to the green dots below — worth
        // knowing before scanning the list whether inviting right now has
        // good odds of a quick accept, or is a message in a bottle either way.
        const onlineNote = onlineCount ? ` ${onlineCount} of them ${onlineCount === 1 ? 'is' : 'are'} online right now.` : ''
        intro.textContent = (n === 1
          ? '1 agent is waiting for a partner here.'
          : `${n} agents are waiting for a partner here.`)
          + onlineNote + ' Invite one and they get a notification to accept.'
        const sendInvite = async (candidate) => {
          for (const b of box.querySelectorAll('.rw-invite, .reconnect-best-invite')) b.disabled = true
          inviteMsg.textContent = ''
          inviteMsg.classList.remove('is-error')
          const r = await call('inviteReconnectMission',
            { agentNo: me, districtId: d.id, inviteeAgentNo: candidate.agentNo, message: noteInput.value.trim() })
          if (r.success) { toast(`Invited ${r.inviteeCodename || candidate.codename}`); refresh(); return }
          inviteMsg.textContent = reconnectError(r.error)
          inviteMsg.classList.add('is-error')
          for (const b of box.querySelectorAll('.rw-invite, .reconnect-best-invite')) b.disabled = false
        }
        const best = res2.candidates[0]
        const bestMeta = el('div', 'reconnect-best-meta',
          `Best available &middot; ${best.online ? 'Online' : esc(waitedLabel(best.waitingSince))}`)
        const bestBtn = el('button', 'btn btn-primary reconnect-best-invite',
          `Invite ${best.codename}`)
        bestBtn.onclick = () => sendInvite(best)
        primaryHost.append(bestMeta, bestBtn)
        const otherAgents = el('details', 'reconnect-other-agents')
        otherAgents.appendChild(el('summary', '', 'See other agents'))
        const otherList = el('div', 'reconnect-waitlist')
        for (const c of res2.candidates.slice(1)) {
          // Online first (server already sorts the list this way) — flagged
          // here too, since an invite to someone actually in the app right
          // now has real odds of getting answered in the next few minutes.
          const row = el('div', 'reconnect-wait-row' + (c.online ? ' is-online' : ''))
          row.innerHTML = (c.online ? '<i class="rw-online-dot" title="Online now"></i>' : '')
            + `<span class="rw-name">${esc(c.codename)}</span>`
            + `<span class="rw-since">${c.online ? 'Online now' : esc(waitedLabel(c.waitingSince))}</span>`
          const btn = el('button', 'btn btn-ghost rw-invite', 'Invite')
          // Agent numbers ride along as data and are never rendered.
          btn.onclick = () => sendInvite(c)
          row.appendChild(btn)
          otherList.appendChild(row)
        }
        otherAgents.appendChild(otherList)
        if (res2.candidates.length > 1) waitList.appendChild(otherAgents)
      })
    }
  }
  // No third branch here anymore — getReconnectMission only ever returns a
  // mission the caller already participates in (invited or joined), so
  // reaching this panel with an open mission and no row of your own is no
  // longer possible. That was the "Join this mission" matchmaking button.

  // Everything outside the three player questions becomes secondary. The
  // controls still exist for recovery/support, but no longer compete with
  // Mission → Team → Next Step on first glance.
  const detailsBody = el('div', 'reconnect-details-body')
  const keep = new Set([
    box.querySelector(':scope > .eyebrow'),
    box.querySelector(':scope > .reconnect-mission-core'),
    box.querySelector(':scope > .reconnect-team-core'),
    problemHost, progressHost, nextBlock, primaryHost,
  ].filter(Boolean))
  for (const child of [...box.children]) {
    if (!keep.has(child)) detailsBody.appendChild(child)
  }
  if (detailsBody.childElementCount) box.appendChild(reconnectDisclosure('Details', detailsBody))

  const chat = existingChat?.querySelector('.reconnect-chat') || chatPanel(d, m, refresh)
  if (existingChat) updateChatThread(chat, m.messages, {
    emptyText: 'No messages yet — say hi to your team.',
  })
  const unread = reconnectChatUnreadCount(m.messageCount, getReconnectChatSeen(m.id))
  const badge = reconnectChatBadgeText(unread)
  const chatDisclosure = existingChat || reconnectDisclosure('', chat, !!m.cipher)
  chatDisclosure.classList.add('reconnect-chat-disclosure')
  chatDisclosure.dataset.missionId = m.id
  chatDisclosure.querySelector(':scope > summary').innerHTML =
    `Team Chat${badge ? ` <span class="reconnect-chat-badge">${esc(badge)} new</span>` : ''}`
  const markChatRead = () => {
    if (!chatDisclosure.open) return
    markReconnectChatSeen(m.id, m.messageCount)
    chatDisclosure.querySelector('.reconnect-chat-badge')?.remove()
  }
  chatDisclosure.ontoggle = markChatRead
  box.appendChild(chatDisclosure)
  if (focusedChatInput?.isConnected) {
    focusedChatInput.focus({ preventScroll: true })
    if (chatSelection?.start != null) {
      focusedChatInput.setSelectionRange(chatSelection.start, chatSelection.end)
    }
  }
  if (chatDisclosure.open) markChatRead()
  restoreViewState()
}

/** The mission's shared thread — an invite's optional note and the ongoing
 *  coordination chat once paired up are the same feature (see the
 *  migration's own comment), so this renders for anyone currently invited
 *  OR joined here, not just after both sides have accepted. Rendering
 *  itself now lives in chat-thread.js, shared with ARMY Comms
 *  (bomb-sheet.js) — this is just the ReConnect-specific wiring on top. */
function chatPanel(d, m, refresh) {
  const wrap = el('div')
  wrap.appendChild(chatThread(m.messages, {
    placeholder: 'Message your team…',
    emptyText: 'No messages yet — say hi to your team.',
    onSend: (body) => call('sendReconnectMessage', { agentNo: getAgentNo(), districtId: d.id, message: body }),
    onSent: refresh,
    errorText: reconnectError,
  }))
  return wrap
}

/** A progress bar with its own label directly above it ("Team members —
 *  1/2", "Combined Haegeum streams — 22/100") instead of leaning on the
 *  number at the right alone to say what's being measured. */
function labeledBar(label, countText, pct, done) {
  const wrap = el('div', 'lbar')
  wrap.innerHTML = `
    <div class="lbar-head"><span>${esc(label)}</span><b>${esc(countText)}</b></div>
    <div class="pbar" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.max(0, Math.min(100, pct))}"><div class="pfill${done ? ' done' : ''}" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>
  `
  return wrap
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
