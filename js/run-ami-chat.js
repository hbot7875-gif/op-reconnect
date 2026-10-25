// RUN AMI — room chat panel.
//
// A small chat icon (with an unread count) sits in the lobby and match
// headers; it opens a compact panel pinned under the header, over the
// opponents and table but clear of the hand and controls, and it never
// blocks play: it isn't a modal sheet, and the game keeps updating
// underneath. Messages arrive with the room view the screen already polls
// (view.chat, newest 30), so the panel only renders what it is given and
// sends through `onSend`. Everything shown is escaped text.

import { el, esc } from './state.js'
import { errorText } from './run-ami-cards.js'
import { RUN_AMI_CHAT_MAX, RUN_AMI_REACTIONS, RUN_AMI_CHAT_ERRORS } from '../supabase/functions/op-reconnect/lib/run-ami-chat-rules.js'

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z"/></svg>'
const time = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function chatErrorText(res) {
  if (res?.error === 'chat_text') return RUN_AMI_CHAT_ERRORS[res.reason] || RUN_AMI_CHAT_ERRORS.blocked
  if (res?.error === 'chat_slow') return 'Slow down a little, then try again.'
  return errorText(res?.error)
}

/** `onSend(kind, body)` → the server's reply ({ success, error, reason }).
 *  `floor()` → the y the panel must stay above (the top of the hand), or null. */
export function createChat({ onSend, floor = () => null }) {
  let messages = []
  let seenId = null // newest id the reader has had a chance to see
  let open = false
  let sending = false

  const button = el('button', 'ra-chat-btn', `${ICON}<span class="ra-chat-dot" hidden></span>`)
  button.type = 'button'
  button.setAttribute('aria-label', 'Room chat')
  button.setAttribute('aria-expanded', 'false')
  const dot = button.querySelector('.ra-chat-dot')

  const panel = el('section', 'ra-chat')
  panel.hidden = true
  panel.setAttribute('aria-label', 'Room chat')
  panel.innerHTML = `
    <header class="ra-chat-head"><b>Room chat</b><button class="ra-chat-x" type="button" aria-label="Close chat">×</button></header>
    <ol class="ra-chat-list" role="log" aria-live="polite"></ol>
    <div class="ra-chat-reacts">${RUN_AMI_REACTIONS.map((r) => `<button type="button" data-r="${r}" aria-label="Send ${r}">${r}</button>`).join('')}</div>
    <form class="ra-chat-form">
      <input name="body" maxlength="${RUN_AMI_CHAT_MAX}" autocomplete="off" enterkeyhint="send" placeholder="Say something…" aria-label="Message">
      <button type="submit">Send</button>
    </form>
    <p class="ra-chat-err" role="status" hidden></p>`
  const list = panel.querySelector('.ra-chat-list')
  const form = panel.querySelector('.ra-chat-form')
  const input = form.querySelector('input')
  const err = panel.querySelector('.ra-chat-err')

  function setUnread() {
    const n = messages.filter((m) => !m.mine && (seenId === null || m.id > seenId)).length
    dot.hidden = open || n === 0
    dot.textContent = n > 9 ? '9+' : String(n)
    button.setAttribute('aria-label', n && !open ? `Room chat, ${n} new` : 'Room chat')
  }

  function render() {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 24
    list.innerHTML = messages.length ? messages.map((m) => `
      <li class="ra-msg${m.mine ? ' is-mine' : ''}${m.kind === 'react' ? ' is-react' : ''}">
        <span class="ra-msg-meta"><b>${esc(m.mine ? 'You' : m.name)}</b>${m.watching ? '<small class="ra-msg-tag">watching</small>' : ''}<time>${esc(time(m.at))}</time></span>
        <span class="ra-msg-body">${esc(m.body)}</span>
      </li>`).join('') : '<li class="ra-chat-empty">No messages yet. Say hi!</li>'
    if (atBottom || open) list.scrollTop = list.scrollHeight
  }

  // Keep the panel clear of the hand: end it just above the hand's top edge
  // when that is on screen, never shorter than its own controls need.
  function fit() {
    if (!open) return
    const limit = floor()
    const top = panel.getBoundingClientRect().top
    const cap = Math.min(window.innerHeight * 0.46, 380)
    const room = Number.isFinite(limit) && limit > top ? limit - top - 8 : cap
    panel.style.maxHeight = `${Math.round(Math.max(200, Math.min(cap, room)))}px`
  }

  function setOpen(next) {
    open = next
    panel.hidden = !open
    fit()
    button.setAttribute('aria-expanded', String(open))
    button.classList.toggle('is-open', open)
    if (open) {
      seenId = messages.at(-1)?.id ?? seenId
      render()
      list.scrollTop = list.scrollHeight
    }
    setUnread()
  }

  async function send(kind, body) {
    if (sending) return
    sending = true
    err.hidden = true
    const res = await onSend(kind, body)
    sending = false
    if (res?.success) {
      if (kind === 'text') input.value = ''
      return
    }
    err.textContent = chatErrorText(res)
    err.hidden = false
  }

  button.onclick = () => setOpen(!open)
  window.addEventListener('resize', fit)
  panel.querySelector('.ra-chat-x').onclick = () => setOpen(false)
  panel.querySelector('.ra-chat-reacts').onclick = (e) => {
    const r = e.target.closest('button[data-r]')?.dataset.r
    if (r) send('react', r)
  }
  form.onsubmit = (e) => {
    e.preventDefault()
    const body = input.value.trim()
    if (body) send('text', body)
  }

  return {
    button,
    panel,
    /** The room's newest messages from a fresh view. The first batch after
     *  opening the room counts as already seen, so old chat doesn't ping. */
    update(next) {
      const incoming = Array.isArray(next) ? next : []
      if (seenId === null) seenId = incoming.at(-1)?.id ?? 0
      const changed = incoming.length !== messages.length || incoming.at(-1)?.id !== messages.at(-1)?.id
      messages = incoming
      if (open) seenId = messages.at(-1)?.id ?? seenId
      if (changed) render()
      setUnread()
      fit()
    },
    close() { if (open) setOpen(false) },
    destroy() { window.removeEventListener('resize', fit); button.remove(); panel.remove() },
  }
}
