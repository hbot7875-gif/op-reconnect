// A one-time pop-up announcing Weekly Collection XP: what earns, the weekly
// cap, how a week unlocks, and when it starts (Monday 00:00 KST, shown in the
// player's own time zone). Shown once per agent on this device, only when
// the game state carries the collection block, never during a War of Cards
// game or over another sheet (it waits for the next state update instead).

import { el, showOverlay, hideOverlay } from './state.js'
import { getAgentNo } from './session.js'
import { getScreen } from './router.js'

const KEY = 'rc_collection_xp_intro_seen:'

export function checkForCollectionXpIntro(state) {
  const agentNo = getAgentNo()
  if (!agentNo || !state?.player || !state.collection) return
  try {
    if (localStorage.getItem(`${KEY}${agentNo}`) === '1') return
  } catch (_) {
    return // no way to show it only once: don't show it at all
  }
  if (document.body.classList.contains('ra-playing') || getScreen()?.name === 'runami') return
  const overlay = document.getElementById('overlay')
  if (overlay && !overlay.hidden) return
  try { localStorage.setItem(`${KEY}${agentNo}`, '1') } catch (_) {}
  showOverlay(collectionXpIntroSheet())
}

// Copy as written by the owner. The start is stated in IST on purpose (the
// owner's wording); the Pack strip shows it in each player's own time zone.
export function collectionXpIntroSheet() {
  const sheet = el('div', 'sheet help-sheet help-intro cx-intro')
  const point = (icon, text) => `<li><span class="help-intro-ico cx-intro-ico" aria-hidden="true">${icon}</span><p>${text}</p></li>`
  sheet.innerHTML = `
    <span class="help-eyebrow">New in ReConnect</span>
    <h3 tabindex="-1" data-autofocus="true">YOUR COLLECTIBLES NOW EARN XP! 💜</h3>
    <p class="help-lede">Your collectibles aren't just for decoration anymore!</p>
    <ul class="help-intro-steps">
      ${point('💿', "Place collectibles in districts you've restored.")}
      ${point('⚡', 'Stay active and earn up to <b>50 bonus XP every week</b> from your placed collectibles!')}
      ${point('🎒', "Want to see which collectibles you've earned? <b>Check your Pack!</b>")}
      ${point('🏙', 'Your <b>restored district count</b> is now visible in Rankings!')}
    </ul>
    <p class="cx-intro-when">Rewards begin November 29 at 8:30 PM IST.</p>`
  const ok = el('button', 'btn btn-primary help-send', 'Got it')
  ok.type = 'button'
  ok.onclick = hideOverlay
  sheet.append(ok)
  return sheet
}
