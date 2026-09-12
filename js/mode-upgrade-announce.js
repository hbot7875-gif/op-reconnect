import { el, hideOverlay, showOverlay } from './state.js'
import { esc } from './state.js'
import { openModeSheet } from './ui-hud.js'

const MODE_LABEL = { exam: 'School/Exam', easy: 'Easy', medium: 'Medium', hard: 'Hard' }

export function playModeReview(state) {
  const review = state.modeReview
  if (!review) return
  showOverlay(reviewSheet(review, state))
}

function reviewSheet(review, state) {
  const label = MODE_LABEL[review.mode] || review.mode
  const sheet = el('div', 'sheet')
  sheet.innerHTML = `
    <div class="eyebrow">MOON STATION CHECK</div>
    <h3>Check your streaming mode</h3>
    <p class="muted">We saw high stream totals on ${esc(String(review.highVolumeDays))} recent days.</p>
    <p class="muted">You are on <b>${esc(label)}</b>. If you use more accounts, choose the mode that fits. We did not change your mode or your goals.</p>
  `
  const check = el('button', 'btn btn-primary', 'Check mode')
  check.onclick = () => { hideOverlay(); openModeSheet(state) }
  const later = el('button', 'btn btn-ghost', 'Not now')
  later.onclick = hideOverlay
  sheet.append(check, later)
  return sheet
}
