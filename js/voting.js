// Voting screen (MAMA 2026 first) — events and data only. Markup lives in
// voting-view.js; proof handling in voting-proof.js; every decision that
// counts is made by the server (supabase/functions/op-reconnect/lib/
// vote-campaign-service.js).
import { call } from './api.js'
import { getAgentNo } from './session.js'
import { goWorld } from './router.js'
import { setState, toast } from './state.js'
import { votingScreen, errorText, countdown, MNET_FAST_MS, MNET_CHECKING_MS } from './voting-view.js'
import { nextKstMidnight } from '../supabase/functions/op-reconnect/lib/vote-campaign-rules.js'
import { sha256OfBlob, reencodeImage, blobToBase64, ocrCertificate } from './voting-proof.js'
import { battleView, pickStyle, nextStyle, shareText, STYLES, STYLE_NAMES, BATTLE_URL } from './battle-share-rules.js'
import { posterFile, canShareFiles, sharePoster, shareLink, copyText, savePoster } from './battle-share-flow.js'
import { checkLyric, LYRIC_MAX, LYRIC_ERRORS } from './battle-lyric-filter.js'
import { trackEngagement } from './engagement.js'
import { chatFeed, chatErrorText } from './battle-hub-view.js'
import { checkChatText, CHAT_MAX } from '../supabase/functions/op-reconnect/lib/battle-text-filter.js'

const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
const PRECHECK_TIMEOUT_MS = 15_000

let root = null
let status = null
let local = freshLocal()
let openSheet = null
let lastFocus = null
let ticker = null

let chooserTimer = null
let proofPoll = null
// MAMA Event Hub data (Team roster, Chat feed), kept apart from `status`.
let hubData = { team: { loading: true }, chat: { loading: true } }
let hubTimer = null
let hubTicks = 0

function freshLocal() {
  return {
    mnet: {}, x: {}, error: null, editHandle: false,
    giftBusy: false, giftReveal: null, giftRequest: null,
    battleBusy: false, battleReveal: null, battleRequests: {},
    winnerReveal: null, winnerRequest: null,
    chooser: null,
    share: null,
    tab: null,
    hub: { chatOpen: false, draft: '', replyTo: null, selId: null, reportId: null, waitUntil: 0, error: null, sending: false, unread: false },
  }
}

export function renderVoting(container) {
  // The 90-second game-state poll re-runs every screen's render; this one
  // keeps its own data, so a repaint in place would only lose an open sheet
  // or a half-typed link.
  if (root && root.isConnected && container.contains(root)) return
  container.innerHTML = ''
  root = document.createElement('div')
  root.className = 'vt-screen'
  root.innerHTML = '<div class="vt-loading" role="status">Loading voting…</div>'
  container.appendChild(root)
  root.addEventListener('click', onClick)
  root.addEventListener('change', onChange)
  root.addEventListener('submit', onSubmit)
  root.addEventListener('keydown', onKeydown)
  root.addEventListener('input', (e) => {
    if (e.target.matches?.('[data-vt-lyric]')) onLineInput(e.target)
    else if (e.target.matches?.('[data-vt-chat-input]')) onChatInput(e.target)
  })
  local = freshLocal()
  openSheet = null
  hubData = { team: { loading: true }, chat: { loading: true } }
  load()
}

async function load() {
  const r = await call('getVotingStatus', { agentNo: getAgentNo() })
  if (!root?.isConnected) return
  if (!r?.success) {
    root.innerHTML = `<div class="vt-loading" role="status">${r?.error === 'no_campaign' ? 'There is no voting right now.' : "Voting couldn't load. Pull to refresh or try again shortly."}</div>`
    return
  }
  status = r
  if (votedFlag()) local.mnet.voted = true
  if (composedFlag()) local.x.composed = true
  if (status.battle && !local.tab) local.tab = firstTab()
  paint()
  if (status.battle) startHub()
  // First visit once the battle is on and this agent has no side yet: the
  // 7-second choice. The server holds the clock and makes the timeout pick.
  if (status.battle && !status.battle.myTeam && status.campaign.phase === 'open' && !local.chooser) startChooser()
  scheduleProofPoll()
}

// While a proof is being verified (automatically, in the background), keep
// this screen's status current: every 10 s in the first minutes after an
// upload, then once a minute. Repaints only when something changed, so a
// half-typed X link survives the quiet polls.
const POLL_FAST_MS = 10_000
const POLL_SLOW_MS = 60_000
const sentWithin = (ms) => !!local.mnet.sentAt && Date.now() - local.mnet.sentAt < ms
const isFresh = () => sentWithin(MNET_FAST_MS)

function scheduleProofPoll() {
  clearTimeout(proofPoll)
  if (!root?.isConnected || !status) return
  if (!Object.values(status.states || {}).includes('verifying')) return
  proofPoll = setTimeout(pollProofs, isFresh() ? POLL_FAST_MS : POLL_SLOW_MS)
}

async function pollProofs() {
  if (!root?.isConnected) return
  const wasChecking = sentWithin(MNET_CHECKING_MS)
  const r = await call('getVotingStatus', { agentNo: getAgentNo() })
  if (!root?.isConnected) return
  if (r?.success) {
    const key = (s) => JSON.stringify([s.states, s.todayProgress, s.notices])
    const changed = key(r) !== key(status)
    const credited = (r.stats?.verifiedVotes || 0) > (status.stats?.verifiedVotes || 0)
    status = r
    // Repaint on a real change, or once when "Checking your certificate…"
    // becomes "Still checking".
    if (changed || (wasChecking && !sentWithin(MNET_CHECKING_MS))) paint()
    if (credited) refreshGameState() // XP, Charge Cells and the HUD
  }
  scheduleProofPoll()
}

