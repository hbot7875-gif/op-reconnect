// ARIRANG RE:CELEBRATE Party Chat — a persistent social layer, not a tab.
//
// One element for both layouts: on a phone it's a drawer over the lower part
// of whatever the agent is looking at (Battle or Watch), minimisable to a
// one-line bar; on desktop it's the collapsible right-hand panel of the
// party room. Opening/closing only toggles classes, so it never touches the
// YouTube player, and its state (mode, draft, unread, messages) lives in this
// module — switching Battle ↔ Watch, or leaving and coming back, keeps it.
//
// There is no realtime chat backend yet. Production shows an honest
// "opens soon" state; preview lines exist only in a local dev build.

import { el, esc } from './state.js'
import { PREVIEW_CHAT } from './recelebrate-preview-data.js'

const SHOW_PREVIEW_CHAT = import.meta.env.DEV
const SIDES = { hooligans: '⚡', aliens: '🛸' }

const chat = {
  mode: null, // 'open' | 'min' | 'hidden'
  draft: '',
  unread: 0,
  messages: SHOW_PREVIEW_CHAT ? [...PREVIEW_CHAT.messages] : [],
  pending: SHOW_PREVIEW_CHAT ? [...(PREVIEW_CHAT.later || [])] : [],
  drip: null,
}

const isDesktop = () => window.matchMedia('(min-width: 980px)').matches

export function createPartyChat({ getSide, onOpen }) {
  // Until chat has a backend, desktop starts it as the slim rail: a full
  // column of "opens soon" would only take width from the stage.
  if (!chat.mode) chat.mode = isDesktop() && SHOW_PREVIEW_CHAT ? 'open' : 'min'

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
        ${SHOW_PREVIEW_CHAT ? '<span class="rcp-preview-chip">PREVIEW · DEV ONLY</span>' : ''}
        <button type="button" class="rcp-chat-min" aria-label="Minimise chat">–</button>
        <button type="button" class="rcp-chat-close" aria-label="Hide chat">×</button>
      </div>
      ${SHOW_PREVIEW_CHAT ? `
        <div class="rcp-msgs" role="log" aria-live="polite"></div>
        <form class="rcp-say">
          <input type="text" maxlength="200" placeholder="say something to the party…" aria-label="Chat message">
          <button type="submit">SEND</button>
        </form>` : `
        <div class="rcp-chat-soon">
          <b>PARTY CHAT OPENS SOON ♡</b>
          <span>One room for Hooligans and Aliens — it's not open yet.</span>
        </div>`}
    </div>
    <button type="button" class="rcp-chat-fab" aria-label="Open party chat">💬<b class="rcp-chat-unread" hidden></b></button>
  `

  const list = box.querySelector('.rcp-msgs')
  const input = box.querySelector('.rcp-say input')
  if (input) {
    input.value = chat.draft
    input.addEventListener('input', () => { chat.draft = input.value })
  }

  const drawMessages = (stick) => {
    if (!list) return
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 24
    list.innerHTML = chat.messages.map((m) => `
      <div class="rcp-msg is-${m.side}${m.me ? ' is-me' : ''}">
        <div class="rcp-msg-who"><span class="rcp-msg-side">${SIDES[m.side] || ''}</span>
          <b>${esc(m.name)}</b><span class="rcp-msg-no">${esc(m.no)}</span><span class="rcp-msg-at">${esc(m.at)}</span></div>
        <div class="rcp-msg-text">${esc(m.text)}</div>
      </div>`).join('')
    // Don't yank someone who scrolled up to read back.
    if (stick || atBottom) list.scrollTop = list.scrollHeight
  }

  const paint = () => {
    box.classList.toggle('is-open', chat.mode === 'open')
    box.classList.toggle('is-min', chat.mode === 'min')
    box.classList.toggle('is-hidden', chat.mode === 'hidden')
    box.querySelector('.rcp-chat-bar').setAttribute('aria-expanded', String(chat.mode === 'open'))
    box.querySelector('.rcp-chat-count').textContent = SHOW_PREVIEW_CHAT ? `· ${chat.messages.length}` : '· OPENS SOON'
    const last = chat.messages[chat.messages.length - 1]
    box.querySelector('.rcp-chat-latest').textContent = last ? `${SIDES[last.side] || ''} ${last.name}: ${last.text}` : ''
    box.querySelectorAll('.rcp-chat-unread').forEach((b) => { b.hidden = !chat.unread; b.textContent = chat.unread })
  }

  const setMode = (mode) => {
    chat.mode = mode
    if (mode === 'open') chat.unread = 0
    paint()
    if (mode === 'open') { drawMessages(true); onOpen?.() }
  }

  box.querySelector('.rcp-chat-bar').onclick = () => setMode(chat.mode === 'open' ? 'min' : 'open')
  box.querySelector('.rcp-chat-min').onclick = () => setMode('min')
  box.querySelector('.rcp-chat-close').onclick = () => setMode(isDesktop() ? 'min' : 'hidden')
  box.querySelector('.rcp-chat-fab').onclick = () => setMode('open')

  const add = (m) => {
    chat.messages.push(m)
    if (chat.mode !== 'open') chat.unread += 1
    drawMessages(false)
    paint()
  }

  const form = box.querySelector('.rcp-say')
  if (form) {
    form.onsubmit = (e) => {
      e.preventDefault()
      const text = input.value.trim()
      const side = getSide()
      if (!text || !side) return
      const d = new Date()
      chat.messages.push({ side, name: 'you', no: 'not sent · preview', me: true, text,
        at: `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}` })
      input.value = ''
      chat.draft = ''
      drawMessages(true)
      paint()
    }
  }

  // Dev preview only: drip a few lines in so the unread badge can be seen.
  if (SHOW_PREVIEW_CHAT && !chat.drip && chat.pending.length) {
    chat.drip = setInterval(() => {
      const next = chat.pending.shift()
      if (!next) { clearInterval(chat.drip); return }
      if (box.isConnected) add(next); else chat.messages.push(next)
    }, 15000)
  }

  drawMessages(true)
  paint()
  return { el: box, setMode }
}
