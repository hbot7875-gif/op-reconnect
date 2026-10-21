// MAMA voting popups that must reach the player wherever they are.
//
// A duplicate certificate is usually found by the background check minutes
// (or, after a review, hours) after the upload — by then the player is on
// another screen, or already has a counted certificate that day, so the
// card's inline note never reached them. The City poll (state.voting) and
// the Voting screen both pass their `alerts` here; each one pops up once.

import { getAgentNo } from './session.js'
import { el, hideOverlay, showOverlay } from './state.js'
import { getScreen, goVoting } from './router.js'
import { unseenAlerts, markAlertsSeen, duplicatePopupCopy } from './voting-alert-rules.js'
import { votePopupHtml } from './vote-popup.js'

function overlayBusy() {
  const overlay = document.getElementById('overlay')
  // The shared overlay, or one of the Voting screen's own sheets (which sit above it).
  return (overlay && !overlay.hidden) || !!document.querySelector('.has-sheet')
}

function popup(copy) {
  const sheet = el('div', 'sheet vt-pop', votePopupHtml({
    tone: 'err', icon: 'xCircle', eyebrow: copy.eyebrow, title: copy.title, body: copy.body,
    primary: copy.action, secondary: copy.later,
  }))
  const go = sheet.querySelector('[data-vp="primary"]')
  go.onclick = () => {
    hideOverlay()
    if (getScreen()?.name !== 'voting') goVoting()
    else {
      // Already here: straight to the file picker when the card offers one.
      const pick = document.querySelector('[data-vt-mission="mnet"] [data-vt-act="mnet-file"]')
      if (pick) pick.click()
      else document.querySelector('[data-vt-mission="mnet"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }
  sheet.querySelector('[data-vp="secondary"]').onclick = hideOverlay
  showOverlay(sheet)
  sheet.setAttribute('role', 'alertdialog')
}

/** Show any not-yet-seen duplicate alerts as one popup. Waits for a free
 *  overlay (the next poll retries) rather than covering another sheet. */
export function checkForVotingAlerts(alerts) {
  const agentNo = getAgentNo()
  let storage
  try { storage = localStorage } catch (_) { return }
  const fresh = unseenAlerts(alerts, agentNo, storage)
  if (!fresh.length || overlayBusy()) return
  markAlertsSeen(fresh, agentNo, storage)
  popup(duplicatePopupCopy(fresh))
}

/** The same screenshot refused at upload: say so at once, as a popup. */
export function showDuplicateCertificatePopup() {
  popup(duplicatePopupCopy([{}]))
}
