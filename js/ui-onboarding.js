// Onboarding: codename + mode → enter the network. No story screen — the
// lore intro was cut so a new agent is one screen from the game.
//
// Someone who came from a MAMA voting link skips even that: a codename is
// picked for them (changeable in Settings), mode stays Easy, and they land
// straight on the voting screen. See onboarding-path.js.

import { call } from './api.js'
import { el, esc, toast, setState, showOverlay } from './state.js'
import { agentManualSheet } from './agent-manual.js'
import { openStreamSource, uplinkBroken } from './settings-streams.js'
import { wardDisplayName, districtDisplayName } from './ward-tiles.js'
import { fromVotingLink, suggestCodename } from './onboarding-path.js'
import { readInvite } from './battle-invite.js'

const ERRORS = {
  codename_invalid: 'Codenames are 3-24 letters or numbers — and can\'t be your agent number or Instagram handle.',
  codename_taken: 'That one\'s taken. Try another.',
  already_joined: 'You\'re already in — reloading…',
}

export function renderOnboarding(container, payload, agentNo, onJoined) {
  container.innerHTML = ''
  container.hidden = false
  let voting = false
  try { voting = fromVotingLink(location.search, readInvite(localStorage)) } catch { /* no storage */ }
  if (voting) quickJoin(container, payload, agentNo, onJoined)
  else renderIdentity(container, payload, agentNo, onJoined)
}

/** Voting-link path: join with a picked codename and go straight in. Falls
 *  back to the normal codename screen if joining keeps failing. */
async function quickJoin(container, payload, agentNo, onJoined) {
  const wrap = el('div', 'ob-wrap')
  wrap.append(el('div', 'eyebrow', 'ALMOST THERE'), el('h1', 'title-sm', 'Opening MAMA voting…'))
  container.appendChild(wrap)
  for (let i = 0; i < 4; i++) {
    const codename = suggestCodename()
    const res = await call('joinGame', { agentNo, codename, mode: 'easy' }).catch(() => null)
    if (res?.success || res?.error === 'already_joined') {
      container.hidden = true
      if (res.joined) setState(res)
      onJoined()
      if (res.success) toast(`Your codename is ${res.player?.codename || codename}. Change it any time in Settings.`)
      return
    }
    if (res?.error !== 'codename_taken' && res?.error !== 'codename_invalid') break
  }
  container.innerHTML = ''
  renderIdentity(container, payload, agentNo, onJoined)
}

function renderIdentity(container, payload, agentNo, onJoined) {
  const intro = payload.intro || {}
  const modes = payload.modes || {}

  // ── Codename + mode ──
  const step2 = el('div', 'ob-wrap')
  step2.append(
    el('div', 'eyebrow', 'IDENTITY SETUP'),
    el('h1', 'title-sm', esc(intro.welcome || 'Welcome, Agent.')),
    el('p', 'muted', 'Pick a codename. Everyone sees this one, so don\'t use your agent number or Instagram handle.'),
  )
  const input = el('input', 'ob-input')
  input.placeholder = 'Your codename'
  input.maxLength = 24
  step2.appendChild(input)

  step2.appendChild(el('p', 'muted', '<br>How many accounts are you streaming on?'))
  const modeGrid = el('div', 'mode-grid')
  let selectedMode = 'easy'
  const order = ['easy', 'steady', 'medium', 'hard']
  // 10/15/20/30 streams per XP on easy/steady/medium/hard — same fixed ladder
  // config.ts's streamsPerXpFor() defaults to, shown here so the tradeoff
  // (bigger targets AND slower XP, not just bigger targets) is visible
  // before it's picked, not discovered later in Settings.
  const STREAMS_PER_XP = { easy: 10, steady: 15, medium: 20, hard: 30 }
  for (const key of order) {
    if (!modes[key]) continue
    const opt = el('div', 'mode-opt' + (key === selectedMode ? ' sel' : ''),
      `<div class="t">${esc(modes[key].label || key)}</div><div class="dim">Targets ×${esc(modes[key].multiplier)} · ${STREAMS_PER_XP[key]} goal streams = 1 XP</div>`)
    opt.onclick = () => {
      selectedMode = key
      modeGrid.querySelectorAll('.mode-opt').forEach((o) => o.classList.remove('sel'))
      opt.classList.add('sel')
    }
    modeGrid.appendChild(opt)
  }
  step2.appendChild(modeGrid)
  const btn2 = el('button', 'btn btn-primary', 'Lock it in')
  step2.appendChild(btn2)
  container.appendChild(step2)
  input.focus()

  btn2.onclick = async () => {
    const codename = input.value.trim()
    if (codename.length < 3) { toast('Needs at least 3 characters'); return }
    btn2.disabled = true
    btn2.textContent = 'SENDING…'
    const res = await call('joinGame', { agentNo, codename, mode: selectedMode })
    btn2.disabled = false
    btn2.textContent = 'Lock it in'
    if (!res.success && res.error !== 'already_joined') {
      toast(ERRORS[res.error] || res.error || 'Something went wrong')
      return
    }
    // Hold the joined state back until the first-run screens are done:
    // setState() publishes to main.js's subscriber, which flips straight to
    // the game and hides this container.
    showFirstRun(container, agentNo, res.joined ? res : null, onJoined)
  }
}

