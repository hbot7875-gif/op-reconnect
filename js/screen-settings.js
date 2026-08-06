// Settings — the tab every game has and this one didn't.
//
// Four sections, ordered by how badly a player needs them:
//   Uplink    where streams come from. Broken here means the whole game is
//             broken, so it sits at the top and shouts when it's misconfigured.
//   Agent     number, handle, recovery email.
//   Security  password, sign out.
//   Game      difficulty.
//
// Rows open sheets rather than expanding inline: the overlay pattern is
// already how this game asks for anything (mode, items, districts), and a
// settings screen that pushes content around as you tap it feels cheap.

import { call } from './api.js'
import { el, esc, toast, showOverlay, hideOverlay, getState } from './state.js'
import { getAgentNo, getSession, setSession, setToken, clearSession } from './session.js'
import { openStreamSource, openPin, openSignalLog, sourceName, uplinkBroken } from './settings-streams.js'
import { openModeSheet } from './ui-hud.js'
import { agentManualSheet } from './agent-manual.js'

let account = null

export function renderSettings(container, state) {
  container.innerHTML = ''
  const wrap = el('div', 'set-screen')

  wrap.appendChild(el('div', 'pack-head', `
    <span class="pack-eyebrow">⚙ Settings</span>
    <span class="pack-name">${esc(state?.player?.codename || 'Agent')}</span>
  `))

  const body = el('div', 'set-body')
  wrap.appendChild(body)
  container.appendChild(wrap)

  // main.js re-renders the active screen on every state change — the 90s
  // poll and the tab-focus refresh both land here. Repainting from the
  // cached account first means those don't blink the whole screen back to a
  // loading line; the fetch below then quietly corrects it.
  if (account) paintSections(body, state)
  else body.appendChild(el('p', 'muted', 'Opening your file…'))

  call('getAccount', { agentNo: getAgentNo() }).then((res) => {
    if (!res.success) {
      body.innerHTML = ''
      body.appendChild(el('p', 'muted', esc(res.error || "Couldn't load your agent file")))
      return
    }
    account = res.account
    // Keep the stored session in step — the email lives here now, and
    // ui-auth wrote it at sign-in from a payload that may predate it.
    const s = getSession()
    if (s) setSession({ ...s, email: account.email })
    paintSections(body, state)
  })
}

function reload(body, state) {
  call('getAccount', { agentNo: getAgentNo() }).then((res) => {
    if (res.success) { account = res.account; paintSections(body, state) }
  })
}

function paintSections(body, state) {
  body.innerHTML = ''
  const refresh = () => reload(body, state)

  // ── The one warning worth interrupting for ──────────────────────
  if (uplinkBroken(account)) {
    const warn = el('button', 'set-alarm', `
      <span class="sa-icon">⚠</span>
      <span class="sa-main">
        <span class="sa-title">Your stream source isn't set up</span>
        <span class="sa-body">Nothing you stream is being counted. Tap to fix it — it takes a minute.</span>
      </span>
    `)
    warn.onclick = () => openStreamSource(account, refresh)
    body.appendChild(warn)
  }
  if (!account.email) {
    const warn = el('button', 'set-alarm soft', `
      <span class="sa-icon">✉</span>
      <span class="sa-main">
        <span class="sa-title">No recovery email on file</span>
        <span class="sa-body">Your agent number is the only way back into this account. Add an email so a lost password isn't the end of it.</span>
      </span>
    `)
    warn.onclick = () => showOverlay(emailSheet(account, refresh))
    body.appendChild(warn)
  }

  // ── Stream source ─────────────────────────────────────────────
  body.appendChild(section('Stream source', 'How your streams reach the network', [
    {
      // Naming the source while it's missing its username reads as "this is
      // handled" when nothing is being counted — say what's actually true.
      icon: '📡', name: 'Stream source',
      value: uplinkBroken(account) ? 'Needs setup' : sourceName(account.streamSource),
      body: 'ListenBrainz, a scrobbler app, stats.fm or musicat.fm.',
      onClick: () => openStreamSource(account, refresh),
    },
    {
      icon: '🔑', name: 'Scrobbler PIN', value: account.hasPin ? 'Ready' : 'Not set',
      body: 'The private key and URLs for Web Scrobbler or Pano Scrobbler.',
      onClick: () => openPin(account, refresh),
    },
    {
      icon: '📻', name: 'Check your streams', value: '',
      body: "See what the network heard from you in the last 24 hours, and what counted.",
      onClick: () => openSignalLog(),
    },
  ]))

  // ── Agent file ──────────────────────────────────────────────────
  body.appendChild(section('Agent file', 'Who HT thinks you are', [
    {
      icon: '🪪', name: 'Agent number', value: account.agentNo,
      body: 'You sign in with this. Tap to copy it somewhere safe.',
      onClick: async () => {
        try { await navigator.clipboard.writeText(account.agentNo); toast('Agent number copied') }
        catch { toast(account.agentNo) }
      },
    },
    { icon: '@', name: 'Handle', value: account.handle, body: 'Public — this is your district on the map.', muted: true },
    {
      icon: '✉', name: 'Recovery email', value: account.email || 'Not set',
      body: 'The only way back in if you lose your number or password.',
      onClick: () => showOverlay(emailSheet(account, refresh)),
    },
  ]))

  // ── Security ────────────────────────────────────────────────────
  body.appendChild(section('Security', 'Keep the file yours', [
    {
      icon: '🔒', name: 'Change password', value: '',
      body: 'Signs out every other device.',
      onClick: () => showOverlay(passwordSheet()),
    },
    {
      icon: '⏻', name: 'Sign out', value: '',
      body: 'Ends this session everywhere. Your progress stays exactly where it is.',
      onClick: () => showOverlay(signOutSheet()),
    },
    {
      icon: '🪦', name: 'Retirement Protocol', value: '',
      body: 'Permanently step down. Your district stays on the map, exactly as you left it.',
      onClick: () => showOverlay(retireSheet()),
    },
  ]))

  // ── Game ────────────────────────────────────────────────────────
  body.appendChild(section('Game', 'How hard you want this', [
    {
      icon: '🎚', name: 'Streaming mode', value: state?.player?.mode || 'easy',
      body: 'More accounts means bigger targets and slower XP from assigned goal streams — 10/20/30 for 1 XP.',
      onClick: () => openModeSheet(getState() || state),
    },
  ]))

  // ── Help — reference material, not inventory, so it lives here rather
  // than the Pack (which used to carry it as one of six generic cards).
  body.appendChild(section('Help', 'Reference, not inventory', [
    {
      icon: '📖', name: 'How to Play', value: '',
      body: 'The game loop, every way to earn XP, and how to protect your progress.',
      onClick: () => showOverlay(agentManualSheet()),
    },
  ]))

  // ── HT access — agent000 only. Not a real security boundary (admin.html
  // is still gated by its own SYNC_ADMIN_KEY), just keeps the entry point
  // out of every other agent's settings screen.
  if ((account.agentNo || '').toUpperCase() === 'AGENT000') {
    body.appendChild(section('HT Access', 'Command panel', [
      {
        icon: '🛰️', name: 'Admin Panel', value: '',
        body: 'Red Zone events, broadcasts, district goals, agent lookup.',
        onClick: () => { window.location.href = 'admin.html' },
      },
    ]))
  }

  body.appendChild(el('div', 'set-foot',
    `Agent since ${fmtDate(account.createdAt)} · OP: ReConnect`))
}

