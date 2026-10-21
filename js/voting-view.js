// Voting screen markup (MAMA 2026 first). Pure: a view model in, HTML out,
// no DOM access — so every mission state can be rendered and checked in Node
// (voting-view.test.mjs) and the screen controller (voting.js) only wires
// events. Player-facing words: "Voting", never "Campaign"; "Voting Gift",
// never "Supply Chest".
import { vIcon as ic } from './voting-icons.js'
import {
  liveStrip, hubTabs, momentsCard, teamPanel, chatFab, chatSheet, chatMessageSheet, chatReportSheet, chatMutedSheet,
} from './battle-hub-view.js'
import { LYRICS } from './battle-share-rules.js'
import { LYRIC_MAX, LYRIC_ERRORS } from './battle-lyric-filter.js'
import { daysLeft, nextKstMidnight, xComposeUrl } from '../supabase/functions/op-reconnect/lib/vote-campaign-rules.js'

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

/** How long after an upload the Mnet card shows "Checking your
 *  certificate…" before it says "Still checking". The automatic check
 *  usually lands inside this. */
export const MNET_CHECKING_MS = 60_000
/** How long after an upload the screen polls every 10 s (then once a
 *  minute). It keeps polling while anything is verifying either way. */
export const MNET_FAST_MS = 3 * 60_000

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** 'YYYY-MM-DD' → 'Oct 14'. */
export function dayLabel(day) {
  const [, m, d] = String(day || '').split('-')
  return m ? `${MONTHS[Number(m) - 1]} ${Number(d)}` : ''
}
/** An instant → 'Oct 14 · 09:41 KST'. */
export function kstStamp(iso) {
  const t = new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString()
  return `${dayLabel(t.slice(0, 10))} · ${t.slice(11, 16)} KST`
}
export function countdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const p = (n) => String(n).padStart(2, '0')
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`
}

const ERRORS = {
  already_submitted: "You've already sent today's proof for this mission.",
  duplicate_proof: 'This proof has already been used.',
  duplicate_certificate: 'This certificate has already been submitted. Please upload a new voting certificate.',
  x_duplicate_post: 'This X post has already been submitted. Please submit a different voting post.',
  x_post_private: 'We can’t see this post because the account is private. Make the account public on X, then add the link again.',
  x_post_not_found: 'We couldn’t find this post on X. It may have been deleted. If you just posted it, wait a minute and try again — or post again and add the new link.',
  x_handle_has_votes: 'This account already has votes counted, so only an admin can remove it.',
  x_handle_not_linked: 'That account isn’t linked.',
  x_handle_retired: 'That X account was replaced on your file, so it can’t earn new votes. Post from one of your linked accounts.',
  x_handle_no_votes: 'That account has no votes yet — you can simply remove it and add the new one.',
  x_replacement_pending: 'You already have a replacement waiting for approval.',
  x_replacement_limit: 'You’ve already replaced an X account for this event. Ask an admin if another one stopped working.',
  bad_reason: 'Choose what happened to the account.',
  voting_closed: 'Voting is closed.',
  voting_not_open: 'Voting opens Oct 12 at 19:00 KST.',
  post_before_open: 'That post was made before voting opened. Post a new one.',
  post_after_close: 'That post was made after voting closed.',
  bad_url: 'Paste the link to your post — it looks like x.com/name/status/…',
  x_handle_required: 'Add your X handle first.',
  x_handle_taken: 'That X account is linked to another agent file.',
  x_handle_limit: 'You already registered 3 X accounts for this event.',
  x_handle_daily_limit: 'That X account already earned its vote credit today.',
  x_handle_unregistered: 'Register that X account before submitting its post.',
  daily_mission_limit: "You've reached today's limit for this voting channel.",
  bad_handle: 'X handles are 1–15 letters, numbers or underscores.',
  image_too_large: 'That image is over 5 MB. Try a screenshot instead of a photo.',
  bad_image_type: 'Use a PNG or JPG screenshot.',
  upload_failed: "The upload didn't go through. Try again.",
  not_enough_fill: 'Your Voting Gift is not full yet.',
  daily_limit: "You've opened today's Voting Gift. It resets at 00:00 KST.",
  gift_not_ready: 'Voting Gift rewards have not been announced yet.',
  already_claimed: 'You already claimed this Battle Gift.',
  not_reached: 'This Battle Gift is not unlocked yet.',
  not_contributor: 'Verify at least one MAMA vote to claim Battle Gifts.',
  not_configured: 'Battle Gifts are announced soon.',
  not_final: 'The final score is in at 12:00 KST on Oct 23.',
  not_winner: 'The winner reward goes to the winning team.',
  battle_off: 'The MAMA Battle is not running.',
  team_required: 'Choose your MAMA Battle side first — then send your proof.',
}
export function errorText(code, extra = {}) {
  if (code === 'x_missing_hashtags') return `Your post is missing ${(extra.missing || ['a required hashtag']).join(' and ')}. Post again with both hashtags, then add the new link.`
  if (code === 'x_handle_taken' && extra.author) return `This post was made from @${extra.author}, which is linked to another agent file. Post from one of your own linked accounts.`
  if (code === 'x_handle_retired' && extra.author) return `@${extra.author} was replaced on your file, so it can’t earn new votes. Post from one of your linked accounts.`
  if (code === 'post_wrong_day') return `That post is from ${dayLabel(extra.postDay)} KST. Post a new one today.`
  return ERRORS[code] || 'Something went wrong. Try again.'
}

// ── Pieces ────────────────────────────────────────────────────────────

function badge(kind, icon, text) {
  return `<span class="vt-badge ${kind}">${icon ? ic(icon) : ''}${esc(text)}</span>`
}

function stepper(names, current, review = false) {
  return `<ol class="vt-stepper" aria-label="Proof progress">${names.map((n, i) => {
    let cls = ''
    let dot = String(i + 1)
    if (i < current) { cls = 'is-done'; dot = ic('check') } else if (i === current) cls = review ? 'is-review' : 'is-current'
    return `<li class="vt-step ${cls}"${i === current ? ' aria-current="step"' : ''}><span class="vt-dot">${dot}</span>${esc(n)}</li>`
  }).join('')}</ol>`
}

function checkChips(items) {
  return `<div class="vt-checks">${items.map(([label, state]) => {
    if (state === true) return `<span class="vt-check">${ic('check')}${esc(label)}</span>`
    if (state === 'wait') return `<span class="vt-check is-wait">${ic('loader', 'vt-spin')}${esc(label)}</span>`
    // Stored and queued, but nothing is running yet: no animation.
    if (state === 'queued') return `<span class="vt-check is-wait">${ic('clock')}${esc(label)}</span>`
    return `<span class="vt-check is-unclear">${ic('hourglass')}${esc(label)}</span>`
  }).join('')}</div>`
}

function note(kind, icon, text) {
  return `<div class="vt-note ${kind}" role="${kind === 'is-err' ? 'alert' : 'status'}">${ic(icon)}<span>${text}</span></div>`
}

// ── Header + Today's voting ──────────────────────────────────────────

function header(vm) {
  const c = vm.status.campaign
  const left = daysLeft({ closes_at: c.closesAt }, vm.now)
  const closes = dayLabel(new Date(new Date(c.closesAt).getTime() + 9 * 3600_000).toISOString().slice(0, 10))
  const pill = c.phase === 'open' ? 'Voting open' : c.phase === 'upcoming' ? 'Opens soon' : 'Voting closed'
  return `<section class="vt-camp" aria-labelledby="vt-title">
    <div class="vt-camp-top">
      <span class="vt-camp-mark" aria-hidden="true">MA</span>
      <div class="vt-camp-id">
        <h1 class="vt-camp-name" id="vt-title">${esc(c.title)}</h1>
        <div class="vt-camp-round">${esc(c.roundLabel || '')}</div>
      </div>
      <span class="vt-live${c.phase === 'open' ? '' : ' is-off'}">${pill}</span>
    </div>
    <div class="vt-camp-meta">
      <span>${ic('clock')}Voting closes <b>${esc(closes)}</b> · KST</span>
      ${c.phase === 'open' ? `<span>${left} ${left === 1 ? 'day' : 'days'} left</span>` : ''}
    </div>
  </section>`
}

function todayProgress(vm) {
  const missions = vm.status.campaign.missions
  const progress = vm.status.todayProgress || {}
  const done = missions.reduce((n, m) => n + (progress[m.id]?.verified || 0), 0)
  const total = missions.reduce((n, m) => n + (progress[m.id]?.max || m.maxDaily || 1), 0)
  const segs = missions.flatMap((m) => {
    const p = progress[m.id] || { verified: 0, pending: 0, max: m.maxDaily || 1 }
    return Array.from({ length: p.max }, (_, i) => `<span class="vt-seg${i < p.verified ? ' is-done' : i < p.verified + p.pending ? ' is-pending' : ''}"></span>`)
  }).join('')
  const breakdown = missions.map((m) => {
    const p = progress[m.id] || { verified: 0, max: m.maxDaily || 1 }
    return `${esc(m.label.replace(/ Vote$/, ''))} ${p.verified}/${p.max}`
  }).join(' · ')
  const reset = countdown(nextKstMidnight(vm.now).getTime() - vm.now.getTime())
  return `<section aria-labelledby="vt-h-today">
    <div class="vt-card vt-progress">
      <div class="vt-progress-row">
        <h2 class="vt-progress-label" id="vt-h-today">Today's voting</h2>
        <span class="vt-progress-val">${done} <small>/ ${total}</small></span>
      </div>
      <div class="vt-segs" style="--n:${total}" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}" aria-label="Today's verified votes">${segs}</div>
      <div class="vt-progress-foot"><span>${breakdown}</span><span>Resets in <span class="vt-mono" data-vt-reset>${reset}</span></span></div>
    </div>
  </section>`
}

// ── Mnet card ─────────────────────────────────────────────────────────

/** Not started | Voted (upload needed) | Verifying | In review | Complete. */
export function mnetUiState(serverState, local) {
  if (serverState === 'verified') return 'done'
  if (serverState === 'review') return 'review'
  if (serverState === 'verifying' || local?.uploading) return 'verifying'
  if (local?.voted || serverState === 'rejected') return 'upload'
  return 'todo'
}

// Duplicate outcomes, in the player's words. Never who, never how.
export const DUPLICATE_TEXT = {
  duplicate: 'This certificate has already been submitted. Please upload a new voting certificate.',
  possible_duplicate: 'This certificate may have already been submitted. It’s been sent for review.',
}

// A certificate the automatic check couldn't fully read.
export const REVIEW_TEXT = 'We couldn’t confidently read a couple of details, so it’s in review. Your upload is safe.'
// The trusted check couldn't read the certificate's wording at all.
export const UNREADABLE_TEXT = 'We couldn’t read your certificate clearly. Please upload the original certificate image or a clearer screenshot.'
// Picked a very small image: say so before it goes anywhere (never a block).
export const SMALL_IMAGE_TEXT = 'This screenshot is very small, so we may not be able to read it. Upload the original certificate image if you can.'

function mnetCard(vm, m) {
  const local = vm.local.mnet || {}
  const dup = vm.status.notices?.[m.id] || null
  const count = vm.status.todayProgress?.[m.id] || { verified: 0, pending: 0, used: 0, remaining: m.maxDaily || 1, max: m.maxDaily || 1 }
  const ui = mnetUiState(vm.status.states[m.id], local)
  const proof = (vm.status.todayProofs || []).find((p) => p.missionId === m.id)
  const date = dayLabel(vm.status.today)
  const STEPS = ['Vote', 'Upload', 'Verify', 'Complete']
  const closed = vm.status.campaign.phase !== 'open'
  const err = vm.local.error?.mission === m.id ? note('is-err', 'xCircle', esc(vm.local.error.text)) : ''
  let status = ''
  let body = ''

  if (ui === 'todo') {
    status = `<span class="vt-status">${ic('circleDashed')}Mnet votes · ${count.verified}/${count.max}</span>`
    body = `${verifiedLine(count, 'Vote again on Mnet for the next certificate.')}
      <p class="vt-rule">Vote for BTS in Fans' Choice, then save the certificate Mnet shows you.</p>
      ${err}
      <div class="vt-actions">
        <a class="vt-btn vt-btn-primary" href="${esc(m.voteUrl || '#')}" target="_blank" rel="noopener noreferrer" data-vt-act="mnet-vote"${closed ? ' aria-disabled="true"' : ''}>Vote on Mnet ${ic('ext')}</a>
        <button class="vt-btn vt-btn-ghost" type="button" data-vt-act="mnet-voted"${closed ? ' disabled' : ''}>I've voted</button>
      </div>`
  } else if (ui === 'upload') {
    const rejected = vm.status.states[m.id] === 'rejected'
    status = `<span class="vt-status is-accent">${ic('upload')}Voted — certificate needed</span>`
    const pre = local.precheck
    body = `${stepper(STEPS, 1)}
      ${rejected ? note('is-err', 'xCircle', dup === 'duplicate' ? DUPLICATE_TEXT.duplicate : "Today's earlier proof wasn't accepted. Upload a clear certificate.") : ''}
      <label class="vt-drop" data-vt-drop>
        <input type="file" accept="image/png,image/jpeg" class="vt-file" data-vt-act="mnet-file">
        <span class="vt-drop-ico">${ic('upload')}</span>
        <strong>Upload your vote certificate</strong>
        <span>PNG or JPG · up to 5 MB</span>
      </label>
      ${local.smallWarn ? `<div class="vt-attn" role="alert">${note('is-warn', 'info', SMALL_IMAGE_TEXT)}<div class="vt-actions"><button class="vt-btn vt-btn-outline" type="button" data-vt-act="mnet-small-cancel">Choose another image</button><button class="vt-btn vt-btn-ghost" type="button" data-vt-act="mnet-small-continue">Upload anyway</button></div></div>` : ''}
      ${pre ? checkChips([['Certificate', pre.certificate || 'unclear'], ["Fans' Choice 1st Vote", pre.category || 'unclear'], [date, pre.date || 'unclear']]) : ''}
      ${note('', 'shield', "We check only that it's today's Fans' Choice certificate and that BTS is selected. The certificate number and account details are not stored.")}
      ${err}
      <div class="vt-actions">
        <button class="vt-btn vt-btn-primary" type="button" data-vt-act="mnet-pick">${ic('upload')}Upload certificate</button>
        <a class="vt-btn vt-btn-ghost" href="${esc(m.voteUrl || '#')}" target="_blank" rel="noopener noreferrer">Vote again</a>
      </div>`
  } else if (ui === 'verifying') {
    // Uploading, then "Checking your certificate…" for the first minute
    // while the automatic check usually lands; past that (or after a reload),
    // a calm "Still checking" — never an endless spinner. The screen keeps
    // polling and updates by itself.
    const fresh = !local.uploading && !!local.sentAt && vm.now - local.sentAt < MNET_CHECKING_MS
    const chip = local.uploading || fresh ? 'wait' : 'queued'
    status = local.uploading
      ? `<span class="vt-status">${ic('loader', 'vt-spin')}Uploading certificate…</span>`
      : fresh
        ? `<span class="vt-status">${ic('loader', 'vt-spin')}Checking your certificate…</span>`
        : `<span class="vt-status">${ic('clock')}Still checking — no need to upload again</span>`
    const another = count.remaining ? ' You can add another distinct certificate.' : ''
    body = `${stepper(STEPS, 2)}
      ${checkChips([['Certificate', chip], ["Fans' Choice 1st Vote", chip], [date, chip], ['BTS selected', chip]])}
      ${local.uploading ? '' : fresh
        ? `<p class="vt-rule">Usually takes under 1–2 minutes. You can leave this page — it will update automatically.${another}</p>`
        : `${note('', 'info', 'You can leave this page — it will update automatically.')}
      ${another ? `<p class="vt-rule">${another.trim()}</p>` : ''}`}
      ${count.remaining && !local.uploading ? `<label class="vt-btn vt-btn-outline">${ic('upload')}Upload another<input type="file" accept="image/png,image/jpeg" class="vt-file" data-vt-act="mnet-file"></label>` : ''}`
  } else if (ui === 'review' && dup === 'duplicate') {
    // Already counted once: say so plainly; nothing to wait for.
    status = badge('is-err', 'xCircle', 'Not counted')
    body = `${note('is-err', 'xCircle', DUPLICATE_TEXT.duplicate)}
      ${count.remaining ? `<label class="vt-btn vt-btn-outline">${ic('upload')}Upload another certificate<input type="file" accept="image/png,image/jpeg" class="vt-file" data-vt-act="mnet-file"></label>` : ''}`
  } else if (ui === 'review') {
    const c = proof?.checks || {}
    status = badge('is-warn', 'hourglass', 'In review')
    body = `${stepper(STEPS, 2, true)}
      ${checkChips([['Certificate', c.certificate === true || 'unclear'], ["Fans' Choice 1st Vote", c.category === true || 'unclear'], [date, c.date === true || 'unclear'], ['BTS selected', c.bts === 'match' || 'unclear']])}
      ${note('is-warn', 'info', dup === 'possible_duplicate' ? DUPLICATE_TEXT.possible_duplicate : proof?.hint === 'unreadable' ? UNREADABLE_TEXT : REVIEW_TEXT)}
      ${count.remaining ? `<label class="vt-btn vt-btn-outline">${ic('upload')}${proof?.hint === 'unreadable' ? 'Upload new certificate' : 'Upload another certificate'}<input type="file" accept="image/png,image/jpeg" class="vt-file" data-vt-act="mnet-file"></label>` : ''}`
  } else {
    status = badge('is-ok', 'check', 'Verified')
    body = `${checkChips([['Certificate', true], ["Fans' Choice 1st Vote", true], [date, true], ['BTS selected', true]])}
      <div class="vt-sub">${ic('clock')}Next vote opens at <span class="vt-mono">00:00 KST</span></div>`
  }
  const badgeInHead = ui === 'review' || ui === 'done'
  return `<article class="vt-card vt-mission" data-vt-mission="${esc(m.id)}" data-vt-state="${ui}" aria-labelledby="vt-m-${esc(m.id)}">
    <div class="vt-m-head">
      <span class="vt-m-logo" aria-hidden="true">M</span>
      <div class="vt-m-title"><h3 id="vt-m-${esc(m.id)}">Mnet votes · ${count.verified}/${count.max}</h3><div class="vt-sub">${ic('clock')}Up to ${count.max} distinct certificates daily · <span class="vt-keep">resets at <span class="vt-mono">00:00 KST</span></span></div></div>
      ${badgeInHead ? status : ''}
    </div>
    ${badgeInHead ? '' : status}
    ${body}
  </article>`
}

// ── X card ────────────────────────────────────────────────────────────

/** Not started | Link needed | Verifying | In review | Complete. */
/**
 * "I've voted" / "I've posted" are the player's own notes for the day. Each
 * is kept with the time it was set; once a proof for that mission has been
 * sent after it, the note has done its job and the card goes back to its
 * real state (a legacy "1" counts as set at the start of the day).
 */
export function dayFlagActive(raw, activity, missionId, today) {
  if (raw === null || raw === undefined || raw === '') return false
  const setAt = raw === '1' ? 0 : Number(raw) || 0
  const latest = (activity || [])
    .filter((a) => a.missionId === missionId && a.voteDay === today)
    .reduce((t, a) => Math.max(t, Date.parse(a.at) || 0), -1)
  return latest < 0 || setAt > latest
}

/** "1 of 3 verified today" — so a counted vote is visible on the card, not
 *  only in a passing toast. */
function verifiedLine(count, next) {
  if (!count.verified) return ''
  return note('is-ok', 'check', `${count.verified} of ${count.max} verified today.${count.remaining ? ` ${next}` : ''}`)
}

export function xUiState(serverState, local) {
  if (serverState === 'verified') return 'done'
  if (serverState === 'review') return 'review'
  if (serverState === 'verifying' || local?.submitting) return 'verifying'
  if (local?.composed) return 'link'
  return 'todo'
}

function xCard(vm, m) {
  const local = vm.local.x || {}
  const count = vm.status.todayProgress?.[m.id] || { verified: 0, pending: 0, used: 0, remaining: m.maxDaily || 1, max: m.maxDaily || 1 }
  const handles = vm.status.xHandles || (vm.status.xHandle ? [vm.status.xHandle] : [])
  const ui = xUiState(vm.status.states[m.id], local)
  const proof = (vm.status.todayProofs || []).find((p) => p.missionId === m.id)
  const date = dayLabel(vm.status.today)
  const STEPS = ['Post', 'Add link', 'Verify', 'Complete']
  const closed = vm.status.campaign.phase !== 'open'
  const err = vm.local.error?.mission === m.id ? note('is-err', 'xCircle', esc(vm.local.error.text)) : ''
  const tags = (m.hashtags || []).map((h) => `#${String(h).replace(/^#/, '')}`)
  const tagChips = `<div class="vt-tags">${tags.map((t) => `<span class="vt-tag">${esc(t)}<button type="button" aria-label="Copy ${esc(t)}" data-vt-copy="${esc(t)}">${ic('copy')}</button></span>`).join('')}</div>`
  let status = ''
  let body = ''

  if (ui === 'todo') {
    const rejected = vm.status.states[m.id] === 'rejected'
    status = `<span class="vt-status">${ic('circleDashed')}X votes · ${count.verified}/${count.max}</span>`
    body = `${verifiedLine(count, 'For the next one, post from another linked account.')}
      ${tagChips}
      ${rejected ? note('is-err', 'xCircle', "Today's earlier post wasn't accepted. Post again and add the new link.") : ''}
      ${err}
      <div class="vt-actions">
        <a class="vt-btn vt-btn-primary" href="${esc(xComposeUrl(m.hashtags))}" target="_blank" rel="noopener noreferrer" data-vt-act="x-compose"${closed ? ' aria-disabled="true"' : ''}>Create vote post ${ic('ext')}</a>
        <button class="vt-btn vt-btn-outline vt-btn-fit" type="button" data-vt-act="x-link"${closed ? ' disabled' : ''}>${ic('link')}Add link</button>
      </div>`
  } else if (ui === 'link') {
    status = `<span class="vt-status is-accent">${ic('link')}Posted — link needed</span>`
    body = `${stepper(STEPS, 1)}
      <p class="vt-rule">Copy your post's link from X, then add it here so it can be checked.</p>
      ${err}
      <div class="vt-actions">
        <button class="vt-btn vt-btn-primary" type="button" data-vt-act="x-link"${closed ? ' disabled' : ''}>${ic('link')}Add link</button>
        <a class="vt-btn vt-btn-ghost" href="${esc(xComposeUrl(m.hashtags))}" target="_blank" rel="noopener noreferrer">Post again</a>
      </div>`
  } else if (ui === 'verifying') {
    status = `<span class="vt-status">${ic('loader', 'vt-spin')}Checking your post…</span>`
    body = `${stepper(STEPS, 2)}${checkChips([['Hashtags', 'wait'], ['Public post', 'wait'], [date, 'wait']])}${count.remaining ? `<div class="vt-actions"><a class="vt-btn vt-btn-primary" href="${esc(xComposeUrl(m.hashtags))}" target="_blank" rel="noopener noreferrer" data-vt-act="x-compose">Create another vote post ${ic('ext')}</a><button class="vt-btn vt-btn-outline" type="button" data-vt-act="x-link">${ic('link')}Add link</button></div>` : ''}`
  } else if (ui === 'review') {
    const c = proof?.checks || {}
    status = badge('is-warn', 'hourglass', 'In review')
    body = `${stepper(STEPS, 2, true)}
      ${checkChips([['Hashtags', c.hashtags === true || 'unclear'], ['Public post', c.publicPost === true || 'unclear'], [date, c.date === true || 'unclear']])}
      ${proof?.hint === 'unlinked_account'
        ? `${note('is-warn', 'info', `This post was made from <b>@${esc(proof.author)}</b>, but that account isn’t linked. A reviewer will check this one; link the account so your next posts from it count.`)}
      <div class="vt-actions">${handles.length < (m.maxHandles || 3) && !handles.includes(proof.author) ? `<button class="vt-btn vt-btn-outline" type="button" data-vt-act="x-link-author" data-vt-author="${esc(proof.author)}">${ic('link')}Link @${esc(proof.author)}</button>` : ''}<button class="vt-btn vt-btn-ghost" type="button" data-vt-act="x-manage">Manage X accounts</button></div>`
        : note('is-warn', 'info', 'This post needs review — do not submit it again.')}
      ${count.remaining ? `<div class="vt-actions"><a class="vt-btn vt-btn-primary" href="${esc(xComposeUrl(m.hashtags))}" target="_blank" rel="noopener noreferrer" data-vt-act="x-compose">Create another vote post ${ic('ext')}</a><button class="vt-btn vt-btn-outline" type="button" data-vt-act="x-link">${ic('link')}Add link</button></div>` : ''}`
  } else {
    status = badge('is-ok', 'check', 'Verified')
    body = checkChips([['Both hashtags', true], ['Public post', true], [date, true]])
  }
  const badgeInHead = ui === 'review' || ui === 'done'
  return `<article class="vt-card vt-mission" data-vt-mission="${esc(m.id)}" data-vt-state="${ui}" aria-labelledby="vt-m-${esc(m.id)}">
    <div class="vt-m-head">
      <span class="vt-m-logo" aria-hidden="true">X</span>
      <div class="vt-m-title"><h3 id="vt-m-${esc(m.id)}">X votes · ${count.verified}/${count.max}</h3><div class="vt-sub">${ic('globe')}X accounts · ${handles.length}/${m.maxHandles || 3} · one vote per account daily</div>
        <button type="button" class="vt-link vt-m-manage" data-vt-act="x-manage">Manage X accounts${(vm.status.xReplacements || []).some((r) => r.status === 'pending') ? ' · replacement pending' : ''}</button></div>
      ${badgeInHead ? status : ''}
    </div>
    ${badgeInHead ? '' : status}
    ${body}
  </article>`
}

