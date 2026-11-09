// Help portal. Agents: Settings → Get help (and the bell, when the team has
// replied). AGENT000: Settings → Help inbox. The server (lib/help.ts)
// attaches the agent's stream details itself and decides who may answer.

import { el, esc, showOverlay, hideOverlay, toast, getState, setState } from './state.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'
import {
  HELP_TOPICS, HELP_ERRORS, HELP_MESSAGE_MAX, HELP_REPLY_MAX, topicLabel, diagnosticsLine,
  HELP_SCREENSHOT_MAX, HELP_SCREENSHOT_BYTES,
} from '../supabase/functions/op-reconnect/lib/help-rules.js'

const say = (code) => HELP_ERRORS[code] || HELP_ERRORS.server_error
const when = (isoText) => {
  if (!isoText) return ''
  return new Date(isoText).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Clears a help count from the bell straight away (the next poll agrees). */
function clearHelpCount(key) {
  const s = getState()
  if (s?.help?.[key]) setState({ ...s, help: { ...s.help, [key]: 0 } })
}

/** Thumbnails of a request's screenshots (short-lived private links from
 *  the server); tapping one opens it full size. */
function shotsHtml(urls) {
  if (!urls?.length) return ''
  return `<div class="help-shot-row">${urls.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer"><img src="${esc(u)}" alt="Screenshot ${i + 1}" loading="lazy"></a>`).join('')}</div>`
}

/** A picked image, shrunk to at most 1400px on its long side and re-encoded
 *  as JPEG, so it uploads quickly on mobile data. */
async function shrinkImage(file) {
  if (!file.type.startsWith('image/')) return null
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = url
    })
    const scale = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
    let dataUrl = canvas.toDataURL('image/jpeg', 0.82)
    if (dataUrl.length * 0.75 > HELP_SCREENSHOT_BYTES) dataUrl = canvas.toDataURL('image/jpeg', 0.6)
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    return { dataUrl, base64, bytes: Math.floor(base64.length * 0.75) }
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ── Agents ──────────────────────────────────────────────────────────────

/** The agent's help sheet: a New request tab (the form) and a My requests
 *  tab (what they sent and the team's replies). Replies are only marked read
 *  when My requests is actually opened. `tab: 'mine'` opens straight onto
 *  the replies (from the bell or a reply dot). */
export function openHelp({ tab = 'new' } = {}) {
  const unread = Number(getState()?.help?.replyUnread) || 0
  const sheet = el('div', 'sheet help-sheet help-agent')
  sheet.innerHTML = `
    <span class="help-eyebrow">ReConnect team</span>
    <h3 tabindex="-1" data-autofocus="true">Get help</h3>
    <div class="help-tabs" role="tablist">
      <button type="button" role="tab" data-tab="new" aria-selected="true">New request</button>
      <button type="button" role="tab" data-tab="mine" aria-selected="false">My requests${unread ? `<span class="help-tab-badge" aria-label="${unread} new repl${unread === 1 ? 'y' : 'ies'}">${unread}</span>` : ''}</button>
    </div>
    <section class="help-pane" data-pane="new">
      <p class="help-lede">Something not working? Have a question? Tell us here and we'll get back to you! 💜</p>
      <form class="help-form">
        <fieldset class="help-topics"><legend>What do you need help with?</legend>
          ${HELP_TOPICS.map((t, i) => `<label class="help-chip"><input type="radio" name="topic" value="${t.id}"${i === 0 ? ' checked' : ''}><span>${esc(t.label)}</span></label>`).join('')}
        </fieldset>
        <textarea name="message" rows="3" maxlength="${HELP_MESSAGE_MAX}" aria-label="Your message" placeholder="Tell us what happened or what you need help with..."></textarea>
        <div class="help-shots">
          <div class="help-thumbs"></div>
          <label class="help-add-shot"><input type="file" accept="image/*" hidden><span>+ Add screenshot</span></label>
        </div>
        <div class="help-note">
          <span>Only you and the team see this. Be kind! We're ARMYs too 💜</span>
          <button type="button" class="help-info" aria-expanded="false" aria-label="What we include">i</button>
        </div>
        <p class="help-info-more" hidden>Up to ${HELP_SCREENSHOT_MAX} screenshots. For streaming issues, we automatically include your streaming source and last sync time to help us check. We never see your password or PIN. Screenshots are deleted 30 days after we've resolved your request.</p>
        <p class="help-err" role="status" hidden></p>
        <button class="btn btn-primary help-send" type="submit">Send to the team</button>
      </form>
    </section>
    <section class="help-pane" data-pane="mine" hidden>
      <p class="help-lede">We'll reply here — your requests and the team's answers.</p>
      <div class="help-list"><p class="muted">Loading…</p></div>
    </section>`
  const form = sheet.querySelector('.help-form')
  const err = sheet.querySelector('.help-err')
  const showTab = (name) => {
    for (const t of sheet.querySelectorAll('[data-tab]')) t.setAttribute('aria-selected', String(t.dataset.tab === name))
    for (const pane of sheet.querySelectorAll('[data-pane]')) pane.hidden = pane.dataset.pane !== name
    if (name === 'mine') {
      sheet.querySelector('.help-tab-badge')?.remove()
      loadMine(sheet)
    }
  }
  for (const t of sheet.querySelectorAll('[data-tab]')) t.onclick = () => showTab(t.dataset.tab)
  const info = sheet.querySelector('.help-info')
  const more = sheet.querySelector('.help-info-more')
  info.onclick = () => { more.hidden = !more.hidden; info.setAttribute('aria-expanded', String(!more.hidden)) }

  // The message box starts at three lines and grows as they type.
  const box = form.message
  box.oninput = () => { box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight, 220)}px` }

  // Screenshots, shrunk on the phone before they're sent.
  let shots = []
  const thumbs = sheet.querySelector('.help-thumbs')
  const addLabel = sheet.querySelector('.help-add-shot')
  const picker = addLabel.querySelector('input')
  const paintShots = () => {
    thumbs.innerHTML = shots.map((s, i) => `<span class="help-thumb"><img src="${s.dataUrl}" alt="Screenshot ${i + 1}"><button type="button" data-rm="${i}" aria-label="Remove screenshot ${i + 1}">×</button></span>`).join('')
    for (const b of thumbs.querySelectorAll('[data-rm]')) b.onclick = () => { shots.splice(Number(b.dataset.rm), 1); paintShots() }
    addLabel.hidden = shots.length >= HELP_SCREENSHOT_MAX
  }
  picker.onchange = async () => {
    const file = picker.files?.[0]
    picker.value = ''
    if (!file) return
    err.hidden = true
    const shot = await shrinkImage(file).catch(() => null)
    if (!shot) { err.textContent = say('bad_image'); err.hidden = false; return }
    if (shot.bytes > HELP_SCREENSHOT_BYTES) { err.textContent = say('image_too_large'); err.hidden = false; return }
    shots.push(shot)
    paintShots()
  }

  form.onsubmit = async (e) => {
    e.preventDefault()
    const send = form.querySelector('.help-send')
    send.disabled = true
    err.hidden = true
    const res = await call('submitHelpRequest', {
      agentNo: getAgentNo(), topic: form.topic.value, message: form.message.value,
      images: shots.map((s) => ({ base64: s.base64, mime: 'image/jpeg' })),
    })
    send.disabled = false
    if (!res?.success) { err.textContent = say(res?.error); err.hidden = false; return }
    form.message.value = ''
    box.style.height = ''
    shots = []
    paintShots()
    toast("Sent! We'll reply in My requests 💜")
    showTab('mine')
  }
  showOverlay(sheet)
  if (tab === 'mine') showTab('mine')
}

