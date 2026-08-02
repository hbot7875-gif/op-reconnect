// Sign in / create account for Op: Reconnect.
//
// This season has its own accounts, so this is the front door — no Mission
// Control detour. Two panels behind one toggle: create an agent file, or sign
// back into one. The codename + mode step is NOT here; that's the game's
// onboarding and runs once, after the account exists.
//
// The agent number is issued by the server and shown once on creation, so the
// screen that reveals it is deliberately hard to click past.

import { call } from './api.js'
import { el, esc, toast } from './state.js'
import { setSession } from './session.js'

const ERRORS = {
  handle_taken: 'That handle is already registered. Sign in instead?',
  handle_invalid: 'Handles are 3-30 characters — letters, numbers, dots and underscores.',
  password_short: 'Passwords need at least 6 characters.',
  bad_credentials: "That agent number and password don't match.",
  agent_not_found: "No agent with that number. Check it, or create a new file.",
  rate_limited: 'Too many tries. Wait a minute and go again.',
  email_invalid: "That email doesn't look right.",
  email_taken: 'That email already has an agent file. Sign in, or recover it.',
  code_invalid: "That code isn't right. Check the email again.",
  code_expired: 'That code has expired. Ask for a new one.',
  mail_not_configured: "Recovery email isn't switched on yet — ask HQ to set it up.",
}
const friendly = (e) => ERRORS[e] || e || 'Something went wrong'

export function renderAuth(container, onAuthed) {
  container.innerHTML = ''
  container.hidden = false
  const wrap = el('div', 'auth-wrap')

  wrap.appendChild(el('div', 'eyebrow', 'OP: RECONNECT'))
  wrap.appendChild(el('h1', 'title-sm', 'The network needs agents'))
  wrap.appendChild(el('p', 'muted auth-lede',
    'This is a new season with new agent files. Old numbers from the last mission don\'t work here — make a fresh one.'))

  const tabs = el('div', 'auth-tabs')
  const tabNew = el('button', 'auth-tab sel', 'Create file')
  const tabOld = el('button', 'auth-tab', 'I have one')
  tabs.append(tabNew, tabOld)
  wrap.appendChild(tabs)

  const panelNew = buildRegister(onAuthed)
  const panelOld = buildLogin(onAuthed)
  panelOld.hidden = true
  wrap.append(panelNew, panelOld)

  tabNew.onclick = () => {
    tabNew.classList.add('sel'); tabOld.classList.remove('sel')
    panelNew.hidden = false; panelOld.hidden = true
  }
  tabOld.onclick = () => {
    tabOld.classList.add('sel'); tabNew.classList.remove('sel')
    panelOld.hidden = false; panelNew.hidden = true
  }

  // No link out to the old site's Mission Control: that's a separate
  // deployment with separate accounts, and a relative path to it resolves to
  // nothing from here.
  const foot = el('div', 'auth-foot')
  foot.innerHTML = 'New season, new agent files. Nothing carries over from the last mission.'
  wrap.appendChild(foot)

  container.appendChild(wrap)
}

/* ── Create an agent file ─────────────────────────────────────────────── */