// ── BTS X Vote Pulse (display only) ──────────────────────────────────

/** 12842 → '12,842'. Fixed locale so every agent sees the same digits. */
export function fmtCount(n) {
  return Number(n).toLocaleString('en-US')
}

function pulse(vm) {
  const p = vm.status.pulse
  if (!p) return ''
  const tags = esc((p.tags || []).join(' + '))
  let body
  if (p.count == null) {
    body = `<div class="vt-pulse-top"><span class="vt-pulse-wait">${ic('loader')}Collecting the first count</span></div>`
  } else {
    body = `<div class="vt-pulse-top">
        <span class="vt-pulse-val">${fmtCount(p.count)}+</span><span class="vt-pulse-unit">tracked posts</span>
        ${p.delta ? `<span class="vt-pulse-delta">+${fmtCount(p.delta)} since last update</span>` : ''}
      </div>`
  }
  const updated = p.lastUpdatedAt
    ? `<span class="vt-pulse-time${p.stale ? ' is-stale' : ''}">${ic('clock')}Last updated <span class="vt-mono">${esc(kstStamp(p.lastUpdatedAt))}</span></span>`
    : ''
  return `<section aria-labelledby="vt-h-pulse">
    <div class="vt-sec-h"><h2 id="vt-h-pulse">BTS X Vote Pulse</h2></div>
    <div class="vt-card vt-pulse" data-vt-pulse="${p.count == null ? 'collecting' : p.stale ? 'stale' : 'fresh'}">
      ${body}
      <p class="vt-pulse-sub">Tracked public ${tags} posts</p>
      <div class="vt-pulse-foot">${updated}<span class="vt-pulse-note">Tracked public posts · unofficial estimate</span></div>
    </div>
  </section>`
}

