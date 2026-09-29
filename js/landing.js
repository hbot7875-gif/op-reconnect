// Landing page behaviour: the crowd, the live numbers, and the one decision
// the page exists to make easy — start, or sign back in.

import { startConcertBackground } from './concert-bg.js'
import { installBootSequence } from './landing-boot.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'
import { compact } from './compact-number.js'

const canvas = document.getElementById('crowd')
if (canvas) startConcertBackground(canvas)

// The dark-city map that used to render here is gone from the landing page
// (js/landing-map.js itself is kept — _preview_landing.html still mounts
// one, and nothing shipped imports it now, so the bundler drops it).

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

const STAT_IDS = ['statAgents', 'statArirang', 'statRoad1B']

function setStat(id, value, suffix = '') {
  const el = document.getElementById(id)
  if (!el) return
  el.classList.remove('is-loading')
  el.textContent = value === null || value === undefined ? '—' : value.toLocaleString() + suffix
}

/** The API sends real integers; only the display is compact (see
 *  compact-number.js for why it floors rather than rounds). */
function setCompactStat(id, value) {
  const el = document.getElementById(id)
  if (!el) return
  el.classList.remove('is-loading')
  el.textContent = value === null || value === undefined ? '—' : compact(value)
}

call('getPublicStats', {}).then((res) => {
  if (!res || !res.success || !res.stats) {
    for (const id of STAT_IDS) setStat(id, null)
    return
  }
  const s = res.stats
  setStat('statAgents', s.agents)

  // "1 AGENTS" on the first line a stranger reads is a small thing that makes
  // the whole page look unfinished. Early on, 1 is a genuinely likely count.
  const agentWord = document.getElementById('statAgentsWord')
  if (agentWord) agentWord.textContent = s.agents === 1 ? 'AGENT' : 'AGENTS'

  // Two separately labelled campaign totals. SWIM is legitimately counted in
  // both — it is an ARIRANG album track AND one of the four Road-to-1B focus
  // songs — so these are never summed into a single "total streams" figure;
  // doing that would double-count it by six figures.
  setCompactStat('statArirang', s.arirangStreams)
  setCompactStat('statRoad1B', s.roadTo1BStreams)
}).catch(() => {
  for (const id of STAT_IDS) setStat(id, null)
})
