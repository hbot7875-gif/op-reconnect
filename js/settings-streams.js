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
    body: 'Reads the Spotify or Apple Music listening history connected to your musicat.fm profile. Enter your musicat username (or the ID from your profile URL) — either works.',
    field: { prop: 'musicatPublicId', param: 'musicatPublicId', label: 'musicat username or ID', placeholder: 'your musicat username' },
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

  const selectSource = (key, opt) => {
    selected = key
    for (const node of grid.children) node.classList.remove('sel')
    opt.classList.add('sel')
  }

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
      // Typing into a source field is an explicit choice of that source.
      // Previously the stopped click left ListenBrainz selected, so filling
      // Musicat and pressing Save incorrectly asked for an LB username.
      input.onclick = (e) => {
        e.stopPropagation()
        selectSource(s.key, opt)
      }
      input.onfocus = () => selectSource(s.key, opt)
      inputs[s.key] = input
      opt.appendChild(input)
    }
    if (s.needsPin) {
      const note = el('div', 'src-note', account.hasPin
        ? '✓ PIN ready — open “Scrobbler PIN” below to see it.'
        : '⚠ Needs a PIN first — close this and tap “Scrobbler PIN”.')
      opt.appendChild(note)
    }

    opt.onclick = () => selectSource(s.key, opt)
    grid.appendChild(opt)
  }
  sheet.appendChild(grid)

  const save = el('button', 'btn btn-primary', 'Save')
  save.onclick = async () => {
    save.disabled = true
    save.textContent = 'SAVING…'
    const payload = { agentNo: getAgentNo(), preference: selected }
    const source = SOURCES.find((s) => s.key === selected)
    if (source?.field && inputs[selected]) {
      payload[source.field.param] = inputs[selected].value.trim()
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
    musicat_user_not_found: "Couldn't find that musicat.fm user — check the spelling.",
    musicat_unreachable: "Couldn't reach musicat.fm — try again in a moment.",
    lb_user_not_found: "Couldn't find that ListenBrainz user — check the spelling.",
    lb_unreachable: "Couldn't reach ListenBrainz — try again in a moment.",
    statsfm_user_not_found: "Couldn't find that stats.fm user — check the spelling.",
    statsfm_unreachable: "Couldn't reach stats.fm — try again in a moment.",
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

function formatGapSeconds(s) {
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60)
  const rem = Math.round(s % 60)
  return rem ? `${m}m ${rem}s` : `${m}m`
}

/* ── Streaming integrity self-check ───────────────────────────────────────
   The same "PL rules" checks Moon Station (BOTZ, admin-only) runs on any
   agent, here scoped to your own account: getMySelfCheck is `auth: 'agent'`,
   verified against your own session, so this can only ever answer "is MY
   account clean" — it can't look anyone else up. It CAN tell you that your
   own linked ListenBrainz/stats.fm/Musicat identity is also on another
   agent number, which does reveal that other agent's number/handle; that's
   a deliberate choice (an agent should be able to notice "oh, I forgot I
   made a second file"), not an oversight.
   Named and lit the same as BOTZ's admin tool (Moon Station) on purpose —
   one name for one mechanic, whether HT is running it on you or you're
   running it on yourself. The spinning red beacon is flavor, not a status
   readout — it's on regardless of whether anything's actually flagged,
   same as a real police light doesn't dim itself when there's no one to
   pull over. */
function moonStationSheet() {
  const sheet = el('div', 'sheet set-sheet')
  sheet.append(
    el('div', 'ms-beacon-row', '<span class="ms-beacon" aria-hidden="true">🚨</span><span class="eyebrow">MOON STATION (UNDER TEST)</span>'),
    el('h3', '', 'Your own police check'),
    el('p', 'muted', "The same repeat/too-fast timing check HT runs on any agent, and whether your linked identity shows up on another agent file — just for your own account."),
  )
  const body = el('div', 'sig-body', '<p class="muted">Checking…</p>')
  sheet.appendChild(body)

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)

  call('getMySelfCheck', { agentNo: getAgentNo(), days: 7 }).then((res) => {
    body.innerHTML = ''
    if (!res.success) {
      body.appendChild(el('p', 'muted', esc(res.error || "Couldn't run the check")))
      return
    }

    body.appendChild(el('div', 'sig-summary', `
      <span><b>${res.trackCount}</b> streams &middot; last ${res.windowDays}d</span>
      <span class="${res.flaggedCount ? 'is-flagged' : ''}"><b>${res.flaggedCount}</b> flagged</span>
    `))

    const alts = res.possibleAlts || []
    if (alts.length) {
      const lines = alts.map((a) =>
        `Same ${esc(a.via)} identity as <b>${esc(a.handle || a.agentNo)}</b> (${esc(a.agentNo)})`).join('<br>')
      body.appendChild(el('div', 'sig-alt-warn', `<b>⚠ Possible alt account${alts.length === 1 ? '' : 's'}</b><br>${lines}`))
    }

    if (!res.tracks?.length) {
      body.appendChild(el('p', 'muted', 'Nothing in the last 7 days to check yet.'))
      return
    }
    // The full sequence, not just the flagged tracks — same report shape as
    // the Candy Star playlist validator (candy-star-admin.html's Validate a
    // playlist: numbered rows, a pass/fail icon, one detail line each), so
    // "why was this flagged" reads the same way "why did this rule fail"
    // already does elsewhere in the game. Backend hands tracks back
    // newest-first (an activity log); reversed here to oldest-first because
    // a SEQUENCE — "first you played this, then this, then this" — has to
    // read top-to-bottom in the order it actually happened, not backwards.
    const sequence = res.tracks.slice(0, 25).slice().reverse()
    const list = el('div', 'ms-list')
    sequence.forEach((t, i) => {
      const flagged = (t.flags || []).length > 0
      const badges = (t.flags || []).map((f) =>
        `<span class="sig-badge">${f === 'repeat' ? '🔁 repeat' : esc(f)}</span>`).join('')
      const when = new Date(t.at).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
      const gapText = typeof t.gapSeconds === 'number'
        ? `${formatGapSeconds(t.gapSeconds)} after the previous play`
        : 'first play in this window'
      list.appendChild(el('div', 'ms-row' + (flagged ? ' is-flagged' : ''), `
        <span class="ms-seq">${i + 1}</span>
        <span class="ms-ico">${flagged ? '⚠' : '✓'}</span>
        <div class="ms-row-body">
          <div class="ms-row-top">
            <span class="ms-track">${esc(t.track)}</span>
            <span class="ms-artist">${esc(t.artist || '—')}</span>
          </div>
          <div class="ms-row-bottom">
            <span class="ms-time">${esc(when)} &middot; ${esc(gapText)}</span>
            <span class="ms-flags">${badges}</span>
          </div>
        </div>
      `))
    })
    body.appendChild(list)
  })

  return sheet
}

export function openStreamSource(account, onSaved) { showOverlay(streamSourceSheet(account, onSaved)) }
export function openPin(account, onChanged) { showOverlay(pinSheet(account, onChanged)) }
export function openSignalLog() { showOverlay(signalLogSheet()) }
export function openMoonStation() { showOverlay(moonStationSheet()) }