// ── MAMA Battle ──────────────────────────────────────────────────────

/** 'Your team is leading by 16' / 'Your team is 16 behind' / 'Tied at 120',
 *  and after the freeze, the final result. */
export function battleLine(b) {
  const [a, z] = b.teams
  if (!a || !z) return ''
  if (b.frozen && b.winners) {
    if (b.winners.length > 1) return `Final: tied at ${fmtCount(a.points)} — both teams win`
    const w = b.teams.find((t) => t.id === b.winners[0])
    return b.myTeam === w?.id ? `Final: ${w.label} win — your team won` : `Final: ${w?.label} win`
  }
  if (a.points === z.points) return `Tied at ${fmtCount(a.points)}`
  const lead = a.points > z.points ? a : z
  const gap = Math.abs(a.points - z.points)
  if (!b.myTeam) return `${lead.label} lead by ${fmtCount(gap)}`
  return b.myTeam === lead.id ? `Your team is leading by ${fmtCount(gap)}` : `Your team is ${fmtCount(gap)} behind`
}

function timeLeftText(closesAt, now) {
  const ms = new Date(closesAt).getTime() - now.getTime()
  if (ms <= 0) return 'Battle ended'
  const d = Math.floor(ms / 86_400_000)
  const h = Math.floor((ms % 86_400_000) / 3_600_000)
  return d > 0 ? `${d}d ${h}h left` : `${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m left`
}