function section(title, sub, rows) {
  const box = el('div', 'set-section')
  box.appendChild(el('div', 'set-head', `
    <span class="sh-title">${esc(title)}</span>
    <span class="sh-sub">${esc(sub)}</span>
  `))
  for (const r of rows) {
    const row = el(r.onClick ? 'button' : 'div', 'set-row' + (r.muted ? ' is-static' : ''))
    row.innerHTML = `
      <span class="sr-icon">${r.icon}</span>
      <span class="sr-main">
        <span class="sr-name">${esc(r.name)}</span>
        <span class="sr-body">${esc(r.body)}</span>
      </span>
      <span class="sr-tail">
        ${r.value ? `<span class="sr-value">${esc(r.value)}</span>` : ''}
        ${r.onClick ? '<span class="sr-go">›</span>' : ''}
      </span>
    `
    if (r.onClick) row.onclick = r.onClick
    box.appendChild(row)
  }
  return box
}

function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }
  catch { return '—' }
}

/* ── Sheets ───────────────────────────────────────────────────────────── */

function emailSheet(acct, onSaved) {
  const sheet = el('div', 'sheet set-sheet')
  sheet.append(
    el('div', 'eyebrow', 'RECOVERY EMAIL'),
    el('h3', '', acct.email ? 'Change your recovery email' : 'Add a recovery email'),
    el('p', 'muted', "It's only ever used to get you back into this account. No newsletters, no notifications."),
  )
  const email = el('input', 'ob-input')
  email.type = 'email'
  email.placeholder = 'you@example.com'
  email.value = acct.email || ''
  email.autocomplete = 'email'

  const pw = el('input', 'ob-input')
  pw.type = 'password'
  pw.placeholder = 'Your password'
  pw.autocomplete = 'current-password'

  sheet.append(
    field('Email', '', email),
    field('Password', 'Confirming it\'s you — whoever holds the email holds the account.', pw),
  )

  const save = el('button', 'btn btn-primary', 'Save email')
  save.onclick = async () => {
    save.disabled = true
    save.textContent = 'SAVING…'
    const res = await call('updateEmail', { agentNo: getAgentNo(), email: email.value.trim(), password: pw.value })
    save.disabled = false
    save.textContent = 'Save email'
    if (!res.success) { toast(errText(res.error)); return }
    hideOverlay()
    toast('Recovery email saved')
    onSaved?.()
  }
  sheet.appendChild(save)
  const close = el('button', 'btn btn-ghost', 'Cancel')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

function passwordSheet() {
  const sheet = el('div', 'sheet set-sheet')
  sheet.append(
    el('div', 'eyebrow', 'PASSWORD'),
    el('h3', '', 'Change your password'),
    el('p', 'muted', 'Every other device gets signed out. This one stays put.'),
  )
  const cur = pwInput('Current password', 'current-password')
  const next = pwInput('New password', 'new-password')
  const again = pwInput('Type the new one again', 'new-password')
  sheet.append(field('Current', '', cur), field('New', 'At least 6 characters.', next), field('', '', again))

  const save = el('button', 'btn btn-primary', 'Change password')
  save.onclick = async () => {
    if (next.value.length < 6) { toast('New password needs at least 6 characters'); return }
    if (next.value !== again.value) { toast("New passwords don't match"); return }
    save.disabled = true
    save.textContent = 'SAVING…'
    const res = await call('changePassword', {
      agentNo: getAgentNo(), currentPassword: cur.value, newPassword: next.value,
    })
    save.disabled = false
    save.textContent = 'Change password'
    if (!res.success) { toast(errText(res.error)); return }
    // The server rotated the token; without storing the new one this device
    // would sign ITSELF out on the next call.
    setToken(res.sessionToken)
    hideOverlay()
    toast('Password changed')
  }
  sheet.appendChild(save)
  const close = el('button', 'btn btn-ghost', 'Cancel')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

function signOutSheet() {
  const sheet = el('div', 'sheet set-sheet')
  sheet.append(
    el('div', 'eyebrow', 'SIGN OUT'),
    el('h3', '', 'Sign out of this agent file?'),
    el('p', 'muted', `You'll need ${esc(account?.agentNo || 'your agent number')} and your password to get back in. Nothing you've restored is affected.`),
  )
  const go = el('button', 'btn btn-alert', 'Sign out')
  go.onclick = async () => {
    go.disabled = true
    go.textContent = 'SIGNING OUT…'
    // Server-side first: clearing localStorage alone left the token valid in
    // rc_agents forever, which is the wrong answer on a shared device.
    await call('logoutAgent', { agentNo: getAgentNo() })
    clearSession()
    hideOverlay()
    location.reload()
  }
  sheet.appendChild(go)
  const close = el('button', 'btn btn-ghost', 'Stay signed in')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

/** Two-step confirm: retype the handle you're retiring AND the password,
 *  before the one destructive action on this whole screen. Every other
 *  sheet here (password, sign out) needed only one of those — this is the
 *  only one that can't be undone, so it asks for both. */
function retireSheet() {
  const sheet = el('div', 'sheet set-sheet')
  sheet.append(
    el('div', 'eyebrow', 'RETIREMENT PROTOCOL'),
    el('h3', '', 'Retire this agent file?'),
    el('p', 'muted', `This locks ${esc(account?.agentNo || 'your agent number')} out of the network for good — it can't be undone. Your district, XP and badges stay exactly where they are on the map; they just stop being yours to touch.`),
  )

  const handle = el('input', 'ob-input')
  handle.type = 'text'
  handle.placeholder = account?.handle || 'your handle'
  handle.autocomplete = 'off'
  const pw = pwInput('Your password', 'current-password')
  sheet.append(
    field('Type your handle to confirm', `Type "${esc(account?.handle || '')}" exactly, case included.`, handle),
    field('Password', '', pw),
  )

  const go = el('button', 'btn btn-alert', 'Retire this file')
  go.onclick = async () => {
    if (handle.value !== (account?.handle || '')) { toast("That doesn't match your handle"); return }
    go.disabled = true
    go.textContent = 'RETIRING…'
    const res = await call('retireAccount', { agentNo: getAgentNo(), password: pw.value })
    go.disabled = false
    go.textContent = 'Retire this file'
    if (!res.success) { toast(errText(res.error)); return }
    clearSession()
    hideOverlay()
    toast('Agent file retired. Thank you for your service.')
    location.reload()
  }
  sheet.appendChild(go)
  const close = el('button', 'btn btn-ghost', 'Never mind')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

/* ── bits ─────────────────────────────────────────────────────────────── */

function pwInput(placeholder, autocomplete) {
  const i = el('input', 'ob-input')
  i.type = 'password'
  i.placeholder = placeholder
  i.autocomplete = autocomplete
  return i
}

function field(label, hint, input) {
  const f = el('div', 'auth-field')
  if (label) f.appendChild(el('label', 'auth-label', esc(label)))
  f.appendChild(input)
  if (hint) f.appendChild(el('div', 'auth-hint', esc(hint)))
  return f
}

export function errText(code) {
  return {
    bad_credentials: "That password doesn't match.",
    email_invalid: 'That email doesn\'t look right.',
    email_taken: 'Another agent file already uses that email.',
    password_short: 'Passwords need at least 6 characters.',
    rate_limited: 'Too many tries. Wait a minute and go again.',
    agent_not_found: 'Agent file not found.',
    agent_retired: 'This agent file has already been retired.',
  }[code] || code || 'Something went wrong'
}
