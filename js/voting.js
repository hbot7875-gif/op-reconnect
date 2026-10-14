// Voting screen (MAMA 2026 first) — events and data only. Markup lives in
// voting-view.js; proof handling in voting-proof.js; every decision that
// counts is made by the server (supabase/functions/op-reconnect/lib/
// vote-campaign-service.js).
import { call } from './api.js'
import { getAgentNo } from './session.js'
import { goWorld } from './router.js'
import { setState, toast } from './state.js'
import { votingScreen, errorText, countdown, MNET_FAST_MS } from './voting-view.js'
import { nextKstMidnight } from '../supabase/functions/op-reconnect/lib/vote-campaign-rules.js'
import { sha256OfBlob, reencodeImage, blobToBase64, ocrCertificate } from './voting-proof.js'
import { battleView, pickStyle, nextStyle, shareText, STYLES, STYLE_NAMES, BATTLE_URL } from './battle-share-rules.js'
import { posterFile, canShareFiles, sharePoster, shareLink, copyText, savePoster } from './battle-share-flow.js'
import { checkLyric, LYRIC_MAX, LYRIC_ERRORS } from './battle-lyric-filter.js'

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

function freshLocal() {
  return {
    mnet: {}, x: {}, error: null, editHandle: false,
    giftBusy: false, giftReveal: null, giftRequest: null,
    battleBusy: false, battleReveal: null, battleRequests: {},
    winnerReveal: null, winnerRequest: null,
    chooser: null,
    share: null,
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
  root.addEventListener('input', (e) => { if (e.target.matches?.('[data-vt-lyric]')) onLineInput(e.target) })
  local = freshLocal()
  openSheet = null
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
  paint()
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
const isFresh = () => !!local.mnet.sentAt && Date.now() - local.mnet.sentAt < MNET_FAST_MS

function scheduleProofPoll() {
  clearTimeout(proofPoll)
  if (!root?.isConnected || !status) return
  if (!Object.values(status.states || {}).includes('verifying')) return
  proofPoll = setTimeout(pollProofs, isFresh() ? POLL_FAST_MS : POLL_SLOW_MS)
}

async function pollProofs() {
  if (!root?.isConnected) return
  const wasFresh = isFresh()
  const r = await call('getVotingStatus', { agentNo: getAgentNo() })
  if (!root?.isConnected) return
  if (r?.success) {
    const key = (s) => JSON.stringify([s.states, s.todayProgress])
    const changed = key(r) !== key(status)
    const credited = (r.stats?.verifiedVotes || 0) > (status.stats?.verifiedVotes || 0)
    status = r
    // Repaint on a real change, or once when "Verifying…" becomes "running".
    if (changed || (wasFresh && !isFresh())) paint()
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
  paint()
  root.querySelector('[data-vt-act="chooser-done"]')?.focus()
}

function paint() {
  if (!root?.isConnected || !status) return
  const sheet = openSheet
  root.innerHTML = votingScreen({ status, local, now: new Date() })
  if (sheet) showSheet(sheet, false)
  // The team chooser is modal: nothing behind it is reachable while open.
  if (local.chooser) for (const n of root.querySelectorAll('.vt-appbar, .vt-page')) n.inert = true
  startTicker()
}

function startTicker() {
  clearInterval(ticker)
  ticker = setInterval(() => {
    if (!root?.isConnected) { clearInterval(ticker); return }
    const left = nextKstMidnight().getTime() - Date.now()
    const span = root.querySelector('[data-vt-reset]')
    if (span) span.textContent = countdown(left)
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
  showStyle(pickStyle(view))
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
    if (r === 'shared') toast('Text copied')
    if (r !== 'failed') return
  }
  // No image sharing here (or it just failed): the link still goes.
  const r = await shareLink(shareSnap.text)
  if (r === 'copied') toast('Link copied')
}

function shareSave() {
  const p = currentPoster()
  if (!p) return
  if (savePoster(p.url) === 'hold') { local.share.hold = true; paint() }
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
  for (const n of root.querySelectorAll('.vt-appbar, .vt-page')) n.inert = true
  requestAnimationFrame(() => sheet.classList.add('is-open'))
  if (moveFocus) (sheet.querySelector('input, summary, button:not([data-vt-act="sheet-close"])') || sheet).focus()
}

function closeSheet() {
  if (!openSheet) return
  const sheet = root.querySelector(`[data-vt-sheet="${openSheet}"]`)
  if (openSheet === 'share') releaseShare()
  openSheet = null
  local.editHandle = false
  if (local.error?.mission === 'x-sheet') local.error = null
  sheet?.classList.remove('is-open')
  if (sheet) sheet.hidden = true
  root.querySelector('.vt-scrim').hidden = true
  root.classList.remove('has-sheet')
  for (const n of root.querySelectorAll('.vt-appbar, .vt-page')) n.inert = false
  if (lastFocus?.isConnected) lastFocus.focus()
}

function onKeydown(e) {
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
  else if (act === 'x-link') { local.error = null; paint(); showSheet('link') }
  else if (act === 'x-edit-handle') { local.editHandle = true; paint(); root.querySelector('input[name="handle"]')?.focus() }
  else if (act === 'gift-open') openGift()
  else if (act === 'x-compose') { setComposed(); local.x.composed = true; setTimeout(paint, 400) }
  else if (act === 'team-pick') pickTeam(t.dataset.vtTeam)
  else if (act === 'chooser-done') { local.chooser = null; load() }
  else if (act === 'battle-claim') claimBattle(Number(t.dataset.vtIndex))
  else if (act === 'winner-claim') claimWinner()
  else if (act === 'battle-share') openShare()
  else if (act === 'share-style' && local.share?.style) showStyle(nextStyle(local.share.style), true)
  else if (act === 'share-go') shareGo()
  else if (act === 'share-save') shareSave()
  else if (act === 'share-link') copyText(BATTLE_URL).then((ok) => toast(ok ? 'Link copied' : BATTLE_URL))
  else if (act === 'share-lines-reset') resetLines()
  else if (act === 'share-text' && shareSnap) copyText(shareSnap.text).then((ok) => ok && toast('Text copied'))
}

function onChange(e) {
  if (e.target.matches('[data-vt-act="mnet-file"]') && e.target.files?.[0]) sendCertificate(e.target.files[0])
}

function onSubmit(e) {
  if (!e.target.matches('[data-vt-form="x"]')) return
  e.preventDefault()
  const form = new FormData(e.target)
  sendXPost(form.get('url'), form.has('handle') ? form.get('handle') : null)
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])
}

async function sendCertificate(file) {
  const mission = status.campaign.missions.find((m) => m.kind === 'mnet_certificate')
  local.error = null
  if (!/^image\/(png|jpeg)$/.test(file.type)) { local.error = { mission: mission.id, text: errorText('bad_image_type') }; paint(); return }
  if (file.size > MAX_ORIGINAL_BYTES) { local.error = { mission: mission.id, text: errorText('image_too_large') }; paint(); return }
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
    if (!r?.success) { local.error = { mission: mission.id, text: errorText(r?.error) }; paint(); return }
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
    if (!r?.success) throw Object.assign(new Error(r?.error), { code: r?.error, extra: r })
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