/** My requests: a compact list (topic, date, status, "New reply"), newest
 *  first; tapping one opens the conversation — their message, then the
 *  team's reply — right underneath. A new reply opens itself. */
async function loadMine(sheet) {
  const list = sheet.querySelector('.help-list')
  const res = await call('getMyHelpRequests', { agentNo: getAgentNo() })
  if (!res?.success) { list.innerHTML = `<p class="muted">${esc(say(res?.error))}</p>`; return }
  clearHelpCount('replyUnread')
  if (!res.requests.length) { list.innerHTML = '<p class="muted">Nothing sent yet — your requests and our replies will show up here.</p>'; return }
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '')
  list.innerHTML = ''
  res.requests.forEach((r, i) => {
    const status = r.status === 'resolved' ? 'Resolved' : r.reply ? 'Replied' : 'Waiting'
    const item = el('article', 'help-conv' + (r.isNewReply ? ' is-new' : ''))
    const head = el('button', 'help-conv-head')
    head.type = 'button'
    head.innerHTML = `
      <span class="help-conv-topic">${esc(topicLabel(r.topic))}${r.isNewReply ? '<em class="help-new">New reply</em>' : ''}</span>
      <span class="help-conv-meta">${esc(day(r.createdAt))}<span class="help-status is-${r.status}">${status}</span></span>
      <span class="help-conv-chev" aria-hidden="true">›</span>`
    const body = el('div', 'help-conv-body')
    body.innerHTML = `
      <div class="help-bubble is-me"><p>${esc(r.message)}</p>${shotsHtml(r.screenshots)}<small>You · ${esc(when(r.createdAt))}</small></div>
      ${r.reply
        ? `<div class="help-bubble is-team"><b>ReConnect team</b><p>${esc(r.reply)}</p><small>${esc(when(r.repliedAt))}</small></div>`
        : '<p class="help-wait">We\'ve got it — we\'ll reply here.</p>'}`
    const open = r.isNewReply || (i === 0 && !res.requests.some((x) => x.isNewReply))
    body.hidden = !open
    item.classList.toggle('is-open', open)
    head.setAttribute('aria-expanded', String(open))
    head.onclick = () => {
      body.hidden = !body.hidden
      item.classList.toggle('is-open', !body.hidden)
      head.setAttribute('aria-expanded', String(!body.hidden))
    }
    item.append(head, body)
    list.appendChild(item)
  })
}

