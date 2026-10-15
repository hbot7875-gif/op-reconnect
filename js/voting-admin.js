// Voting review (admin.html) — the generic queue for every voting campaign.
//
// A reviewer sees only what deciding needs: agent, mission, KST date, the
// proof (a 10-minute signed link, never a storage path), the structured
// checks and the status. No OCR text exists to show.
//
// Mnet certificates are checked automatically (scripts/mnet-verify-worker.mjs,
// GitHub Actions): the BTS artist-tile image match plus OCR of the
// certificate's own wording and date, on the image the SERVER stored. This
// queue is the fallback — unclear proofs, failed automatic checks, duplicate
// disputes and manual overrides. "Retry checks" runs the same trusted check
// here in an admin session for anything still waiting; only booleans and the
// image result (match / unclear / no_match) go back, and the server decides.
import { vIcon as ic } from './voting-icons.js'
import { esc, dayLabel, kstStamp } from './voting-view.js'
import { trustedCertificateCheck } from './voting-proof.js'

const PAGE = 10
const MNET_CHECKS = [['certificate', 'Certificate valid'], ['category', "Fans' Choice 1st Vote"], ['date', 'Correct voting date']]
const BTS_CHOICES = [['match', 'Matched'], ['unclear', 'Unclear'], ['no_match', 'No match']]
const X_CHECKS = [['hashtags', 'Hashtags'], ['publicPost', 'Public post'], ['date', 'Posted that day'], ['author', 'Linked account']]
const STATUS = {
  verifying: ['is-neutral', 'loader', 'Verifying'],
  review: ['is-warn', 'hourglass', 'In review'],
  verified: ['is-ok', 'check', 'Verified'],
  rejected: ['is-err', 'xCircle', 'Rejected'],
}

const NOTES = {
  awaiting_trusted_check: 'Waiting for the automatic check',
  auto_check_failed: 'Automatic check could not read the image',
  all_checks_passed: 'All checks passed',
  missing_hashtags: 'Hashtags missing',
  author_mismatch: 'Posted from a different account',
  wrong_day: 'Posted on another day',
  x_unreachable: "X couldn't be reached",
  x_post_not_found: 'X says the post is missing, private or deleted',
  duplicate_certificate: 'Duplicate certificate — the same certificate number already backs another proof',
  possible_duplicate_certificate: 'Possible duplicate — another agent sent a certificate from the same minute',
}
export function noteText(code) {
  const c = String(code || '')
  if (c.startsWith('unclear:')) {
    const names = { ...Object.fromEntries(MNET_CHECKS), bts: 'BTS selected (image unclear)', bts_no_match: 'BTS selected (image did not match)' }
    return `Unclear: ${c.slice(8).split(',').map((k) => names[k] || k).join(', ')}`
  }
  return NOTES[c] || c
}

