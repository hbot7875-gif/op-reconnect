// MAMA Battle: the team choice used to appear only inside the Voting screen,
// so an agent who never opened Voting was never asked to pick a side. This
// asks from the City instead — once per KST day, while voting is open or the
// battle recruits before it opens, and only for an agent with no team (a
// recruit link's team leads the title) — and "Choose my team" opens Voting,
// where the usual 7-second choice starts by itself (voting.js). Once voting
// is open, an agent already on a team gets "The MAMA Battle is LIVE" once a
// KST day instead (until today's votes are all in); "Upload now" opens Voting.
// From 21:00 KST, an agent with nothing verified today gets a last call
// ("Votes reset in 2h 15m") with one button and no "Later".
//
// Same localStorage-seen pattern as exam-mode-announce.js and
// birthday-era-popup.js; storage failing reads as "seen" so nobody is nagged
// on every poll.

import { getAgentNo } from './session.js'
import { el, getState, hideOverlay, showOverlay, toast } from './state.js'
import { getScreen, goVoting } from './router.js'
import { mamaPopupKind, markMamaTeamPopupSeen, mamaTeamPopupCopy, nextResetAt, resetNoticeCopy } from './mama-team-popup-rules.js'
import { votePopupHtml, teamTilesHtml } from './vote-popup.js'
import { readInvite } from './battle-invite.js'

// The daily reset (00:00 KST). The 90s poll already brings the reset popup
// back while the City is open; this timer makes it land on the minute, and
// sends a browser notification to an agent who allowed them and is looking
// elsewhere. No push server: a closed tab gets nothing, and finds the popup
// on its next visit.
let resetTimer = null
let resetFor = ''
const canNotify = () => typeof Notification !== 'undefined'

function scheduleReset(state) {
  const at = nextResetAt(state?.voting)
  const key = at ? `${state.voting.campaignId}:${at.getTime()}` : ''
  if (key === resetFor) return
  clearTimeout(resetTimer)
  resetFor = key
  // A couple of seconds late, so the server's day has turned too.
  if (at) resetTimer = setTimeout(onReset, Math.min(at.getTime() - Date.now() + 3000, 2 ** 31 - 1))
}

function onReset() {
  resetFor = ''
  const state = getState()
  if (!state?.joined || !state.voting) return
  // Today's count is zero again; the next poll brings the real numbers.
  const fresh = { ...state, voting: { ...state.voting, done: 0 } }
  if (document.hidden || !document.hasFocus()) notifyReset(fresh.voting)
  checkForMamaTeamPopup(fresh)
}

function notifyReset(voting) {
  if (!canNotify() || Notification.permission !== 'granted') return
  try {
    const { title, body } = resetNoticeCopy(voting)
    // One per reset, even with the City open in several tabs.
    const n = new Notification(title, { body, tag: `mama-reset:${voting.campaignId}`, icon: '/og-image.jpg' })
    n.onclick = () => { window.focus(); n.close(); hideOverlay(); goVoting() }
  } catch (_) { /* Android Chrome only notifies from a service worker */ }
}

const remindHtml = () => (canNotify() && Notification.permission === 'default'
  ? '<div class="vt-pop-acts vt-pop-remind"><button type="button" class="vt-pop-btn is-outline" data-vp="remind">🔔 Alert me when votes reset</button></div>'
  : '')

export function checkForMamaTeamPopup(state) {
  const agentNo = getAgentNo()
  if (!agentNo || !state?.joined) return
  scheduleReset(state)
  let storage
  try { storage = localStorage } catch (_) { return }
  const kind = mamaPopupKind(state.voting, { agentNo, storage, screen: getScreen()?.name })
  if (!kind) return
  // Don't fight another sheet for the shared overlay; the next poll retries.
  const overlay = document.getElementById('overlay')
  if (overlay && !overlay.hidden) return
  markMamaTeamPopupSeen(storage, agentNo, state.voting, kind)

  const copy = mamaTeamPopupCopy(state.voting, readInvite(storage), kind)
  const sheet = el('div', 'sheet vt-pop', votePopupHtml({
    tone: kind === 'closing' ? 'warn' : 'accent', icon: { live: 'upload', closing: 'clock' }[kind] || 'swords',
    eyebrow: copy.eyebrow, title: copy.title, body: copy.body,
    extra: teamTilesHtml(copy.teams) + (kind === 'live' ? remindHtml() : ''), primary: copy.action, secondary: copy.later,
  }))
  const remind = sheet.querySelector('[data-vp="remind"]')
  if (remind) {
    remind.onclick = async () => {
      remind.disabled = true
      let answer = 'default'
      try { answer = await Notification.requestPermission() } catch (_) {}
      if (answer === 'granted') { remind.textContent = '🔔 You’ll get an alert at the reset'; toast('Keep ReConnect open in a tab to get the alert at 00:00 KST.', 5200) }
      else { remind.closest('.vt-pop-remind').remove(); if (answer === 'denied') toast('Alerts are blocked in this browser. You’ll still see the popup here.', 5200) }
    }
  }
  const go = sheet.querySelector('[data-vp="primary"]')
  go.onclick = () => { hideOverlay(); goVoting() }
  const later = sheet.querySelector('[data-vp="secondary"]')
  if (later) later.onclick = hideOverlay
  showOverlay(sheet)
}
