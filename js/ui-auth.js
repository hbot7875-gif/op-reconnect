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
import { ambientToggle } from './ambient.js'
import { fromVotingLink } from './onboarding-path.js'
import { readInvite } from './battle-invite.js'
import { normalizeXHandle, pickAccountHandle } from '../supabase/functions/op-reconnect/lib/x-handle-rules.js'

const ERRORS = {
  handle_taken: 'That Instagram username is already registered. Sign in instead?',
  handle_invalid: 'Instagram usernames are 3-30 characters — letters, numbers, dots and underscores.',
  handle_required: 'Add your Instagram or X username.',
  password_short: 'Passwords need at least 6 characters.',
  bad_credentials: "That agent number and password don't match.",
  agent_not_found: "No agent with that number. Check it, or create a new file.",
  agent_retired: 'This agent file was retired. It can\'t be reactivated.',
  x_handle_invalid: "That doesn't look like an X username.",
  x_handle_taken: 'That X username is already on another agent file. Sign in instead?',
  x_handle_short: 'An X username this short can’t be your account name. Add your Instagram too.',
  rate_limited: 'Too many tries. Wait a minute and go again.',
  email_invalid: "That email doesn't look right.",
  email_taken: 'That email already has an agent file. Sign in, or recover it.',
  email_not_found: "No agent file uses this email. Try the email you signed up with.",
  code_invalid: "That code isn't right. Check the email again.",
  code_expired: 'That code has expired. Ask for a new one.',
  mail_not_configured: "Recovery email isn't switched on yet — ask HT to set it up.",
}
const friendly = (e) => ERRORS[e] || e || 'Something went wrong'

/** opts.notice: why the player is here (e.g. signed out because the account
 *  signed in elsewhere) — shown above the forms, and it opens on sign-in. */