// ── AGENT000 ────────────────────────────────────────────────────────────

export function openHelpInbox() {
  const sheet = el('div', 'sheet help-sheet help-inbox')
  sheet.innerHTML = `
    <span class="help-eyebrow">HT Access</span>
    <h3 tabindex="-1" data-autofocus="true">Help inbox</h3>
    <div class="help-tabs" role="tablist">
      <button type="button" role="tab" data-status="open" aria-selected="true">Open</button>
      <button type="button" role="tab" data-status="all" aria-selected="false">All</button>
    </div>
    <div class="help-list"><p class="muted">Loading…</p></div>`
  let status = 'open'
  for (const tab of sheet.querySelectorAll('[data-status]')) {
    tab.onclick = () => {
      status = tab.dataset.status
      for (const t of sheet.querySelectorAll('[data-status]')) t.setAttribute('aria-selected', String(t === tab))
      loadInbox(sheet, status)
    }
  }
  showOverlay(sheet)
  loadInbox(sheet, status)
}

async function loadInbox(sheet, status) {
  const list = sheet.querySelector('.help-list')
  const res = await call('helpInbox', { agentNo: getAgentNo(), status })
  if (!res?.success) { list.innerHTML = `<p class="muted">${esc(say(res?.error))}</p>`; return }
  if (status === 'open') {
    const s = getState()
    if (s?.help) setState({ ...s, help: { ...s.help, inboxOpen: res.requests.length } })
  }
  if (!res.requests.length) { list.innerHTML = `<p class="muted">${status === 'open' ? 'No open requests.' : 'No requests yet.'}</p>`; return }
  list.innerHTML = ''
  for (const r of res.requests) {
    const item = el('article', 'help-item' + (r.status === 'resolved' ? ' is-resolved' : ''))
    item.innerHTML = `
      <header><b>${esc(r.agentNo)} · ${esc(r.codename)}${r.handle ? ` <small>@${esc(r.handle)}</small>` : ''}</b><span class="help-status is-${r.status}">${r.status === 'resolved' ? 'Resolved' : 'Open'}</span></header>
      <div class="help-meta">${esc(topicLabel(r.topic))} · ${esc(when(r.createdAt))}</div>
      <p class="help-msg">${esc(r.message)}</p>
      ${shotsHtml(r.screenshots)}
      <p class="help-diag">${esc(diagnosticsLine(r.diagnostics, when))}</p>
      ${r.reply ? `<div class="help-reply"><b>Your reply</b><p>${esc(r.reply)}</p><small>${esc(when(r.repliedAt))}</small></div>` : ''}
      <textarea rows="2" maxlength="${HELP_REPLY_MAX}" placeholder="${r.reply ? 'Send another reply' : 'Reply to the agent'}"></textarea>
      <div class="help-actions">
        <button class="btn btn-primary" type="button" data-act="reply">Reply</button>
        <button class="btn btn-ghost" type="button" data-act="status">${r.status === 'resolved' ? 'Reopen' : 'Resolve'}</button>
      </div>`
    const box = item.querySelector('textarea')
    const act = async (payload, done) => {
      for (const b of item.querySelectorAll('button')) b.disabled = true
      const res2 = await call('helpReply', { agentNo: getAgentNo(), id: r.id, ...payload })
      for (const b of item.querySelectorAll('button')) b.disabled = false
      if (!res2?.success) { toast(say(res2?.error)); return }
      toast(done)
      loadInbox(sheet, status)
    }
    item.querySelector('[data-act="reply"]').onclick = () => {
      const reply = box.value.trim()
      if (!reply) { toast(say('empty_reply')); return }
      act({ reply }, `Replied to ${r.codename}`)
    }
    item.querySelector('[data-act="status"]').onclick = () =>
      act({ status: r.status === 'resolved' ? 'open' : 'resolved', ...(box.value.trim() ? { reply: box.value.trim() } : {}) },
        r.status === 'resolved' ? 'Reopened' : 'Resolved')
    list.appendChild(item)
  }
}

