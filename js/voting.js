// Voting screen (MAMA 2026 first) — events and data only. Markup lives in
// voting-view.js; proof handling in voting-proof.js; every decision that
// counts is made by the server (supabase/functions/op-reconnect/lib/
// vote-campaign-service.js).
import { call } from './api.js'
import { getAgentNo } from './session.js'
import { goWorld } from './router.js'
import { setState, toast } from './state.js'
import { votingScreen, errorText, countdown } from './voting-view.js'
import { nextKstMidnight } from '../supabase/functions/op-reconnect/lib/vote-campaign-rules.js'
import { sha256OfBlob, reencodeImage, blobToBase64, ocrCertificate } from './voting-proof.js'

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

function freshLocal() {
  return {
    mnet: {}, x: {}, error: null, editHandle: false,
    giftBusy: false, giftReveal: null, giftRequest: null,
    battleBusy: false, battleReveal: null, battleRequests: {},
    winnerReveal: null, winnerRequest: null,
    chooser: null,
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
    // Friendly pre-check only. A slow or failed read never blocks sending.
    let clientChecks = {}
    try {
      clientChecks = await withTimeout(ocrCertificate(clean, mission, status.today,
        { opensAt: status.campaign.opensAt, closesAt: status.campaign.closesAt }), PRECHECK_TIMEOUT_MS)
      local.mnet.precheck = clientChecks
    } catch { /* the server decides regardless */ }
    const r = await call('submitMnetProof', {
      agentNo: getAgentNo(), campaignId: status.campaign.id, missionId: mission.id,
      imageBase64: await blobToBase64(clean), imageMime: 'image/jpeg', originalHash, clientChecks,
    })
    local.mnet.uploading = false
    if (r?.error === 'team_required') { local.error = { mission: mission.id, text: errorText(r.error) }; paint(); startChooser(); return }
    if (!r?.success) { local.error = { mission: mission.id, text: errorText(r?.error) }; paint(); return }
    toast('Certificate received')
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
