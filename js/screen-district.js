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
    // Built here (screen-district.js owns the interactive open/invite/accept
    // flow) but handed to renderBoard so it can be positioned right after
    // Track Mission instead of tacked on after every other card — see
    // renderBoard's own comment. Only when there's an unfinished reconnect
    // goal to actually show; a finished one gets a quiet compact row from
    // renderBoard itself with nothing left to interact with.
    const reconnectBox = d.reconnect && !d.reconnect.done ? reconnectPanel(d) : null
    renderBoard(board, d, { reconnectBox })
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
  already_completed: "You've already finished this together — refreshing…",
  already_paired_elsewhere: "You're already teamed up with someone else here — decline this invite first if you want to switch.",
  invitee_not_eligible: "That agent isn't actively restoring this district.",
  invitee_required: 'Enter an agent number to invite.',
  cannot_invite_self: "You can't invite yourself.",
  not_in_mission: 'Open or join a mission before inviting someone.',
  no_pending_invite: "You don't have a pending invite here.",
  invite_expired: 'That invite expired after a day unanswered — ask them to send a new one.',
  target_required: 'Something went wrong picking who to remove.',
  cannot_remove_self: "You can't remove yourself — decline or leave isn't available here.",
  not_mission_creator: 'Only whoever opened this mission can remove someone from it.',
  already_contributed: "They've already streamed toward this — can't remove them now.",
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
    // Name the partner. An agent who got here by ACCEPTING an invite never
    // sent one themselves, so a bare "everyone's in" reads as the mission
    // completing on its own — one player reported exactly that ("I didn't
    // invite anyone but it's completed"). Saying who they teamed up with
    // makes the other half of the flow visible after the fact.
    const others = (m.participants || []).filter((p) => !p.isMe && p.status === 'joined')
    const withWho = others.length ? ` with ${others.map((p) => esc(p.codename)).join(' and ')}` : ''
    const done = m.sharedTrack
      ? `Done — you teamed up${withWho} and ${esc(m.sharedTrack.label)} hit ${m.sharedTrack.target} between you. Reward lands once the district finishes.`
      : `Done — you teamed up${withWho}. Reward lands once the district finishes.`
    box.appendChild(el('p', 'muted', done))
    return
  }

  const myRow = m?.participants?.find((p) => p.isMe)

  if (!m || m.status !== 'open') {
    const st = res.config.sharedTrack
    box.appendChild(el('p', 'muted', res.variant === 'invite'
      ? `Invite ${res.config.requiredAgents} agents who are also restoring ${esc(districtDisplayName(d))} to help out — no streaming needed from them, just a yes.`
      : st
        ? `Team up with ${res.config.requiredAgents} agents also restoring ${esc(districtDisplayName(d))}. Open a mission, then invite someone specific — once they accept, stream ${esc(st.label)} — everyone's own plays add up together until you hit ${st.target}.`
        : `Team up with ${res.config.requiredAgents} agents also restoring ${esc(districtDisplayName(d))} — open a mission, then invite someone specific. Once they accept, everyone needs to keep streaming toward their own goals here.`))
    // Who's already standing here, BEFORE committing to open anything. The
    // pickable list used to appear only after opening a mission, so this
    // screen — the one everybody sees first — could never say whether
    // anyone was actually around to team up with. "Open a mission" reads as
    // a shot in the dark without it, and as answering someone with it.
    const waiting = el('p', 'muted reconnect-waiting-now')
    box.appendChild(waiting)
    call('getInviteCandidates', { agentNo: me, districtId: d.id }).then((res2) => {
      const n = res2?.success ? (res2.candidates?.length || 0) : 0
      if (!n) { waiting.remove(); return }
      waiting.innerHTML = n === 1
        ? `<b>1 agent is waiting for a partner here right now.</b> Open a mission to invite them.`
        : `<b>${n} agents are waiting for a partner here right now.</b> Open a mission to invite one.`
    })

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

  // A mission is open — show live progress either way. "Ready" (joined) is
  // its own state, separate from "streamed" — a joined agent who hasn't
  // streamed yet is still fully counted toward the team, just with nothing
  // to show on the shared total yet. Leading with a plain-language status
  // line before the bars, because "1/2 joined" reads as a fraction to parse,
  // not a sentence to understand at a glance.
  const joined = m.participants.filter((p) => p.status === 'joined')
  // An expired invite is not pending — nobody is going to answer it. Kept
  // separate so the "only N more acceptances needed" line below doesn't
  // count on a reply that can never come.
  const pending = m.participants.filter((p) => p.status === 'invited' && !p.inviteExpired)
  const expired = m.participants.filter((p) => p.status === 'invited' && p.inviteExpired)
  const need = Math.max(0, m.requiredAgents - joined.length)

  box.appendChild(el('div', 'team-status', `
    <b>Team: ${joined.length} of ${m.requiredAgents} ready</b>
    ${need > 0 ? `<span> &middot; Need ${need} more agent${need === 1 ? '' : 's'}</span>` : ''}
  `))
  box.appendChild(labeledBar('Team members', `${joined.length}/${m.requiredAgents}`,
    Math.round((joined.length / m.requiredAgents) * 100), need === 0))

  if (res.variant === 'connect' && m.sharedTrack) {
    const st = m.sharedTrack
    const pct = Math.min(100, Math.round((st.progress / Math.max(1, st.target)) * 100))
    box.appendChild(labeledBar(`Combined ${esc(st.label)} streams`, `${st.progress}/${st.target}`,
      pct, st.progress >= st.target))
    box.appendChild(el('p', 'muted', `Everyone's own plays of ${esc(st.label)} since they personally joined, added together.`))
  } else if (res.variant === 'connect') {
    const streamedCount = joined.filter((p) => p.streamed).length
    box.appendChild(el('p', 'muted', `${streamedCount}/${joined.length} have streamed toward their own goals here since joining.`))
  }

  // The one thing the sender would otherwise never learn: their invite ran
  // out. Without this the name just disappeared from the roster (it used to
  // be hard-deleted) and they'd be left wondering whether they'd imagined
  // inviting anyone. Says plainly that the slot is theirs to use again.
  if (expired.length && need > 0) {
    const who = expired.map((p) => esc(p.codename)).join(', ')
    box.appendChild(el('p', 'muted reconnect-expired-note',
      expired.length === 1
        ? `${who} didn't reply within a day, so that invite expired — the slot's free again, invite someone else below.`
        : `${who} didn't reply within a day, so those invites expired — the slots are free again, invite someone else below.`))
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
      : p.status === 'invited' ? 'Invite pending'
      : res.variant === 'invite' ? '✓ Ready'
      : `Ready &middot; ${p.streams ?? 0} stream${(p.streams ?? 0) === 1 ? '' : 's'}`
    const row = el('div', 'reconnect-agent'
      + (p.status === 'invited' ? ' is-pending' : '')
      + (p.inviteExpired ? ' is-expired' : ''), `
      <span>${esc(p.codename)}${p.isMe ? ' (you)' : ''}</span>
      <span>${statusText}</span>
    `)
    const msg = el('div', 'reconnect-row-msg')
    // Only the mission creator sees this, and only next to someone who
    // hasn't contributed anything yet — server already enforces both, this
    // is just not offering a button that would only come back as an error.
    // Still-pending vs. already-joined reads as two different actions even
    // though the server call is the same one either way.
    if (m.isCreator && p.removable) {
      const removeBtn = el('button', 'reconnect-remove',
        p.inviteExpired ? 'Clear' : p.status === 'invited' ? 'Cancel invite' : 'Remove')
      removeBtn.onclick = async () => {
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
      row.appendChild(removeBtn)
    }
    list.append(row, msg)
  }
  box.appendChild(list)

  if (myRow?.status === 'invited') {
    box.appendChild(el('p', 'muted', res.variant === 'invite'
      ? "You've been invited to team up here — accepting alone completes your part, no streaming needed."
      : m.sharedTrack
        ? `You've been invited to team up here. Accept to join — once you do, stream ${esc(m.sharedTrack.label)} along with everyone else here until you've hit ${m.sharedTrack.target} between you.`
        : "You've been invited to team up here. Accept to join — once you do, stream toward your own goals here at least once."))
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
    if (need > 0) {
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
          // The list already excludes anyone already invited, joined, or not
          // actively restoring this district — empty means there's genuinely
          // nobody free right now, not a filter mistake.
          intro.remove()
          noteInput.remove()
          waitList.appendChild(el('p', 'muted', 'No free agents right now—check again soon.'))
          return
        }
        const n = res2.candidates.length
        intro.textContent = n === 1
          ? '1 agent is waiting for a partner here. Invite them and they get a notification to accept.'
          : `${n} agents are waiting for a partner here. Invite one and they get a notification to accept.`
        for (const c of res2.candidates) {
          const row = el('div', 'reconnect-wait-row')
          row.innerHTML = `<span class="rw-name">${esc(c.codename)}</span>`
            + `<span class="rw-since">${esc(waitedLabel(c.waitingSince))}</span>`
          const btn = el('button', 'btn btn-ghost rw-invite', 'Invite')
          btn.onclick = async () => {
            // Agent numbers are never shown to players — the number rides
            // along on the row's own data, never rendered.
            for (const b of waitList.querySelectorAll('.rw-invite')) b.disabled = true
            inviteMsg.textContent = ''
            inviteMsg.classList.remove('is-error')
            const r = await call('inviteReconnectMission',
              { agentNo: me, districtId: d.id, inviteeAgentNo: c.agentNo, message: noteInput.value.trim() })
            if (r.success) { toast(`Invited ${r.inviteeCodename || c.codename}`); refresh() }
            else {
              inviteMsg.textContent = reconnectError(r.error)
              inviteMsg.classList.add('is-error')
              for (const b of waitList.querySelectorAll('.rw-invite')) b.disabled = false
            }
          }
          row.appendChild(btn)
          waitList.appendChild(row)
        }
      })
    }
  }
  // No third branch here anymore — getReconnectMission only ever returns a
  // mission the caller already participates in (invited or joined), so
  // reaching this panel with an open mission and no row of your own is no
  // longer possible. That was the "Join this mission" matchmaking button.

  box.appendChild(chatPanel(d, m, refresh))
}