export function renderAuth(container, onAuthed, opts = {}) {
  container.innerHTML = ''
  container.hidden = false
  const wrap = el('div', 'auth-wrap')

  // No photo, no mist, no scrim behind these forms. The landing page is where
  // the atmosphere belongs; here the job is reading labels and typing into
  // fields, and a dimmed stadium shot behind them only ever competed with the
  // inputs sitting on top of it. Plain page background instead.
  wrap.appendChild(ambientToggle('audio/weather-ambient.mp3'))

  if (opts.notice) {
    const notice = el('p', 'auth-notice', opts.notice)
    notice.setAttribute('role', 'status')
    wrap.appendChild(notice)
  }
  // Someone who tapped "Join" on a MAMA voting link came to vote, so the
  // form says that — not the streaming game's pitch.
  let voting = false
  try { voting = fromVotingLink(location.search, readInvite(localStorage)) } catch { /* no storage */ }
  // One short header, then straight into the tabs. The three numbered
  // "how it works" boxes that used to sit here are gone: onboarding already
  // walks through streaming and the ARMY Bomb once the account exists, and on
  // a phone they pushed the form itself below the fold.
  const head = el('header', 'auth-head')
  head.append(
    el('div', 'eyebrow', voting ? 'MAMA 2026 · Vote for BTS' : 'OP: ReConnect'),
    el('h1', 'title-sm', voting ? 'Make your account to start voting' : 'The network needs agents.'),
    el('p', 'muted auth-lede', voting
      ? 'Free, takes a minute. Then pick your side, vote on Mnet and upload your certificate here.'
      : 'Make a free agent file to start streaming with ARMY.'),
  )
  wrap.appendChild(head)

  // The landing page's "I already have an agent file" link sends
  // ?mode=signin so it actually lands somewhere different from "Create your
  // agent file" — both used to point at the same URL and land on the same
  // Create-file-by-default tab regardless of which one you clicked.
  const wantsSignIn = new URLSearchParams(location.search).get('mode') === 'signin'

  const tabs = el('div', 'auth-tabs')
  tabs.setAttribute('role', 'tablist')
  const tabNew = el('button', 'auth-tab', 'Create file')
  const tabOld = el('button', 'auth-tab', 'I have one')
  tabNew.type = 'button'
  tabOld.type = 'button'
  tabNew.id = 'auth-tab-new'
  tabOld.id = 'auth-tab-old'
  tabNew.setAttribute('role', 'tab')
  tabOld.setAttribute('role', 'tab')
  tabs.append(tabNew, tabOld)
  wrap.appendChild(tabs)

  const panelNew = buildRegister(onAuthed)
  const panelOld = buildLogin(onAuthed)
  panelNew.id = 'auth-panel-new'
  panelOld.id = 'auth-panel-old'
  panelNew.setAttribute('role', 'tabpanel')
  panelOld.setAttribute('role', 'tabpanel')
  panelNew.setAttribute('aria-labelledby', tabNew.id)
  panelOld.setAttribute('aria-labelledby', tabOld.id)
  tabNew.setAttribute('aria-controls', panelNew.id)
  tabOld.setAttribute('aria-controls', panelOld.id)
  wrap.append(panelNew, panelOld)

  const selectTab = (which, { focus } = {}) => {
    const isNew = which === 'new'
    tabNew.classList.toggle('sel', isNew)
    tabOld.classList.toggle('sel', !isNew)
    tabNew.setAttribute('aria-selected', String(isNew))
    tabOld.setAttribute('aria-selected', String(!isNew))
    tabNew.tabIndex = isNew ? 0 : -1
    tabOld.tabIndex = isNew ? -1 : 0
    panelNew.hidden = !isNew
    panelOld.hidden = isNew
    if (focus) (isNew ? tabNew : tabOld).focus()
  }
  selectTab(wantsSignIn || opts.notice ? 'old' : 'new')

  tabNew.onclick = () => selectTab('new')
  tabOld.onclick = () => selectTab('old')
  // Arrow keys move between tabs and follow focus, matching the standard
  // tablist keyboard pattern screen reader users expect.
  tabs.onkeydown = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    if (e.key === 'Home') selectTab('new', { focus: true })
    else if (e.key === 'End') selectTab('old', { focus: true })
    else selectTab(document.activeElement === tabNew ? 'old' : 'new', { focus: true })
  }

  // No link out to the old site's Mission Control: that's a separate
  // deployment with separate accounts, and a relative path to it resolves to
  // nothing from here.
  container.appendChild(wrap)
}

/* ── Create an agent file ─────────────────────────────────────────────── */

