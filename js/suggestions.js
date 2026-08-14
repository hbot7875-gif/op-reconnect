// Suggestions — a simple, one-way drop box for feature ideas, new goals,
// anything an agent wants to see next. Deliberately plain: one text box, one
// button. No voting, no categories, no public list — what an agent writes
// here is theirs, not something every other agent scrolls past on City.
//
// Lives behind a small map marker (same toolMarker pattern Candy Star
// already uses, city-map.js), not an always-open card on the World screen —
// visible enough to notice, opt-in enough not to be in anyone's face.

import { call } from './api.js'
import { el, showOverlay, hideOverlay } from './state.js'
import { getAgentNo } from './session.js'

// A blank box is intimidating — "what am I even supposed to write here?"
// These aren't categories the server tracks (still just plain text; see
// suggestions.ts, deliberately no schema for it), just a starting phrase
// tapped in to get someone past the blank-page problem. Rotates through
// the placeholder too, so even someone who ignores the chips still sees a
// concrete example instead of a generic prompt.
const EXAMPLES = [
  { chip: '🆕 New feature', prefix: 'New feature: ', placeholder: 'e.g. "A weekly login streak reward"' },
  { chip: '🎯 Goal idea', prefix: 'Goal idea: ', placeholder: 'e.g. "A track goal for the BE era comeback"' },
  { chip: '📣 Help promote it', prefix: 'Promotion idea: ', placeholder: 'e.g. "Share the city recovery % on Instagram weekly"' },
]

export function suggestionsSheet() {
  const sheet = el('div', 'sheet suggestions-sheet')
  sheet.appendChild(el('div', 'eyebrow', '💡 SUGGESTIONS'))
  sheet.appendChild(el('p', 'am-intro', 'New feature or goal ideas? Drop them here — just for the team behind the game, not shared with other agents.'))

  const input = el('textarea', 'ob-input suggest-input')
  input.maxLength = 240

  const chips = el('div', 'suggest-chips')
  EXAMPLES.forEach((ex) => {
    const chip = el('button', 'suggest-chip', ex.chip)
    chip.type = 'button'
    chip.onclick = () => {
      // Only pre-fill when the box is still empty/untouched — tapping a
      // second chip after already typing something shouldn't wipe it out.
      if (!input.value.trim()) input.value = ex.prefix
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    }
    chips.appendChild(chip)
  })
  sheet.appendChild(chips)
  input.placeholder = EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)].placeholder
  sheet.appendChild(input)

  const row = el('div', 'suggest-row')
  const msg = el('span', 'suggest-msg')
  const btn = el('button', 'btn btn-primary', 'Send')
  row.append(msg, btn)
  sheet.appendChild(row)

  btn.onclick = async () => {
    const body = input.value.trim()
    if (!body) return
    btn.disabled = true
    msg.textContent = ''
    msg.classList.remove('is-error')
    const r = await call('submitSuggestion', { agentNo: getAgentNo(), body })
    if (r.success) {
      input.value = ''
      msg.textContent = 'Sent — thanks for the idea.'
      msg.classList.remove('is-error')
    } else {
      msg.textContent = r.error === 'daily_limit_reached' ? "That's plenty for today — try again tomorrow." : "Couldn't send — try again."
      msg.classList.add('is-error')
    }
    btn.disabled = false
  }

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

export function openSuggestions() {
  showOverlay(suggestionsSheet())
}
