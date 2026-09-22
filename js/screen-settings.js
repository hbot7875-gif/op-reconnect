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
import { el, esc, toast, showOverlay, hideOverlay, getState, setState } from './state.js'
import { getAgentNo, getSession, setSession, setToken, clearSession } from './session.js'
import { openStreamSource, openPin, openSignalLog, openMoonStation, sourceName, uplinkBroken } from './settings-streams.js'
import { openModeSheet } from './ui-hud.js'
import { agentManualSheet } from './agent-manual.js'

let account = null

const COMMUNITY_LINKS = {
  updates: 'https://ig.me/j/AbZZsW13xRAgMb_D/',
  discussion: 'https://ig.me/j/AbZYVFwKMMuh1zzV/',
}

export function renderSettings(container, state) {
  container.innerHTML = ''
  const wrap = el('div', 'set-screen')

  wrap.appendChild(el('div', 'pack-head', `
    <span class="pack-eyebrow">⚙ Settings</span>
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
      icon: '🏷', name: 'Codename', value: state?.player?.codename || '',
      body: "What other agents see. Can't be your agent number or Instagram handle.",
      onClick: () => showOverlay(codenameSheet(state, refresh)),
    },
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
      icon: '🚨', name: 'Moon Station (under test)', value: '',
      body: 'The same repeat check HT runs, and whether your linked identity shows up on another agent file. Also on the tab bar.',
      onClick: () => openMoonStation(),
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
  const leave = state?.player?.leave || null
  body.appendChild(section('Game', 'How hard you want this', [
    {
      icon: '🎚', name: 'Streaming mode', value: state?.player?.mode || 'easy',
      body: 'Your mode sets the targets and XP pace for your next district. Your current district stays unchanged.',
      onClick: () => openModeSheet(getState() || state),
    },
    // Leave / pause — exams, travel, a break. Pauses the clocks that would
    // otherwise punish being away (district deadline, ARMY Bomb, streak,
    // inactivity), never the shared ReConnect ones. Server rules in
    // lib/leave.ts + the rc_player_leave migration.
    {
      icon: leave ? '⏸' : '🌙',
      name: leave ? 'On leave' : 'Take a leave',
      value: leave ? `until ${fmtDate(leave.endsAt)}` : '',
      body: leave
        ? `Your district deadline, ARMY Bomb and streak are paused until ${fmtDate(leave.endsAt)}. Streams still count if you play.`
        : 'Going away for a few days? Pause your district deadline, ARMY Bomb and streak for 3–14 days.',
      onClick: () => showOverlay(leaveSheet(getState() || state)),
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

  // Presence privacy hides only the player-facing green dot/count. The
  // account keeps syncing and playing normally, and support diagnostics keep
  // their real last-seen time so hiding never weakens account safety.
  body.appendChild(section('Privacy', 'Choose when others can see you', [
    {
      icon: account.appearOffline ? '◯' : '●',
      name: 'Online status', value: account.appearOffline ? 'Hidden' : 'Visible',
      body: account.appearOffline
        ? "You're playing normally, but other agents won't see you or your current district."
        : "Other agents can see your codename and which district you're restoring while you're active.",
      onClick: () => showOverlay(presenceSheet(account, refresh)),
    },
  ]))

  // ── Community — the same purpose split used by the Arirang mission:
  // one chat stays readable for official updates, while doubts and player
  // conversation have a separate home. Real links are anchors so mobile
  // browsers can hand ig.me URLs to Instagram without a popup blocker.
  body.appendChild(section('Group chats', 'Updates, questions, and other agents', [
    {
      icon: '📣', name: 'Main GC', value: 'Join',
      body: 'Mission updates and important announcements.',
      href: COMMUNITY_LINKS.updates,
    },
    {
      icon: '💬', name: 'ReConnect Discussion GC', value: 'Join',
      body: 'Ask questions, clear doubts, and talk with other agents.',
      href: COMMUNITY_LINKS.discussion,
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
      {
        icon: '🎖️', name: 'Badge Vault', value: '',
        body: 'Upload and crop badge art. Open to agent000 plus anyone listed in badge_editors.',
        onClick: () => { window.location.href = 'badge-admin.html' },
      },
      {
        icon: '🎧', name: 'Playlist Makers', value: '',
        body: 'Add a playlist to a district Vault. Open to agent000 plus anyone listed in playlist_makers.',
        onClick: () => { window.location.href = 'playlist-maker.html' },
      },
    ]))
  } else if (state?.player?.isBadgeVaultEditor) {
    // Not agent000, but the server already confirmed they're on
    // badge_editors — same row without the rest of HT Access.
    body.appendChild(section('Badge Vault', 'Upload badge art', [
      {
        icon: '🎖️', name: 'Badge Vault', value: '',
        body: 'Upload and crop badge art for the badges you have access to.',
        onClick: () => { window.location.href = 'badge-admin.html' },
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
    const row = el(r.href ? 'a' : r.onClick ? 'button' : 'div', 'set-row' + (r.muted ? ' is-static' : ''))
    if (r.href) {
      row.href = r.href
      row.target = '_blank'
      row.rel = 'noopener noreferrer'
    }
    row.innerHTML = `
      <span class="sr-icon">${r.icon}</span>
      <span class="sr-main">
        <span class="sr-name">${esc(r.name)}</span>
        <span class="sr-body">${esc(r.body)}</span>
      </span>
      <span class="sr-tail">
        ${r.value ? `<span class="sr-value">${esc(r.value)}</span>` : ''}
        ${r.onClick || r.href ? '<span class="sr-go">›</span>' : ''}
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

const LEAVE_OPTIONS = [3, 5, 7, 10, 14]

function leaveSheet(state) {
  const leave = state?.player?.leave || null
  const availableAt = state?.player?.leaveAvailableAt || null
  const sheet = el('div', 'sheet set-sheet set-leave')
  sheet.appendChild(el('div', 'eyebrow', leave ? 'ON LEAVE' : 'TAKE A LEAVE'))

  if (leave) {
    sheet.append(
      el('h3', '', `Paused until ${fmtDate(leave.endsAt)}`),
      el('p', 'muted', `${leave.daysLeft} day${leave.daysLeft === 1 ? '' : 's'} left. ${leave.districtPaused ? 'Your district deadline, ' : 'Your '}ARMY Bomb and streak are all on hold. Streams still count if you do play.`),
      el('p', 'muted', 'Ending early hands back only the unused days — nothing you already got is taken away.'),
    )
    const end = el('button', 'btn btn-primary', 'End leave now')
    end.onclick = async () => {
      end.disabled = true
      end.textContent = 'ENDING…'
      const res = await call('endLeave', { agentNo: getAgentNo() })
      end.disabled = false
      end.textContent = 'End leave now'
      if (!res.success) { toast(errText(res.error)); return }
      const cur = getState() || state
      setState({ ...cur, player: { ...cur.player, leave: null, leaveAvailableAt: res.leaveAvailableAt || null } })
      hideOverlay()
      toast('Welcome back — your clocks are running again')
    }
    sheet.appendChild(end)
  } else if (availableAt) {
    sheet.append(
      el('h3', '', 'Not just yet'),
      el('p', 'muted', `Leaves are spaced out so they stay a break, not a pause button. Your next one can start on ${fmtDate(availableAt)}.`),
    )
  } else {
    let days = 7
    sheet.append(
      el('h3', '', 'How long will you be away?'),
      el('p', 'muted', "Starts now. While you're on leave:"),
    )
    const list = el('ul', 'set-leave-list')
    list.innerHTML = `
      <li>⏳ Your district deadline is pushed out by the same number of days${state?.activeDistrict ? '' : ' (no district is running right now)'}</li>
      <li>💣 Your ARMY Bomb won't go dark, and no blackout clock runs</li>
      <li>🔥 Your streak is covered every day — no Streak Freezes spent</li>
      <li>🗂 The 14-day inactivity clock stops</li>
      <li>🤝 ReConnect team missions keep going — those clocks belong to your teammates too</li>
      <li>🎧 Anything you stream still counts</li>`
    sheet.appendChild(list)
    sheet.appendChild(el('div', 'set-leave-picks-label', 'DAYS AWAY'))
    const picks = el('div', 'set-leave-picks')
    const paint = () => picks.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.days) === days))
    for (const n of LEAVE_OPTIONS) {
      const b = el('button', 'btn btn-ghost', String(n))
      b.type = 'button'
      b.dataset.days = String(n)
      b.onclick = () => { days = n; paint() }
      picks.appendChild(b)
    }
    paint()
    sheet.appendChild(picks)
    sheet.appendChild(el('p', 'muted set-leave-note', 'One leave at a time; the next one can start 14 days after this one ends. You can end it early any time.'))
    const start = el('button', 'btn btn-primary', 'Start leave')
    start.onclick = async () => {
      start.disabled = true
      start.textContent = 'STARTING…'
      const res = await call('startLeave', { agentNo: getAgentNo(), days })
      start.disabled = false
      start.textContent = 'Start leave'
      if (!res.success) { toast(errText(res.error)); return }
      const cur = getState() || state
      setState({ ...cur, player: { ...cur.player, leave: res.leave, leaveAvailableAt: null } })
      hideOverlay()
      toast(`On leave until ${fmtDate(res.leave.endsAt)} — see you then ♡`)
    }
    sheet.appendChild(start)
  }
  const close = el('button', 'btn btn-ghost', leave || availableAt ? 'Close' : 'Cancel')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

function presenceSheet(acct, onSaved) {
  const hiding = !acct.appearOffline
  const sheet = el('div', 'sheet set-sheet')
  sheet.append(
    el('div', 'eyebrow', 'ONLINE STATUS'),
    el('h3', '', hiding ? 'Appear offline?' : 'Appear online again?'),
    el('p', 'muted', hiding
      ? "You can still stream, sync and play normally. Other agents won't see you in Active now, your current district, or with an online dot in ReConnect invites."
      : 'Other agents can see your codename and current district while you are active, plus your online dot in ReConnect invites.'),
  )
  const save = el('button', 'btn btn-primary', hiding ? 'Appear offline' : 'Appear online')
  save.onclick = async () => {
    save.disabled = true
    save.textContent = 'SAVING…'
    const res = await call('setAppearOffline', {
      agentNo: getAgentNo(),
      appearOffline: hiding,
    })
    save.disabled = false
    save.textContent = hiding ? 'Appear offline' : 'Appear online'
    if (!res.success) { toast(errText(res.error)); return }
    acct.appearOffline = res.appearOffline
    hideOverlay()
    toast(res.appearOffline ? 'You now appear offline' : 'You now appear online')
    onSaved?.()
  }
  sheet.appendChild(save)
  const close = el('button', 'btn btn-ghost', 'Cancel')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

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

/** Same rule joinGame enforces at onboarding (see handlers.ts's shared
 *  validateCodename) — can't be blank-ish, agent-number-shaped, or match the
 *  agent number/Instagram handle on file. This sheet just gives a way back
 *  in after that one-time onboarding pick, for anyone who wants a different
 *  public name later. */
function codenameSheet(state, onSaved) {
  const sheet = el('div', 'sheet set-sheet')
  const current = state?.player?.codename || ''
  sheet.append(
    el('div', 'eyebrow', 'CODENAME'),
    el('h3', '', 'Change your codename'),
    el('p', 'muted', "Everyone sees this one. It can't be your agent number or Instagram handle."),
  )
  const name = el('input', 'ob-input')
  name.placeholder = 'Your codename'
  name.maxLength = 24
  name.value = current
  name.autocomplete = 'off'
  sheet.appendChild(field('Codename', '3-24 letters, numbers, spaces, dots, underscores or hyphens.', name))

  const save = el('button', 'btn btn-primary', 'Save codename')
  save.onclick = async () => {
    const next = name.value.trim()
    if (next.length < 3) { toast('Needs at least 3 characters'); return }
    if (next === current) { hideOverlay(); return }
    save.disabled = true
    save.textContent = 'SAVING…'
    const res = await call('updateCodename', { agentNo: getAgentNo(), codename: next })
    save.disabled = false
    save.textContent = 'Save codename'
    if (!res.success) { toast(errText(res.error)); return }
    setState(res)
    hideOverlay()
    toast(`Codename set — ${next}`)
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
    already_on_leave: "You're already on leave.",
    not_on_leave: "You're not on leave right now.",
    leave_cooldown: 'Your next leave can start 14 days after the last one ended.',
    leave_days_out_of_range: 'Leaves run 3 to 14 days.',
    codename_invalid: 'Codenames are 3-24 letters or numbers — and can\'t be your agent number or Instagram handle.',
    codename_taken: 'That one\'s taken. Try another.',
  }[code] || code || 'Something went wrong'
}
