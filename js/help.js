// Help portal. Agents: Settings → Get help (and the bell, when the team has
// replied). AGENT000: Settings → Help inbox. The server (lib/help.ts)
// attaches the agent's stream details itself and decides who may answer.

import { el, esc, showOverlay, hideOverlay, toast, getState, setState } from './state.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'
import {
  HELP_TOPICS, HELP_ERRORS, HELP_MESSAGE_MAX, HELP_REPLY_MAX, topicLabel, diagnosticsLine,
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

// ── Agents ──────────────────────────────────────────────────────────────

export function openHelp() {
  const sheet = el('div', 'sheet help-sheet')
  sheet.innerHTML = `
    <span class="help-eyebrow">ReConnect team</span>
    <h3 tabindex="-1" data-autofocus="true">Get help</h3>
    <p class="help-lede">Tell us what's wrong and we'll reply here. We attach your stream source and last sync so we can check faster — never your password or PIN.</p>
    <form class="help-form">
      <fieldset class="help-topics"><legend>What is it about?</legend>
        ${HELP_TOPICS.map((t, i) => `<label class="help-chip"><input type="radio" name="topic" value="${t.id}"${i === 0 ? ' checked' : ''}><span>${esc(t.label)}</span></label>`).join('')}
      </fieldset>
      <label class="help-field"><span>What happened?</span>
        <textarea name="message" rows="4" maxlength="${HELP_MESSAGE_MAX}" placeholder="For example: I streamed 20 songs today but my district didn't move."></textarea>
      </label>
      <p class="help-err" role="status" hidden></p>
      <button class="btn btn-primary help-send" type="submit">Send to the team</button>
    </form>
    <section class="help-mine"><h4>Your requests</h4><div class="help-list"><p class="muted">Loading…</p></div></section>`
  const form = sheet.querySelector('.help-form')
  const err = sheet.querySelector('.help-err')
  form.onsubmit = async (e) => {
    e.preventDefault()
    const send = form.querySelector('.help-send')
    send.disabled = true
    err.hidden = true
    const res = await call('submitHelpRequest', { agentNo: getAgentNo(), topic: form.topic.value, message: form.message.value })
    send.disabled = false
    if (!res?.success) { err.textContent = say(res?.error); err.hidden = false; return }
    form.message.value = ''
    toast("Sent — we'll reply here")
    loadMine(sheet)
  }
  showOverlay(sheet)
  loadMine(sheet)
}

async function loadMine(sheet) {
  const list = sheet.querySelector('.help-list')
  const res = await call('getMyHelpRequests', { agentNo: getAgentNo() })
  if (!res?.success) { list.innerHTML = `<p class="muted">${esc(say(res?.error))}</p>`; return }
  clearHelpCount('replyUnread')
  if (!res.requests.length) { list.innerHTML = '<p class="muted">Nothing sent yet.</p>'; return }
  list.innerHTML = res.requests.map((r) => `
    <article class="help-item${r.isNewReply ? ' is-new' : ''}">
      <header><b>${esc(topicLabel(r.topic))}</b><span class="help-status is-${r.status}">${r.status === 'resolved' ? 'Resolved' : r.reply ? 'Replied' : 'Open'}</span></header>
      <p class="help-msg">${esc(r.message)}</p>
      <small>Sent ${esc(when(r.createdAt))}</small>
      ${r.reply ? `<div class="help-reply"><b>ReConnect team${r.isNewReply ? ' · new' : ''}</b><p>${esc(r.reply)}</p><small>${esc(when(r.repliedAt))}</small></div>` : ''}
    </article>`).join('')
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