async function refreshGameState() {
  const fresh = await call('getGameState', { agentNo: getAgentNo() })
  if (fresh?.success) setState(fresh)
}

// "I've voted" is the player's own note, kept on this device for today only.
function votedKey() { return `vt:voted:${status.campaign.id}:${status.today}` }
function votedFlag() { try { return localStorage.getItem(votedKey()) === '1' } catch { return false } }
function setVoted() { try { localStorage.setItem(votedKey(), '1') } catch { /* private mode: in-memory only */ } }
function composedKey() { return `vt:posted:${status.campaign.id}:${status.today}` }
function composedFlag() { try { return localStorage.getItem(composedKey()) === '1' } catch { return false } }
function setComposed() { try { localStorage.setItem(composedKey(), '1') } catch { /* in-memory only */ } }

// ── Team chooser ─────────────────────────────────────────────────────

async function startChooser() {
  const r = await call('startVotingTeamChoice', { agentNo: getAgentNo(), campaignId: status.campaign.id })
  if (!r?.success || !root?.isConnected) return
  if (r.team) { finishChooser(r.team, r.via); return }
  local.chooser = { secondsLeft: r.secondsLeft, picked: null, result: null }
  paint()
  root.querySelector('[data-vt-act="team-pick"]')?.focus()
  clearInterval(chooserTimer)
  chooserTimer = setInterval(async () => {
    if (!root?.isConnected) { clearInterval(chooserTimer); return }
    if (!local.chooser || local.chooser.picked || local.chooser.result) return
    local.chooser.secondsLeft -= 1
    const num = root.querySelector('.vt-chooser-num')
    if (num) num.textContent = String(Math.max(0, local.chooser.secondsLeft))
    if (local.chooser.secondsLeft <= 0) {
      clearInterval(chooserTimer)
      // Past the server's window (+ its 2s grace), asking again returns
      // the server's own assignment.
      setTimeout(async () => {
        const t = await call('startVotingTeamChoice', { agentNo: getAgentNo(), campaignId: status.campaign.id })
        if (t?.team) finishChooser(t.team, t.via)
      }, 2600)
    }
  }, 1000)
}

async function pickTeam(team) {
  if (!local.chooser || local.chooser.picked) return
  local.chooser.picked = team
  paint()
  const r = await call('chooseVotingTeam', { agentNo: getAgentNo(), campaignId: status.campaign.id, team })
  clearInterval(chooserTimer)
  if (r?.team) finishChooser(r.team, r.via)
  else { local.chooser.picked = null; paint() }
}

function finishChooser(team, via) {
  local.chooser = { result: team, via }
  if (status.battle) status.battle.myTeam = team
  // Team and Chat open up now that there's a side.
  hubData = { team: { loading: true }, chat: { loading: true } }
  loadTeam()
  loadChat()
  paint()
  root.querySelector('[data-vt-act="chooser-done"]')?.focus()
}

function paint() {
  if (!root?.isConnected || !status) return
  const sheet = openSheet
  // A repaint keeps Chat as it was: the caret in a half-typed message, and
  // the list scrolled where the player left it (or pinned to the newest).
  const input = root.querySelector('[data-vt-chat-input]')
  const caret = input && document.activeElement === input ? [input.selectionStart, input.selectionEnd] : null
  const pos = feedPosition()
  root.innerHTML = votingScreen({ status, local, now: new Date(), hub: hubData })
  if (sheet) {
    // A message's options or the report form sit on top of the open Chat.
    if (sheet !== 'chat' && sheet.startsWith('chat') && local.hub.chatOpen) showSheet('chat', false)
    showSheet(sheet, false)
  }
  // The team chooser is modal: nothing behind it is reachable while open.
  if (local.chooser) for (const n of root.querySelectorAll(BEHIND)) n.inert = true
  restoreFeed(pos)
  if (caret) {
    const again = root.querySelector('[data-vt-chat-input]')
    again?.focus()
    again?.setSelectionRange(caret[0], caret[1])
  }
  startTicker()
}

// Everything a sheet or the chooser makes unreachable.
const BEHIND = '.vt-appbar, .vt-ev, .vt-page, .vt-chat-fab'

function startTicker() {
  clearInterval(ticker)
  ticker = setInterval(() => {
    if (!root?.isConnected) { clearInterval(ticker); return }
    const left = nextKstMidnight().getTime() - Date.now()
    const span = root.querySelector('[data-vt-reset]')
    if (span) span.textContent = countdown(left)
    tickSlowMode()
    // A new KST day: today's missions start over.
    if (status && new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10) !== status.today) {
      clearInterval(ticker)
      local = freshLocal()
      load()
    }
  }, 1000)
}

// ── Share battle ──────────────────────────────────────────────────────
// One snapshot of the public battle summary per opening of the sheet; the
// poster styles and the two team lines only redraw that snapshot. Nothing
// here writes battle data, the team lines never leave this sheet, and the
// only link shared is the public /battle page.

const LINE_REDRAW_MS = 120
// { view, text, lines, drafts, errors, posters: Map(key → { blob, url }) }
let shareSnap = null
let lineTimer = null

