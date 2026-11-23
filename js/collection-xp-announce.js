// A one-time pop-up announcing Weekly Collection XP: what earns, the weekly
// cap, how a week unlocks, and when it starts (Monday 00:00 KST, shown in the
// player's own time zone). Shown once per agent on this device, only when
// the game state carries the collection block, never during a War of Cards
// game or over another sheet (it waits for the next state update instead).

import { el, esc, showOverlay, hideOverlay } from './state.js'
import { getAgentNo } from './session.js'
import { getScreen, goResources } from './router.js'
import { kstMidnightLabel, shortReset } from './collection-xp-ui.js'

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
  showOverlay(collectionXpIntroSheet(state.collection))
}

export function collectionXpIntroSheet(c) {
  const sheet = el('div', 'sheet cx-intro')
  const when = c.started ? `It's on now. This week resets ${shortReset(c.resetsAt)}.` : `Starts ${kstMidnightLabel(c.startsWeek)}.`
  sheet.innerHTML = `
    <span class="cx-intro-eyebrow">New in ReConnect</span>
    <h3 tabindex="-1" data-autofocus="true">Weekly Collection XP</h3>
    <p class="cx-intro-lede">Your collectibles now earn XP. Place them in districts you've restored and each one pays once a week.</p>
    <ul class="cx-intro-points">
      <li><b>Albums 15 XP</b>, concert films and ARMY Bombs 12, clothing 10, photocards 8, posters, banners, figures and plushies 7, other decor 5.</li>
      <li><b>Up to ${esc(String(c.cap))} XP a week.</b> A second copy of the same collectible doesn't add.</li>
      <li><b>Keep restoring to unlock it:</b> ${esc(String(c.qualifyPlays))} goal-song plays, a restored district, or ${esc(String(c.qualifyPlays))} plays for a ReConnect team you're helping.</li>
    </ul>
    <p class="cx-intro-when">${esc(when)}</p>`
  const open = el('button', 'btn btn-primary', 'See my collection')
  open.type = 'button'
  open.onclick = () => { hideOverlay(); goResources() }
  const later = el('button', 'btn btn-ghost', 'Got it')
  later.type = 'button'
  later.onclick = hideOverlay
  sheet.append(open, later)
  return sheet
}
