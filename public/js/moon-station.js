// Moon Station — the admin-only police check, extracted from the old
// public/js/botz.js so it can actually load again.
//
// It had been dead code since "Revamp BOTZ as a mission-aware jam tracker"
// (99c58bf), which replaced the page with botz-api.js + botz-phase1.js and
// dropped both the <script src="js/botz.js"> tag and the Moon Station
// markup, while leaving the .botz-moon-* CSS in botz.html behind. The
// backend half never stopped working: adminGetAgentTracks and
// adminScanAltAccounts are live, and since the Stats.fm duplicate work they
// also return a canonical row set plus an ingestionDuplicates count. Only
// the renderer was unreachable.
//
// Restoring the old script tag wholesale would have broken the page: the
// legacy file also defines window.shareBotzSnapshot and
// window.toggleBotzTheme, which botz-phase1.js owns now, so loading both
// would have left whichever ran last in charge of the live buttons. Only
// the Moon Station block is here, and its five exports collide with
// nothing.
//
// Classic script, not a module, for the same reason the rest of this
// directory is: botz.html wires these with inline onclick= handlers, which
// can only see functions on window.
//
// Everything else in the legacy file -- the stats.fm/musicat client-side
// overlays, the streak heatmap, milestone confetti, its own share card and
// its own page bootstrap -- is superseded by botz-phase1.js and is
// deliberately NOT carried over.