const posterKey = (style, lines) => `${style}|${lines.hooligans}|${lines.aliens}`

// Private usage counts (rc_engagement_events, 'battle_share'): which action
// ran, the style, and how it ended. Fixed words only — never the team lines.
const trackShare = (action, extra = {}) =>
  trackEngagement('battle_share', { screen: 'voting', metadata: { action, style: local.share?.style, ...extra } })

function releaseShare() {
  clearTimeout(lineTimer)
  for (const p of shareSnap?.posters.values() || []) URL.revokeObjectURL(p.url)
  shareSnap = null
  local.share = null
}

async function openShare() {
  releaseShare()
  local.share = { loading: true }
  paint()
  showSheet('share')
  const r = await call('getPublicBattle')
  if (!root?.isConnected || openSheet !== 'share') return
  if (!r?.success) { local.share = { error: true }; paint(); return }
  const view = battleView(r, new Date())
  shareSnap = {
    view, text: shareText(view), posters: new Map(),
    lines: { hooligans: '', aliens: '' }, drafts: { hooligans: '', aliens: '' }, errors: {},
  }
  const first = pickStyle(view)
  trackEngagement('battle_share', { screen: 'voting', metadata: { action: 'opened', style: first } })
  showStyle(first)
}

/** The poster for a style + the current team lines (drawn once, then cached). */
async function posterFor(snap, style) {
  const key = posterKey(style, snap.lines)
  let p = snap.posters.get(key)
  if (!p) {
    const { renderPoster } = await import('./battle-poster-render.js')
    const blob = await renderPoster(style, snap.view, snap.lines)
    p = { blob, url: URL.createObjectURL(blob) }
    snap.posters.set(key, p)
  }
  return p
}

async function showStyle(style, focusStyle = false) {
  const snap = shareSnap
  if (!snap) return
  let p
  try { p = await posterFor(snap, style) } catch {
    if (snap === shareSnap) { local.share = { error: true }; paint() }
    return
  }
  if (snap !== shareSnap || openSheet !== 'share') return
  const v = snap.view
  local.share = {
    style, styleName: STYLE_NAMES[style], styleIndex: STYLES.indexOf(style) + 1, clock: v.clock, url: p.url, key: posterKey(style, snap.lines),
    alt: `MAMA Battle poster: ${v.h.label} ${v.h.points}, ${v.a.label} ${v.a.points}. ${v.gapLine}.`,
    canFiles: canShareFiles(posterFile(p.blob)), hold: false, drafts: snap.drafts, errors: snap.errors,
  }
  paint()
  if (focusStyle) root.querySelector('[data-vt-act="share-style"]')?.focus()
}

/** Typing in a team line: counter and error update in place (no repaint, so
 *  the caret stays put); a valid line redraws just the preview image. */
function onLineInput(input) {
  const snap = shareSnap
  const id = input.dataset.vtLyric
  if (!snap || !local.share?.style || !(id in snap.lines)) return
  snap.drafts[id] = input.value
  const r = checkLyric(input.value)
  snap.errors[id] = r.ok ? null : r.reason
  const count = root.querySelector(`[data-vt-count="${id}"]`)
  if (count) count.textContent = `${[...input.value].length}/${LYRIC_MAX}`
  const err = root.querySelector(`[data-vt-lyric-err="${id}"]`)
  if (err) err.textContent = r.ok ? '' : LYRIC_ERRORS[r.reason]
  input.closest('.vt-share-field')?.classList.toggle('is-err', !r.ok)
  if (!r.ok || snap.lines[id] === r.value) return
  snap.lines[id] = r.value // '' → the default line
  clearTimeout(lineTimer)
  lineTimer = setTimeout(() => redrawPreview(snap), LINE_REDRAW_MS)
}

async function redrawPreview(snap) {
  const style = local.share?.style
  if (!style) return
  let p
  try { p = await posterFor(snap, style) } catch { return }
  if (snap !== shareSnap || openSheet !== 'share' || local.share?.style !== style) return
  local.share.url = p.url
  local.share.key = posterKey(style, snap.lines)
  local.share.canFiles = canShareFiles(posterFile(p.blob))
  const img = root.querySelector('.vt-share-img')
  if (img) img.src = p.url
}

function resetLines() {
  if (!shareSnap) return
  shareSnap.lines = { hooligans: '', aliens: '' }
  shareSnap.drafts = { hooligans: '', aliens: '' }
  shareSnap.errors = {}
  if (local.share?.style) showStyle(local.share.style)
}

const currentPoster = () => shareSnap?.posters.get(local.share?.key)

async function shareGo() {
  const p = currentPoster()
  if (!p) return
  if (local.share.canFiles) {
    const r = await sharePoster(posterFile(p.blob), shareSnap.text)
    trackShare('share_poster', { outcome: r })
    if (r === 'shared') toast('Text copied')
    if (r !== 'failed') return
  }
  // No image sharing here (or it just failed): the link still goes.
  const r = await shareLink(shareSnap.text)
  trackShare('share_link', { outcome: r })
  if (r === 'copied') toast('Link copied')
}

function shareSave() {
  const p = currentPoster()
  if (!p) return
  const r = savePoster(p.url)
  trackShare('save', { outcome: r })
  if (r === 'hold') { local.share.hold = true; paint() }
}

// ── Sheets (Radix Dialog behaviour: modal, focus in, Escape, focus back) ──

