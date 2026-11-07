// War of Cards leaderboard, opened from Run ARMY: weekly (from Monday 00:00
// KST) or all time, ranked by wins. Everything is counted on the server
// (lib/war-of-cards.ts, rc_war_outcomes): this sheet only shows the answer,
// plus the viewer's own row when they sit below the top 20.

import { el, showOverlay } from './state.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'
import { boardHtml } from './war-leaderboard-view.js'

let view = { period: 'week' }

export function openWarLeaderboard() {
  const sheet = el('div', 'sheet ra-sheet rarmy-sheet wl-sheet')
  sheet.innerHTML = `
    <span class="rarmy-eyebrow">🏆 War of Cards</span>
    <h3 id="wl-title">Leaderboard</h3>
    <div class="wl-controls">
      <div class="wl-seg" role="group" aria-label="Time period">
        <button type="button" data-wl-period="week">This week</button>
        <button type="button" data-wl-period="all">All time</button>
      </div>
    </div>
    <div class="wl-body" aria-live="polite"><p class="wl-empty">Loading…</p></div>`
  for (const b of sheet.querySelectorAll('[data-wl-period]')) b.onclick = () => { view = { ...view, period: b.dataset.wlPeriod }; load(sheet) }
  const close = el('button', 'btn btn-ghost', 'Back to Run ARMY')
  close.type = 'button'
  close.onclick = () => import('./run-army.js').then((m) => m.openRunArmy())
  sheet.appendChild(close)
  showOverlay(sheet)
  load(sheet)
}

async function load(sheet) {
  for (const b of sheet.querySelectorAll('[data-wl-period]')) b.setAttribute('aria-pressed', String(b.dataset.wlPeriod === view.period))
  const body = sheet.querySelector('.wl-body')
  const asked = { ...view }
  const res = await call('getWarLeaderboard', { agentNo: getAgentNo(), period: asked.period })
  if (!sheet.isConnected || asked.period !== view.period) return
  body.innerHTML = res?.success ? boardHtml(res) : '<p class="wl-empty">The leaderboard couldn\'t load. Try again in a moment.</p>'
}
