// Broadcasts — site-owner announcements, delivered inside the normal
// getGameState response (state.broadcasts, see lib/broadcasts.ts) rather
// than a separate polling mechanism. Rendered as dismissible cards at the
// top of the World screen (screen-world.js).
//
// Dismissal is tracked here, in its own localStorage key, next to (never
// touching) session.js's own rc_agent key — same one-key-per-concern
// convention that file already set.

import { el, esc } from './state.js'
import { goSettings } from './router.js'
import { shouldShowLegalNotice, withNoticeDismissed } from './legal-notice-rules.js'

const SEEN_KEY = 'rc_seen_broadcasts'
// One key per concern, same convention as above. Kept separate from the
// broadcast list on purpose: that one is capped at the last 50 ids, and a
// notice evicted by that cap would come back from the dead.
const NOTICE_KEY = 'rc_seen_notices'

function getSeen() {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    return new Set(raw ? JSON.parse(raw) : [])
  } catch {
    return new Set()
  }
}

function markSeen(id) {
  const seen = getSeen()
  seen.add(id)
  // Cap what's remembered — an ever-growing list of ids is pointless once a
  // broadcast has scrolled well out of the "last 5 live" window the backend
  // itself caps to (lib/broadcasts.ts's getActiveBroadcasts).
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-50))) } catch { /* localStorage unavailable */ }
}

/** A stack of dismissible announcement cards for whatever's live and not
 *  yet dismissed on this device. Empty (childless) when there's nothing to
 *  show, so callers can append it unconditionally. */
export function broadcastCards(state) {
  const wrap = el('div', 'bcast-stack')
  const list = state.broadcasts || []
  const seen = getSeen()
  const unseen = list.filter((b) => !seen.has(b.id))
  if (!unseen.length) return wrap

  for (const b of unseen) {
    const card = el('div', 'bcast-card' + (b.tone === 'gold' ? ' is-gold' : ''))
    card.innerHTML = `
      <div class="bcast-head">
        <span class="bcast-eyebrow">${b.tone === 'gold' ? '★ Announcement' : '📡 Transmission'}</span>
        <button class="bcast-x" type="button" aria-label="Dismiss">✕</button>
      </div>
      <div class="bcast-title">${esc(b.title)}</div>
      <p class="bcast-msg">${esc(b.message)}</p>
    `
    card.querySelector('.bcast-x').onclick = () => {
      markSeen(b.id)
      card.remove()
    }
    wrap.appendChild(card)
  }
  return wrap
}

/* ── The one-time legal-pages notice ─────────────────────────────────────
   Same card, same dismissal convention, no second notification system.

   It is NOT a broadcast row, because a broadcast goes to everyone and this
   is only for agents who predate the pages — the backend decides that from
   rc_players.joined_at and sends back the notice id or null (see
   lib/broadcasts.ts). Nothing here knows when anyone registered.

   It is also not a modal. A card in the normal flow of the World screen
   cannot block play, needs no focus trap and no Escape handling, and is
   reachable by keyboard because it is simply in the document — which is the
   right shape for something informational that nobody has to agree to. */

function readSeenNotices() {
  try {
    const raw = localStorage.getItem(NOTICE_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function markNoticeSeen(id) {
  try {
    localStorage.setItem(NOTICE_KEY, JSON.stringify(withNoticeDismissed(readSeenNotices(), id)))
  } catch { /* localStorage unavailable — the notice simply shows again */ }
}

/** The notice card, or an empty wrapper when there is nothing to show:
 *  no eligible notice, or this device already dismissed it. */
export function legalNoticeCard(state) {
  const wrap = el('div', 'bcast-stack')
  const id = state && state.legalNotice
  if (!shouldShowLegalNotice(state, readSeenNotices())) return wrap

  const card = el('div', 'bcast-card')
  // No "📡 Transmission" eyebrow. A broadcast earns one — it is an in-world
  // message from the site owner. This is a plain notice about Privacy and
  // Terms, and dressing it as an intercepted signal is a label the reader
  // has to look past to get to the point. The card styling already says
  // ReConnect; the title can just be the title.
  card.innerHTML = `
    <div class="bcast-title">ReConnect info update</div>
    <p class="bcast-msg">We&rsquo;ve added Privacy, Terms, Credits and other project information so it&rsquo;s clearer how ReConnect works and handles your data.</p>
    <div class="bcast-actions">
      <button class="btn btn-ghost" type="button" data-act="details">View details</button>
      <button class="btn btn-primary" type="button" data-act="ok">Got it</button>
    </div>
  `
  // Opening the pages is not acknowledgement — someone who goes to read them
  // should still find the notice when they come back. Only "Got it" dismisses.
  card.querySelector('[data-act="details"]').onclick = () => goSettings('legal-notice')
  card.querySelector('[data-act="ok"]').onclick = () => {
    markNoticeSeen(id)
    card.remove()
  }
  wrap.appendChild(card)
  return wrap
}
