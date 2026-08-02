// Landing page behaviour: the crowd, the live numbers, and the one decision
// the page exists to make easy — start, or sign back in.

import { startConcertBackground } from './concert-bg.js'
import { renderLandingMap } from './landing-map.js'
import { installBootSequence } from './landing-boot.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'

const canvas = document.getElementById('crowd')
if (canvas) startConcertBackground(canvas)

// The dark map. Static content — no backend, so it can't fail to a dash the
// way the live stats below it can.
renderLandingMap(document.getElementById('mapMount'))

// Someone already signed in shouldn't be sold the game they're playing.
// Swap the primary call to action for a way back into it.
const agentNo = getAgentNo()
if (agentNo) {
  const primary = document.getElementById('ctaPrimary')
  const secondary = document.getElementById('ctaSecondary')
  if (primary) { primary.textContent = 'Resume mission'; primary.href = 'game.html' }
  if (secondary) {
    secondary.textContent = `Signed in as ${agentNo}`
    secondary.href = 'game.html'
    secondary.classList.add('is-quiet')
  }
}

// After the CTA swap above, so the handshake sees the final hrefs.
installBootSequence()

/* ── Live numbers ─────────────────────────────────────────────────────
   Real counts or a dash. A landing page that fakes its stats is lying to
   the exact people it's trying to recruit. */

function setStat(id, value, suffix = '') {
  const el = document.getElementById(id)
  if (!el) return
  el.classList.remove('is-loading')
  el.textContent = value === null || value === undefined ? '—' : value.toLocaleString() + suffix
}

call('getPublicStats', {}).then((res) => {
  if (!res || !res.success || !res.stats) {
    for (const id of ['statAgents', 'statDistricts', 'statCharge']) setStat(id, null)
    return
  }
  const s = res.stats
  setStat('statAgents', s.agents)
  setStat('statDistricts', s.districtsRestored)
  setStat('statCharge', s.charge === null ? null : Math.round(s.charge * 100), '%')

  // "/248", set directly against statDistricts in the markup — one compact
  // "26/248" rather than a separate "of 248 across 7 wards" line, now that
  // this lives in a single status line instead of its own card.
  const total = document.getElementById('statDistrictsTotal')
  if (total && s.districtsTotal) total.textContent = `/${s.districtsTotal}`

  // The bomb multiplier is the game's own "the network is busy right now"
  // signal — worth surfacing only when it's actually doing something.
  const boost = document.getElementById('chargeBoost')
  if (boost && s.multiplier && s.multiplier > 1) {
    boost.textContent = `· ×${s.multiplier} XP while charged`
    boost.hidden = false
  }
}).catch(() => {
  for (const id of ['statAgents', 'statDistricts', 'statCharge']) setStat(id, null)
})
