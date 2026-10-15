// MAMA Event Hub markup — the live strip, the Battle | Team | Chat | Voting
// tabs, the Team roster and Chat. Pure: a view model in, HTML out, so every
// state renders in Node (battle-hub.test.mjs). voting-view.js places these;
// voting.js wires the events.
//
// Colour rule: a team's colour marks only team things — names, score bars,
// thin rails, chat identity. Tabs, switches, buttons and focus stay neutral.
import { vIcon as ic } from './voting-icons.js'
import { CHAT_EMOJI, collapseMoments, instagramUrl } from '../supabase/functions/op-reconnect/lib/battle-hub-rules.js'
import { CHAT_MAX, CHAT_ERRORS } from '../supabase/functions/op-reconnect/lib/battle-text-filter.js'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const fmt = (n) => Number(n || 0).toLocaleString('en-US')
const teamAttr = (id) => (/^[a-z0-9_]{1,24}$/.test(String(id || '')) ? ` data-team="${id}"` : '')

// Chat is not a tab: it floats above the nav (ReCelebrate-style) and opens as a sheet.
export const HUB_TABS = [['battle', 'Battle'], ['team', 'Team'], ['voting', 'Voting']]

export const REPORT_LABELS = {
  harassment: 'Harassment or bullying', hate: 'Hate or slurs', sexual: 'Sexual content',
  personal_info: 'Sharing personal info', spam: 'Spam or flooding', other: 'Something else',
}

const CHAT_FAIL = {
  slow_down: 'Slow mode is on. Try again in a moment.',
  repeat: 'You just said that.',
  timed_out: "You can't post in Chat right now.",
  chat_closed: 'Chat is read-only now.',
  chat_paused: 'Chat is paused for a moment.',
  team_required: 'Pick your side first.',
  own_message: "That's your own message.",
  not_found: 'That message is no longer there.',
}
/** Words for a Chat error from the server (or the local check). */
export function chatErrorText(error, reason) {
  if (error === 'chat_text') return CHAT_ERRORS[reason] || CHAT_ERRORS.blocked
  return CHAT_FAIL[error] || "That didn't go through. Try again."
}

