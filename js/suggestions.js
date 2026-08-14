// Suggestions — a simple public board for feature ideas, new goals,
// anything an agent wants to see next. Deliberately plain: one text box, one
// button, a chronological list underneath. No voting, no categories.
//
// Lives behind a small map marker (same toolMarker pattern Candy Star
// already uses, city-map.js), not an always-open card on the World screen —
// visible enough to notice, opt-in enough not to push every other agent's
// suggestions in front of everyone on every visit to City.

import { call } from './api.js'
import { el, esc, toast, showOverlay, hideOverlay } from './state.js'
import { getAgentNo } from './session.js'

function timeAgo(iso) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

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
  sheet.appendChild(el('p', 'am-intro', 'New feature or goal ideas? Drop them here — every agent can read them.'))

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

  const list = el('div', 'suggest-list')
  list.appendChild(el('p', 'muted', 'Loading suggestions…'))
  sheet.appendChild(list)

  const load = () => call('getSuggestions', { agentNo: getAgentNo() }).then((res) => {
    list.innerHTML = ''
    if (!res?.success) { list.appendChild(el('p', 'muted', "Couldn't load suggestions.")); return }
    if (!res.suggestions.length) { list.appendChild(el('p', 'muted', 'No suggestions yet — be the first.')); return }
    for (const s of res.suggestions) {
      const row2 = el('div', 'suggest-row-item')
      row2.innerHTML = `<div class="suggest-body">${esc(s.body)}</div>`
        + `<div class="suggest-meta">${esc(s.codename)} &middot; ${timeAgo(s.createdAt)}</div>`
      list.appendChild(row2)
    }
  })
  load()

  btn.onclick = async () => {
    const body = input.value.trim()
    if (!body) return
    btn.disabled = true
    msg.textContent = ''
    msg.classList.remove('is-error')
    const r = await call('submitSuggestion', { agentNo: getAgentNo(), body })
    if (r.success) {
      input.value = ''
      toast('Sent — thanks for the idea')
      list.innerHTML = '<p class="muted">Loading suggestions…</p>'
      load()
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