/** The next milestone not yet reached, for "Next Battle Gift at …". */
export function nextMilestone(b) {
  return (b.milestones || []).find((m) => !m.reached) || null
}

function battle(vm) {
  const b = vm.status.battle
  if (!b) return ''
  const [x, y] = b.teams
  const total = Math.max(1, x.points + y.points)
  const leading = x.points === y.points ? null : x.points > y.points ? x.id : y.id
  const side = (t, end) => `<div class="vt-vs-t${end ? ' is-end' : ''}" data-team="${esc(t.id)}">
      <span class="vt-team-chip"><i aria-hidden="true"></i>${esc(t.label)}</span>
      <span class="vt-vs-pts">${fmtCount(t.points)}</span>
      <span class="vt-vs-you">${b.myTeam === t.id ? 'Your team' : '&nbsp;'}</span>
    </div>`
  return `<section class="vt-hero" aria-labelledby="vt-h-battle" data-vt-battle="${leading || 'tied'}">
    <h2 class="vt-sr" id="vt-h-battle">MAMA Battle${b.frozen ? ' · Final score' : ''}</h2>
    ${b.frozen ? '<p class="vt-hero-final">Final score</p>' : ''}
    <div class="vt-vs">${side(x, false)}<span class="vt-vs-x" aria-hidden="true">VS</span>${side(y, true)}</div>
    <div class="vt-tug" aria-hidden="true"><span class="${leading === y.id ? 'is-behind' : 'is-ahead'}" style="flex-grow:${(x.points / total).toFixed(4)}"></span><span class="${leading === y.id ? 'is-ahead' : 'is-behind'}" style="flex-grow:${(y.points / total).toFixed(4)}"></span></div>
    <p class="vt-battle-line">${esc(battleLine(b))}</p>
    <p class="vt-battle-meta"><span>Your contribution <b>${fmtCount(b.myPoints)}</b></span><span>Community total <b>${fmtCount(b.total)}</b></span></p>
    <button class="vt-btn vt-btn-outline vt-battle-share" type="button" data-vt-act="battle-share" aria-haspopup="dialog">${ic('share')}Share battle${b.myTeam ? `<i class="vt-share-dot" data-team="${esc(b.myTeam)}" aria-hidden="true"></i>` : ''}</button>
    <p class="vt-battle-note">Friendly ReConnect battle — every verified vote still supports BTS.${b.frozen ? '' : ' Final score at 12:00 KST on Oct 23.'}</p>
  </section>`
}

/** Gold: how close the next shared Battle Gift is, above the claim list. */
function giftProgress(b) {
  if (!b.milestones) return ''
  const next = nextMilestone(b)
  const pct = next ? Math.min(100, Math.round((b.total / next.target) * 100)) : 100
  return `<div class="vt-gp">
      <div class="vt-gp-row"><span class="vt-gp-ico">${ic('gift')}</span><span class="vt-gp-t">${next
        ? `Next Battle Gift at <b>${fmtCount(next.target)}</b> · ${fmtCount(next.target - b.total)} to go`
        : 'All Battle Gifts unlocked'}</span><span class="vt-aside vt-mono">${fmtCount(b.total)}</span></div>
      ${next ? `<span class="vt-gift-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${next.target}" aria-valuenow="${b.total}" aria-label="Community progress to the next Battle Gift"><span style="width:${pct}%"></span></span>` : ''}
      <ol class="vt-gp-steps">${b.milestones.map((m) => `<li class="${m.reached ? 'is-got' : next && m.target === next.target ? 'is-next' : ''}">${fmtCount(m.target)}${m.reached ? ' ✓' : ''}</li>`).join('')}</ol>
    </div>`
}

// ── Your voting ───────────────────────────────────────────────────────

function nextReward(vm) {
  const g = vm.status.gift
  if (g.state === 'ready') return `${esc(g.name)} <small>ready to open</small>`
  const b = vm.status.battle
  if (b?.milestones?.some((m) => m.claimable)) return 'Battle Gift <small>ready to claim</small>'
  if (g.state === 'capped') return `${esc(g.name)} <small>opens again at 00:00 KST</small>`
  if (g.state === 'filling' && g.threshold) return `${esc(g.name)} <small>${g.threshold - g.fill} to go</small>`
  return 'MAMA badge'
}

function stats(vm) {
  const s = vm.status.stats
  const progress = vm.status.todayProgress || {}
  const done = Object.values(progress).reduce((n, p) => n + (p.verified || 0), 0)
  const total = Object.values(progress).reduce((n, p) => n + (p.max || 0), 0) || vm.status.campaign.missions.length
  const bd = vm.status.badge
  const days = bd?.earned
    ? `${s.votingDays} <small>· MAMA badge earned</small>`
    : bd?.verifiedDays ? `${s.votingDays} <small>/ ${bd.verifiedDays} for MAMA badge</small>` : `${s.votingDays}`
  return `<section aria-labelledby="vt-h-stats">
    <div class="vt-sec-h"><h2 id="vt-h-stats">Your voting</h2></div>
    <div class="vt-stats">
      <div class="vt-card vt-stat"><span class="vt-stat-k">${ic('shield')}Verified votes</span><span class="vt-stat-v">${s.verifiedVotes}</span></div>
      <div class="vt-card vt-stat" data-vt-badge="${bd?.earned ? 'earned' : 'progress'}"><span class="vt-stat-k">${ic('calendar')}Voting days</span><span class="vt-stat-v is-days">${days}</span></div>
      <div class="vt-card vt-stat"><span class="vt-stat-k">${ic('target')}Today's votes</span><span class="vt-stat-v">${done} <small>/ ${total}</small></span></div>
      <div class="vt-card vt-stat"><span class="vt-stat-k">${ic('award')}Next reward</span><span class="vt-stat-v is-sm">${nextReward(vm)}</span></div>
    </div>
  </section>`
}