function buildRegister(onAuthed) {
  const panel = el('div', 'auth-panel')

  const handle = el('input', 'ob-input')
  handle.placeholder = 'Your Instagram handle'
  handle.maxLength = 30
  handle.autocomplete = 'username'

  const pw = el('input', 'ob-input')
  pw.type = 'password'
  pw.placeholder = 'Create a password'
  pw.autocomplete = 'new-password'

  const pw2 = el('input', 'ob-input')
  pw2.type = 'password'
  pw2.placeholder = 'Type it again'
  pw2.autocomplete = 'new-password'

  // Required, as of migration 023. The agent number is shown exactly once
  // and is what you sign in with — without an address on file, one forgotten
  // password ends the account permanently, with no recovery path for the
  // player and none for HQ either.
  const email = el('input', 'ob-input')
  email.type = 'email'
  email.placeholder = 'you@example.com'
  email.autocomplete = 'email'

  const lb = el('input', 'ob-input')
  lb.placeholder = 'ListenBrainz username (optional)'
  lb.autocomplete = 'off'

  panel.append(
    field('Handle', 'Everyone sees this. It becomes your district on the map.', handle),
    field('Email', 'Only ever used to get you back in if you lose your number or password.', email),
    field('Password', 'At least 6 characters.', pw),
    field('', '', pw2),
    field('Streams', 'Link it now or set it up in Settings — this is how your streams reach the network.', lb),
  )

  // Live check, so "taken" arrives before a password gets typed. checkHandle
  // was listed in api.js's public actions from the start and only now exists.
  let handleTimer = null
  handle.oninput = () => {
    clearTimeout(handleTimer)
    const h = handle.value.trim()
    handle.classList.remove('is-bad', 'is-good')
    if (h.length < 3) return
    handleTimer = setTimeout(async () => {
      const res = await call('checkHandle', { handle: h })
      if (handle.value.trim() !== h) return
      handle.classList.toggle('is-good', !!res.available)
      handle.classList.toggle('is-bad', !res.available)
    }, 400)
  }

  const btn = el('button', 'btn btn-primary auth-go', 'Create my agent file')
  btn.onclick = async () => {
    const h = handle.value.trim()
    if (h.length < 3) { toast('Handle needs at least 3 characters'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) { toast('Add an email so you can get back in later'); return }
    if (pw.value.length < 6) { toast('Password needs at least 6 characters'); return }
    if (pw.value !== pw2.value) { toast("Passwords don't match"); return }

    btn.disabled = true
    btn.textContent = 'CREATING…'
    const res = await call('registerAgent', {
      handle: h,
      email: email.value.trim(),
      password: pw.value,
      lbUsername: lb.value.trim() || null,
    })
    btn.disabled = false
    btn.textContent = 'Create my agent file'

    if (!res.success) { toast(friendly(res.error)); return }
    setSession(res.agent)
    showNumber(res.agent, onAuthed)
  }
  panel.appendChild(btn)
  return panel
}

/* ── Sign back in ─────────────────────────────────────────────────────── */

function buildLogin(onAuthed) {
  const panel = el('div', 'auth-panel')

  const no = el('input', 'ob-input')
  no.placeholder = 'Agent number (e.g. AGENT042)'
  no.autocomplete = 'username'

  const pw = el('input', 'ob-input')
  pw.type = 'password'
  pw.placeholder = 'Password'
  pw.autocomplete = 'current-password'

  panel.append(
    field('Agent number', 'The one HQ gave you when you signed up.', no),
    field('Password', '', pw),
  )

  const btn = el('button', 'btn btn-primary auth-go', 'Sign in')
  const go = async () => {
    const agentNo = no.value.trim().toUpperCase()
    if (!agentNo || !pw.value) { toast('Agent number and password, please'); return }
    btn.disabled = true
    btn.textContent = 'CHECKING…'
    const res = await call('loginAgent', { agentNo, password: pw.value })
    btn.disabled = false
    btn.textContent = 'Sign in'
    if (!res.success) { toast(friendly(res.error)); return }
    setSession(res.agent)
    onAuthed()
  }
  btn.onclick = go
  pw.onkeydown = (e) => { if (e.key === 'Enter') go() }
  panel.appendChild(btn)

  // One link for both kinds of lost: the recovery email carries the agent
  // number AND a reset code, because "I forgot my password" and "I lost my
  // number" are the same person in the same trouble.
  const forgot = el('button', 'auth-link', 'Lost your number or password?')
  forgot.onclick = () => showRecovery(onAuthed)
  panel.appendChild(forgot)
  return panel
}

/* ── Recovery: email → code → new password ────────────────────────────── */

function showRecovery(onAuthed) {
  const wrap = document.querySelector('.auth-wrap')
  wrap.innerHTML = ''
  wrap.append(
    el('div', 'eyebrow', 'SIGNAL RECOVERY'),
    el('h1', 'title-sm', 'Get back into your file'),
    el('p', 'muted auth-lede', 'Enter the email on your agent file. HQ sends back your agent number and a one-time code.'),
  )

  const email = el('input', 'ob-input')
  email.type = 'email'
  email.placeholder = 'you@example.com'
  email.autocomplete = 'email'
  wrap.appendChild(field('Email', '', email))

  const send = el('button', 'btn btn-primary auth-go', 'Send my code')
  send.onclick = async () => {
    const addr = email.value.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) { toast('Enter the email on your agent file'); return }
    send.disabled = true
    send.textContent = 'SENDING…'
    const res = await call('requestPasswordReset', { email: addr })
    send.disabled = false
    send.textContent = 'Send my code'
    if (!res.success) { toast(friendly(res.error)); return }
    showCodeStep(addr, res.expiresInMinutes || 30, onAuthed)
  }
  wrap.appendChild(send)

  const back = el('button', 'auth-link', '← Back to sign in')
  back.onclick = () => renderAuth(document.getElementById('auth'), onAuthed)
  wrap.appendChild(back)
}

