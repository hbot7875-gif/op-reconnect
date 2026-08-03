// Broadcasts — site-owner announcements, delivered inside the normal
// getGameState response (state.broadcasts, see lib/broadcasts.ts) rather
// than a separate polling mechanism. Rendered as dismissible cards at the
// top of the World screen (screen-world.js).
//
// Dismissal is tracked here, in its own localStorage key, next to (never
// touching) session.js's own rc_agent key — same one-key-per-concern
// convention that file already set.

import { el, esc } from './state.js'

const SEEN_KEY = 'rc_seen_broadcasts'

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
