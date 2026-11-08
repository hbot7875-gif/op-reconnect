// "MISSION SUCCESS!" — the one-time pop-up when an agent's album reaches
// 15/15 and War of Cards opens to them (by a Signal Sweep cover or a gift).
//
// The server decides when it's due (state.warUnlockDue: a full album, not a
// tester, not yet shown on any device; lib/war-of-cards.ts) and is told the
// moment it's shown, so it appears once across devices. If the agent isn't
// online when the 15th cover lands, the next game-state poll after they
// return carries the flag. It waits while another sheet is open or a War of
// Cards match is being played, and simply tries again on the next poll.
//
// The reveal is CSS only (css/run-ami.css, .wu-*): the stamp, the count, a
// card turns over and a few album covers flash past before the last one
// lands, then WAR OF CARDS UNLOCKED!. With reduced motion, it's all there.

import { el, showOverlay, hideOverlay } from './state.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'
import { getScreen } from './router.js'
import { cardHtml, cardBackHtml } from './run-ami-cards.js'
import { openRunArmy } from './run-army.js'

// Covers that flash past, each a different era (js/run-ami-art.js ERA_OF:
// WINGS, Her, BE, Proof), before the card that stays (the wild, PTD).
const FLASH = [{ c: 'r', k: '1' }, { c: 'b', k: '3' }, { c: 'g', k: '8' }, { c: 'y', k: '9' }]

const SEEN_KEY = 'rc_seen_war_unlock:'
// The server record is what keeps the reveal to once. This device's note
// only covers the moment between showing it and the server saving that, so
// it expires: a reveal the server has been told to show again (by an admin
// reset, say) isn't silently swallowed on a device that showed it before.
const LOCAL_HOLD_MS = 10 * 60_000
let showing = false

/** A match is on, or the agent is on War of Cards' own screen. */
const inGame = () => document.body.classList.contains('ra-playing') || getScreen()?.name === 'runami'

export function checkForWarUnlock(state) {
  const agentNo = getAgentNo()
  if (!agentNo || !state?.joined || !state.warUnlockDue || showing) return
  // Shown on this device moments ago and the server hasn't caught up: tell
  // it again and stay quiet.
  try {
    const shownAt = Number(localStorage.getItem(`${SEEN_KEY}${agentNo}`))
    if (shownAt && Date.now() - shownAt < LOCAL_HOLD_MS) { call('markWarUnlockSeen', { agentNo }); return }
  } catch (_) { /* no storage: the server record alone keeps it to once */ }
  if (inGame()) return
  const overlay = document.getElementById('overlay')
  if (overlay && !overlay.hidden) return

  showing = true
  try { localStorage.setItem(`${SEEN_KEY}${agentNo}`, String(Date.now())) } catch (_) {}
  call('markWarUnlockSeen', { agentNo }).finally(() => { showing = false })
  showOverlay(unlockSheet())
}

export function unlockSheet() {
  const sheet = el('div', 'sheet ra-sheet wu-sheet')
  sheet.setAttribute('aria-labelledby', 'wu-title')
  sheet.innerHTML = `
    <div class="wu-stage">
      <p class="wu-stamp" aria-hidden="true"><span>MISSION</span><span>SUCCESS!</span></p>
      <p class="wu-count"><b>15/15</b><span>ALBUM COMPLETE</span></p>
      <div class="wu-flip" aria-hidden="true">
        <div class="wu-flip-inner">
          <div class="wu-face wu-face-back">${cardBackHtml()}</div>
          <div class="wu-face wu-face-front">
            ${cardHtml({ c: null, k: 'wild' })}
            ${FLASH.map((card, i) => `<span class="wu-flash" style="--i:${FLASH.length - 1 - i}">${cardHtml(card)}</span>`).join('')}
          </div>
        </div>
      </div>
      <h3 class="wu-title" id="wu-title" tabindex="-1"><span>WAR OF CARDS</span><span class="wu-title-hi">UNLOCKED!</span></h3>
    </div>`
  const go = el('button', 'btn btn-primary wu-go', "LET'S GO!")
  go.type = 'button'
  go.dataset.autofocus = 'true'
  go.onclick = () => { hideOverlay(); openRunArmy() }
  const later = el('button', 'btn btn-ghost wu-later', 'Later')
  later.type = 'button'
  later.onclick = hideOverlay
  sheet.append(go, later)
  return sheet
}