function showSheet(name, moveFocus = true) {
  const sheet = root.querySelector(`[data-vt-sheet="${name}"]`)
  if (!sheet) return
  if (moveFocus) lastFocus = document.activeElement
  openSheet = name
  root.querySelector('.vt-scrim').hidden = false
  sheet.hidden = false
  root.classList.add('has-sheet')
  for (const n of root.querySelectorAll(BEHIND)) n.inert = true
  requestAnimationFrame(() => sheet.classList.add('is-open'))
  if (moveFocus) (sheet.querySelector('input, summary, button:not([data-vt-act="sheet-close"])') || sheet).focus()
}

function closeSheet() {
  if (!openSheet) return
  const closing = openSheet
  const sheet = root.querySelector(`[data-vt-sheet="${openSheet}"]`)
  if (openSheet === 'share') releaseShare()
  openSheet = null
  local.editHandle = false
  local.xUnlinked = null
  local.xRemoveConfirm = null
  if (local.error?.mission === 'x-sheet') local.error = null
  sheet?.classList.remove('is-open')
  if (sheet) sheet.hidden = true
  root.querySelector('.vt-scrim').hidden = true
  root.classList.remove('has-sheet')
  for (const n of root.querySelectorAll(BEHIND)) n.inert = false
  if (closing === 'chat') { local.hub.chatOpen = false; scheduleHub() }
  // Closing a message's options (or the report form) goes back to Chat.
  else if (closing.startsWith('chat') && local.hub.chatOpen) { showSheet('chat', false); return }
  if (lastFocus?.isConnected) lastFocus.focus()
}

function onKeydown(e) {
  // Tabs: arrow keys move between them (WAI-ARIA tabs pattern).
  if (!openSheet && e.target.matches?.('.vt-tab') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
    const tabs = [...root.querySelectorAll('.vt-tab')]
    const i = tabs.indexOf(e.target)
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    e.preventDefault()
    switchTab(tabs[j].dataset.vtTab)
    tabs[j].focus()
    return
  }
  if (!openSheet) return
  if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return }
  if (e.key === 'Enter' && e.target.matches?.('[data-vt-lyric]')) { e.preventDefault(); e.target.blur(); return }
  if (e.key !== 'Tab') return
  const sheet = root.querySelector(`[data-vt-sheet="${openSheet}"]`)
  const items = [...sheet.querySelectorAll('button, summary, input, a[href]')].filter((n) => !n.disabled)
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}

// ── Events ────────────────────────────────────────────────────────────

function onClick(e) {
  const copy = e.target.closest('[data-vt-copy]')
  if (copy) {
    navigator.clipboard?.writeText(copy.dataset.vtCopy).then(() => toast('Copied'), () => toast(copy.dataset.vtCopy))
    return
  }
  const t = e.target.closest('[data-vt-act]')
  if (!t) return
  if (t.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return }
  const act = t.dataset.vtAct
  if (act === 'back') goWorld()
  else if (act === 'guide-open') showSheet('guide')
  else if (act === 'sheet-close') closeSheet()
  else if (act === 'mnet-vote') { setVoted(); local.mnet.voted = true; setTimeout(paint, 400) }
  else if (act === 'mnet-voted') { setVoted(); local.mnet.voted = true; local.error = null; paint() }
  else if (act === 'mnet-pick') root.querySelector('[data-vt-act="mnet-file"]')?.click()
  else if (act === 'mnet-small-continue') { const f = local.mnet.smallFile; local.mnet.smallWarn = false; local.mnet.smallFile = null; if (f) sendCertificate(f, { force: true }) }
  else if (act === 'mnet-small-cancel') { local.mnet.smallWarn = false; local.mnet.smallFile = null; paint(); root.querySelector('[data-vt-act="mnet-file"]')?.click() }
  else if (act === 'x-link-author') linkAuthor(t.dataset.vtAuthor)
  else if (act === 'x-choose-other') chooseOtherPost()
  else if (act === 'x-manage') { local.error = null; local.xUnlinked = null; paint(); showSheet('link') }
  else if (act === 'x-remove-handle') removeHandle(t.dataset.vtHandle)
  else if (act === 'x-link') { local.error = null; paint(); showSheet('link') }
  else if (act === 'x-edit-handle') { local.editHandle = true; paint(); root.querySelector('input[name="handle"]')?.focus() }
  else if (act === 'gift-open') openGift()
  else if (act === 'x-compose') { setComposed(); local.x.composed = true; setTimeout(paint, 400) }
  else if (act === 'team-pick') pickTeam(t.dataset.vtTeam)
  else if (act === 'chooser-done') { local.chooser = null; load() }
  else if (act === 'battle-claim') claimBattle(Number(t.dataset.vtIndex))
  else if (act === 'winner-claim') claimWinner()
  else if (act === 'battle-share') openShare()
  else if (act === 'share-style' && local.share?.style) { const next = nextStyle(local.share.style); trackShare('try_style', { style: next }); showStyle(next, true) }
  else if (act === 'share-go') shareGo()
  else if (act === 'share-save') shareSave()
  else if (act === 'share-link') copyText(BATTLE_URL).then((ok) => { trackShare('copy_link', { outcome: ok ? 'copied' : 'failed' }); toast(ok ? 'Link copied' : BATTLE_URL) })
  else if (act === 'share-lines-reset') resetLines()
  else if (act === 'share-text' && shareSnap) copyText(shareSnap.text).then((ok) => { trackShare('copy_text', { outcome: ok ? 'copied' : 'failed' }); if (ok) toast('Text copied') })
  else if (act === 'hub-tab') switchTab(t.dataset.vtTab)
  else if (act === 'team-choose') startChooser()
  else if (act === 'team-retry') { hubData.team = { loading: true }; paint(); loadTeam() }
  else if (act === 'chat-retry') { hubData.chat = { loading: true }; paint(); loadChat() }
  else if (act === 'chat-more') openMessage(Number(t.dataset.vtId))
  else if (act === 'chat-react') reactTo(Number(t.dataset.vtId), t.dataset.vtEmoji)
  else if (act === 'chat-reply') replyTo(Number(t.dataset.vtId))
  else if (act === 'chat-reply-cancel') { local.hub.replyTo = null; paint(); root.querySelector('[data-vt-chat-input]')?.focus() }
  else if (act === 'chat-mute') muteMember(t.dataset.vtKey, true)
  else if (act === 'chat-unmute') muteMember(t.dataset.vtKey, false)
  else if (act === 'chat-report-open') openReport(Number(t.dataset.vtId))
  else if (act === 'chat-muted') showSheet('chat-muted')
  else if (act === 'chat-open') openChat()
}

