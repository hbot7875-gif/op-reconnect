// Suggestions — a simple public board for feature ideas, new goals,
// anything an agent wants to see next. Deliberately plain: one text box, one
// button, a chronological list underneath. No voting, no categories, no
// separate screen — it lives right on City so it's seen, not filed away
// behind a settings tab nobody opens.

import { call } from './api.js'
import { el, esc, toast } from './state.js'
import { getAgentNo } from './session.js'

function timeAgo(iso) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function suggestionsCard() {
  const card = el('div', 'card suggestions-card')
  card.appendChild(el('div', 'eyebrow', '💡 SUGGESTIONS'))
  card.appendChild(el('p', 'muted', 'New feature or goal ideas? Drop them here — every agent can read them.'))

  const input = el('textarea', 'ob-input suggest-input')
  input.placeholder = 'What would you like to see next?'
  input.maxLength = 240
  card.appendChild(input)

  const row = el('div', 'suggest-row')
  const msg = el('span', 'suggest-msg')
  const btn = el('button', 'btn btn-primary', 'Send')
  row.append(msg, btn)
  card.appendChild(row)

  const list = el('div', 'suggest-list')
  list.appendChild(el('p', 'muted', 'Loading suggestions…'))
  card.appendChild(list)

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

  return card
}
