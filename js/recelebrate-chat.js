// ARIRANG RE:CELEBRATE Party Chat — one event-scoped shared room.
//
// The Edge Function verifies the agent session, derives the sender's team
// from their Party Pass, and returns codenames only. This client polls the
// compact latest-message window using the app's existing HTTP API.

import { call } from './api.js'
import { getAgentNo } from './session.js'
import { el, esc } from './state.js'

const SIDES = { hooligans: '⚡', aliens: '🛸' }
const POLL_MS = 5_000

const chat = {
  mode: null,
  draft: '',
  unread: 0,
  messages: [],
  loaded: false,
  poll: null,
}

const isDesktop = () => window.matchMedia('(min-width: 980px)').matches
const messageTime = (iso) => {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).format(d)
}

const ERROR_COPY = {
  party_not_open: 'PARTY CHAT OPENS WITH THE PARTY ♡',
  party_over: 'THE PARTY ENDED · CHAT IS READ-ONLY',
  team_required: 'PICK UR SIDE BEFORE U CHAT ✦',
  slow_down: 'ONE SEC 😭 TRY AGAIN IN A MOMENT',
  message_required: 'TYPE SOMETHING FIRST',
  invalid_session: 'SIGN IN AGAIN TO USE PARTY CHAT',
}

export function createPartyChat({ getSide, onOpen }) {
  if (!chat.mode) chat.mode = 'min'
  clearTimeout(chat.poll)

  const box = el('aside', 'rcp-chat')
  box.setAttribute('aria-label', 'Party chat')
  box.innerHTML = `
    <button type="button" class="rcp-chat-bar" aria-expanded="false">
      <span class="rcp-chat-bar-top">💬 PARTY CHAT <span class="rcp-chat-count"></span><b class="rcp-chat-unread" hidden></b></span>
      <span class="rcp-chat-latest"></span>
    </button>
    <div class="rcp-chat-panel">
      <div class="rcp-chat-head">
        <span class="rcp-area-title">PARTY CHAT</span>
        <button type="button" class="rcp-chat-min" aria-label="Minimise chat">–</button>
        <button type="button" class="rcp-chat-close" aria-label="Hide chat">×</button>
      </div>
      <div class="rcp-msgs" role="log" aria-live="polite"></div>
      <p class="rcp-chat-status" role="status" hidden></p>
      <form class="rcp-say">
        <input type="text" maxlength="200" placeholder="say something to the party…" aria-label="Chat message">
        <button type="submit">SEND</button>
      </form>
    </div>
    <button type="button" class="rcp-chat-fab" aria-label="Open party chat">💬<b class="rcp-chat-unread" hidden></b></button>
  `

  const list = box.querySelector('.rcp-msgs')
  const form = box.querySelector('.rcp-say')
  const input = form.querySelector('input')
  const send = form.querySelector('button')
  const status = box.querySelector('.rcp-chat-status')
  let roomReadOnly = false
  input.value = chat.draft
  input.addEventListener('input', () => { chat.draft = input.value })

  const setStatus = (text = '', error = false) => {
    status.textContent = text
    status.hidden = !text
    status.classList.toggle('is-error', error)
  }

  const drawMessages = (stick = false) => {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 24
    list.innerHTML = chat.messages.length ? chat.messages.map((m) => `
      <div class="rcp-msg is-${esc(m.side || 'guest')}${m.me ? ' is-me' : ''}">
        <div class="rcp-msg-who"><span class="rcp-msg-side">${SIDES[m.side] || ''}</span>
          <b>${esc(m.name || 'AGENT')}</b><span class="rcp-msg-at">${esc(messageTime(m.at))}</span></div>
        <div class="rcp-msg-text">${esc(m.text)}</div>
      </div>`).join('') : '<div class="rcp-chat-empty">first one here 👀 say hi</div>'
    if (stick || atBottom) list.scrollTop = list.scrollHeight
  }

  const paint = () => {
    box.classList.toggle('is-open', chat.mode === 'open')
    box.classList.toggle('is-min', chat.mode === 'min')
    box.classList.toggle('is-hidden', chat.mode === 'hidden')
    box.querySelector('.rcp-chat-bar').setAttribute('aria-expanded', String(chat.mode === 'open'))
    box.querySelector('.rcp-chat-count').textContent = `· ${chat.messages.length}`
    const last = chat.messages[chat.messages.length - 1]
    box.querySelector('.rcp-chat-latest').textContent = last
      ? `${SIDES[last.side] || ''} ${last.name}: ${last.text}`
      : roomReadOnly ? 'party ended · chat is read-only' : 'the room is open ✦'
    box.querySelectorAll('.rcp-chat-unread').forEach((b) => { b.hidden = !chat.unread; b.textContent = chat.unread })
  }

  const setMode = (mode) => {
    chat.mode = mode
    if (mode === 'open') chat.unread = 0
    paint()
    if (mode === 'open') { drawMessages(true); onOpen?.() }
  }

  const applyComposerState = ({ locked = false, readOnly = roomReadOnly } = {}) => {
    roomReadOnly = readOnly
    const noSide = !getSide()
    const disabled = locked || readOnly || noSide
    input.disabled = disabled
    send.disabled = disabled
    if (locked) setStatus(ERROR_COPY.party_not_open)
    else if (readOnly) setStatus(ERROR_COPY.party_over)
    else if (noSide) setStatus(ERROR_COPY.team_required)
    else if (!status.classList.contains('is-error')) setStatus('')
  }

  // Party Pass/team choice can finish while this room is already mounted.
  // Unlock the composer immediately instead of waiting for the next poll.
  const onPassChange = () => {
    if (!box.isConnected) {
      window.removeEventListener('rc-arc-pass', onPassChange)
      return
    }
    applyComposerState()
  }
  window.addEventListener('rc-arc-pass', onPassChange)

  let loading = false
  const loadMessages = async (stick = false) => {
    clearTimeout(chat.poll)
    chat.poll = null
    if (loading || !box.isConnected) return
    loading = true
    const res = await call('getRecelebrateMessages', { agentNo: getAgentNo() })
    loading = false
    if (!box.isConnected) return
    if (res?.success) {
      const old = new Set(chat.messages.map((m) => String(m.id)))
      const incoming = Array.isArray(res.messages) ? res.messages : []
      if (chat.loaded && chat.mode !== 'open') {
        chat.unread += incoming.filter((m) => !old.has(String(m.id)) && !m.me).length
      }
      chat.messages = incoming
      chat.loaded = true
      setStatus('')
      applyComposerState(res)
      drawMessages(stick)
      paint()
    } else {
      setStatus('CHAT IS RECONNECTING…', true)
    }
    chat.poll = setTimeout(() => loadMessages(false), POLL_MS)
  }

  box.querySelector('.rcp-chat-bar').onclick = () => setMode(chat.mode === 'open' ? 'min' : 'open')
  box.querySelector('.rcp-chat-min').onclick = () => setMode('min')
  box.querySelector('.rcp-chat-close').onclick = () => setMode(isDesktop() ? 'min' : 'hidden')
  box.querySelector('.rcp-chat-fab').onclick = () => setMode('open')

  form.onsubmit = async (e) => {
    e.preventDefault()
    const text = input.value.trim()
    if (!text) return
    if (!getSide()) { applyComposerState(); return }
    input.disabled = true
    send.disabled = true
    send.textContent = '…'
    const res = await call('sendRecelebrateMessage', { agentNo: getAgentNo(), message: text })
    send.textContent = 'SEND'
    if (res?.success) {
      input.value = ''
      chat.draft = ''
      setStatus('')
      await loadMessages(true)
    } else {
      input.disabled = false
      send.disabled = false
      setStatus(ERROR_COPY[res?.error] || 'COULDN’T SEND · TRY AGAIN', true)
    }
  }

  drawMessages(true)
  paint()
  queueMicrotask(() => loadMessages(true))
  return { el: box, setMode, refresh: () => loadMessages(true) }
}