/** Pure, so the review card can be rendered and checked in Node. */
export function reviewCardHtml(row) {
  const isMnet = row.kind === 'mnet_certificate'
  const defs = isMnet ? MNET_CHECKS : X_CHECKS
  const checks = row.checks || {}
  const [k, i, t] = STATUS[row.status] || STATUS.review
  const open = row.status === 'verifying' || row.status === 'review'
  const client = row.client_checks && Object.keys(row.client_checks).length
    ? `<p class="vta-hint">Browser pre-check (not trusted): ${MNET_CHECKS.map(([key, label]) => `${esc(label)} ${row.client_checks[key] ? '✓' : '–'}`).join(' · ')}</p>` : ''
  const proof = isMnet
    ? (row.proofUrl
      ? `<a class="vta-proof" href="${esc(row.proofUrl)}" target="_blank" rel="noopener noreferrer"><img src="${esc(row.proofUrl)}" alt="Vote certificate from ${esc(row.agent_no)}" loading="lazy"></a>`
      : '<p class="vta-hint">Proof image already deleted.</p>')
    : `<p class="vta-post"><a href="${esc(row.post_url || '#')}" target="_blank" rel="noopener noreferrer">${ic('ext')}Open post</a>
        <span>Posted by <b>@${esc(row.post_author || '?')}</b> · linked <b>@${esc(row.expectedHandle || 'none')}</b></span></p>`
  return `<article class="vta-card" data-vta-id="${row.id}">
    <header class="vta-head">
      <div><b class="vt-mono">${esc(row.agent_no)}</b> · ${esc(row.missionLabel)} · <span class="vt-mono">${esc(dayLabel(row.vote_day))} KST</span></div>
      <span class="vt-badge ${k}">${ic(i)}${t}</span>
    </header>
    <div class="vta-body">
      ${proof}
      <div class="vta-side">
        <fieldset class="vta-checks"${open ? '' : ' disabled'}><legend>Checks</legend>
          ${defs.map(([key, label]) => `<label class="vta-check"><input type="checkbox" name="${key}"${checks[key] === true ? ' checked' : ''}> ${esc(label)}</label>`).join('')}
        </fieldset>
        ${isMnet ? `<fieldset class="vta-checks vta-bts"${open ? '' : ' disabled'}><legend>BTS selected${checks.bts ? ` · image check: ${esc((BTS_CHOICES.find(([v]) => v === checks.bts) || [])[1] || '')}${typeof checks.btsScore === 'number' ? ` (${checks.btsScore.toFixed(2)})` : ''}` : ' · not checked yet'}</legend>
          ${BTS_CHOICES.map(([v, label]) => `<label class="vta-check"><input type="radio" name="bts-${row.id}" value="${v}"${(checks.bts || 'unclear') === v ? ' checked' : ''}> ${label}</label>`).join('')}
        </fieldset>` : ''}
        ${client}
        ${row.duplicate_of ? `<p class="vta-hint vta-dup">${row.duplicate_kind === 'certificate' ? 'Same certificate as' : 'Check against'} proof #${Number(row.duplicate_of)}${row.duplicate_kind === 'certificate' ? ' — cannot be verified while that proof stands' : ''}</p>` : ''}
        <p class="vta-hint">${esc(noteText(row.verify_note))}${row.submitted_at ? ` · sent ${esc(kstStamp(row.submitted_at))}` : ''}</p>
        ${row.reviewed_by ? `<p class="vta-hint">Reviewed by ${esc(row.reviewed_by)}${row.reviewed_at ? ` · ${esc(kstStamp(row.reviewed_at))}` : ''}${row.review_note ? ` · “${esc(row.review_note)}”` : ''}</p>` : ''}
        ${open ? `<input class="vta-note" name="note" maxlength="300" placeholder="Note (optional)">
        <div class="vta-actions">
          <button type="button" class="vt-btn vt-btn-primary vt-btn-sm" data-vta="verify">${ic('check')}Verify</button>
          <button type="button" class="vt-btn vt-btn-outline vt-btn-sm" data-vta="keep">Save checks</button>
          <button type="button" class="vt-btn vt-btn-ghost vt-btn-sm vta-reject" data-vta="reject">Reject</button>
        </div>` : ''}
        <p class="vta-out" role="status"></p>
      </div>
    </div>
  </article>`
}

const CHAT_STATUS = { visible: ['is-neutral', 'chat', 'Visible'], auto_hidden: ['is-warn', 'flag', 'Hidden by reports'], removed: ['is-err', 'xCircle', 'Removed'] }

/** One reported or hidden MAMA Chat message, with the moderation actions. */
export function chatCardHtml(item) {
  const [k, i, t] = CHAT_STATUS[item.status] || CHAT_STATUS.visible
  const until = item.timeoutUntil ? kstStamp(item.timeoutUntil) : null
  const btn = (act, label, min) => `<button type="button" class="vt-btn vt-btn-ghost vt-btn-sm" data-vta-chat="${act}"${min != null ? ` data-vta-min="${min}"` : ''}>${label}</button>`
  return `<article class="vta-card" data-vta-chat-id="${item.id}">
    <header class="vta-head">
      <div><b class="vt-mono">${esc(item.agentNo)}</b> · ${esc(item.codename)} · ${esc(String(item.team || '').toUpperCase())} · Chat</div>
      <span class="vt-badge ${k}">${ic(i)}${t}</span>
    </header>
    <div class="vta-side">
      <p class="vta-chat-body">${esc(item.body)}</p>
      <p class="vta-hint">${item.reports} ${item.reports === 1 ? 'report' : 'reports'} (${item.ownTeamReports} from their own team)${item.reasons.length ? ` · ${esc(item.reasons.join(', '))}` : ''} · sent ${esc(kstStamp(item.at))}${until ? ` · timed out until ${esc(until)}` : ''}</p>
      <div class="vta-actions">
        ${item.status === 'visible' ? '' : btn('restore', 'Restore')}
        ${item.status === 'removed' ? '' : btn('remove', 'Remove')}
        ${btn('timeout', 'Time out 1 h', 60)}${btn('timeout', '24 h', 1440)}${btn('timeout', 'Rest of event', 'event')}
        ${until ? btn('timeout', 'Lift timeout', 0) : ''}
      </div>
      <p class="vta-out" role="status"></p>
    </div>
  </article>`
}

export function mountVotingReview(panel, call) {
  let status = 'verifying'
  let offset = 0
  let rows = []
  let running = false
  let stop = false

  panel.innerHTML = `<div class="vt-admin">
    <div class="vta-top">
      <div><h2 class="vta-title" data-vta-title>Voting review</h2><p class="vta-hint" data-vta-counts>—</p></div>
      <div class="vta-filters" role="tablist">
        ${Object.entries(STATUS).map(([s, [, , label]]) => `<button type="button" class="vta-filter" role="tab" data-vta-filter="${s}" aria-selected="${s === status}">${label}</button>`).join('')}
        <button type="button" class="vta-filter" role="tab" data-vta-filter="chat" aria-selected="false">Chat reports</button>
      </div>
      <div class="vta-tools">
        <button type="button" class="vt-btn vt-btn-primary vt-btn-sm" data-vta-run>${ic('shield')}Retry checks</button>
        <button type="button" class="vt-btn vt-btn-ghost vt-btn-sm" data-vta-load>Reload</button>
      </div>
      <p class="vta-hint">Mnet certificates are checked automatically after upload — wording, date, and whether the BTS artist image matches. The server verifies only when everything passes; anything unclear lands in In review for you. Retry checks runs the same check here for anything still waiting.</p>
      <p class="vta-run" data-vta-run-status role="status" aria-live="polite" hidden></p>
    </div>
    <div data-vta-list></div>
    <div class="vta-pager"><button type="button" class="vt-btn vt-btn-ghost vt-btn-sm" data-vta-prev>Prev</button><span class="vta-hint" data-vta-page></span><button type="button" class="vt-btn vt-btn-ghost vt-btn-sm" data-vta-next>Next</button></div>
  </div>`
  const $ = (sel) => panel.querySelector(sel)

  async function load() {
    $('[data-vta-list]').innerHTML = '<p class="vta-hint">Loading…</p>'
    if (status === 'chat') return loadChat()
    const r = await call('adminListCampaignProofs', { status, limit: PAGE, offset })
    if (!r?.success) { $('[data-vta-list]').innerHTML = `<p class="vta-hint">${esc(r?.error || 'Could not load')}</p>`; return }
    rows = r.proofs
    $('[data-vta-title]').textContent = `${r.campaign.title} · Voting review`
    $('[data-vta-counts]').textContent = `${r.queue.verifying} verifying · ${r.queue.review} in review`
    $('[data-vta-list]').innerHTML = rows.length ? rows.map(reviewCardHtml).join('') : '<p class="vta-hint">Nothing here.</p>'
    $('[data-vta-page]').textContent = r.total ? `${offset + 1}–${Math.min(offset + PAGE, r.total)} of ${r.total}` : ''
    $('[data-vta-prev]').disabled = offset === 0
    $('[data-vta-next]').disabled = offset + PAGE >= r.total
    $('[data-vta-run]').hidden = status !== 'verifying'
  }

  // MAMA Chat: reported and hidden messages (adminListBattleChat).
  async function loadChat() {
    const r = await call('adminListBattleChat', {})
    $('[data-vta-run]').hidden = true
    $('[data-vta-page]').textContent = ''
    $('[data-vta-prev]').disabled = true
    $('[data-vta-next]').disabled = true
    if (!r?.success) { $('[data-vta-list]').innerHTML = `<p class="vta-hint">${esc(r?.error === 'no_battle' ? 'No battle running.' : r?.error || 'Could not load')}</p>`; return }
    $('[data-vta-counts]').textContent = `${r.items.length} reported or hidden Chat ${r.items.length === 1 ? 'message' : 'messages'}`
    $('[data-vta-list]').innerHTML = r.items.length
      ? `<p class="vta-hint">Hidden automatically at 3 reports when one comes from the sender's own team, otherwise at 5. Restore or remove clears the reports.</p>${r.items.map(chatCardHtml).join('')}`
      : '<p class="vta-hint">No Chat reports.</p>'
  }

  async function moderate(card, btn) {
    const out = card.querySelector('.vta-out')
    for (const b of card.querySelectorAll('button')) b.disabled = true
    const res = await call('adminModerateBattleChat', { messageId: Number(card.dataset.vtaChatId), action: btn.dataset.vtaChat, minutes: btn.dataset.vtaMin })
    if (res?.success) { out.textContent = 'Saved'; setTimeout(load, 500) } else {
      out.textContent = res?.error || 'Failed'
      for (const b of card.querySelectorAll('button')) b.disabled = false
    }
  }

  function checksOf(card) {
    const out = {}
    for (const box of card.querySelectorAll('.vta-checks input[type="checkbox"]')) out[box.name] = box.checked
    const bts = card.querySelector('.vta-bts input[type="radio"]:checked')
    if (bts) out.bts = bts.value
    return out
  }

  async function decide(card, decision) {
    const out = card.querySelector('.vta-out')
    for (const b of card.querySelectorAll('button')) b.disabled = true
    const res = await call('adminReviewCampaignProof', {
      proofId: Number(card.dataset.vtaId), decision, checks: checksOf(card), note: card.querySelector('.vta-note')?.value || '',
    })
    if (res?.success) { out.textContent = `Saved: ${res.status}`; setTimeout(load, 600) } else {
      out.textContent = res?.error === 'daily_mission_limit' ? 'This agent already reached the daily limit for that voting channel.'
        : res?.error === 'duplicate_certificate' ? 'Same certificate as another live proof — reject one of them.' : (res?.error || 'Failed')
      for (const b of card.querySelectorAll('button')) b.disabled = false
    }
  }

  async function runChecks() {
    if (running) { stop = true; return }
    running = true
    stop = false
    const btn = $('[data-vta-run]')
    const line = $('[data-vta-run-status]')
    btn.textContent = 'Stop'
    line.hidden = false
    let done = 0
    let verified = 0
    for (const row of rows.filter((x) => x.kind === 'mnet_certificate' && x.status === 'verifying')) {
      if (stop) break
      line.textContent = `Checking ${done + 1}…`
      try {
        const res = await fetch(row.proofUrl)
        if (!res.ok) throw new Error('Proof link expired — reload')
        const t = await trustedCertificateCheck(await res.blob(), { certificate: row.certificate || {} }, row.vote_day, row.window || {})
        // The number and time go only to the server, which fingerprints
        // them and keeps neither; nothing here displays or stores them.
        const r = await call('adminRecordCampaignChecks', { proofId: row.id, checks: t.checks,
          certificateNumber: t.certificateNumber, participationAt: t.participationAt })
        if (r?.status === 'verified') verified++
      } catch (e) {
        line.textContent = `Stopped: ${e.message}`
        break
      }
      done++
    }
    running = false
    btn.innerHTML = `${ic('shield')}Retry checks`
    line.textContent = `${done} checked · ${verified} verified · ${done - verified} sent to review`
    load()
  }

  panel.addEventListener('click', (e) => {
    const f = e.target.closest('[data-vta-filter]')
    if (f) {
      status = f.dataset.vtaFilter
      offset = 0
      for (const b of panel.querySelectorAll('[data-vta-filter]')) b.setAttribute('aria-selected', String(b === f))
      load()
      return
    }
    if (e.target.closest('[data-vta-load]')) return load()
    if (e.target.closest('[data-vta-run]')) return runChecks()
    if (e.target.closest('[data-vta-prev]')) { offset = Math.max(0, offset - PAGE); return load() }
    if (e.target.closest('[data-vta-next]')) { offset += PAGE; return load() }
    const mod = e.target.closest('[data-vta-chat]')
    if (mod) return moderate(mod.closest('.vta-card'), mod)
    const act = e.target.closest('[data-vta]')
    if (act) decide(act.closest('.vta-card'), act.dataset.vta)
  })

  return { load }
}
