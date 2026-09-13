import { el, hideOverlay, showOverlay } from './state.js'
import { esc } from './state.js'
import { openModeSheet } from './ui-hud.js'

const MODE_LABEL = { exam: 'School/Exam', easy: 'Easy', steady: 'Easy+', medium: 'Medium', hard: 'Hard' }

export function playModeReview(state) {
  const review = state.modeReview
  if (!review) return
  showOverlay(reviewSheet(review, state))
}

function reviewSheet(review, state) {
  const label = MODE_LABEL[review.mode] || review.mode
  const suggestion = MODE_LABEL[review.suggestedMode] || review.suggestedMode
  const sheet = el('div', 'sheet')
  sheet.innerHTML = `
    <div class="eyebrow">MOON STATION CHECK</div>
    <h3>Check your streaming mode</h3>
    <p class="muted">We saw high stream totals on ${esc(String(review.highVolumeDays))} recent days.</p>
    <p class="muted">You are on <b>${esc(label)}</b>.${suggestion ? ` <b>${esc(suggestion)}</b> may fit your recent pace better.` : ' Check that this still fits how many accounts you use.'}</p>
    <p class="muted">We did not change your mode or your current district goals.</p>
  `
  const check = el('button', 'btn btn-primary', 'Check mode')
  check.onclick = () => { hideOverlay(); openModeSheet(state) }
  const later = el('button', 'btn btn-ghost', 'Not now')
  later.onclick = hideOverlay
  sheet.append(check, later)
  return sheet
}
