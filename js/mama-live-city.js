// The MAMA 2026 live voting card at the top of the City (signed-in players),
// in the same look as the MAMA Round 2 voting card (vt-entry vt-city in
// voting.css): icon, title with a LIVE pill while voting is open, one line,
// and a chevron. Upcoming / Live only, set by the admin; Hidden shows nothing.
// Tapping it opens Mnet Plus.

import { vIcon as ic } from './voting-icons.js'
import { esc } from './voting-view.js'
import { mamaCityCopy } from '../supabase/functions/op-reconnect/lib/mama-live-rules.js'

const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'UTC' } }
const locale = () => (navigator.languages && navigator.languages[0]) || navigator.language || 'en'

/** The card element, or null when the banner is Hidden. */
export function mamaLiveCityCard(mama) {
  const c = mamaCityCopy(mama, { timeZone: zone(), locale: locale() })
  if (!c) return null
  const live = c.state === 'live'
  const a = document.createElement('a')
  a.className = 'vt-entry vt-city ml-city'
  a.href = c.url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.setAttribute('aria-label', `${c.title}. ${c.line}. Opens Mnet Plus.`)
  a.innerHTML = `
    <span class="vt-entry-ico" aria-hidden="true">${ic('vote')}</span>
    <span class="vt-city-txt" aria-hidden="true">
      <span class="vt-city-t">${esc(c.title)}<span class="vt-city-live"${live ? '' : ' hidden'}><i></i>LIVE</span></span>
      <span class="vt-city-vs">${esc(c.line)}</span>
    </span>
    <span class="vt-city-go" aria-hidden="true">${ic('chevR')}</span>`
  return a
}