/** The mission's shared thread — an invite's optional note and the ongoing
 *  coordination chat once paired up are the same feature (see the
 *  migration's own comment), so this renders for anyone currently invited
 *  OR joined here, not just after both sides have accepted. Kept simple on
 *  purpose: plain text, oldest first, no read receipts or typing
 *  indicators — this is "leave your teammate a note," not a full DM inbox. */
function chatPanel(d, m, refresh) {
  const wrap = el('div', 'reconnect-chat')
  wrap.appendChild(el('div', 'eyebrow', '💬 TEAM CHAT'))
  const list = el('div', 'reconnect-chat-list')
  if (!m.messages?.length) {
    list.appendChild(el('div', 'muted', 'No messages yet — say hi to your team.'))
  } else {
    for (const msg of m.messages) {
      const row = el('div', 'reconnect-chat-msg' + (msg.isMe ? ' is-me' : ''))
      row.innerHTML = `<b>${esc(msg.isMe ? 'You' : msg.codename)}</b><span>${esc(msg.body)}</span>`
      list.appendChild(row)
    }
  }
  wrap.appendChild(list)

  const composer = el('div', 'reconnect-invite-row')
  const input = el('input', 'ob-input')
  input.placeholder = 'Message your team…'
  input.maxLength = 240
  const sendBtn = el('button', 'btn btn-ghost', 'Send')
  const send = async () => {
    const body = input.value.trim()
    if (!body) return
    input.disabled = true
    sendBtn.disabled = true
    const r = await call('sendReconnectMessage', { agentNo: getAgentNo(), districtId: d.id, message: body })
    input.disabled = false
    sendBtn.disabled = false
    if (r.success) { input.value = ''; refresh() }
    else toast(reconnectError(r.error))
  }
  sendBtn.onclick = send
  input.onkeydown = (e) => { if (e.key === 'Enter') send() }
  composer.append(input, sendBtn)
  wrap.appendChild(composer)
  return wrap
}

/** A progress bar with its own label directly above it ("Team members —
 *  1/2", "Combined Haegeum streams — 22/100") instead of leaning on the
 *  number at the right alone to say what's being measured. */
function labeledBar(label, countText, pct, done) {
  const wrap = el('div', 'lbar')
  wrap.innerHTML = `
    <div class="lbar-head"><span>${esc(label)}</span><b>${esc(countText)}</b></div>
    <div class="pbar"><div class="pfill${done ? ' done' : ''}" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>
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
