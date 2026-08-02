// The handshake between the landing page and the game.
//
// Clicking "Start your mission" used to be a plain document navigation: the
// page went white-ish for a beat and the game appeared. Fine for a website,
// wrong for this — the whole premise is that you're connecting to something,
// and the one moment the player actually performs that action had no weight
// at all.
//
// So: a short terminal handshake over a blackout, then the navigation. It is
// deliberately NOT a loading bar. A fake progress bar is a lie about work
// that isn't happening, and it'd break the same rule the Network status
// section obeys (game-design §13.3 — never invent a number). Nothing here
// reports a percentage, a count, or a state it can't stand behind. The lines
// are all things that are simply true: an uplink opens, the grid is dark,
// and either the network knows your agent number or it's waiting for one.
//
// Three hard rules this has to respect:
//   - Skippable. §13's "nobody should be trapped in an animation" applies to
//     a 1.2s transition just as much as to the restoration sequence.
//   - `prefers-reduced-motion` skips it entirely — straight navigation.
//   - It must NEVER be able to strand someone on the landing page. Every
//     path ends in a navigation, including the error path.

import { getAgentNo } from './session.js'

const STEP = 170       // ms between lines
const HOLD = 260       // ms on the last line before the page changes

// Spoiler-free by construction: no ward names, no district names, no totals.
// A stranger reading these learns the network is down and that agents exist,
// which is what the page above already says out loud.
function script(agentNo) {
  return [
    '> opening uplink',
    '> handshake ok',
    '> locating the grid',
    '> the grid is dark',
    agentNo ? `> ${agentNo} recognised` : '> awaiting agent',
  ]
}

let running = false

function overlay() {
  const el = document.createElement('div')
  // Purely atmospheric. Announcing five lines of flavour to a screen reader
  // mid-navigation is noise, and the destination page is the real content.
  el.className = 'boot'
  el.setAttribute('aria-hidden', 'true')
  const inner = document.createElement('div')
  inner.className = 'boot-inner'
  el.appendChild(inner)
  return { el, inner }
}

function run(href, agentNo) {
  if (running) return
  running = true

  const { el, inner } = overlay()
  document.body.appendChild(el)
  // Next frame, so the fade-in transition actually has a start state.
  requestAnimationFrame(() => el.classList.add('is-on'))

  const lines = script(agentNo)
  const timers = []
  let done = false

  // One way out, used by every path: the timers, the skip handlers and the
  // safety net all funnel here, so "go to the game" can only happen once and
  // can't be lost if any single path throws.
  const go = () => {
    if (done) return
    done = true
    for (const t of timers) clearTimeout(t)
    window.location.href = href
  }

  lines.forEach((text, i) => {
    timers.push(setTimeout(() => {
      const p = document.createElement('p')
      p.className = 'boot-line'
      p.textContent = text
      // The caret rides the newest line, so it reads as a live terminal
      // rather than five lines that happened to appear.
      const prev = inner.querySelector('.has-caret')
      if (prev) prev.classList.remove('has-caret')
      p.classList.add('has-caret')
      inner.appendChild(p)
    }, i * STEP))
  })

  timers.push(setTimeout(go, lines.length * STEP + HOLD))

  // Skip: anything at all. Someone who has seen this forty times taps once
  // and is gone. Capture phase so it beats any other handler on the page.
  const skip = (e) => {
    if (e.type === 'keydown' && (e.metaKey || e.ctrlKey || e.altKey)) return
    go()
  }
  document.addEventListener('pointerdown', skip, { capture: true, once: true })
  document.addEventListener('keydown', skip, { capture: true, once: true })

  // Safety net. If a timer is throttled — a backgrounded tab is the usual
  // way — this still lands on the game rather than leaving someone staring
  // at a black screen that never resolves.
  timers.push(setTimeout(go, 4000))
}

export function installBootSequence() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

  for (const a of document.querySelectorAll('a[href="game.html"]')) {
    a.addEventListener('click', (e) => {
      // Let the browser do its normal thing for new-tab / new-window intent.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
      if (reduced.matches) return
      e.preventDefault()
      run(a.getAttribute('href'), getAgentNo())
    })
  }

  // The sequence is covering a real navigation, so spend it warming the
  // destination instead of just counting: by the time the last line lands the
  // game's HTML is usually already in cache. Cheap, and it makes the pause
  // honest work rather than theatre.
  const hint = document.createElement('link')
  hint.rel = 'prefetch'
  hint.href = 'game.html'
  document.head.appendChild(hint)
}
