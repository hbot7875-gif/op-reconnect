// MAMA Battle: the team choice used to appear only inside the Voting screen,
// so an agent who never opened Voting was never asked to pick a side. This
// asks from the City instead — once per KST day, only while voting is open
// and only for an agent with no team — and "Choose my team" opens Voting,
// where the usual 7-second choice starts by itself (voting.js).
//
// Same localStorage-seen pattern as exam-mode-announce.js and
// birthday-era-popup.js; storage failing reads as "seen" so nobody is nagged
// on every poll.

import { getAgentNo } from './session.js'
import { el, esc, hideOverlay, showOverlay } from './state.js'
import { getScreen, goVoting } from './router.js'
import { mamaTeamPopupDue, markMamaTeamPopupSeen, mamaTeamPopupCopy } from './mama-team-popup-rules.js'

export function checkForMamaTeamPopup(state) {
  const agentNo = getAgentNo()
  if (!agentNo || !state?.joined) return
  let storage
  try { storage = localStorage } catch (_) { return }
  if (!mamaTeamPopupDue(state.voting, { agentNo, storage, screen: getScreen()?.name })) return
  // Don't fight another sheet for the shared overlay; the next poll retries.
  const overlay = document.getElementById('overlay')
  if (overlay && !overlay.hidden) return
  markMamaTeamPopupSeen(storage, agentNo, state.voting.campaignId)

  const copy = mamaTeamPopupCopy(state.voting)
  const sheet = el('div', 'sheet')
  sheet.append(
    el('div', 'eyebrow', esc(copy.eyebrow)),
    el('h3', '', esc(copy.title)),
    el('p', 'muted', esc(copy.body)),
  )
  if (copy.score) sheet.appendChild(el('p', 'dim', esc(copy.score)))
  const go = el('button', 'btn btn-primary', esc(copy.action))
  go.onclick = () => { hideOverlay(); goVoting() }
  const later = el('button', 'btn btn-ghost', 'Not now')
  later.onclick = hideOverlay
  sheet.append(go, later)
  showOverlay(sheet)
}
