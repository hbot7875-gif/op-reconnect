// "Charge your ARMY Bomb" popup on day 6 and day 13 without charging (see
// bomb-nudge-rules.js). One button, no "Later": it opens the charge sheet.

import { getAgentNo } from './session.js'
import { el, hideOverlay, showOverlay } from './state.js'
import { agentChargeSheet } from './agent-charge.js'
import { votePopupHtml } from './vote-popup.js'
import { bombNudgeDue, markBombNudgeSeen, bombNudgeCopy } from './bomb-nudge-rules.js'

export function checkForBombNudge(state) {
  const agentNo = getAgentNo()
  if (!agentNo || !state?.joined) return
  const feedHealth = state.agentCharge?.feedHealth
  let storage
  try { storage = localStorage } catch (_) { return }
  const stage = bombNudgeDue(feedHealth, { agentNo, storage })
  if (!stage) return
  // Don't fight another sheet for the shared overlay; the next poll retries.
  const overlay = document.getElementById('overlay')
  if (overlay && !overlay.hidden) return
  markBombNudgeSeen(storage, agentNo, feedHealth, stage)

  const copy = bombNudgeCopy(stage, feedHealth)
  const sheet = el('div', 'sheet vt-pop', votePopupHtml({
    tone: copy.tone, icon: 'battery', eyebrow: copy.eyebrow, title: copy.title, body: copy.body, primary: copy.action,
  }))
  sheet.querySelector('[data-vp="primary"]').onclick = () => { hideOverlay(); showOverlay(agentChargeSheet()) }
  showOverlay(sheet)
}