function guideButton() {
  return `<button class="vt-row-btn" type="button" data-vt-act="guide-open" aria-haspopup="dialog">
    <span class="vt-row-ico">${ic('book')}</span>
    <span class="vt-row-txt"><span class="vt-row-t">Voting guide</span><span class="vt-row-s">Mnet and X rules, proof, privacy</span></span>
    ${ic('chevR')}
  </button>`
}

// ── Voting activity ──────────────────────────────────────────────────

const STATUS_BADGE = {
  verified: ['is-ok', 'check', 'Verified'],
  verifying: ['is-neutral', 'loader', 'Verifying'],
  review: ['is-warn', 'hourglass', 'In review'],
  rejected: ['is-err', 'xCircle', 'Rejected'],
}

function activity(vm) {
  const labels = Object.fromEntries(vm.status.campaign.missions.map((m) => [m.id, m]))
  const rows = vm.status.activity || []
  const list = rows.length
    ? rows.map((a) => {
      const m = labels[a.missionId]
      const [k, i, t] = STATUS_BADGE[a.status] || STATUS_BADGE.verifying
      return `<li><span class="vt-l-ico" aria-hidden="true">${m?.kind === 'x_post' ? 'X' : 'M'}</span><span class="vt-l-txt"><span class="vt-l-t">${m?.kind === 'x_post' ? 'X vote post' : 'Mnet certificate'}</span><span class="vt-l-s vt-mono">${esc(kstStamp(a.at))}</span></span>${badge(k, i, t)}</li>`
    }).join('')
    : `<li class="vt-empty">Nothing yet. Your proofs appear here once you send them.</li>`
  return `<section aria-labelledby="vt-h-activity">
    <div class="vt-sec-h"><h2 id="vt-h-activity">Voting activity</h2></div>
    <ul class="vt-card vt-list">${list}</ul>
  </section>`
}

// ── Rewards: Voting Gift and Battle Gifts (secondary to voting) ──────

export const REWARD_NAMES = {
  charge_cell: 'Charge Cell', xp: 'XP', streak_freeze: 'Streak Freeze', extension: 'Extension', wings: 'Wings', backup_pass: 'Backup Pass',
}
const REWARD_ICONS = { charge_cell: 'battery', xp: 'zap', streak_freeze: 'snowflake', extension: 'hourglass', wings: 'feather', backup_pass: 'users' }

/** '+10 XP', '+1 Backup Pass'. */
export function rewardText(r) {
  const name = REWARD_NAMES[r.kind] || r.kind
  return `+${r.amount || 1} ${name}`
}

function rewardTiles(rewards) {
  return `<ul class="vt-reveal" aria-label="Rewards">${rewards.map((r) => `<li class="vt-reveal-tile">${ic(REWARD_ICONS[r.kind] || 'gift')}<span>${esc(rewardText(r))}</span></li>`).join('')}</ul>`
}

function poolLine(pool) {
  return pool.length ? `<p class="vt-l-s">Can hold ${pool.map((p) => esc(REWARD_NAMES[p.kind] || p.kind)).join(' · ')}</p>` : ''
}

function votingGift(vm) {
  const g = vm.status.gift
  const labels = Object.fromEntries(vm.status.campaign.missions.map((m) => [m.id, m.label]))
  const last = g.contributions?.[0]
  const from = last ? `Last fill: ${esc(labels[last.missionId] || last.missionId)} · ${esc(dayLabel(last.voteDay))}` : 'Each verified mission adds 1'
  const shown = g.threshold ? Math.min(g.fill, g.threshold) : g.fill
  const pct = g.threshold ? Math.round((shown / g.threshold) * 100) : 0
  const reveal = vm.local.giftReveal
  let state
  if (reveal) state = badge('is-ok', 'check', 'Opened')
  else if (g.state === 'tba') state = badge('is-neutral', 'lock', 'TBA')
  else if (g.state === 'ready') state = badge('is-ok', 'gift', 'Ready')
  else if (g.state === 'capped') state = badge('is-neutral', 'clock', 'Daily limit reached')
  else state = badge('is-neutral', 'lock', 'Filling')
  const extra = g.fill > g.threshold && g.threshold ? `<span class="vt-l-s">+${g.fill - g.threshold} saved toward the next one</span>` : ''
  return `<section aria-labelledby="vt-h-gift">
    <div class="vt-sec-h"><h2 id="vt-h-gift">${esc(g.name)}</h2><span class="vt-aside">Your personal reward</span></div>
    <div class="vt-card vt-gift" data-vt-gift="${reveal ? 'opened' : g.state}">
      <div class="vt-gift-head">
        <span class="vt-l-ico">${ic('gift')}</span>
        <div class="vt-l-txt">
          ${g.state === 'tba' ? '<span class="vt-l-s">Rewards announced soon</span>'
            : `<span class="vt-gift-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${g.threshold}" aria-valuenow="${shown}" aria-label="${esc(g.name)} fill"><span style="width:${pct}%"></span></span>
          <span class="vt-l-s">${shown} of ${g.threshold}</span>${extra}`}
        </div>
        ${state}
      </div>
      ${reveal ? rewardTiles(reveal) : ''}
      ${g.state === 'ready' && !reveal ? `<button class="vt-btn vt-btn-primary" type="button" data-vt-act="gift-open"${vm.local.giftBusy ? ' disabled' : ''}>${ic('gift')}Open ${esc(g.name)}</button>` : ''}
      ${g.state === 'capped' ? `<p class="vt-l-s">You've opened ${g.dailyCap} today. More at 00:00 KST.</p>` : ''}
      ${g.state !== 'tba' ? `<p class="vt-l-s">${from} · up to ${g.dailyCap || 2} opens a day</p>${poolLine(g.pool)}` : ''}
      ${vm.local.error?.mission === 'gift' ? note('is-err', 'xCircle', esc(vm.local.error.text)) : ''}
    </div>
  </section>`
}

function battleGifts(vm) {
  const b = vm.status.battle
  if (!b) return ''
  let body
  if (!b.milestones) {
    body = `<li><span class="vt-l-ico">${ic('flag')}</span><span class="vt-l-txt"><span class="vt-l-t">Community milestones</span><span class="vt-l-s">Announced soon</span></span>${badge('is-neutral', 'lock', 'TBA')}</li>`
  } else {
    body = b.milestones.map((m) => {
      const reveal = vm.local.battleReveal?.index === m.index ? vm.local.battleReveal.rewards : null
      let right
      let sub
      if (m.claimed) { right = badge('is-ok', 'check', 'Claimed'); sub = 'Claimed' }
      else if (m.claimable) {
        right = `<button class="vt-btn vt-btn-primary vt-btn-sm" type="button" data-vt-act="battle-claim" data-vt-index="${m.index}"${vm.local.battleBusy ? ' disabled' : ''}>Claim</button>`
        sub = 'Unlocked — ready to claim'
      } else if (m.reached) { right = badge('is-neutral', 'lock', 'Vote to qualify'); sub = 'Unlocked · verify 1 vote to claim' }
      else { right = badge('is-neutral', 'lock', 'Locked'); sub = `${fmtCount(Math.max(0, m.target - b.total))} community votes to go` }
      return `<li data-vt-bgift="${m.claimed ? 'claimed' : m.claimable ? 'ready' : m.reached ? 'not-contributor' : 'locked'}"><span class="vt-l-ico">${ic('flag')}</span><span class="vt-l-txt"><span class="vt-l-t">Battle Gift ${m.index + 1} · ${fmtCount(m.target)} votes</span><span class="vt-l-s">${esc(sub)}</span>${reveal ? rewardTiles(reveal) : ''}</span>${right}</li>`
    }).join('')
  }
  body += winnerRow(vm, b)
  return `<section aria-labelledby="vt-h-bgifts">
    <div class="vt-sec-h"><h2 id="vt-h-bgifts">Battle Gifts</h2><span class="vt-aside">Shared milestones</span></div>
    ${giftProgress(b)}
    <ul class="vt-card vt-list">${body}</ul>
    <p class="vt-foot-note">Everyone who verified at least one MAMA vote can claim — on either team.</p>
    ${vm.local.error?.mission === 'battle' ? note('is-err', 'xCircle', esc(vm.local.error.text)) : ''}
  </section>`
}

function winnerRow(vm, b) {
  const w = b.winnerReward
  if (!w) return ''
  const what = w.rewards.map((r) => `${r.amount} ${esc(REWARD_NAMES[r.kind] || r.kind)}`).join(' + ')
  const reveal = vm.local.winnerReveal
  let right
  let sub
  if (w.state === 'claimed') { right = badge('is-ok', 'check', 'Claimed'); sub = `Claimed · ${what}` }
  else if (w.state === 'claimable') {
    right = `<button class="vt-btn vt-btn-primary vt-btn-sm" type="button" data-vt-act="winner-claim"${vm.local.battleBusy ? ' disabled' : ''}>Claim</button>`
    sub = `Your team won · ${what}`
  } else if (w.state === 'not_winner') { right = badge('is-neutral', 'flag', 'Final'); sub = 'Goes to the winning team. Your Battle Gifts stay yours.' }
  else if (w.state === 'not_contributor') { right = badge('is-neutral', 'lock', 'Not eligible'); sub = 'For agents who scored for the winning team' }
  else { right = badge('is-neutral', 'lock', 'After final'); sub = `${what} for the winning team · final score Oct 23 12:00 KST` }
  return `<li data-vt-winner="${w.state}"><span class="vt-l-ico">${ic('award')}</span><span class="vt-l-txt"><span class="vt-l-t">Winner reward</span><span class="vt-l-s">${sub}</span>${reveal ? rewardTiles(reveal) : ''}</span>${right}</li>`
}

// ── Team chooser (full screen, 7 seconds) ────────────────────────────

/**
 * vm.local.chooser: { secondsLeft, picked, result, via }.
 * Both sides use identical markup and styling — neither looks stronger.
 */
export function teamChooser(vm) {
  const ch = vm.local.chooser
  const b = vm.status.battle
  if (!ch || !b) return ''
  const teams = b.teams
  if (ch.result) {
    const t = teams.find((x) => x.id === ch.result)
    return `<div class="vt-chooser" role="dialog" aria-modal="true" aria-labelledby="vt-ch-title" data-vt-chooser="result">
      <div class="vt-chooser-in">
        <p class="vt-chooser-kicker">MAMA Battle</p>
        <h2 class="vt-chooser-title" id="vt-ch-title">You're on ${esc(t?.label || '')}</h2>
        <p class="vt-chooser-sub">${ch.via === 'timeout' ? 'Time ran out, so you joined the smaller team.' : 'Locked for MAMA 2026.'} Every verified vote still supports BTS.</p>
        <button class="vt-btn vt-btn-primary" type="button" data-vt-act="chooser-done">Continue</button>
      </div>
    </div>`
  }
  return `<div class="vt-chooser" role="dialog" aria-modal="true" aria-labelledby="vt-ch-title" data-vt-chooser="choose">
    <div class="vt-chooser-in">
      <p class="vt-chooser-kicker">MAMA Battle</p>
      <h2 class="vt-chooser-title" id="vt-ch-title">Choose your side</h2>
      <div class="vt-chooser-count" aria-live="polite"><span class="vt-chooser-num">${Math.max(0, ch.secondsLeft)}</span><span class="vt-chooser-unit">seconds</span></div>
      <div class="vt-chooser-teams">
        ${teams.map((t) => `<button class="vt-chooser-team${ch.picked === t.id ? ' is-picked' : ''}" type="button" data-vt-act="team-pick" data-vt-team="${esc(t.id)}"${ch.picked ? ' disabled' : ''}>${esc(t.label)}</button>`).join('')}
      </div>
      <p class="vt-chooser-sub">Friendly ReConnect battle. Your side is locked for MAMA 2026. No pick in time puts you on the smaller team.</p>
    </div>
  </div>`
}

// ── Sheets ───────────────────────────────────────────────────────────

export function guideSheet(vm) {
  const c = vm.status.campaign
  const x = c.missions.find((m) => m.kind === 'x_post')
  const tags = (x?.hashtags || []).map((h) => `#${String(h).replace(/^#/, '')}`).join(' ')
  return `<div class="vt-sheet" role="dialog" aria-modal="true" aria-labelledby="vt-g-title" data-vt-sheet="guide" hidden>
    <div class="vt-grabber" aria-hidden="true"></div>
    <div class="vt-sheet-h"><h2 id="vt-g-title">Voting guide</h2><button class="vt-icon-btn" type="button" aria-label="Close" data-vt-act="sheet-close">${ic('x')}</button></div>
    <p class="vt-sheet-desc">${esc(c.roundLabel || '')} · Oct 12 19:00 – Oct 22 23:59 KST</p>
    <div class="vt-acc">
      <details open><summary>Mnet rules ${ic('chevD')}</summary><ul>
        <li>Vote once per day. The day resets at 00:00 KST.</li>
        <li>Choose BTS in Fans' Choice (Male) and finish the vote.</li>
        <li>Save the certificate Mnet shows after voting.</li></ul></details>
      <details><summary>X rules ${ic('chevD')}</summary><ul>
        <li>Your account must be public, or the vote won't count.</li>
        <li>Use the hashtags exactly: ${esc(tags)}.</li>
        <li>One vote post per day. Don't delete it until voting closes.</li></ul></details>
      <details><summary>Proof requirements ${ic('chevD')}</summary><ul>
        <li>Mnet: an unedited screenshot of today's certificate.</li>
        <li>X: the link to today's post, from the X account you linked.</li>
        <li>Each screenshot or post can only be used once.</li>
        <li>Proofs are checked before they count. Unclear ones go to a reviewer — no need to send them again.</li></ul></details>
      <details><summary>Privacy and safety ${ic('chevD')}</summary><ul>
        <li>Crop out notifications before uploading.</li>
        <li>We keep only the checks, never your Mnet account details. Screenshots are deleted 30 days after voting closes.</li>
        <li>Your X handle is used only to match your posts. It is never shown to other agents.</li>
        <li>Never share a password. ReConnect will never ask for your Mnet or X login.</li></ul></details>
    </div>
  </div>`
}