function onChange(e) {
  if (e.target.matches('[data-vt-act="mnet-file"]') && e.target.files?.[0]) sendCertificate(e.target.files[0])
}

function onSubmit(e) {
  if (e.target.matches('[data-vt-form="chat"]')) { e.preventDefault(); sendChat(); return }
  if (e.target.matches('[data-vt-form="chat-report"]')) {
    e.preventDefault()
    sendReport(Number(e.target.dataset.vtId), new FormData(e.target).get('reason'))
    return
  }
  if (!e.target.matches('[data-vt-form="x"]')) return
  e.preventDefault()
  const form = new FormData(e.target)
  sendXPost(form.get('url'), form.has('handle') ? form.get('handle') : null)
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])
}

// Under this width the certificate's small print usually can't be read.
const SMALL_IMAGE_PX = 500

async function imageWidth(file) {
  try {
    const bmp = await createImageBitmap(file)
    const w = bmp.width
    bmp.close?.()
    return w
  } catch {
    return null
  }
}

async function sendCertificate(file, { force = false } = {}) {
  const mission = status.campaign.missions.find((m) => m.kind === 'mnet_certificate')
  local.error = null
  if (!/^image\/(png|jpeg)$/.test(file.type)) { local.error = { mission: mission.id, text: errorText('bad_image_type') }; paint(); return }
  if (file.size > MAX_ORIGINAL_BYTES) { local.error = { mission: mission.id, text: errorText('image_too_large') }; paint(); return }
  // A forwarded or cropped thumbnail: offer the original first. Never a block.
  if (!force) {
    const w = await imageWidth(file)
    if (w && w < SMALL_IMAGE_PX) { local.mnet.smallWarn = true; local.mnet.smallFile = file; paint(); return }
  }
  local.mnet.smallWarn = false
  local.mnet.smallFile = null
  local.mnet.uploading = true
  paint()
  try {
    const originalHash = await sha256OfBlob(file) // before anything changes the bytes
    const clean = await reencodeImage(file) // EXIF and location are gone from here on
    if (clean.size > MAX_UPLOAD_BYTES) throw Object.assign(new Error('too_large'), { code: 'image_too_large' })
    // Mnet prints the participation time on this phone's clock, so the
    // offset goes with the proof (the server keeps only a valid offset).
    const utcOffsetMinutes = -new Date().getTimezoneOffset()
    // Friendly pre-check only. A slow or failed read never blocks sending.
    let clientChecks = {}
    try {
      clientChecks = await withTimeout(ocrCertificate(clean, mission, status.today,
        { opensAt: status.campaign.opensAt, closesAt: status.campaign.closesAt, utcOffsetMinutes, submittedAt: new Date().toISOString() }), PRECHECK_TIMEOUT_MS)
      local.mnet.precheck = clientChecks
    } catch { /* the server decides regardless */ }
    const r = await call('submitMnetProof', {
      agentNo: getAgentNo(), campaignId: status.campaign.id, missionId: mission.id,
      imageBase64: await blobToBase64(clean), imageMime: 'image/jpeg', originalHash, clientChecks, utcOffsetMinutes,
    })
    local.mnet.uploading = false
    if (r?.error === 'team_required') { local.error = { mission: mission.id, text: errorText(r.error) }; paint(); startChooser(); return }
    // The same screenshot again is a confirmed duplicate: say so in plain words.
    if (!r?.success) { local.error = { mission: mission.id, text: errorText(r?.error === 'duplicate_proof' ? 'duplicate_certificate' : r?.error) }; paint(); return }
    toast('Certificate received')
    local.mnet.sentAt = Date.now()
    await load()
    refreshGameState()
  } catch (err) {
    local.mnet.uploading = false
    local.error = { mission: mission.id, text: errorText(err?.code || 'upload_failed') }
    paint()
  }
}

