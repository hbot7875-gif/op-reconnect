// Uplink settings — where your counted streams come from.
//
// This is the screen the game could not function without and did not have.
// Sign-up says ListenBrainz is optional, "link it now or later" — but there
// was no later: nothing in the client ever called setStreamSource,
// generateScrobblePin or getWebhookPin, so anyone who skipped that one field
// was left on the empty direct-scrobble source with no way to reach a PIN.
// Zero counted streams, zero XP, a tutorial district that never completes,
// and no explanation. Everything here already existed server-side; it just
// had no door.
//
// The uplink check at the bottom is the other half: it's not enough to let
// someone pick a source, they have to be able to SEE it working.

import { call, API_URL } from './api.js'
import { el, esc, toast, hideOverlay, showOverlay } from './state.js'
import { getAgentNo } from './session.js'

const SOURCES = [
  {
    key: 'lb',
    name: 'ListenBrainz',
    sub: 'Recommended · works everywhere',
    body: 'The open scrobbling service. Point your player at it once and every stream reaches the network on its own.',
    field: { prop: 'lbUsername', param: 'lbUsername', label: 'ListenBrainz username', placeholder: 'your-lb-username' },
  },
  {
    key: 'direct',
    name: 'Scrobbler app',
    sub: 'Web Scrobbler · Pano Scrobbler',
    body: 'Send plays straight here from a scrobbler extension or app, using your own PIN. No third-party account needed.',
    needsPin: true,
  },
  {
    key: 'statsfm',
    name: 'stats.fm',
    sub: 'Spotify listeners',
    body: 'If you already track Spotify with stats.fm, the game reads your recent plays from your public profile.',
    field: { prop: 'statsfmUsername', param: 'statsfmUsername', label: 'stats.fm username', placeholder: 'your-statsfm-username' },
  },
  {
    key: 'musicat',
    name: 'musicat.fm',
    sub: 'Spotify + Apple Music listeners',
    body: 'Reads the Spotify or Apple Music listening history connected to your musicat.fm profile. Your public user ID is in the profile URL.',
    field: { prop: 'musicatPublicId', param: 'musicatPublicId', label: 'musicat public ID', placeholder: 'public user id' },
  },
]

export const sourceName = (key) => SOURCES.find((s) => s.key === key)?.name || 'Not set up'

/** True when the account has nothing that can actually produce a stream.
 *  Drives the warning banner — silence is the worst possible feedback here. */
export function uplinkBroken(account) {
  if (!account) return false
  const src = account.streamSource || 'lb'
  if (src === 'lb') return !account.lbUsername
  if (src === 'statsfm') return !account.statsfmUsername
  if (src === 'musicat') return !account.musicatPublicId
  if (src === 'direct') return !account.hasPin
  return true
}

/* ── Source picker ────────────────────────────────────────────────────── */