/** "This post was made from @x, but that account isn't linked." — a popup of
 *  its own with the three ways forward. Only after the server said so for
 *  this exact post. */
export function xUnlinkedSheet(vm) {
  const x = vm.status.campaign.missions.find((m) => m.kind === 'x_post')
  const handles = vm.status.xHandles || (vm.status.xHandle ? [vm.status.xHandle] : [])
  const handleMax = x?.maxHandles || 3
  return `<div class="vt-sheet" role="alertdialog" aria-modal="true" aria-labelledby="vt-xu-title" data-vt-sheet="xunlinked" hidden>
    <div class="vt-grabber" aria-hidden="true"></div>
    <div class="vt-sheet-h vt-sheet-h-end"><button class="vt-icon-btn" type="button" aria-label="Close" data-vt-act="sheet-close">${ic('x')}</button></div>
    <div class="vt-pop-ico is-warn">${ic('link')}</div>
    <h2 class="vt-pop-title" id="vt-xu-title">This account isn’t linked</h2>
    ${xUnlinkedPanel(vm, handles, handleMax)}
  </div>`
}

function xUnlinkedPanel(vm, handles, handleMax) {
  const u = vm.local.xUnlinked
  if (!u) return ''
  const room = u.canLink && handles.length < handleMax
  return `<div class="vt-xu" role="alert">
    <p class="vt-pop-body">This post was made from <b>@${esc(u.author)}</b>, but that account isn’t linked.${room ? ' Link it and this post will be checked again.' : ` You already have ${handleMax} X accounts linked — remove one without votes below, or post from a linked account.`}</p>
    <div class="vt-pop-acts">
      ${room ? `<button class="vt-pop-btn is-primary" type="button" data-vt-act="x-link-author" data-vt-author="${esc(u.author)}"${vm.local.x?.submitting ? ' disabled' : ''}>Link this account</button>` : ''}
      <button class="vt-pop-btn is-outline" type="button" data-vt-act="x-choose-other">Choose another account</button>
      <button class="vt-pop-btn is-quiet" type="button" data-vt-act="sheet-close">Cancel</button>
    </div>
  </div>`
}

export const REPLACE_STATUS = { pending: ['is-warn', 'hourglass', 'Pending approval'], approved: ['is-ok', 'check', 'Approved'], rejected: ['is-err', 'xCircle', 'Rejected'] }
export const REPLACE_REASONS = [['suspended', 'Suspended'], ['deleted', 'Deleted'], ['locked', 'Locked / can’t log in'], ['other', 'Other']]

/** Linked X accounts. One without votes can be removed; one with votes can
 *  be replaced (admin-approved) if it stopped working. */