async function sendXPost(url, handle) {
  const mission = status.campaign.missions.find((m) => m.kind === 'x_post')
  local.error = null
  local.x.submitting = true
  paint()
  showSheet('link', false)
  try {
    if (handle !== null) {
      const h = await call('setXHandle', { agentNo: getAgentNo(), campaignId: status.campaign.id, xHandle: handle })
      if (!h?.success) throw Object.assign(new Error(h?.error), { code: h?.error })
      status.xHandle = h.xHandle
      status.xHandles = [...new Set([...(status.xHandles || []), h.xHandle])]
      status.xHandleLinked = !!h.xHandle
      local.editHandle = false
    }
    const r = await call('submitXProof', { agentNo: getAgentNo(), campaignId: status.campaign.id, missionId: mission.id, postUrl: url })
    if (r?.error === 'team_required') { closeSheet(); startChooser() }
    if (r?.error === 'x_account_not_linked') {
      local.x.submitting = false
      local.xUnlinked = { author: r.author, canLink: !!r.canLink, url }
      paint()
      showSheet('link', false)
      return
    }
    // The same post id already used — by this agent or another.
    if (r?.error === 'duplicate_proof') throw Object.assign(new Error('x_duplicate_post'), { code: 'x_duplicate_post' })
    if (!r?.success) throw Object.assign(new Error(r?.error), { code: r?.error, extra: r })
    local.xUnlinked = null
    local.x.submitting = false
    closeSheet()
    toast(r.status === 'verified' ? 'X vote verified' : 'Sent for review')
    await load()
    refreshGameState()
  } catch (err) {
    local.x.submitting = false
    local.error = { mission: 'x-sheet', text: errorText(err?.code, err?.extra || {}) }
    paint()
    showSheet('link', false)
  }
}

async function openGift() {
  local.giftBusy = true
  local.error = null
  local.giftReveal = null
  paint()
  // One id per tap until it succeeds, so a retry after a dropped
  // connection replays the same open instead of making a second one.
  local.giftRequest = local.giftRequest || crypto.randomUUID()
  const r = await call('openVotingGift', { agentNo: getAgentNo(), campaignId: status.campaign.id, requestId: local.giftRequest })
  local.giftBusy = false
  if (!r?.success) { local.error = { mission: 'gift', text: errorText(r?.error) }; paint(); return }
  local.giftRequest = null
  local.giftReveal = r.rewards || []
  await load()
  refreshGameState()
}

async function claimWinner() {
  local.battleBusy = true
  local.error = null
  paint()
  local.winnerRequest = local.winnerRequest || crypto.randomUUID()
  const r = await call('claimBattleWinner', { agentNo: getAgentNo(), campaignId: status.campaign.id, requestId: local.winnerRequest })
  local.battleBusy = false
  if (!r?.success) { local.error = { mission: 'battle', text: errorText(r?.error) }; paint(); return }
  local.winnerRequest = null
  local.winnerReveal = r.rewards || []
  await load()
  refreshGameState()
}

async function claimBattle(index) {
  local.battleBusy = true
  local.error = null
  paint()
  const rid = local.battleRequests[index] || (local.battleRequests[index] = crypto.randomUUID())
  const r = await call('claimBattleGift', { agentNo: getAgentNo(), campaignId: status.campaign.id, milestoneIndex: index, requestId: rid })
  local.battleBusy = false
  if (!r?.success) { local.error = { mission: 'battle', text: errorText(r?.error) }; paint(); return }
  delete local.battleRequests[index]
  local.battleReveal = { index, rewards: r.rewards || [] }
  await load()
  refreshGameState()
}

// ── MAMA Event Hub: tabs, Team, Chat ─────────────────────────────────
// Polls only while this screen is open and the page is visible: Chat every
// 4 s while the Chat sheet is open (30 s otherwise, for Moments and the
// unread dot), Team once a minute on the Team tab, the live score once a
// minute.

const CHAT_FAST_MS = 4_000
const HUB_SLOW_MS = 30_000
const HUB_TAB_IDS = ['battle', 'team', 'voting']
const tabKey = () => `vt:hubtab:${status.campaign.id}`
const readKey = () => `vt:chatread:${status.campaign.id}`

/** Voting while today's votes are still 0, otherwise the last tab used. */
function firstTab() {
  const done = Object.values(status.todayProgress || {}).reduce((n, p) => n + (p.verified || 0), 0)
  if (!done && status.campaign.phase === 'open') return 'voting'
  try {
    const t = localStorage.getItem(tabKey())
    if (HUB_TAB_IDS.includes(t)) return t
  } catch { /* none saved */ }
  return 'battle'
}

function startHub() {
  clearTimeout(hubTimer)
  hubTicks = 0
  loadChat()
  if (local.tab === 'team') loadTeam()
  scheduleHub()
}

function scheduleHub() {
  clearTimeout(hubTimer)
  if (!root?.isConnected || !status?.battle) return
  hubTimer = setTimeout(hubTick, local.hub.chatOpen ? CHAT_FAST_MS : HUB_SLOW_MS)
}

async function hubTick() {
  if (!root?.isConnected) return
  if (!document.hidden) {
    hubTicks += 1
    const minute = local.hub.chatOpen ? hubTicks % 15 === 0 : hubTicks % 2 === 0
    await loadChat()
    if (local.tab === 'team' && minute) await loadTeam()
    if (minute) await refreshScore()
  }
  scheduleHub()
}

