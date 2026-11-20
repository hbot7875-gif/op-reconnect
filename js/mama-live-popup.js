// In the game: the MAMA 2026 live voting popup (mama-live-rules.js). Only
// while the admin has set Live, once per visitor per Live session (the same
// seen-key as the landing page, so someone who closed it there isn't asked
// again here), and only on the City screen with no other sheet open — never
// over a district, a quest, War of Cards or any other screen in use.
// Uses the existing MAMA popup look (vt-pop in voting.css); showOverlay adds the ×.

import { el, hideOverlay, showOverlay } from './state.js'
import { getScreen } from './router.js'
import { esc } from './voting-view.js'
import { mamaPopupDue, markMamaPopupSeen, MAMA_POPUP_COPY, liveVoteUrl } from '../supabase/functions/op-reconnect/lib/mama-live-rules.js'

export function checkForMamaLivePopup(state) {
  if (!state?.joined || state.mamaLive?.state !== 'live') return
  if (getScreen()?.name !== 'world') return
  const overlay = document.getElementById('overlay')
  if (overlay && !overlay.hidden) return // the next poll tries again
  let storage
  try { storage = localStorage } catch (_) { return }
  if (!mamaPopupDue(state.mamaLive, storage)) return
  markMamaPopupSeen(state.mamaLive, storage)

  // Heading, one line of text, one button; showOverlay adds the × close.
  const sheet = el('div', 'sheet vt-pop ml-live-pop', `
    <h3 class="vt-pop-title">${esc(MAMA_POPUP_COPY.heading)}</h3>
    <p class="vt-pop-body">${esc(MAMA_POPUP_COPY.text)}</p>
    <div class="vt-pop-acts">
      <button type="button" class="vt-pop-btn is-primary" data-vp="primary" data-autofocus="true">${esc(MAMA_POPUP_COPY.button)}</button>
    </div>`)
  sheet.querySelector('[data-vp="primary"]').onclick = () => {
    hideOverlay()
    const url = liveVoteUrl(state.mamaLive)
    try { window.open(url, '_blank', 'noopener') } catch (_) { location.href = url }
  }
  showOverlay(sheet)
}