function showCodeStep(addr, minutes, onAuthed) {
  const wrap = document.querySelector('.auth-wrap')
  wrap.innerHTML = ''
  wrap.append(
    el('div', 'eyebrow', 'CODE SENT'),
    el('h1', 'title-sm', 'Check your email'),
    // Deliberately says "if that address is on file" — the server answers
    // identically for unknown addresses so this endpoint can't be used to
    // find out who's registered, and the wording shouldn't promise more.
    el('p', 'muted auth-lede',
      `If ${esc(addr)} is on an agent file, a code is on its way. It expires in ${minutes} minutes, and the email has your agent number in it too.`),
  )

  const code = el('input', 'ob-input')
  code.placeholder = 'ABCD2345'
  code.autocomplete = 'one-time-code'
  code.style.textTransform = 'uppercase'

  const pw = el('input', 'ob-input')
  pw.type = 'password'
  pw.placeholder = 'New password'
  pw.autocomplete = 'new-password'

  const pw2 = el('input', 'ob-input')
  pw2.type = 'password'
  pw2.placeholder = 'Type it again'
  pw2.autocomplete = 'new-password'

  wrap.append(
    field('Code', '', code),
    field('New password', 'At least 6 characters.', pw),
    field('', '', pw2),
  )

  const go = el('button', 'btn btn-primary auth-go', 'Set my new password')
  go.onclick = async () => {
    if (pw.value.length < 6) { toast('Password needs at least 6 characters'); return }
    if (pw.value !== pw2.value) { toast("Passwords don't match"); return }
    go.disabled = true
    go.textContent = 'RESETTING…'
    const res = await call('resetPassword', { code: code.value.trim(), newPassword: pw.value })
    go.disabled = false
    go.textContent = 'Set my new password'
    if (!res.success) { toast(friendly(res.error)); return }
    // The reset hands back a live session, so there's no reason to bounce
    // someone to a sign-in form they'd fill in with what they just typed.
    setSession(res.agent)
    toast(`Welcome back, ${res.agent.agentNo}`)
    onAuthed()
  }
  wrap.appendChild(go)

  const back = el('button', 'auth-link', '← Back to sign in')
  back.onclick = () => renderAuth(document.getElementById('auth'), onAuthed)
  wrap.appendChild(back)
}

/* ── The number, shown once ───────────────────────────────────────────── */

function showNumber(agent, onAuthed) {
  const wrap = document.querySelector('.auth-wrap')
  wrap.innerHTML = ''
  wrap.append(
    el('div', 'eyebrow', 'AGENT FILE CREATED'),
    el('h1', 'title-sm', `Welcome, ${esc(agent.handle || 'Agent')}`),
    el('p', 'muted', 'This is your agent number. You sign in with it — write it down somewhere safe.'),
    el('div', 'agent-id-box', esc(agent.agentNo || agent.agent_no)),
    el('div', 'warn-box',
      '⚠️ <strong>Keep it to yourself</strong><br>Your number is how HQ knows it\'s you. Never post it — not every signal on this grid is friendly.'),
  )
  const btn = el('button', 'btn btn-primary auth-go', "Got it — let's go")
  btn.onclick = onAuthed
  wrap.appendChild(btn)
}

/* ── bits ─────────────────────────────────────────────────────────────── */

function field(label, hint, input) {
  const f = el('div', 'auth-field')
  if (label) f.appendChild(el('label', 'auth-label', esc(label)))
  f.appendChild(input)
  if (hint) f.appendChild(el('div', 'auth-hint', esc(hint)))
  return f
}