function switchTab(tab) {
  if (!HUB_TAB_IDS.includes(tab) || tab === local.tab) return
  local.tab = tab
  try { localStorage.setItem(tabKey(), tab) } catch { /* in-memory only */ }
  for (const b of root.querySelectorAll('.vt-tab')) {
    const on = b.dataset.vtTab === tab
    b.setAttribute('aria-selected', String(on))
    b.tabIndex = on ? 0 : -1
  }
  for (const p of root.querySelectorAll('[data-vt-panel]')) p.hidden = p.dataset.vtPanel !== tab
  root.querySelector('.vt-hub-page')?.setAttribute('data-vt-tab-now', tab)
  if (tab === 'team') loadTeam()
  scheduleHub()
}

/** The floating button: Chat opens as a sheet over whichever tab is showing. */
function openChat() {
  local.hub.chatOpen = true
  showSheet('chat')
  markRead()
  restoreFeed(null)
  root.querySelector('[data-vt-chat-input]')?.focus({ preventScroll: true })
  loadChat()
  scheduleHub()
}

// ── Team ──

async function loadTeam() {
  const r = await call('getBattleTeam', { agentNo: getAgentNo() })
  if (!root?.isConnected) return
  const next = r?.success ? r : { error: r?.error || 'failed' }
  if (JSON.stringify(next) === JSON.stringify(hubData.team)) return
  hubData.team = next
  if (local.tab === 'team') paint()
}

// ── Chat ──

const latestFromOthers = (chat) => Math.max(0, ...(chat?.messages || []).filter((m) => m.kind === 'player' && !m.mine).map((m) => Number(m.id)))
function lastRead() {
  try { return Number(localStorage.getItem(readKey())) || 0 } catch { return 0 }
}
function markRead() {
  local.hub.unread = false
  root.querySelector('.vt-fab-dot')?.remove()
  const id = latestFromOthers(hubData.chat)
  try { if (id) localStorage.setItem(readKey(), String(id)) } catch { /* in-memory only */ }
}
function setUnread() {
  if (local.hub.unread) return
  local.hub.unread = true
  const fab = root.querySelector('.vt-chat-fab')
  if (fab && !fab.querySelector('.vt-fab-dot')) {
    fab.insertAdjacentHTML('beforeend', '<i class="vt-fab-dot" aria-hidden="true"></i>')
    fab.setAttribute('aria-label', 'Open MAMA Chat, new messages')
  }
}

const lockKey = (c) => [c?.open, c?.paused, c?.timeoutUntil, (c?.muted || []).length].join('|')

async function loadChat() {
  const r = await call('getBattleChat', { agentNo: getAgentNo() })
  if (!root?.isConnected) return
  const prev = hubData.chat
  const next = r?.success ? r : { error: r?.error || 'failed' }
  if (JSON.stringify(next) === JSON.stringify(prev)) return
  hubData.chat = next
  if (local.hub.chatOpen) markRead()
  else if (latestFromOthers(next) > lastRead()) setUnread()
  const structural = prev?.loading || prev?.error || next.error || lockKey(prev) !== lockKey(next)
    || JSON.stringify(prev?.presence) !== JSON.stringify(next.presence)
  const momentsChanged = JSON.stringify(prev?.moments) !== JSON.stringify(next.moments)
  if (structural || (momentsChanged && local.tab === 'battle')) { paint(); return }
  // Only messages or reactions changed: swap the list, leave the composer be.
  const feed = root.querySelector('[data-vt-chat-feed]')
  if (feed && (!openSheet || openSheet === 'chat')) {
    const pos = feedPosition()
    const labels = Object.fromEntries((status.battle?.teams || []).map((t) => [t.id, t.label]))
    feed.innerHTML = chatFeed(next, labels, local.hub)
    restoreFeed(pos)
  }
}

function feedPosition() {
  const feed = root?.querySelector('[data-vt-chat-feed]')
  if (!feed || !feed.clientHeight) return null
  return { top: feed.scrollTop, atEnd: feed.scrollHeight - feed.scrollTop - feed.clientHeight < 48 }
}
function restoreFeed(pos) {
  const feed = root?.querySelector('[data-vt-chat-feed]')
  if (!feed) return
  feed.scrollTop = !pos || pos.atEnd ? feed.scrollHeight : pos.top
}

const IDLE_HINT = 'Both teams see this · no links or @usernames'

function onChatInput(input) {
  local.hub.draft = input.value
  const count = root.querySelector('[data-vt-chat-count]')
  if (count) count.textContent = `${[...input.value].length}/${CHAT_MAX}`
  if (local.hub.error) {
    local.hub.error = null
    const hint = root.querySelector('[data-vt-chat-hint]')
    if (hint) { hint.textContent = IDLE_HINT; hint.className = ''; hint.removeAttribute('role') }
  }
}

function tickSlowMode() {
  const btn = root?.querySelector('.vt-chat-send')
  if (!btn || !local.hub.waitUntil) return
  const left = Math.ceil((local.hub.waitUntil - Date.now()) / 1000)
  if (left > 0) {
    btn.disabled = true
    btn.innerHTML = `<span class="vt-mono">${left}</span>`
    btn.setAttribute('aria-label', `Send in ${left} seconds`)
  } else {
    local.hub.waitUntil = 0
    paint()
  }
}

function chatFail(r) {
  if (r?.error === 'slow_down') local.hub.waitUntil = Date.now() + (Number(r.wait) || 5) * 1000
  if (['timed_out', 'chat_closed', 'chat_paused'].includes(r?.error)) loadChat()
  local.hub.error = chatErrorText(r?.error, r?.reason)
}