export function streamSourceSheet(account, onSaved) {
  const sheet = el('div', 'sheet set-sheet')
  sheet.append(
    el('div', 'eyebrow', 'STREAM SOURCE'),
    el('h3', '', 'Where do your streams come from?'),
    el('p', 'muted', 'Pick one. This is how the network sees what you played — without it, nothing you stream counts.'),
  )

  let selected = account.streamSource || 'lb'
  const inputs = {}
  const grid = el('div', 'mode-grid')

  for (const s of SOURCES) {
    const opt = el('button', 'mode-opt src-opt' + (selected === s.key ? ' sel' : ''), `
      <div class="t">${esc(s.name)}</div>
      <div class="s">${esc(s.sub)}</div>
      <div class="src-body">${esc(s.body)}</div>
    `)

    if (s.field) {
      const input = el('input', 'ob-input src-input')
      input.placeholder = s.field.placeholder
      input.value = account[s.field.prop] || ''
      input.autocomplete = 'off'
      input.onclick = (e) => e.stopPropagation()
      inputs[s.key] = input
      opt.appendChild(input)
    }
    if (s.needsPin) {
      const note = el('div', 'src-note', account.hasPin
        ? '✓ PIN ready — open “Scrobbler PIN” below to see it.'
        : '⚠ Needs a PIN first — close this and tap “Scrobbler PIN”.')
      opt.appendChild(note)
    }

    opt.onclick = () => {
      selected = s.key
      for (const node of grid.children) node.classList.remove('sel')
      opt.classList.add('sel')
    }
    grid.appendChild(opt)
  }
  sheet.appendChild(grid)

  const save = el('button', 'btn btn-primary', 'Save')
  save.onclick = async () => {
    save.disabled = true
    save.textContent = 'SAVING…'
    const payload = { agentNo: getAgentNo(), preference: selected }
    for (const s of SOURCES) {
      if (s.field && inputs[s.key]) payload[s.field.param] = inputs[s.key].value.trim()
    }
    const res = await call('setStreamSource', payload)
    save.disabled = false
    save.textContent = 'Save'
    if (!res.success) { toast(sourceError(res.error)); return }
    hideOverlay()
    toast(`Stream source set to ${sourceName(selected)}`)
    onSaved?.()
  }
  sheet.appendChild(save)

  const close = el('button', 'btn btn-ghost', 'Cancel')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

function sourceError(code) {
  return {
    lb_username_required: 'Add your ListenBrainz username first.',
    statsfm_username_required: 'Add your stats.fm username first.',
    musicat_id_required: 'Add your musicat public ID first.',
    pin_required: 'Generate a PIN before switching to a scrobbler app.',
    invalid_preference: 'Pick one of the listed sources.',
  }[code] || code || "Couldn't save that"
}

/* ── Scrobbler PIN ────────────────────────────────────────────────────── */

export function pinSheet(account, onChanged) {
  const sheet = el('div', 'sheet set-sheet')
  sheet.append(
    el('div', 'eyebrow', 'SCROBBLER PIN'),
    el('h3', '', 'Your private connection key'),
    el('p', 'muted', 'Paste these into Web Scrobbler or Pano Scrobbler and your plays arrive here directly. Treat the PIN like a password — anyone who has it can log streams as you.'),
  )

  const box = el('div', 'pin-box')
  sheet.appendChild(box)

  const paint = (pin) => {
    box.innerHTML = ''
    if (!pin) {
      box.appendChild(el('div', 'muted', account.hasPin
        ? 'A PIN exists on this account. Reveal it to set up a new device.'
        : 'No PIN yet. Generate one to use a scrobbler app.'))
      return
    }
    box.append(
      copyRow('Webhook URL', `${API_URL}?pin=${encodeURIComponent(pin)}`),
      copyRow('ListenBrainz-style URL', API_URL),
      copyRow('API token', pin),
    )
    box.appendChild(el('div', 'dim', 'Web Scrobbler: use the Webhook URL. Pano Scrobbler: use the ListenBrainz-style URL plus the API token.'))
  }
  paint(null)

  const reveal = el('button', 'btn btn-ghost', account.hasPin ? 'Reveal my PIN' : 'No PIN yet')
  reveal.disabled = !account.hasPin
  reveal.onclick = async () => {
    reveal.disabled = true
    reveal.textContent = 'CHECKING…'
    const res = await call('getWebhookPin', { agentNo: getAgentNo() })
    reveal.textContent = 'Reveal my PIN'
    reveal.disabled = false
    if (!res.success) { toast(res.error === 'no_pin' ? 'No PIN yet — generate one.' : res.error); return }
    paint(res.pin)
    reveal.hidden = true
  }

  const gen = el('button', 'btn btn-primary', account.hasPin ? 'Generate a new PIN' : 'Generate my PIN')
  gen.onclick = async () => {
    // Regenerating invalidates the old one, so say so before doing it rather
    // than after someone's scrobbler quietly stops working.
    if (account.hasPin && !confirm('A new PIN replaces the old one. Any device still using the old PIN stops sending streams. Continue?')) return
    gen.disabled = true
    gen.textContent = 'GENERATING…'
    const res = await call('generateScrobblePin', { agentNo: getAgentNo() })
    gen.disabled = false
    gen.textContent = 'Generate a new PIN'
    if (!res.success) { toast(res.error || "Couldn't generate a PIN"); return }
    account.hasPin = true
    reveal.hidden = true
    paint(res.pin)
    toast('New PIN ready')
    onChanged?.()
  }

  sheet.append(reveal, gen)
  const close = el('button', 'btn btn-ghost', 'Done')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}

function copyRow(label, value) {
  const row = el('div', 'copy-row')
  row.innerHTML = `<span class="cr-label">${esc(label)}</span><code class="cr-val">${esc(value)}</code>`
  const btn = el('button', 'cr-btn', 'Copy')
  btn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(value)
      btn.textContent = 'Copied'
      setTimeout(() => { btn.textContent = 'Copy' }, 1600)
    } catch {
      toast('Copy failed — long-press to select it')
    }
  }
  row.appendChild(btn)
  return row
}

/* ── Uplink check (BOTZ, in game) ─────────────────────────────────────── */

/** getSignalLog has been built, routed and unreachable — nothing in the
 *  client ever called it. It belongs exactly here: the honest answer to "is
 *  my uplink actually working?" is the list of what the network just heard. */
export function signalLogSheet() {
  const sheet = el('div', 'sheet set-sheet')
  sheet.append(
    el('div', 'eyebrow', 'STREAM CHECK'),
    el('h3', '', 'What the network is hearing'),
  )
  const body = el('div', 'sig-body', '<p class="muted">Listening…</p>')
  sheet.appendChild(body)

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)

  call('getSignalLog', { agentNo: getAgentNo() }).then((res) => {
    body.innerHTML = ''
    if (!res.success) {
      body.appendChild(el('p', 'muted', esc(res.error || "Couldn't reach your stream source")))
      return
    }
    const t = res.totals || {}
    body.appendChild(el('div', 'sig-totals', `
      <span><b>${t.counted24h ?? 0}</b> counted</span>
      <span><b>${t.streams24h ?? 0}</b> heard · last 24h</span>
    `))

    if (!res.streams?.length) {
      body.appendChild(el('p', 'muted', 'Nothing has come through in the last 24 hours. If you\'ve been streaming, your stream source is probably wrong — check it above.'))
      return
    }
    if (res.nowPlaying) {
      body.appendChild(el('div', 'sig-now', `
        <span class="sig-dot"></span>
        <span class="sig-now-t">${esc(res.nowPlaying.track)}</span>
        <span class="sig-now-a">${esc(res.nowPlaying.artist || '')}</span>
      `))
    }
    const list = el('div', 'sig-list')
    for (const s of res.streams.slice(0, 25)) {
      list.appendChild(el('div', 'sig-row' + (s.counted ? '' : ' skip'), `
        <span class="sig-track">${esc(s.track)}</span>
        <span class="sig-artist">${esc(s.artist || '—')}</span>
        <span class="sig-flag">${s.counted ? '✓' : 'not BTS'}</span>
      `))
    }
    body.appendChild(list)
  })

  return sheet
}

export function openStreamSource(account, onSaved) { showOverlay(streamSourceSheet(account, onSaved)) }
export function openPin(account, onChanged) { showOverlay(pinSheet(account, onChanged)) }
export function openSignalLog() { showOverlay(signalLogSheet()) }
