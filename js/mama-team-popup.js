// MAMA Battle: the team choice used to appear only inside the Voting screen,
// so an agent who never opened Voting was never asked to pick a side. This
// asks from the City instead — once per KST day, while voting is open or the
// battle recruits before it opens, and only for an agent with no team (a
// recruit link's team leads the title) — and "Choose my team" opens Voting,
// where the usual 7-second choice starts by itself (voting.js).
//
// Same localStorage-seen pattern as exam-mode-announce.js and
// birthday-era-popup.js; storage failing reads as "seen" so nobody is nagged
// on every poll.

import { getAgentNo } from './session.js'
import { el, hideOverlay, showOverlay } from './state.js'
import { getScreen, goVoting } from './router.js'
import { mamaTeamPopupDue, markMamaTeamPopupSeen, mamaTeamPopupCopy } from './mama-team-popup-rules.js'
import { votePopupHtml, teamTilesHtml } from './vote-popup.js'
import { readInvite } from './battle-invite.js'

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

  const copy = mamaTeamPopupCopy(state.voting, readInvite(storage))
  const sheet = el('div', 'sheet vt-pop', votePopupHtml({
    tone: 'accent', icon: 'swords', eyebrow: copy.eyebrow, title: copy.title, body: copy.body,
    extra: teamTilesHtml(copy.teams), primary: copy.action, secondary: copy.later,
  }))
  const go = sheet.querySelector('[data-vp="primary"]')
  go.onclick = () => { hideOverlay(); goVoting() }
  sheet.querySelector('[data-vp="secondary"]').onclick = hideOverlay
  showOverlay(sheet)
}
