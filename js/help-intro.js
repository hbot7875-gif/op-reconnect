// A one-time pop-up introducing Get help: where the button is, what you can
// send, and where the team's reply shows up. Shown once per agent on this
// device; never during a War of Cards game or over another sheet (it waits
// for the next state update instead).

import { el, showOverlay, hideOverlay } from './state.js'
import { getAgentNo } from './session.js'
import { getScreen } from './router.js'
import { rcIcon } from './reconnect-icons.js'
import { openHelp } from './help.js'

const KEY = 'rc_help_intro_seen:'

export function checkForHelpIntro(state) {
  const agentNo = getAgentNo()
  if (!agentNo || !state?.player) return
  try {
    if (localStorage.getItem(`${KEY}${agentNo}`) === '1') return
  } catch (_) {
    return // no way to show it only once: don't show it at all
  }
  if (document.body.classList.contains('ra-playing') || getScreen()?.name === 'runami') return
  const overlay = document.getElementById('overlay')
  if (overlay && !overlay.hidden) return
  try { localStorage.setItem(`${KEY}${agentNo}`, '1') } catch (_) {}
  showOverlay(helpIntroSheet())
}

export function helpIntroSheet() {
  const sheet = el('div', 'sheet help-sheet help-intro')
  sheet.innerHTML = `
    <span class="help-eyebrow">New in ReConnect</span>
    <h3 tabindex="-1" data-autofocus="true">Need help? Just ask 💜</h3>
    <p class="help-lede">Something not counting, or not sure how a quest works? You can now message the ReConnect team right from the app.</p>
    <ul class="help-intro-steps">
      <li><span class="help-intro-ico">${rcIcon('chat')}</span><p><b>Tap the purple ? button</b> at the bottom right of any screen.</p></li>
      <li><span class="help-intro-ico">${rcIcon('listChecks')}</span><p><b>Report a problem or ask a question</b> — add a screenshot if it helps.</p></li>
      <li><span class="help-intro-ico">${rcIcon('mail')}</span><p><b>We reply in My requests</b>, and you'll see it on the bell.</p></li>
    </ul>`
  const ask = el('button', 'btn btn-primary help-send', 'Ask something now')
  ask.type = 'button'
  ask.onclick = () => { hideOverlay(); openHelp() }
  const later = el('button', 'btn btn-ghost help-intro-later', 'Got it')
  later.type = 'button'
  later.onclick = hideOverlay
  sheet.append(ask, later)
  return sheet
}
