// Onboarding: transmission intro → codename + mode → identity assigned →
// enter the network. All copy comes from the server payload (DB-driven).

import { call } from './api.js'
import { el, esc, toast, setState } from './state.js'
import { ambientToggle } from './ambient.js'
import { openStreamSource, uplinkBroken } from './settings-streams.js'
import { wardDisplayName, districtDisplayName } from './ward-tiles.js'

const ERRORS = {
  codename_invalid: 'Codenames are 3-24 letters or numbers — and can\'t be your agent number.',
  codename_taken: 'That one\'s taken. Try another.',
  already_joined: 'You\'re already in — reloading…',
}

const MISSION_SOUNDTRACK = 'https://youtu.be/WyXcTOW8iPE'
const DEFAULT_LORE = `After the old tracking network collapsed, HT lost contact with hundreds of agents worldwide.

To ReConnect them, HT built a new intelligence network called BOTZ, powered by ARMY Bombs. But its signal is unstable.

Every stream you log restores a piece of the network.

When your ARMY Bomb loses power, parts of the city go dark again.

Stream to earn Charge Cells.
Use them to keep your ARMY Bomb glowing.

Restore the city.
Find the missing agents.
ReConnect the network.

Welcome to Operation ReConnect.`

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
  const soundtrack = ambientToggle(MISSION_SOUNDTRACK)
  step1.appendChild(soundtrack)
  const body = el('div', 'ob-body')
  const signal = el('div', 'ob-signal', '<span class="ob-signal-ring"></span><span class="ob-signal-core"></span>')
  signal.setAttribute('aria-hidden', 'true')
  const lore = cinematicLore(intro.body || DEFAULT_LORE)
  body.appendChild(signal)
  body.appendChild(lore.node)
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
  btn1.classList.add('ob-continue')
  btn1.style.animationDelay = `${Math.min(lore.duration, 8).toFixed(2)}s`
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
  // 10/20/30 streams per XP on easy/medium/hard — same fixed ladder
  // config.ts's streamsPerXpFor() defaults to, shown here so the tradeoff
  // (bigger targets AND slower XP, not just bigger targets) is visible
  // before it's picked, not discovered later in Settings.
  const STREAMS_PER_XP = { easy: 10, medium: 20, hard: 30 }
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
    btn3.onclick = () => {
      soundtrack.stopPlayback?.()
      showFirstRun(container, agentNo, joinedState, onJoined)
    }
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
    el('p', 'dim', 'Keep your ARMY Bomb charged: every 20 counted Album Goal streams earns a Charge Cell, and one Cell adds 4 hours.'),
  )
  mount.appendChild(el('div', 'ob-charge-loop', `
    <span>STREAM</span><i>→</i><span>EARN ⚡</span><i>→</i><span>CHARGE</span><i>→</i><span>KEEP THE CITY LIT</span>
  `))
  const btn = el('button', 'btn btn-primary', 'Show me my first district')
  btn.onclick = proceed
  mount.appendChild(btn)
}

/* ── cinematic transmission ──────────────────────────────────────────── */

/** Reveal the story in a few complete, readable beats. Each paragraph arrives
 *  together, so this feels like a game opening rather than a typing demo. */
function cinematicLore(text) {
  const node = el('div', 'ob-lore')
  const paragraphs = String(text).trim().split(/\n\s*\n/).filter(Boolean)
  paragraphs.forEach((paragraph, beat) => {
    const line = el('p', `ob-beat ob-beat-${Math.min(beat + 1, 7)}`,
      esc(paragraph.trim()).replace(/\n/g, '<br>'))
    line.style.animationDelay = `${(0.35 + beat * 1.05).toFixed(2)}s`
    node.appendChild(line)
  })

  if (!paragraphs.length) node.appendChild(el('p', 'ob-beat', 'TRANSMISSION LOST. STAND BY.'))
  return { node, duration: 0.35 + Math.max(paragraphs.length, 1) * 1.05 }
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