/* ── first run ────────────────────────────────────────────────────────────
   This only ever runs once per account — main.js only calls
   renderOnboarding for an agent that hasn't joined yet, and joining is a
   one-way transition. That makes it the one guaranteed moment to catch two
   things before dropping someone into the full World screen (Bomb, map,
   resources, settings, all at once): whether their stream source actually
   works at all (see settings-streams.js's own header comment — skipping
   that field used to mean zero counted streams with no explanation, forever,
   silently), and telling them the one concrete first move instead of
   leaving them to find the one open district themselves. */

function showFirstRun(container, agentNo, joinedState, onJoined) {
  const step4 = el('div', 'ob-wrap')
  container.innerHTML = ''
  container.appendChild(step4)

  const enter = () => {
    container.hidden = true
    if (joinedState) setState(joinedState)
    onJoined()
  }
  const showFirstMove = () => renderFirstMove(step4, joinedState, enter)

  call('getAccount', { agentNo }).then((res) => {
    if (res.success && uplinkBroken(res.account)) {
      renderUplinkPrompt(step4, res.account, showFirstMove)
    } else {
      showFirstMove()
    }
  }).catch(showFirstMove) // best-effort — never block joining over this check failing
}

function renderUplinkPrompt(mount, account, onContinue) {
  mount.innerHTML = ''
  mount.append(
    el('div', 'eyebrow', 'ONE THING FIRST'),
    el('h1', 'title-sm', 'Where do your streams come from?'),
    el('p', 'muted', "Without this, your assigned goal streams cannot be verified for XP or district restoration. Takes a few seconds."),
  )
  const go = el('button', 'btn btn-primary', 'Set it up')
  go.onclick = () => openStreamSource(account, onContinue)
  mount.appendChild(go)
  const skip = el('button', 'auth-link', "I'll do this later")
  skip.onclick = onContinue
  mount.appendChild(skip)
}

function renderFirstMove(mount, joinedState, proceed) {
  mount.innerHTML = ''
  const wards = joinedState?.map?.wards || []
  const districts = joinedState?.map?.districts || []
  const activeDistrict = districts.find((d) => d.status === 'active')
  const ward = wards.find((w) => w.id === activeDistrict?.wardId)
  const districtName = activeDistrict ? districtDisplayName(activeDistrict) : ''
  const wardName = ward ? wardDisplayName(ward) : ''

  mount.append(
    el('div', 'eyebrow', "YOU'RE UP"),
    el('h1', 'title-sm', "Here's the move"),
    el('p', 'muted', activeDistrict
      // Home Base's district and ward share the same display name — skip
      // the redundant "in X" clause whenever they'd repeat.
      ? `${esc(districtName)}${wardName && wardName !== districtName ? ` in ${esc(wardName)}` : ''} is already open. Enter it to see your assigned Track, Album, and ReConnect goals. Only assigned goal streams earn regular XP.`
      : 'One district is already open on the map. Enter it to see your assigned Track, Album, and ReConnect goals. Only assigned goal streams earn regular XP.'),
    el('p', 'dim', 'Keep your ARMY Bomb charged: every 20 counted Album Goal streams earns a Charge Cell, and one Cell adds 2 hours.'),
  )
  mount.appendChild(el('div', 'ob-charge-loop', `
    <span>STREAM</span><i>→</i><span>EARN ⚡</span><i>→</i><span>CHARGE</span><i>→</i><span>KEEP THE CITY LIT</span>
  `))
  const btn = el('button', 'btn btn-primary', 'Show me my first district')
  btn.onclick = proceed
  mount.appendChild(btn)

  // The manual was only ever reachable from Settings, which is the one screen
  // a brand-new agent has no reason to open — so the rules it explains (how
  // teaming up works, what happens when a timer runs out) were effectively
  // undiscoverable at exactly the moment they matter most. Offered here as a
  // second, quieter option so it never competes with the real call to action.
  const manual = el('button', 'btn btn-ghost ob-manual-link', '📖 Read the Agent Manual first')
  manual.onclick = () => showOverlay(agentManualSheet())
  mount.appendChild(manual)
}
