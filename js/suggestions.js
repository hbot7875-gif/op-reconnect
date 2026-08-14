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

export function suggestionsSheet() {
  const sheet = el('div', 'sheet suggestions-sheet')
  sheet.appendChild(el('div', 'eyebrow', '💡 SUGGESTIONS'))
  sheet.appendChild(el('p', 'am-intro', 'New feature or goal ideas? Drop them here — just for the team behind the game, not shared with other agents.'))

  const input = el('textarea', 'ob-input suggest-input')
  input.maxLength = 240
  input.placeholder = 'Type your idea here…'
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
