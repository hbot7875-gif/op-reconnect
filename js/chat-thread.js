// One small shared thread renderer — plain text, oldest first, no read
// receipts/typing indicators/reactions. Originally screen-district.js's own
// ReConnect "Team Chat" (chatPanel); pulled out here, unchanged in spirit,
// so ARMY Comms (bomb-sheet.js) can render the exact same component
// against a different backend action instead of a second chat UI existing
// anywhere in this app.

import { el, esc, toast } from './state.js'

const mountedMessages = new WeakMap()

function sameMessage(a, b) {
  return !!a && !!b && a.isMe === b.isMe && a.isSystem === b.isSystem
    && a.codename === b.codename && a.body === b.body
}

function appendMessage(list, msg) {
  const row = el('div', 'reconnect-chat-msg'
    + (msg.isMe ? ' is-me' : '') + (msg.isSystem ? ' is-system' : ''))
  row.innerHTML = msg.isSystem
    ? `<span>${esc(msg.body)}</span>`
    : `<b>${esc(msg.isMe ? 'You' : msg.codename)}</b><span>${esc(msg.body)}</span>`
  list.appendChild(row)
}

function paintMessages(list, messages, opts = {}) {
  list.innerHTML = ''
  if (!messages?.length) {
    list.appendChild(el('div', 'muted', opts.emptyText || 'No messages yet — say hi.'))
    return
  }
  for (const msg of messages) appendMessage(list, msg)
}

/** Refresh only the transcript. The composer is intentionally left mounted
 *  so live mission updates cannot erase a draft, cursor or keyboard focus. */
export function updateChatThread(wrap, messages, opts = {}) {
  const list = wrap?.querySelector('.reconnect-chat-list')
  if (!list) return wrap
  const next = messages || []
  const previous = mountedMessages.get(wrap) || []
  if (previous.length === next.length && previous.every((msg, i) => sameMessage(msg, next[i]))) return wrap

  // The backend returns oldest-first. When the existing transcript is an
  // exact prefix, append only the new rows; no old message blinks or moves.
  const appendOnly = next.length >= previous.length
    && previous.every((msg, i) => sameMessage(msg, next[i]))
  if (appendOnly) {
    if (!previous.length) list.innerHTML = ''
    for (const msg of next.slice(previous.length)) appendMessage(list, msg)
  } else {
    paintMessages(list, next, opts)
  }
  mountedMessages.set(wrap, next.map((msg) => ({ ...msg })))
  return wrap
}

/**
 * @param {{isMe:boolean, isSystem?:boolean, codename?:string, body:string}[]} messages
 * @param {{
 *   onSend: (body: string) => Promise<{success:boolean, error?:string}>,
 *   onSent?: () => void,
 *   placeholder?: string,
 *   emptyText?: string,
 *   readOnly?: boolean,
 *   readOnlyNote?: string,
 *   errorText?: (code: string) => string,
 *   variant?: string,
 * }} opts
 */
export function chatThread(messages, opts) {
  // variant is a pure CSS hook (e.g. ARMY Comms' 'radio') — same
  // markup and behavior for every caller, just a different skin, so one
  // implementation still means one implementation.
  const wrap = el('div', 'reconnect-chat' + (opts.variant ? ` is-${opts.variant}` : ''))
  const list = el('div', 'reconnect-chat-list')
  paintMessages(list, messages, opts)
  wrap.appendChild(list)
  mountedMessages.set(wrap, (messages || []).map((msg) => ({ ...msg })))

  if (opts.readOnly) {
    wrap.appendChild(el('div', 'reconnect-chat-readonly', opts.readOnlyNote || 'This thread is now read-only.'))
    return wrap
  }

  // Its own class, not the generic invite row: the composer lives inside
  // sheets, where a full-width button rule would otherwise take the whole
  // row and squeeze the text field down to nothing.
  const composer = el('div', 'reconnect-chat-composer')
  const input = el('input', 'ob-input')
  input.type = 'text'
  input.setAttribute('aria-label', opts.placeholder || 'Message')
  input.placeholder = opts.placeholder || 'Message…'
  input.maxLength = 240
  const sendBtn = el('button', 'btn btn-ghost', 'Send')
  const send = async () => {
    const body = input.value.trim()
    if (!body) return
    input.disabled = true
    sendBtn.disabled = true
    const r = await opts.onSend(body)
    input.disabled = false
    sendBtn.disabled = false
    if (r?.success) { input.value = ''; opts.onSent?.() }
    else toast((opts.errorText ? opts.errorText(r?.error) : r?.error) || "Couldn't send — try again.")
  }
  sendBtn.onclick = send
  input.onkeydown = (e) => { if (e.key === 'Enter') send() }
  composer.append(input, sendBtn)
  wrap.appendChild(composer)
  return wrap
}
