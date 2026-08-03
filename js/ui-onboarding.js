// Onboarding: transmission intro → codename + mode → identity assigned →
// enter the network. All copy comes from the server payload (DB-driven).

import { call } from './api.js'
import { el, esc, toast, setState } from './state.js'
import { ambientToggle } from './ambient.js'
import { openStreamSource, uplinkBroken } from './settings-streams.js'

const ERRORS = {
  codename_invalid: 'Codenames are 3-24 letters or numbers — and can\'t be your agent number.',
  codename_taken: 'That one\'s taken. Try another.',
  already_joined: 'You\'re already in — reloading…',
}

export function renderOnboarding(container, payload, agentNo, onJoined) {
  const intro = payload.intro || {}
  const modes = payload.modes || {}
  container.innerHTML = ''
  container.hidden = false

  // ── Step 1: the transmission ──
  const step1 = el('div', 'ob-wrap')
  // Minimal mystery instead of a narrator: same drifting-mist layer the
  // auth screen uses (reconnect.css's .mist), just over the plain dark
  // background here since this screen has no photo of its own.
  step1.appendChild(el('div', 'mist'))
  step1.appendChild(ambientToggle('audio/weather-ambient.mp3'))
  const body = el('div', 'ob-body')
  body.appendChild(typewriterWords(intro.body || ''))
  step1.append(
    el('div', 'eyebrow', esc(intro.title || 'TRANSMISSION')),
    el('h1', 'title-sm', esc(intro.chapter || 'Operation: ReConnect')),
    body,
  )

  // Voice-over for the lore, when the chapter has one. No recording exists
  // for any chapter yet, so intro.audioUrl is never set today and this stays
  // out of the DOM entirely — the day a real narration lands, the server
  // payload gains that one field and this appears with no other code change.
  if (intro.audioUrl) step1.appendChild(voiceoverButton(intro.audioUrl))

  const btn1 = el('button', 'btn btn-primary', "I'm in")
  step1.appendChild(btn1)
  container.appendChild(step1)

  // ── Step 2: codename + mode ──
  const step2 = el('div', 'ob-wrap')
  step2.hidden = true
  step2.append(
    el('div', 'eyebrow', 'IDENTITY SETUP'),
    el('h1', 'title-sm', esc(intro.welcome || 'Welcome, Agent.')),
    el('p', 'muted', 'Pick a codename. Everyone sees this one, so don\'t use your agent number.'),
  )
  const input = el('input', 'ob-input')
  input.placeholder = 'Your codename'
  input.maxLength = 24
  step2.appendChild(input)

  step2.appendChild(el('p', 'muted', '<br>How many devices are you streaming on?'))
  const modeGrid = el('div', 'mode-grid')
  let selectedMode = 'easy'
  const order = ['easy', 'medium', 'hard']
  for (const key of order) {
    if (!modes[key]) continue
    const opt = el('div', 'mode-opt' + (key === selectedMode ? ' sel' : ''),
      `<div class="t">${esc(modes[key].label || key)}</div><div class="dim">Targets ×${esc(modes[key].multiplier)}</div>`)
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

  // ── Step 3: identity assigned + infiltrator warning ──
  const step3 = el('div', 'ob-wrap')
  step3.hidden = true
  container.appendChild(step3)

  btn1.onclick = () => { step1.hidden = true; step2.hidden = false; input.focus() }

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
    // Hold the joined state back until the agent presses "Enter the Network".
    // Calling setState() here publishes to main.js's subscriber, which flips
    // straight to the game and hides this container — so step 3, and with it
    // the agent number and the security notice, never got seen at all.
    const joinedState = res.joined ? res : null
    step2.hidden = true
    step3.innerHTML = ''
    // The agent number was already revealed when the account was created —
    // no need to show it twice in the same minute.
    step3.append(
      el('div', 'eyebrow', 'IDENTITY ASSIGNED'),
      el('h1', 'title-sm', `Codename: ${esc(res.player?.codename || codename)}`),
      el('p', 'muted', 'This is the name other agents see. Your agent number stays private.'),
    )
    const btn3 = el('button', 'btn btn-primary', "Let's go")
    btn3.onclick = () => showFirstRun(container, agentNo, joinedState, onJoined)
    step3.appendChild(btn3)
    step3.hidden = false
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
    el('p', 'muted', "Without this, nothing you stream gets counted — no XP, no restoration, no explanation why. Takes a few seconds."),
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

  mount.append(
    el('div', 'eyebrow', "YOU'RE UP"),
    el('h1', 'title-sm', "Here's the move"),
    el('p', 'muted', activeDistrict
      ? `${esc(activeDistrict.name)}${ward ? ` in ${esc(ward.name)}` : ''} is already open and waiting. Stream any BTS track to start restoring it.`
      : 'One district is already open on the map. Stream any BTS track to start restoring it.'),
    el('p', 'dim', "The ARMY Bomb charges as the network heals — watch it above the map."),
  )
  const btn = el('button', 'btn btn-primary', 'Enter the network')
  btn.onclick = proceed
  mount.appendChild(btn)
}

/* ── typewriter ───────────────────────────────────────────────────────── */

/** The lore reads as a transmission arriving, not a wall of text dumped on
 *  screen — each word fades/rises in on its own staggered CSS delay (.ob-body
 *  .tw-word in reconnect.css). Pure CSS animation-delay rather than a JS
 *  setTimeout chain: it can't drift or desync, and prefers-reduced-motion
 *  turns it off with one rule instead of branching this function.
 *  Splits on whitespace and keeps every whitespace run as a plain text node
 *  (not wrapped), so \n\n paragraph breaks survive for .ob-body's own
 *  white-space: pre-line to render. */
function typewriterWords(text) {
  const frag = document.createDocumentFragment()
  const tokens = String(text).split(/(\s+)/)
  let i = 0
  for (const tok of tokens) {
    if (!tok) continue
    if (/^\s+$/.test(tok)) { frag.appendChild(document.createTextNode(tok)); continue }
    const span = document.createElement('span')
    span.className = 'tw-word'
    span.textContent = tok
    span.style.animationDelay = `${(i * 0.035).toFixed(3)}s`
    i++
    frag.appendChild(span)
  }
  return frag
}

/* ── voice-over ───────────────────────────────────────────────────────── */

/** A play/pause toggle for the chapter's narration. Fails silent, not
 *  broken: if the URL 404s or the format won't play, the button removes
 *  itself rather than sitting there as a dead control. */
function voiceoverButton(src) {
  const audio = new Audio(src)
  const btn = el('button', 'btn btn-ghost ob-voiceover', '▶ Play transmission')
  audio.onerror = () => btn.remove()
  audio.onended = () => { btn.textContent = '▶ Play transmission'; btn.classList.remove('is-playing') }
  btn.onclick = () => {
    if (audio.paused) { audio.play(); btn.textContent = '⏸ Playing…'; btn.classList.add('is-playing') }
    else { audio.pause(); btn.textContent = '▶ Play transmission'; btn.classList.remove('is-playing') }
  }
  return btn
}