function xAccounts(vm, handles, handleMax) {
  const locked = new Set(vm.status.xHandleLocked || [])
  const confirm = vm.local.xRemoveConfirm
  const requests = vm.status.xReplacements || []
  const pending = requests.find((r) => r.status === 'pending')
  const canRequest = !pending && (vm.status.xReplacementsLeft ?? 1) > 0
  const lockedRow = (h) => pending?.oldHandle === h
    ? `<span class="vt-xacc-lock">Replacement pending approval</span>`
    : canRequest
      ? `<span class="vt-xacc-lock">Has votes</span><button type="button" class="vt-link" data-vt-act="x-replace-open" data-vt-handle="${esc(h)}">Request replacement</button>`
      : pending ? '<span class="vt-xacc-lock">Has votes</span>' : '<span class="vt-xacc-lock">Has votes · admin only</span>'
  return `<div class="vt-xacc"><span class="vt-field-l">Your X accounts · ${handles.length}/${handleMax}</span>
    <ul class="vt-xacc-list">${handles.map((h) => `<li><b>@${esc(h)}</b>${locked.has(h)
      ? lockedRow(h)
      : `<button type="button" class="vt-link${confirm === h ? ' is-danger' : ''}" data-vt-act="x-remove-handle" data-vt-handle="${esc(h)}">${confirm === h ? 'Tap again to remove' : 'Remove'}</button>`}</li>`).join('')}</ul>
    ${handles.length < handleMax ? '<button type="button" class="vt-link" data-vt-act="x-edit-handle">Add account</button>' : ''}
    ${requests.length ? `<span class="vt-field-l">Replacement requests</span>
    <ul class="vt-xacc-list vt-xrepl-list">${requests.slice(0, 3).map((r) => {
      const [k, i, t] = REPLACE_STATUS[r.status] || REPLACE_STATUS.pending
      return `<li><span>@${esc(r.oldHandle)} → <b>@${esc(r.newHandle)}</b></span>${badge(k, i, t)}</li>`
    }).join('')}</ul>` : ''}
  </div>`
}

/** Replace an account that's suspended, deleted or locked. Votes it already
 *  earned stay; after approval it stops earning and the new one takes its slot. */
export function replaceSheetBody(vm, oldHandle) {
  const err = vm.local.error?.mission === 'x-sheet' ? note('is-err', 'xCircle', esc(vm.local.error.text)) : ''
  return `<div class="vt-form vt-xrepl" data-vt-xrepl="${esc(oldHandle)}">
      <p class="vt-rule">Use this if <b>@${esc(oldHandle)}</b> was suspended, deleted, or you can no longer get into it. Votes it already earned stay counted. Once an admin approves, the new account takes its place and <b>@${esc(oldHandle)}</b> stops earning new votes.</p>
      <fieldset class="vt-field vt-xrepl-reasons"><legend class="vt-field-l">What happened?</legend>
        ${REPLACE_REASONS.map(([v, label]) => `<label class="vt-xrepl-reason"><input type="radio" name="xr-reason" value="${v}"> ${esc(label)}</label>`).join('')}
      </fieldset>
      <label class="vt-field"><span class="vt-field-l">New X account</span>
        <span class="vt-input-wrap"><span class="vt-input-pre" aria-hidden="true">@</span><input name="xr-new" class="vt-input" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="40" value=""></span></label>
      <label class="vt-field"><span class="vt-field-l">Anything else? (optional)</span>
        <input name="xr-note" class="vt-input" maxlength="200" autocomplete="off" placeholder="e.g. suspended on Oct 15"></label>
      <p class="vt-field-h">${ic('shield')}We’ll never ask for your password, login codes or other private details.</p>
      ${err}
      <div class="vt-actions">
        <button class="vt-btn vt-btn-primary" type="button" data-vt-act="x-replace-send"${vm.local.xReplaceSending ? ' disabled' : ''}>Send request</button>
        <button class="vt-btn vt-btn-ghost" type="button" data-vt-act="x-replace-cancel">Cancel</button>
      </div>
    </div>`
}

export function linkSheet(vm) {
  const x = vm.status.campaign.missions.find((m) => m.kind === 'x_post')
  const handles = vm.status.xHandles || (vm.status.xHandle ? [vm.status.xHandle] : [])
  const handleMax = x?.maxHandles || 3
  const needHandle = x?.requireHandleMatch && !handles.length
  const replacing = vm.local.xReplace && handles.includes(vm.local.xReplace) ? vm.local.xReplace : null
  const title = replacing ? `Replace @${esc(replacing)}` : vm.local.xManage ? 'Manage X accounts' : 'Add your vote post'
  return `<div class="vt-sheet" role="dialog" aria-modal="true" aria-labelledby="vt-l-title" data-vt-sheet="link" hidden>
    <div class="vt-grabber" aria-hidden="true"></div>
    <div class="vt-sheet-h"><h2 id="vt-l-title">${title}</h2><button class="vt-icon-btn" type="button" aria-label="Close" data-vt-act="sheet-close">${ic('x')}</button></div>
    ${replacing ? replaceSheetBody(vm, replacing) : `<form class="vt-form" data-vt-form="x">
      ${needHandle || vm.local.editHandle ? `<label class="vt-field"><span class="vt-field-l">${handles.length ? 'Add another X account' : 'Your X handle'}</span>
        <span class="vt-input-wrap"><span class="vt-input-pre" aria-hidden="true">@</span><input name="handle" class="vt-input" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="16" value="" required></span>
        <span class="vt-field-h">X accounts stay linked for this event. Maximum ${handleMax}.</span></label>`
        : xAccounts(vm, handles, handleMax)}
      <label class="vt-field"><span class="vt-field-l">Post link</span>
        <input name="url" class="vt-input" type="url" inputmode="url" autocomplete="off" placeholder="https://x.com/…/status/…" required></label>
      ${vm.local.error?.mission === 'x-sheet' ? note('is-err', 'xCircle', esc(vm.local.error.text)) : ''}
      <button class="vt-btn vt-btn-primary" type="submit"${vm.local.x?.submitting ? ' disabled' : ''}>Verify post</button>
    </form>`}
  </div>`
}

/**
 * Share battle (Radix-style sheet, shared with guide/link). `vm.local.share`:
 *   { loading, error, style, styleName, styleIndex, clock, url, alt,
 *     canFiles, hold, drafts: {hooligans, aliens}, errors: {hooligans, aliens} }
 * The preview is the generated poster itself, so what you see is what goes.
 * The two team lines are editable for this share only (never sent anywhere).
 */
function lineField(s, id, label) {
  const draft = s.drafts?.[id] ?? ''
  const err = s.errors?.[id]
  return `<label class="vt-share-field${err ? ' is-err' : ''}">
      <span class="vt-share-field-l"><span>${label}</span><span class="vt-share-count" data-vt-count="${id}" aria-live="polite">${[...draft].length}/${LYRIC_MAX}</span></span>
      <input class="vt-input" type="text" data-vt-lyric="${id}" maxlength="${LYRIC_MAX}" value="${esc(draft)}" placeholder="${esc(LYRICS[id])}" autocomplete="off" enterkeyhint="done" aria-describedby="vt-lyric-err-${id}">
      <span class="vt-share-err" id="vt-lyric-err-${id}" data-vt-lyric-err="${id}">${err ? esc(LYRIC_ERRORS[err] || '') : ''}</span>
    </label>`
}

export function shareSheet(vm) {
  const s = vm.local.share || {}
  const ready = !s.loading && !s.error && s.url
  const preview = s.error
    ? `<div class="vt-share-ph">${note('is-err', 'xCircle', "Couldn't load the battle score. Try again.")}</div>`
    : ready ? `<img class="vt-share-img" src="${esc(s.url)}" alt="${esc(s.alt || 'MAMA Battle poster')}">`
      : `<div class="vt-share-ph" role="status">${ic('loader', 'vt-spin')}</div>`
  const off = ready ? '' : ' disabled'
  return `<div class="vt-sheet vt-share" role="dialog" aria-modal="true" aria-labelledby="vt-s-title" data-vt-sheet="share" hidden>
    <div class="vt-grabber" aria-hidden="true"></div>
    <div class="vt-sheet-h"><h2 id="vt-s-title">Share battle</h2><button class="vt-icon-btn" type="button" aria-label="Close" data-vt-act="sheet-close">${ic('x')}</button></div>
    <p class="vt-sheet-desc">A snapshot of the score${s.clock ? ` at ${esc(s.clock)} KST` : ''}. The link always shows the live score.</p>
    ${ready && !s.canFiles ? `<p class="vt-share-note">${ic('info')}Image sharing isn’t available in this browser.</p>` : ''}
    ${s.hold && ready
      ? `<div class="vt-share-hold"><img class="vt-share-img" src="${esc(s.url)}" alt="${esc(s.alt || 'MAMA Battle poster')}"><p class="vt-share-note">Press and hold the poster to save it.</p></div>`
      : `<div class="vt-share-prev">${preview}</div>`}
    ${ready ? `<p class="vt-share-style"><b>${esc(s.styleName)}</b><span>Style ${s.styleIndex} of 3</span></p>
    <div class="vt-share-lines">
      ${lineField(s, 'hooligans', 'HOOLIGANS line')}
      ${lineField(s, 'aliens', 'ALIENS line')}
      <button class="vt-link vt-share-reset" type="button" data-vt-act="share-lines-reset">Reset to default</button>
    </div>` : ''}
    <div class="vt-share-acts">
      <button class="vt-btn vt-btn-primary" type="button" data-vt-act="share-go"${off}>${ic('share')}${s.canFiles ? 'Share poster' : 'Share link'}</button>
      <button class="vt-btn vt-btn-outline" type="button" data-vt-act="share-style"${off}>${ic('shuffle')}Try another style</button>
      <div class="vt-share-row">
        <button class="vt-btn vt-btn-outline" type="button" data-vt-act="share-save"${off}>${ic('download')}Save poster</button>
        <button class="vt-btn vt-btn-outline" type="button" data-vt-act="share-link">${ic('link')}Copy link</button>
        <button class="vt-btn vt-btn-outline" type="button" data-vt-act="share-text"${s.error ? ' disabled' : off}>${ic('copy')}Copy text</button>
      </div>
    </div>
  </div>`
}

