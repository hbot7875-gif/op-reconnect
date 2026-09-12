// One-shot celebration for an automatic mode upgrade (see mode-guard.ts's
// checkModeAbuse) — same "only present on the one response that just
// triggered it" shape as state.levelUp, not a localStorage-seen flag: this
// is server-driven and rare, so main.js just guards on the mode already
// shown, same pattern celebratedLevel uses.

import { el, hideOverlay, showOverlay } from './state.js'
import { esc } from './state.js'

const MODE_LABEL = { medium: 'Medium', hard: 'Hard' }

export function playModeUpgrade(state) {
  const up = state.modeUpgrade
  if (!up) return
  showOverlay(upgradeSheet(up))
}

function upgradeSheet(up) {
  const label = MODE_LABEL[up.to] || up.to
  const sheet = el('div', 'sheet')
  sheet.innerHTML = `
    <div class="eyebrow">🚨 MOON STATION TRANSMISSION</div>
    <h3>Your signal's been busier than one uplink should be 👀</h3>
    <p class="muted">HT picked up ${esc(String(up.violationDays))} days of traffic no single device could carry on its own — so we bumped your clearance up automatically.</p>
    <p class="muted"><b>You're on ${esc(label)} mode now.</b> Bigger goals, same great you. Nothing you've already restored is affected.</p>
  `
  const ok = el('button', 'btn btn-primary', "Got it, I'm built different")
  ok.onclick = hideOverlay
  sheet.appendChild(ok)
  return sheet
}