;(function () {
  'use strict'

  // Nothing to wire on a page without the panel. Keeps this safe to include
  // anywhere and keeps moonToggleOpen from throwing on a missing node.
  if (!document.getElementById('moonStation')) return

  /** Local copy of the escape helper the block was written against. The
   *  apostrophe is added because an agent handle is player-chosen text and
   *  one of these values is interpolated into an inline onclick attribute;
   *  for every ordinary value the rendered output is unchanged. */
  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }

  // ==================== MOON STATION (police check) ====================
  // BOTZ's answer to the old site's Police Terminal, which only ever linked
  // out to an agent's public Last.fm page for a human to read by hand.
  // op-reconnect's counted streams already live server-side (see
  // adminGetAgentTracks in supabase/functions/op-reconnect/lib/admin-agent.ts),
  // so this shows them directly instead of sending a reviewer somewhere else.
  //
  // Gate is the same shared admin key admin.html/candy-star-admin.html use
  // (rc_admin_key in localStorage) — unlocking one unlocks this too, one less
  // password for HT to juggle. Verifying it works the same way admin.html's
  // own gate does: no separate login action exists, so "checking the key"
  // just means making one real admin call and seeing whether it comes back
  // Unauthorized.
  const MOON_KEY_STORAGE = 'rc_admin_key' // shared with admin.html/candy-star-admin.html on purpose
  let moonLastResult = null   // last successful adminGetAgentTracks payload, so a verdict click can redraw without refetching
  const moonVerdicts = {}     // agentNo -> 'pass' | 'fail' — this session only, never sent anywhere (see the Persistence decision: lookup tool, not a scoring system)
  let moonTriedStoredKey = false

  function moonToggleOpen() {
    const box = document.getElementById('moonStation')
    const opening = box.style.display === 'none'
    box.style.display = opening ? 'block' : 'none'
    if (opening && !moonTriedStoredKey) {
      moonTriedStoredKey = true
      let saved = ''
      try { saved = localStorage.getItem(MOON_KEY_STORAGE) || '' } catch (e) { /* unavailable */ }
      // Silent try — a stale/rotated key just leaves the gate up, no alarming
      // "rejected" flash for something the agent didn't just do (same call as
      // admin.html's own tryStoredKey).
      if (saved) {
        document.getElementById('moonAdminKey').value = saved
        moonUnlock({ silent: true })
      }
    }
  }

  async function moonUnlock(opts) {
    const silent = !!(opts && opts.silent)
    const key = document.getElementById('moonAdminKey').value.trim()
    const errEl = document.getElementById('moonKeyError')
    errEl.style.display = 'none'
    if (!key) {
      if (!silent) { errEl.textContent = 'Enter the admin key first.'; errEl.style.display = 'block' }
      return
    }
    const btn = document.getElementById('moonUnlockBtn')
    if (!silent) { btn.disabled = true; btn.textContent = 'CHECKING…' }
    const res = await window.RCBotz.callAction('adminGetAgentTracks', { adminKey: key, query: 'AGENT000', days: 1 })
    if (!silent) { btn.disabled = false; btn.textContent = 'Unlock' }
    if (!res || !res.success) {
      if (!silent) {
        errEl.textContent = res && res.error === 'Unauthorized' ? 'Admin key rejected.' : ((res && res.error) || "Couldn't reach the backend — try again.")
        errEl.style.display = 'block'
      }
      return
    }
    try { localStorage.setItem(MOON_KEY_STORAGE, key) } catch (e) { /* unavailable */ }
    document.getElementById('moonLocked').style.display = 'none'
    document.getElementById('moonUnlocked').style.display = 'block'
  }

  async function moonCheck() {
    const query = document.getElementById('moonQuery').value.trim()
    const days = document.getElementById('moonDays').value
    const resultEl = document.getElementById('moonResult')
    if (!query) { resultEl.innerHTML = '<div class="botz-empty">Enter an agent number or handle</div>'; return }
    resultEl.innerHTML = '<div class="botz-loading"><div class="botz-spinner"></div>Pulling tracks…</div>'
    let key = ''
    try { key = localStorage.getItem(MOON_KEY_STORAGE) || '' } catch (e) { /* unavailable */ }
    const res = await window.RCBotz.callAction('adminGetAgentTracks', { adminKey: key, query, days })
    if (!res || !res.success) {
      resultEl.innerHTML = `<div class="botz-empty">${esc((res && res.error) || 'Lookup failed')}</div>`
      return
    }
    moonLastResult = res
    moonRenderResult()
  }

  // Describes the pattern, not the person. A flag here is a prompt to look,
  // never a finding -- Moon Station cannot see track duration or device, so
  // the most it can ever mean is "this is worth a second look".
  // Two separate observable patterns, never a verdict. A song can be both:
  // returning inside the gap AND immediately consecutive.
  // Seconds -> "6m 30s", so a reviewer can read the same-song gap at a glance
  // instead of subtracting two timestamps by eye.
  function moonGap(s) {
    const total = Math.max(0, Math.round(Number(s) || 0))
    const m = Math.floor(total / 60)
    const rem = total % 60
    if (!m) return `${rem}s`
    return rem ? `${m}m ${rem}s` : `${m}m`
  }

  const MOON_FLAG_LABEL = {
    repeat: '🔁 repeated-play pattern',
    back_to_back: '⏭️ played twice in a row',
  }
  // Purely corroborating — matching modes prove nothing on their own, but
  // read as one more "these were set up the same way" alongside an already-
  // confirmed shared identity. Null means the agent registered but never
  // finished onboarding, so there's no mode to compare yet.
  function moonModeLabel(mode) {
    const names = { exam: 'School/Exam', easy: 'Easy', steady: 'Easy+', medium: 'Medium', hard: 'Hard' }
    return mode ? `mode: ${esc(names[mode] || mode)}` : 'mode: —'
  }

  function moonRenderResult() {
    const res = moonLastResult
    const resultEl = document.getElementById('moonResult')
    if (!res) return
    const agentNo = res.agent.agentNo
    const verdict = moonVerdicts[agentNo] || null
    const fromLabel = new Date(res.fromDate).toLocaleDateString()
    const toLabel = new Date(res.toDate).toLocaleDateString()

    const rows = res.tracks.length
      ? res.tracks.map(t => {
          const d = new Date(t.at)
          const badges = (t.flags || []).map(f => `<span class="botz-moon-flag">${MOON_FLAG_LABEL[f] || esc(f)}</span>`).join('')
          return `
            <div class="botz-recent-row${(t.flags || []).length ? ' botz-moon-flagged' : ''}">
              <div class="botz-recent-dot"></div>
              <div class="botz-recent-info">
                <div class="botz-recent-name">${esc(t.track || '—')}</div>
                <div class="botz-recent-meta">${esc(t.artist || '')}</div>
              </div>
              <div class="botz-recent-right">
                <div class="botz-recent-time">${d.toLocaleString()}</div>
                ${typeof t.sinceSameSong === 'number'
                  ? `<div class="botz-recent-time">${moonGap(t.sinceSameSong)} since this song last played</div>`
                  : ''}
                ${badges}
              </div>
            </div>`
        }).join('')
      : '<div class="botz-empty">No streams in this window</div>'

    const alts = res.possibleAlts || []
    const altWarning = alts.length
      ? `<div class="botz-moon-alt-warn">
          <b>⚠ Possible alt account${alts.length === 1 ? '' : 's'}</b><br>
          ${alts.map(a => `Same ${esc(a.via)} identity as <b>${esc(a.handle || a.agentNo)}</b> (${esc(a.agentNo)}) &middot; ${moonModeLabel(a.mode)}`).join('<br>')}
        </div>`
      : ''
    const modeNames = { exam: 'School/Exam', easy: 'Easy', steady: 'Easy+', medium: 'Medium', hard: 'Hard' }
    const modeDays = res.excessStreamDays || []
    // Rows the canonical view set aside as the confirmed Stats.fm precision
    // artifact -- one play the source reported twice, once truncated to the
    // minute. Said out loud so a shorter sequence never reads as missing
    // data, and so nobody re-derives a repeat from rows that were never two
    // listens.
    const dupes = Number(res.ingestionDuplicates || 0)
    const dupNote = dupes
      ? `<div class="botz-moon-alt-warn">
          <b>ℹ ${dupes} possible ingestion duplicate${dupes === 1 ? '' : 's'} excluded</b><br>
          Same play reported twice by the source, not a repeated listen.
          Still stored and still counted &mdash; just not evidence.<br>
          <span class="botz-moon-verdict-note">Review only &mdash; nothing was deleted.</span>
        </div>`
      : ''
    const modeWarning = modeDays.length
      ? `<div class="botz-moon-alt-warn">
          <b>⚠ Mode may not match recent pace</b><br>
          ${modeDays.length} high-volume day${modeDays.length === 1 ? '' : 's'} in this check.${res.suggestedMode ? ` Consider <b>${esc(modeNames[res.suggestedMode] || res.suggestedMode)}</b>.` : ''}<br>
          <span class="botz-moon-verdict-note">Review only — no mode or goals were changed.</span>
        </div>`
      : ''

    resultEl.innerHTML = `
      <div class="botz-moon-summary">
        <b>${esc(res.agent.handle || agentNo)}</b> (${esc(agentNo)}) &middot; ${esc(fromLabel)} → ${esc(toLabel)}<br>
        ${res.trackCount} track${res.trackCount === 1 ? '' : 's'} &middot;
        <span class="${res.flaggedCount ? 'botz-moon-flag-count' : ''}">${res.flaggedCount} to review</span> &middot;
        ${moonModeLabel(res.agent.mode)}
      </div>
      ${altWarning}
      ${modeWarning}
      ${dupNote}
      <div class="botz-moon-verdict">
        <button type="button" class="btn-outline${verdict === 'pass' ? ' botz-moon-verdict-active-pass' : ''}" onclick="moonSetVerdict('${esc(agentNo)}','pass')">✓ Pass</button>
        <button type="button" class="btn-outline${verdict === 'fail' ? ' botz-moon-verdict-active-fail' : ''}" onclick="moonSetVerdict('${esc(agentNo)}','fail')">✗ Fail</button>
        <span class="botz-moon-verdict-note">This session only — nothing is saved</span>
      </div>
      <div class="botz-row-list">${rows}</div>
    `
  }

  function moonSetVerdict(agentNo, v) {
    // A second click on the same verdict clears it, so "Pass" isn't a one-way door.
    moonVerdicts[agentNo] = moonVerdicts[agentNo] === v ? null : v
    moonRenderResult()
  }

  /** Roster-wide alt-account scan — every group of 2+ agents sharing one
   *  ListenBrainz/stats.fm/Musicat identity, not just whoever's already been
   *  checked individually. See adminScanAltAccounts in admin-agent.ts. */
  async function moonScanAlts() {
    const el = document.getElementById('moonScanResult')
    el.innerHTML = '<div class="botz-loading"><div class="botz-spinner"></div>Scanning roster…</div>'
    let key = ''
    try { key = localStorage.getItem(MOON_KEY_STORAGE) || '' } catch (e) { /* unavailable */ }
    const res = await window.RCBotz.callAction('adminScanAltAccounts', { adminKey: key })
    if (!res || !res.success) {
      el.innerHTML = `<div class="botz-empty">${esc((res && res.error) || 'Scan failed')}</div>`
      return
    }
    if (!res.groups.length) {
      el.innerHTML = '<div class="botz-empty">No shared identities found</div>'
      return
    }
    el.innerHTML = res.groups.map(g => `
      <div class="botz-moon-scan-group">
        <b>${esc(g.agents.length)} agents</b> share one ${esc(g.via)} identity:<br>
        ${g.agents.map(a => `${esc(a.handle || a.agentNo)} (${esc(a.agentNo)}) &middot; ${moonModeLabel(a.mode)}`).join('<br>')}
      </div>
    `).join('')
  }

  window.moonToggleOpen = moonToggleOpen
  window.moonUnlock = moonUnlock
  window.moonCheck = moonCheck
  window.moonSetVerdict = moonSetVerdict
  window.moonScanAlts = moonScanAlts

})()