// ── Whole screen ─────────────────────────────────────────────────────

export function votingScreen(vm) {
  return vm.status.battle ? hubScreen(vm) : votingOnly(vm)
}

function sheets(vm) {
  return `<div class="vt-scrim" data-vt-act="sheet-close" hidden></div>
    ${guideSheet(vm)}
    ${linkSheet(vm)}
    ${xUnlinkedSheet(vm)}
    ${vm.status.battle ? shareSheet(vm) : ''}
    ${teamChooser(vm)}`
}

/** The Voting tab's content: today's missions and everything personal. */
function votingContent(vm) {
  const ms = vm.status.campaign.missions
  return `${todayProgress(vm)}
      <section aria-labelledby="vt-h-missions">
        <div class="vt-sec-h"><h2 id="vt-h-missions">Today's missions</h2><span class="vt-aside vt-mono">${esc(dayLabel(vm.status.today))} KST</span></div>
        <div class="vt-missions">${ms.map((m) => (m.kind === 'x_post' ? xCard(vm, m) : mnetCard(vm, m))).join('')}</div>
      </section>
      ${votingGift(vm)}
      ${stats(vm)}
      ${activity(vm)}
      ${guideButton()}
      <p class="vt-foot">Unofficial fan project. Votes are cast on Mnet and X — ReConnect only records your proof.</p>`
}

/** No battle configured: the single Voting page, as before the hub. */
function votingOnly(vm) {
  const ms = vm.status.campaign.missions
  return `<header class="vt-appbar">
      <button class="vt-icon-btn" type="button" aria-label="Back to City" data-vt-act="back">${ic('back')}</button>
      <div class="vt-appbar-title">Voting</div>
      <button class="vt-icon-btn" type="button" aria-label="Voting guide" data-vt-act="guide-open" aria-haspopup="dialog">${ic('book')}</button>
    </header>
    <main class="vt-page">
      ${header(vm)}
      ${todayProgress(vm)}
      <section aria-labelledby="vt-h-missions">
        <div class="vt-sec-h"><h2 id="vt-h-missions">Today's missions</h2><span class="vt-aside vt-mono">${esc(dayLabel(vm.status.today))} KST</span></div>
        <div class="vt-missions">${ms.map((m) => (m.kind === 'x_post' ? xCard(vm, m) : mnetCard(vm, m))).join('')}</div>
      </section>
      ${pulse(vm)}
      ${stats(vm)}
      ${votingGift(vm)}
      ${activity(vm)}
      ${guideButton()}
      <p class="vt-foot">Unofficial fan project. Votes are cast on Mnet and X — ReConnect only records your proof.</p>
    </main>
    ${sheets(vm)}`
}

/**
 * The MAMA Event Hub: a live score strip, then Battle | Team | Chat | Voting.
 * All four panels are in the page and only one is shown, so switching tabs
 * never repaints (a half-typed message or X link survives). vm.hub holds
 * Team and Chat data ({ loading } until the first answer).
 */
function hubScreen(vm) {
  const b = vm.status.battle
  const c = vm.status.campaign
  const tab = vm.local.tab || 'voting'
  const hub = vm.local.hub || {}
  const labels = Object.fromEntries(b.teams.map((t) => [t.id, t.label]))
  const progress = Object.values(vm.status.todayProgress || {})
  const done = progress.reduce((n, p) => n + (p.verified || 0), 0)
  const total = progress.reduce((n, p) => n + (p.max || 0), 0)
  const panel = (id, body) => `<div class="vt-panel" role="tabpanel" id="vt-panel-${id}" aria-labelledby="vt-tab-${id}" data-vt-panel="${id}"${tab === id ? '' : ' hidden'}>${body}</div>`
  const chat = vm.hub?.chat
  const selected = chat?.messages?.find((m) => m.id === hub.selId) || null
  return `<header class="vt-ev">
      <div class="vt-ev-top">
        <button class="vt-ev-btn" type="button" aria-label="Back to City" data-vt-act="back">${ic('back')}</button>
        <h1 class="vt-ev-name">${esc(c.title)}</h1>
        <span class="vt-ev-round">${esc(c.roundLabel || '')}</span>
        <button class="vt-ev-btn vt-ev-guide" type="button" aria-label="Voting guide" data-vt-act="guide-open" aria-haspopup="dialog">${ic('book')}</button>
      </div>
      ${liveStrip(b, vm.now, { score: tab !== 'battle' })}
      ${hubTabs(tab, { done, total })}
    </header>
    <main class="vt-page vt-hub-page" data-vt-tab-now="${tab}">
      ${panel('battle', `${battle(vm)}${momentsCard(chat?.moments || [], labels)}${battleGifts(vm)}${pulse(vm)}`)}
      ${panel('team', teamPanel(vm.hub?.team, { labels, max: total || 6 }))}
      ${panel('voting', votingContent(vm))}
    </main>
    ${chatFab(hub)}
    ${sheets(vm)}
    ${chatSheet(chat, hub, labels, vm.now)}
    ${chatMessageSheet(selected, labels)}
    ${chatReportSheet(hub.reportId ? chat?.messages?.find((m) => m.id === hub.reportId) : null, labels)}
    ${chatMutedSheet(chat?.muted)}`
}

/** The City result line for a finished battle. */
export function cityResultText(b) {
  if (!b?.winners?.length) return null
  if (b.winners.length > 1) return 'Battle Draw'
  const w = b.teams.find((t) => t.id === b.winners[0])
  return w ? `${w.label} WIN` : null
}

/**
 * City screen banner, from the cheap game-state summary (state.voting).
 * Compact: one card, two rows. States: live with no team, live with a team
 * (leading / behind / tied), voting closed and verifying, final result.
 */
export function votingEventCard(v, now = new Date()) {
  if (!v) return ''
  const b = v.battle
  const vs = b ? b.teams.map((t) => esc(t.label)).join(' vs ') : esc(v.roundLabel || '')
  const score = b ? `<span class="vt-city-score">${b.teams.map((t) => `<span${b.myTeam === t.id ? ' class="is-mine"' : ''}>${esc(t.label)} <b>${fmtCount(t.points)}</b></span>`).join('<i aria-hidden="true">·</i>')}</span>` : ''
  let status
  let cta
  let state
  if (v.phase === 'final' && cityResultText(b)) {
    state = 'final'
    status = `<b class="vt-city-result">${esc(cityResultText(b))}</b> · final score`
    cta = 'See result'
  } else if (v.phase === 'verifying' || v.phase === 'final') {
    state = 'verifying'
    status = 'Voting closed · Final result after verification'
    cta = 'Open MAMA Battle'
  } else if (b && !b.myTeam) {
    state = 'no-team'
    status = `Pick your side to join the battle · ${esc(timeLeftText(v.closesAt, now))}`
    cta = 'Choose your team'
  } else {
    state = 'live'
    const line = b ? battleLine({ ...b, frozen: false }) : ''
    const today = v.done < v.total ? `${v.done}/${v.total} votes verified today` : "Today's votes done"
    const next = b ? nextMilestone(b) : null
    const nextGift = next ? `Next Gift ${fmtCount(next.target)}` : b?.milestones?.length ? 'All Battle Gifts unlocked' : ''
    status = [line, today, nextGift, timeLeftText(v.closesAt, now)].filter(Boolean).map(esc).join(' · ')
    cta = b ? 'Open MAMA Battle' : 'Vote now'
  }
  return `<button class="vt-entry vt-city" type="button" data-vt-open data-vt-city="${state}">
    <span class="vt-city-top">
      <span class="vt-entry-ico">${ic('swords')}</span>
      <span class="vt-entry-txt"><span class="vt-entry-t">${esc(v.title)} <span class="vt-city-vs">${vs}</span></span>${score}</span>
    </span>
    <span class="vt-city-bottom"><span class="vt-entry-s">${status}</span><span class="vt-city-cta">${esc(cta)}${ic('chevR')}</span></span>
  </button>`
}