/** 'HH:MM' on the player's own clock. */
export function clockTime(at) {
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function timeLeft(closesAt, now) {
  const ms = new Date(closesAt).getTime() - now.getTime()
  if (ms <= 0) return null
  const d = Math.floor(ms / 86_400_000)
  const h = Math.floor((ms % 86_400_000) / 3_600_000)
  return d > 0 ? `${d}d ${h}h left` : `${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m left`
}

// ── Live strip + tabs ─────────────────────────────────────────────────

/** Always visible above the tabs: live state, time left and — except on
 *  Battle, where the matchup itself is the hero — the score. Off-white
 *  numbers; the team colour is only the small dot beside each. */
export function liveStrip(b, now, { score = true } = {}) {
  const left = timeLeft(b.closesAt, now)
  const state = b.frozen ? 'FINAL' : left ? 'LIVE' : 'VERIFYING'
  const [x, y] = b.teams
  const pts = (t, end) => `<span class="vt-ls-t${end ? ' is-end' : ''}"${teamAttr(t.id)}><i aria-hidden="true"></i><b>${fmt(t.points)}</b></span>`
  return `<div class="vt-ls" data-vt-live="${state.toLowerCase()}">
    <span class="vt-ls-state">${state === 'LIVE' ? '<i class="vt-ls-dot" aria-hidden="true"></i>' : ''}${state}</span>
    ${left && !b.frozen ? `<span class="vt-ls-left">${esc(left)}</span>` : ''}
    ${score ? `<span class="vt-ls-score" aria-label="${esc(`${x.label} ${fmt(x.points)}, ${y.label} ${fmt(y.points)}`)}">${pts(x, false)}<span class="vt-ls-vs" aria-hidden="true">vs</span>${pts(y, true)}</span>` : ''}
  </div>`
}

export function hubTabs(tab, { done = 0, total = 0 } = {}) {
  return `<div class="vt-tabs" role="tablist" aria-label="MAMA Battle">${HUB_TABS.map(([id, label]) => {
    const extra = id === 'voting' && total ? `<small class="vt-tab-n">${done}/${total}</small>` : ''
    return `<button class="vt-tab" type="button" role="tab" id="vt-tab-${id}" aria-controls="vt-panel-${id}" aria-selected="${tab === id}" tabindex="${tab === id ? 0 : -1}" data-vt-act="hub-tab" data-vt-tab="${id}">${label}${extra}</button>`
  }).join('')}</div>`
}

/** The floating Chat button above the nav. New messages show a dot, never a count. */
export function chatFab(hub = {}) {
  return `<button class="vt-chat-fab" type="button" data-vt-act="chat-open" aria-haspopup="dialog" aria-label="Open MAMA Chat${hub.unread ? ', new messages' : ''}">${ic('chat')}${hub.unread ? '<i class="vt-fab-dot" aria-hidden="true"></i>' : ''}</button>`
}

// ── Battle: Moments ───────────────────────────────────────────────────

const MOMENT_ICON = { lead: 'zap', tie: 'swords', gift: 'gift', final: 'clock' }

export function momentsCard(moments, labels) {
  const list = (moments || []).slice(0, 5)
  const line = (m) => {
    if (m.sys === 'lead' && m.team) return `<b class="vt-tm-tx"${teamAttr(m.team)}>${esc(labels[m.team] || m.team.toUpperCase())}</b> took the lead`
    return esc(m.body.charAt(0) + m.body.slice(1).toLowerCase())
  }
  return `<section aria-labelledby="vt-h-moments">
    <div class="vt-sec-h"><h2 id="vt-h-moments">Moments</h2><span class="vt-aside">live</span></div>
    ${list.length
      ? `<div class="vt-card vt-moments"><ul>${list.map((m) => `<li data-sys="${esc(m.sys)}"><time class="vt-mono">${esc(clockTime(m.at))}</time><span class="vt-mo-i">${ic(MOMENT_ICON[m.sys] || 'flag')}</span><span>${line(m)}</span></li>`).join('')}</ul></div>`
      : `<p class="vt-moments-empty">${ic('zap')}Lead changes and gift countdowns show up here.</p>`}
  </section>`
}

// ── Team ──────────────────────────────────────────────────────────────

const skeletonRows = (n) => Array.from({ length: n }, () => '<li class="vt-sk-row"><span class="vt-sk vt-sk-av"></span><span class="vt-sk vt-sk-line"></span></li>').join('')

/** team: { loading } | { error } | the getBattleTeam result. */
export function teamPanel(team, { labels, busy = false } = {}) {
  if (!team || team.loading) {
    return `<div class="vt-hub-team" aria-busy="true"><div class="vt-tm-head vt-card"><span class="vt-sk vt-sk-title"></span><span class="vt-sk vt-sk-line"></span></div>
      <ul class="vt-card vt-roster">${skeletonRows(5)}</ul><span class="vt-sr" role="status">Loading your team…</span></div>`
  }
  if (team.error === 'team_required') return pickSide('Team is private to your side. Choose HOOLIGANS or ALIENS to see your teammates.')
  if (team.error) return retryState("Couldn't load your team.", 'team-retry')
  const label = labels[team.team] || team.team.toUpperCase()
  const rows = team.members.map((m) => {
    const url = instagramUrl(m.ig)
    return `<li class="vt-mem${m.me ? ' is-me' : ''}">
      <span class="vt-mem-av" aria-hidden="true">${esc(([...m.codename][0] || '?').toUpperCase())}</span>
      <span class="vt-mem-id"><span class="vt-mem-name">${esc(m.codename)}${m.me ? '<span class="vt-mem-you">YOU</span>' : ''}</span>${url
        ? `<a class="vt-mem-ig" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${ic('instagram')}@${esc(m.ig)}<span class="vt-sr"> on Instagram</span></a>` : ''}</span>
      ${m.votedToday ? `<span class="vt-mem-voted">${ic('check')}Voted today</span>` : ''}
    </li>`
  }).join('')
  return `<div class="vt-hub-team"${teamAttr(team.team)}>
    <div class="vt-tm-head">
      <span class="vt-tm-only">${ic('lock')}Only ${esc(label)} can see this</span>
      <h2 class="vt-tm-name">${esc(label)}</h2>
      <p class="vt-tm-counts"><span><b>${fmt(team.count)}</b> ${team.count === 1 ? 'member' : 'members'}</span><span><b>${fmt(team.online)}</b> online now</span></p>
    </div>
    <label class="vt-card vt-tm-opt">
      <span class="vt-tm-opt-tx"><strong>Show my Instagram username to my team</strong><span>${esc(label)} only · this event · off by default</span></span>
      <input type="checkbox" class="vt-switch" role="switch" data-vt-act="team-ig"${team.showIg ? ' checked' : ''}${busy ? ' disabled' : ''}>
    </label>
    ${team.members.length > 1 ? '' : `<p class="vt-empty vt-card">You're the first ${esc(label)} here. Teammates show up as they join.</p>`}
    <ul class="vt-card vt-roster" aria-label="${esc(label)} members">${rows}</ul>
  </div>`
}

function pickSide(text) {
  return `<div class="vt-hub-state"><span class="vt-hub-state-i">${ic('users')}</span><h2>Pick your side first</h2><p>${esc(text)}</p>
    <button class="vt-btn vt-btn-primary" type="button" data-vt-act="team-choose">Choose your side</button></div>`
}
function retryState(text, act) {
  return `<div class="vt-hub-state"><span class="vt-hub-state-i">${ic('info')}</span><h2>${esc(text)}</h2><p>Check your connection. It retries by itself.</p>
    <button class="vt-btn vt-btn-outline" type="button" data-vt-act="${act}">Try again</button></div>`
}

// ── Chat ──────────────────────────────────────────────────────────────

function message(m, labels, hub) {
  if (m.kind === 'system') {
    return `<li class="vt-moment" data-sys="${esc(m.sys)}"${teamAttr(m.team)} data-vt-msg="${m.id}"><span>${ic(MOMENT_ICON[m.sys] || 'flag')}${esc(m.body)}</span></li>`
  }
  const label = labels[m.team] || ''
  const hidden = m.body == null
  const rx = Object.entries(m.reactions || {}).filter(([, n]) => n > 0)
  const quote = m.replyTo ? `<p class="vt-msg-q"${teamAttr(m.replyTo.team)}>${ic('reply')}<span><b>${esc(m.replyTo.codename)}</b> ${m.replyTo.body == null ? '<i>message hidden</i>' : esc(m.replyTo.body)}</span></p>` : ''
  return `<li class="vt-msg${m.mine ? ' is-mine' : ''}${hidden ? ' is-hidden' : ''}"${teamAttr(m.team)} data-vt-msg="${m.id}">
    <div class="vt-msg-meta"><strong>${esc(m.codename)}</strong>${label ? `<span class="vt-msg-tag">${esc(label)}</span>` : ''}<time class="vt-mono" datetime="${esc(m.at)}">${esc(clockTime(m.at))}</time>${hidden ? '' : `<button class="vt-msg-more" type="button" data-vt-act="chat-more" data-vt-id="${m.id}" aria-haspopup="dialog" aria-label="Message options for ${esc(m.codename)}">${ic('more')}</button>`}</div>
    ${quote}
    <p class="vt-msg-tx">${hidden ? (m.status === 'removed' ? 'Message removed by a moderator' : 'Message hidden after reports') : esc(m.body)}</p>
    ${!hidden && rx.length ? `<div class="vt-rx">${rx.map(([e, n]) => {
      const mine = (m.myReactions || []).includes(e)
      return `<button type="button" class="vt-rx-b${mine ? ' is-mine' : ''}" data-vt-act="chat-react" data-vt-id="${m.id}" data-vt-emoji="${esc(e)}" aria-pressed="${mine}" aria-label="${esc(e)} ${n}${mine ? ', yours' : ''}">${esc(e)}<b>${n}</b></button>`
    }).join('')}</div>` : ''}
  </li>`
}

/** The message list alone (repainted in place on each poll). */
export function chatFeed(chat, labels, hub = {}) {
  const msgs = collapseMoments(chat.messages)
  if (!msgs.length) {
    return `<div class="vt-hub-state is-quiet"><span class="vt-hub-state-i">${ic('chat')}</span><h2>No messages yet</h2><p>Both teams share this room. Say hi to the other side, and keep it about the battle.</p></div>`
  }
  return `<ol class="vt-chat-list">${msgs.map((m) => message(m, labels, hub)).join('')}</ol>`
}

/** Why the composer is off, if it is. */
export function chatLock(chat, now = new Date()) {
  if (chat.timeoutUntil && new Date(chat.timeoutUntil) > now) return `You can read Chat, but can't post until ${clockTime(chat.timeoutUntil)}.`
  if (chat.paused) return 'Chat is paused for a moment.'
  if (!chat.open) return 'Voting has closed. Chat is read-only now. GG, both sides.'
  return null
}

export function composer(chat, hub, labels, now = new Date()) {
  const lock = chatLock(chat, now)
  if (lock) return `<div class="vt-chat-comp is-locked"><p class="vt-note" role="status">${ic('lock')}<span>${esc(lock)}</span></p></div>`
  const reply = hub.replyTo
  const wait = hub.waitUntil && hub.waitUntil > now.getTime() ? Math.ceil((hub.waitUntil - now.getTime()) / 1000) : 0
  const draft = hub.draft || ''
  return `<form class="vt-chat-comp" data-vt-form="chat" novalidate>
    ${reply ? `<div class="vt-chat-reply"${teamAttr(reply.team)}>${ic('reply')}<span>Replying to <b>${esc(reply.codename)}</b>${reply.body ? ` · ${esc(reply.body)}` : ''}</span><button type="button" class="vt-icon-btn" data-vt-act="chat-reply-cancel" aria-label="Cancel reply">${ic('x')}</button></div>` : ''}
    <div class="vt-chat-in">
      <input class="vt-input" name="message" maxlength="${CHAT_MAX}" autocomplete="off" enterkeyhint="send" data-vt-chat-input aria-label="Message to both teams" placeholder="Say something to both teams…" value="${esc(draft)}">
      <button type="submit" class="vt-chat-send" aria-label="${wait ? `Send in ${wait} seconds` : 'Send'}"${wait || hub.sending ? ' disabled' : ''}>${wait ? `<span class="vt-mono">${wait}</span>` : ic('send')}</button>
    </div>
    <div class="vt-chat-foot"><span data-vt-chat-hint${hub.error ? ' class="is-err" role="alert"' : ''}>${esc(hub.error || 'Both teams see this · no links or @usernames')}</span><span class="vt-mono" data-vt-chat-count>${[...draft].length}/${CHAT_MAX}</span></div>
  </form>`
}

/** chat: { loading } | { error } | the getBattleChat result. */
export function chatPanel(chat, hub, labels, now = new Date()) {
  if (!chat || chat.loading) {
    return `<div class="vt-hub-chat" aria-busy="true"><ol class="vt-chat-list">${Array.from({ length: 3 }, () => '<li class="vt-sk-msg"><span class="vt-sk vt-sk-line"></span><span class="vt-sk vt-sk-bubble"></span></li>').join('')}</ol><span class="vt-sr" role="status">Loading Chat…</span></div>`
  }
  if (chat.error === 'team_required') return pickSide('Chat is one room for both teams. Pick a side to join in.')
  if (chat.error) return retryState("Can't reach Chat.", 'chat-retry')
  const here = Object.entries(chat.presence || {})
  return `<div class="vt-hub-chat">
    <div class="vt-chat-head">
      ${here.map(([id, n]) => `<span class="vt-chat-here"${teamAttr(id)}><i aria-hidden="true"></i>${fmt(n)} ${esc(labels[id] || id)} here</span>`).join('')}
      ${chat.muted?.length ? `<button type="button" class="vt-chat-muted" data-vt-act="chat-muted" aria-haspopup="dialog">${ic('mute')}${chat.muted.length} muted</button>` : ''}
    </div>
    <div class="vt-chat-feed" data-vt-chat-feed aria-live="polite" aria-relevant="additions">${chatFeed(chat, labels, hub)}</div>
    ${composer(chat, hub, labels, now)}
  </div>`
}

/** Chat as a sheet over any tab (opened from the floating button). */
export function chatSheet(chat, hub, labels, now = new Date()) {
  return `<div class="vt-sheet vt-chat-sheet" data-vt-sheet="chat" role="dialog" aria-modal="true" aria-labelledby="vt-chat-title" hidden tabindex="-1">
    <div class="vt-sheet-h"><h2 id="vt-chat-title">MAMA Chat</h2><span class="vt-chat-sub">HOOLIGANS × ALIENS</span><button class="vt-icon-btn" type="button" aria-label="Close Chat" data-vt-act="sheet-close">${ic('x')}</button></div>
    ${chatPanel(chat, hub, labels, now)}
  </div>`
}

// ── Chat sheets ───────────────────────────────────────────────────────

const sheetHead = (id, title) => `<div class="vt-sheet-h"><h2 id="${id}">${title}</h2><button class="vt-icon-btn" type="button" aria-label="Close" data-vt-act="sheet-close">${ic('x')}</button></div>`

/** Options for one message: react, reply, and (not your own) mute and report. */
export function chatMessageSheet(m, labels) {
  if (!m) return '<div class="vt-sheet" data-vt-sheet="chat-msg" role="dialog" aria-modal="true" hidden tabindex="-1"></div>'
  const mine = new Set(m.myReactions || [])
  return `<div class="vt-sheet" data-vt-sheet="chat-msg" role="dialog" aria-modal="true" aria-labelledby="vt-cm-title" hidden tabindex="-1">
    ${sheetHead('vt-cm-title', `${esc(m.codename)} <span class="vt-msg-tag"${teamAttr(m.team)}>${esc(labels[m.team] || '')}</span>`)}
    <p class="vt-cm-quote">${esc(m.body || '')}</p>
    <div class="vt-cm-emoji" role="group" aria-label="React">${CHAT_EMOJI.map((e) => `<button type="button" class="vt-cm-e${mine.has(e) ? ' is-mine' : ''}" data-vt-act="chat-react" data-vt-id="${m.id}" data-vt-emoji="${e}" aria-pressed="${mine.has(e)}">${e}</button>`).join('')}</div>
    <div class="vt-cm-acts">
      <button type="button" class="vt-cm-act" data-vt-act="chat-reply" data-vt-id="${m.id}">${ic('reply')}Reply</button>
      ${m.mine ? '' : `<button type="button" class="vt-cm-act" data-vt-act="chat-mute" data-vt-key="${esc(m.memberKey)}">${ic('mute')}Mute ${esc(m.codename)}<small>only for you</small></button>
      <button type="button" class="vt-cm-act is-bad" data-vt-act="chat-report-open" data-vt-id="${m.id}">${ic('flag')}Report message</button>`}
    </div>
  </div>`
}

export function chatReportSheet(m, labels) {
  if (!m) return '<div class="vt-sheet" data-vt-sheet="chat-report" role="dialog" aria-modal="true" hidden tabindex="-1"></div>'
  return `<form class="vt-sheet" data-vt-sheet="chat-report" data-vt-form="chat-report" data-vt-id="${m.id}" role="dialog" aria-modal="true" aria-labelledby="vt-cr-title" hidden tabindex="-1">
    ${sheetHead('vt-cr-title', 'Report this message')}
    <p class="vt-cm-quote"><b>${esc(m.codename)}</b> · ${esc(m.body || '')}</p>
    <fieldset class="vt-cr-reasons"><legend class="vt-sr">Reason</legend>${Object.entries(REPORT_LABELS).map(([k, t], i) => `<label class="vt-cr-r"><input type="radio" name="reason" value="${k}"${i === 0 ? ' checked' : ''}><span>${t}</span></label>`).join('')}</fieldset>
    <p class="vt-cr-note">They won't know who reported it. It disappears for you right away, and a reviewer checks it if others report it too.</p>
    <button class="vt-btn vt-btn-primary" type="submit">Report</button>
  </form>`
}

export function chatMutedSheet(muted) {
  return `<div class="vt-sheet" data-vt-sheet="chat-muted" role="dialog" aria-modal="true" aria-labelledby="vt-mu-title" hidden tabindex="-1">
    ${sheetHead('vt-mu-title', 'Muted in Chat')}
    <p class="vt-cr-note">Only you stop seeing their messages and reactions. They aren't told.</p>
    <ul class="vt-mu-list">${(muted || []).map((m) => `<li><span>${esc(m.codename)}</span><button type="button" class="vt-btn vt-btn-outline vt-btn-sm" data-vt-act="chat-unmute" data-vt-key="${esc(m.memberKey)}">Unmute</button></li>`).join('') || '<li class="vt-empty">Nobody muted.</li>'}</ul>
  </div>`
}