async function sendChat() {
  const input = root.querySelector('[data-vt-chat-input]')
  const text = checkChatText(input?.value ?? local.hub.draft)
  if (!text.ok) { local.hub.error = chatErrorText('chat_text', text.reason); paint(); return }
  if (local.hub.sending || local.hub.waitUntil > Date.now()) return
  local.hub.sending = true
  const r = await call('sendBattleChat', { agentNo: getAgentNo(), message: text.value, replyTo: local.hub.replyTo?.id || null })
  local.hub.sending = false
  if (!root?.isConnected) return
  if (!r?.success) { chatFail(r); paint(); return }
  local.hub.draft = ''
  local.hub.replyTo = null
  local.hub.error = null
  local.hub.waitUntil = Date.now() + 5000 // the server's slow mode, shown up front
  paint()
  root.querySelector('[data-vt-chat-input]')?.focus()
  await loadChat()
  restoreFeed(null)
}

const messageById = (id) => hubData.chat?.messages?.find((m) => m.id === id)

function openMessage(id) {
  if (!messageById(id)) return
  local.hub.selId = id
  paint()
  showSheet('chat-msg')
}

function replyTo(id) {
  const m = messageById(id)
  closeSheet()
  if (!m) return
  local.hub.replyTo = { id: m.id, codename: m.codename, team: m.team, body: (m.body || '').slice(0, 60) }
  paint()
  root.querySelector('[data-vt-chat-input]')?.focus()
}

async function reactTo(id, emoji) {
  if (openSheet === 'chat-msg') closeSheet()
  const r = await call('reactBattleChat', { agentNo: getAgentNo(), messageId: id, emoji })
  if (!r?.success) { toast(chatErrorText(r?.error)); return }
  await loadChat()
}

async function muteMember(key, on) {
  if (!key) return
  const chat = hubData.chat
  const who = chat?.messages?.find((m) => m.memberKey === key)?.codename || chat?.muted?.find((m) => m.memberKey === key)?.codename || 'them'
  const r = await call('muteBattleChat', { agentNo: getAgentNo(), memberKey: key, on })
  if (!r?.success) { toast(chatErrorText(r?.error)); return }
  closeSheet()
  toast(on ? `Muted ${who}. You won't see their messages.` : `Unmuted ${who}`)
  await loadChat()
}

function openReport(id) {
  closeSheet()
  if (!messageById(id)) return
  local.hub.reportId = id
  paint()
  showSheet('chat-report')
}

async function sendReport(id, reason) {
  const r = await call('reportBattleChat', { agentNo: getAgentNo(), messageId: id, reason })
  if (!r?.success) { toast(chatErrorText(r?.error)); return }
  closeSheet()
  local.hub.reportId = null
  toast("Thanks. It's hidden for you now.")
  await loadChat()
}

// ── Live score (the strip on every tab) ──

const leaderOf = (teams) => (teams[0].points === teams[1].points ? 'tie' : teams[0].points > teams[1].points ? teams[0].id : teams[1].id)

async function refreshScore() {
  const r = await call('getPublicBattle')
  if (!r?.success || !root?.isConnected || !status?.battle) return
  const b = status.battle
  const before = leaderOf(b.teams)
  let changed = false
  for (const t of b.teams) {
    const p = r.teams.find((x) => x.id === t.id)?.points
    if (p != null && p !== t.points) { t.points = p; changed = true }
  }
  if (r.total !== b.total) { b.total = r.total; changed = true }
  if (!changed) return
  paint()
  // A lead change eases the score in once (skipped for reduced motion).
  if (leaderOf(b.teams) !== before) for (const el of root.querySelectorAll('.vt-ls-score, .vt-battle')) el.classList.add('is-flip')
}

// ── X accounts: link the post's author, pick another post, remove one ──

/** Link the account the server named, then send the same post again. From
 *  a card in review there's no pending link: it just links for next time. */
async function linkAuthor(author) {
  if (!author) return
  const pending = local.xUnlinked?.url || null
  local.error = null
  const h = await call('setXHandle', { agentNo: getAgentNo(), campaignId: status.campaign.id, xHandle: author })
  if (!h?.success) {
    local.error = { mission: 'x-sheet', text: errorText(h?.error) }
    paint()
    showSheet('link', false)
    return
  }
  status.xHandles = [...new Set([...(status.xHandles || []), h.xHandle])]
  status.xHandleLinked = true
  local.xUnlinked = null
  if (pending) return sendXPost(pending, null)
  toast(`Linked @${h.xHandle}. New posts from it will count.`)
  await load()
}

function chooseOtherPost() {
  local.xUnlinked = null
  local.error = null
  paint()
  showSheet('link', false)
  const input = root.querySelector('[data-vt-form="x"] input[name="url"]')
  if (input) { input.value = ''; input.focus() }
}

/** Two taps: the first asks, the second removes (only accounts without votes). */
async function removeHandle(handle) {
  if (!handle) return
  if (local.xRemoveConfirm !== handle) {
    local.xRemoveConfirm = handle
    paint()
    showSheet('link', false)
    return
  }
  local.xRemoveConfirm = null
  const r = await call('removeXHandle', { agentNo: getAgentNo(), campaignId: status.campaign.id, xHandle: handle })
  if (!r?.success) {
    local.error = { mission: 'x-sheet', text: errorText(r?.error) }
    paint()
    showSheet('link', false)
    return
  }
  toast(`Removed @${handle}`)
  await load()
  showSheet('link', false)
}