function buildRegister(onAuthed) {
  const panel = el('div', 'auth-panel')

  const handle = el('input', 'ob-input')
  handle.placeholder = 'Your Instagram username'
  handle.maxLength = 30
  handle.autocomplete = 'username'

  // Instagram or X, at least one (x-handle-rules.js pickAccountHandle, which
  // the server runs again). Same input styling; a leading @ is stripped.
  const xHandle = el('input', 'ob-input')
  xHandle.placeholder = 'Your X username'
  xHandle.maxLength = 16
  xHandle.autocomplete = 'off'
  xHandle.autocapitalize = 'none'
  xHandle.spellcheck = false

  const { wrap: pwWrap, input: pw } = pwToggleInput('Create a password', 'new-password')
  // Required, as of migration 023. The agent number is shown exactly once
  // and is what you sign in with — without an address on file, one forgotten
  // password ends the account permanently, with no recovery path for the
  // player and none for HT either.
  const email = el('input', 'ob-input')
  email.type = 'email'
  email.placeholder = 'you@example.com'
  email.autocomplete = 'email'

  const handleField = field('Instagram username', '', handle)
  const xField = field('X (Twitter) username', '', xHandle)
  const emailField = field('Email', 'Only ever used to get you back in if you lose your number or password.', email)
  // One password field: the eye toggle shows what was typed, which does the
  // job a second "type it again" field did, with one less thing to fill in.
  const pwField = field('Password', 'At least 6 characters — a couple of words works well.', pwWrap, pw)

  // Instagram and X read as one question ("at least one of these"), so they
  // sit together in one group with the rule said once, underneath both.
  const social = el('div', 'auth-group')
  social.setAttribute('role', 'group')
  social.setAttribute('aria-label', 'Instagram or X username')
  social.append(handleField, xField,
    el('div', 'auth-hint', 'Add at least one: Instagram, X, or both. Your teammates see them in fan battles, so keep your DMs open. Everyone else sees your codename.'))

  panel.append(social, emailField, pwField)

  // Streams aren't collected here anymore. Registering used to also ask for
  // stats.fm / Musicat / ListenBrainz up front — three tabs and a live
  // lookup, in a form whose only job is getting an account created. That
  // step already exists post-signup: ui-onboarding.js's "ONE THING FIRST"
  // screen asks the same question once the account is real, with the full
  // picker (settings-streams.js), and can't be skipped into silence because
  // uplinkBroken() re-checks it. Nothing is lost, and the form asks for four
  // things instead of seven.

  // Live check, so "taken" arrives before a password gets typed. checkHandle
  // was listed in api.js's public actions from the start and only now exists.
  let handleTimer = null
  handle.oninput = () => {
    clearTimeout(handleTimer)
    clearFieldError(handleField)
    clearFieldError(xField)
    const h = handle.value.trim().replace(/^@/, '')
    handle.classList.remove('is-bad', 'is-good')
    if (h.length < 3) return
    handleTimer = setTimeout(async () => {
      const res = await call('checkHandle', { handle: h })
      if (handle.value.trim().replace(/^@/, '') !== h) return
      handle.classList.toggle('is-good', !!res.available)
      handle.classList.toggle('is-bad', !res.available)
      // Say why, inline, with the same words the submit would use.
      if (res.success && !res.available && res.reason) setFieldError(handleField, friendly(res.reason))
    }, 400)
  }
  email.oninput = () => {
    clearFieldError(emailField)
    email.classList.remove('is-bad')
  }
  // Inline checks on leaving a field: the same rules the button applies,
  // just said earlier. Empty fields stay quiet until the button is pressed.
  email.onblur = () => {
    const v = email.value.trim()
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) setFieldError(emailField, friendly('email_invalid'))
  }
  pw.onblur = () => {
    if (pw.value && pw.value.length < 6) setFieldError(pwField, 'Password needs at least 6 characters')
  }
  xHandle.oninput = () => {
    clearFieldError(xField)
    if (!handle.value.trim()) { clearFieldError(handleField); handle.classList.remove('is-bad') }
    const v = xHandle.value.trim()
    xHandle.classList.toggle('is-good', !!v && normalizeXHandle(v).ok)
    xHandle.classList.toggle('is-bad', !!v && !normalizeXHandle(v).ok)
  }

  pw.oninput = () => {
    clearFieldError(pwField)
    pw.classList.toggle('is-good', pw.value.length >= 6)
    pw.classList.toggle('is-bad', pw.value.length > 0 && pw.value.length < 6)
  }

  const btn = el('button', 'btn btn-primary auth-go', 'Create my agent file')
  btn.onclick = async () => {
    const picked = pickAccountHandle({ handle: handle.value, xHandle: xHandle.value })
    let bad = null
    if (!picked.ok) {
      const onX = picked.field === 'x'
      setFieldError(onX ? xField : handleField, friendly(picked.error)); bad = onX ? xHandle : handle
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
      setFieldError(emailField, 'Add an email so you can get back in later'); bad = bad || email
    }
    if (pw.value.length < 6) { setFieldError(pwField, 'Password needs at least 6 characters'); bad = bad || pw }
    if (bad) { bad.focus(); return }

    btn.disabled = true
    btn.textContent = 'CREATING…'
    const res = await call('registerAgent', {
      handle: picked.handleSource === 'instagram' ? picked.handle : '',
      email: email.value.trim(),
      password: pw.value,
      lbUsername: null,
      xHandle: picked.xHandle,
    })
    btn.disabled = false
    btn.textContent = 'Create my agent file'

    if (!res.success) {
      if (res.error === 'handle_taken' || res.error === 'handle_invalid' || res.error === 'handle_required') setFieldError(handleField, friendly(res.error))
      else if (res.error === 'email_invalid' || res.error === 'email_taken') setFieldError(emailField, friendly(res.error))
      else if (res.error === 'x_handle_invalid' || res.error === 'x_handle_taken' || res.error === 'x_handle_short') setFieldError(xField, friendly(res.error))
      else if (res.error === 'password_short') setFieldError(pwField, friendly(res.error))
      else toast(friendly(res.error))
      return
    }
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

  const { wrap: pwWrap, input: pw } = pwToggleInput('Password', 'current-password')

  const noField = field('Agent number', 'The one HT gave you when you signed up.', no)
  const pwField = field('Password', '', pwWrap, pw)
  panel.append(noField, pwField)

  no.oninput = () => clearFieldError(noField)
  pw.oninput = () => clearFieldError(pwField)

  const btn = el('button', 'btn btn-primary auth-go', 'Sign in')
  const go = async () => {
    const agentNo = no.value.trim().toUpperCase()
    let bad = null
    if (!agentNo) { setFieldError(noField, 'Enter your agent number'); bad = bad || no }
    if (!pw.value) { setFieldError(pwField, 'Enter your password'); bad = bad || pw }
    if (bad) { bad.focus(); return }
    btn.disabled = true
    btn.textContent = 'CHECKING…'
    const res = await call('loginAgent', { agentNo, password: pw.value })
    btn.disabled = false
    btn.textContent = 'Sign in'
    if (!res.success) {
      if (res.error === 'agent_not_found') setFieldError(noField, friendly(res.error))
      else if (res.error === 'bad_credentials') setFieldError(pwField, friendly(res.error))
      else toast(friendly(res.error))
      return
    }
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
    el('p', 'muted auth-lede', 'Enter the email on your agent file. HT sends back your agent number and a one-time code.'),
  )

  const email = el('input', 'ob-input')
  email.type = 'email'
  email.placeholder = 'you@example.com'
  email.autocomplete = 'email'
  const emailField = field('Email', '', email)
  email.oninput = () => clearFieldError(emailField)
  wrap.appendChild(emailField)

  const send = el('button', 'btn btn-primary auth-go', 'Send my code')
  send.onclick = async () => {
    const addr = email.value.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) { setFieldError(emailField, 'Enter the email on your agent file'); email.focus(); return }
    send.disabled = true
    send.textContent = 'SENDING…'
    const res = await call('requestPasswordReset', { email: addr })
    send.disabled = false
    send.textContent = 'Send my code'
    if (!res.success) {
      if (res.error === 'email_invalid' || res.error === 'email_not_found') {
        setFieldError(emailField, friendly(res.error))
        email.focus()
      }
      else toast(friendly(res.error))
      return
    }
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
    // The server only gets here for an address that's on file, but a sent
    // email can still land in spam or bounce, so this doesn't promise more.
    el('p', 'muted auth-lede',
      `A code is on its way to ${esc(addr)}. It expires in ${minutes} minutes, and the email has your agent number in it too. Check spam if it's not there in a minute or two.`),
  )

  const code = el('input', 'ob-input')
  code.placeholder = 'ABCD2345'
  code.autocomplete = 'one-time-code'
  code.style.textTransform = 'uppercase'

  const { wrap: pwWrap, input: pw } = pwToggleInput('New password', 'new-password')
  const { wrap: pw2Wrap, input: pw2 } = pwToggleInput('Type it again', 'new-password')

  const codeField = field('Code', '', code)
  const pwField = field('New password', 'At least 6 characters.', pwWrap, pw)
  const pw2Field = field('', '', pw2Wrap, pw2)
  code.oninput = () => clearFieldError(codeField)
  pw.oninput = () => clearFieldError(pwField)
  pw2.oninput = () => clearFieldError(pw2Field)

  wrap.append(codeField, pwField, pw2Field)

  const go = el('button', 'btn btn-primary auth-go', 'Set my new password')
  go.onclick = async () => {
    let bad = null
    if (!code.value.trim()) { setFieldError(codeField, 'Enter the code from the email'); bad = bad || code }
    if (pw.value.length < 6) { setFieldError(pwField, 'Password needs at least 6 characters'); bad = bad || pw }
    else if (pw.value !== pw2.value) { setFieldError(pw2Field, "Passwords don't match"); bad = bad || pw2 }
    if (bad) { bad.focus(); return }
    go.disabled = true
    go.textContent = 'RESETTING…'
    const res = await call('resetPassword', { code: code.value.trim(), newPassword: pw.value })
    go.disabled = false
    go.textContent = 'Set my new password'
    if (!res.success) {
      if (res.error === 'code_invalid' || res.error === 'code_expired') setFieldError(codeField, friendly(res.error))
      else toast(friendly(res.error))
      return
    }
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
    el('p', 'muted', 'You\'re signed in. This is your agent number — screenshot it. You only need it to sign in on another phone or browser.'),
    el('div', 'agent-id-box', esc(agent.agentNo || agent.agent_no)),
    el('div', 'warn-box',
      '🔒 <strong>Keep it private</strong><br>Don\'t post your number. Lost it? Tap "Lost your number or password?" on the sign-in screen and we\'ll email it to you.'),
  )
  const btn = el('button', 'btn btn-primary auth-go', 'Continue')
  btn.onclick = onAuthed
  wrap.appendChild(btn)
}

