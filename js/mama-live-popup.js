// In the game: the MAMA 2026 live voting popup (mama-live-rules.js). Only
// while the admin has set Live, once per visitor per Live session (the same
// seen-key as the landing page, so someone who closed it there isn't asked
// again here), and only on the City screen with no other sheet open — never
// over a district, a quest, War of Cards or any other screen in use.
// Uses the existing MAMA popup look (vote-popup.js); showOverlay adds the ×.

import { el, hideOverlay, showOverlay } from './state.js'
import { getScreen } from './router.js'
import { votePopupHtml } from './vote-popup.js'
import { mamaPopupDue, markMamaPopupSeen, MAMA_POPUP_COPY } from '../supabase/functions/op-reconnect/lib/mama-live-rules.js'

export function checkForMamaLivePopup(state) {
  if (!state?.joined || state.mamaLive?.state !== 'live') return
  if (getScreen()?.name !== 'world') return
  const overlay = document.getElementById('overlay')
  if (overlay && !overlay.hidden) return // the next poll tries again
  let storage
  try { storage = localStorage } catch (_) { return }
  if (!mamaPopupDue(state.mamaLive, storage)) return
  markMamaPopupSeen(state.mamaLive, storage)

  const sheet = el('div', 'sheet vt-pop', votePopupHtml({
    tone: 'accent', icon: 'vote',
    title: MAMA_POPUP_COPY.heading, body: MAMA_POPUP_COPY.text, primary: MAMA_POPUP_COPY.button,
  }))
  sheet.querySelector('[data-vp="primary"]').onclick = () => {
    hideOverlay()
    try { window.open(MAMA_POPUP_COPY.url, '_blank', 'noopener') } catch (_) { location.href = MAMA_POPUP_COPY.url }
  }
  showOverlay(sheet)
}
