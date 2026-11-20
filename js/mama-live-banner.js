// Landing page: the temporary MAMA 2026 live voting banner (below the hero)
// and, while Live, a one-time compact popup. State comes from the admin
// dashboard via the public getMamaLive action; it is re-read every minute so
// an open page follows Upcoming → Live → Hidden without a reload.
// Plain DOM and localStorage only — works in Instagram's in-app browser.

import { call } from './api.js'
import { mamaBannerCopy, mamaPopupDue, markMamaPopupSeen, MAMA_POPUP_COPY, liveVoteUrl } from '../supabase/functions/op-reconnect/lib/mama-live-rules.js'

const REFRESH_MS = 60_000
const host = document.getElementById('mamaLive')

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const visitorZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'UTC' } }
const visitorLocale = () => (navigator.languages && navigator.languages[0]) || navigator.language || 'en'

let storage = null
try { storage = window.localStorage } catch { storage = null }

function renderBanner(mama) {
  if (!host) return
  const copy = mamaBannerCopy(mama, { timeZone: visitorZone(), locale: visitorLocale() })
  if (!copy) { host.hidden = true; host.innerHTML = ''; return }
  host.className = `mama-live is-${copy.state}`
  host.innerHTML = `
    <div class="ml-card">
      <p class="ml-head">${esc(copy.heading)}</p>
      <p class="ml-text">${esc(copy.text)}</p>
      ${copy.startLine ? `<p class="ml-time">${esc(copy.startLine)}</p>` : ''}
      <p class="ml-note">${esc(copy.reminder)}</p>
      <a class="btn btn-primary ml-btn" href="${esc(copy.url)}" target="_blank" rel="noopener noreferrer">${esc(copy.button)}</a>
    </div>`
  host.hidden = false
}

let popup = null
function closePopup(mama) {
  markMamaPopupSeen(mama, storage)
  popup?.remove()
  popup = null
}

function renderPopup(mama) {
  if (mama.state !== 'live') { popup?.remove(); popup = null; return }
  if (popup || !storage || !mamaPopupDue(mama, storage)) return
  popup = document.createElement('div')
  popup.className = 'ml-pop'
  popup.setAttribute('role', 'dialog')
  popup.setAttribute('aria-modal', 'true')
  popup.setAttribute('aria-labelledby', 'mlPopHead')
  popup.innerHTML = `
    <div class="ml-pop-card">
      <button class="ml-pop-x" type="button" aria-label="Close">×</button>
      <p class="ml-head" id="mlPopHead">${esc(MAMA_POPUP_COPY.heading)}</p>
      <p class="ml-text">${esc(MAMA_POPUP_COPY.text)}</p>
      <a class="btn btn-primary ml-btn" href="${esc(liveVoteUrl(mama))}" target="_blank" rel="noopener noreferrer">${esc(MAMA_POPUP_COPY.button)}</a>
    </div>`
  popup.querySelector('.ml-pop-x').addEventListener('click', () => closePopup(mama))
  // Going to vote counts as seen too.
  popup.querySelector('.ml-btn').addEventListener('click', () => closePopup(mama))
  popup.addEventListener('click', (e) => { if (e.target === popup) closePopup(mama) })
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape' && popup) { closePopup(mama); document.removeEventListener('keydown', onKey) }
  })
  markMamaPopupSeen(mama, storage) // once per visitor, even if they just leave
  document.body.appendChild(popup)
  popup.querySelector('.ml-pop-x').focus({ preventScroll: true })
}

async function refresh() {
  const res = await call('getMamaLive', {}).catch(() => null)
  if (!res?.success) return // keep whatever is showing; try again next minute
  renderBanner(res.mamaLive)
  renderPopup(res.mamaLive)
}

if (host) {
  refresh()
  setInterval(() => { if (!document.hidden) refresh() }, REFRESH_MS)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh() })
}