/* ── bits ─────────────────────────────────────────────────────────────── */

let fieldSeq = 0

// Line icons for the password toggle (the emoji pair rendered differently on
// every platform and looked out of place inside a form field).
const EYE = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>'
const EYE_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/></svg>'

/** A labelled form field. `node` is what gets mounted (an input, or a
 *  password field's .pw-wrap); `labelFor` is the actual control the label
 *  and error message should point at — same element unless `node` wraps one.
 *  Returns the wrapper div, with an `.errEl` reference for setFieldError. */
function field(label, hint, node, labelFor) {
  const target = labelFor || node
  if (!target.id) target.id = `auth-f-${++fieldSeq}`
  const f = el('div', 'auth-field')
  if (label) {
    const lab = el('label', 'auth-label', esc(label))
    lab.htmlFor = target.id
    f.appendChild(lab)
  }
  f.appendChild(node)
  const err = el('div', 'auth-error')
  err.id = `${target.id}-err`
  err.hidden = true
  f.appendChild(err)
  target.setAttribute('aria-describedby', err.id)
  if (hint) f.appendChild(el('div', 'auth-hint', esc(hint)))
  f.errEl = err
  f.inputEl = target
  return f
}

function setFieldError(f, msg) {
  if (!f?.errEl) return
  f.errEl.textContent = msg
  f.errEl.hidden = false
  f.inputEl?.setAttribute('aria-invalid', 'true')
  f.inputEl?.classList.add('is-bad')
}

function clearFieldError(f) {
  if (!f?.errEl || f.errEl.hidden) return
  f.errEl.hidden = true
  f.errEl.textContent = ''
  f.inputEl?.removeAttribute('aria-invalid')
}

/** A password input with a show/hide toggle. Returns both the `.pw-wrap`
 *  (what gets mounted) and the `input` itself (what field() should label). */
function pwToggleInput(placeholder, autocomplete) {
  const input = el('input', 'ob-input')
  input.type = 'password'
  input.placeholder = placeholder
  input.autocomplete = autocomplete

  const wrap = el('div', 'pw-wrap')
  wrap.appendChild(input)

  const toggle = el('button', 'pw-toggle', EYE)
  toggle.type = 'button'
  toggle.setAttribute('aria-label', 'Show password')
  toggle.setAttribute('aria-pressed', 'false')
  toggle.onclick = () => {
    const showing = input.type === 'text'
    input.type = showing ? 'password' : 'text'
    toggle.innerHTML = showing ? EYE : EYE_OFF
    toggle.setAttribute('aria-pressed', String(!showing))
    toggle.setAttribute('aria-label', showing ? 'Show password' : 'Hide password')
  }
  wrap.appendChild(toggle)

  return { wrap, input }
}
