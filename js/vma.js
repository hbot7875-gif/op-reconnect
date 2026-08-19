// VMA Voting Mission — a temporary live-event banner on the World screen
// (see vmaEventCard, mirrors broadcasts.js/screen-world.js's redZoneCard
// pattern) that opens a full-sheet mission flow: category → screenshot →
// scan → confirm → send. Backend is lib/vma-voting.ts (getVmaStatus/
// logVmaVote) — nothing here talks about OCR, verification, image hashes,
// or cumulative totals; that's all just "scanning" and "votes" to the
// player. OCR itself runs here, client-side, via Tesseract.js loaded lazily
// from a CDN only when someone actually opens the upload flow — the backend
// tried running it server-side first and it doesn't work in Deno's sandbox.

import { call } from './api.js'
import { el, esc, toast, showOverlay, hideOverlay } from './state.js'
import { getAgentNo } from './session.js'
import { extractVoteTotal, watermarkMatches } from '../supabase/functions/op-reconnect/lib/vma-ocr.js'

let tesseractPromise = null
function loadTesseract() {
  if (tesseractPromise) return tesseractPromise
  tesseractPromise = new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve(window.Tesseract)
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'
    s.onload = () => resolve(window.Tesseract)
    s.onerror = () => reject(new Error('scan_unavailable'))
    document.head.appendChild(s)
  })
  return tesseractPromise
}

// The plain Tesseract.recognize(image, 'eng') convenience call uses fully
// automatic page segmentation, which — verified directly against a real
// vote screenshot's layout — reliably DROPS an isolated large numeral
// sitting between two circular +/- buttons (the vote count) and small
// colored annotation text (the watermark code someone wrote on the
// screenshot), not garbled, just never detected as text at all. A worker
// with page-seg-mode 11 ("sparse text" — look for text anywhere, don't
// assume a uniform block/column) recovers both reliably in the same test.
// Cached like loadTesseract so repeat scans in one session reuse it.
let workerPromise = null
async function getOcrWorker() {
  if (workerPromise) return workerPromise
  workerPromise = (async () => {
    const Tesseract = await loadTesseract()
    const worker = await Tesseract.createWorker('eng')
    await worker.setParameters({ tessedit_pageseg_mode: '11' })
    return worker
  })()
  return workerPromise
}

function timeLeft(untilIso) {
  const ms = new Date(untilIso).getTime() - Date.now()
  if (ms <= 0) return 'ending soon'
  const days = Math.floor(ms / 86_400_000)
  const hours = Math.floor((ms % 86_400_000) / 3_600_000)
  if (days > 0) return `${days}d ${hours}h left`
  const mins = Math.floor((ms % 3_600_000) / 60_000)
  return `${hours}h ${mins}m left`
}

/** Small event banner for the World screen. Empty (childless) when no
 *  event is live, so screen-world.js can append it unconditionally same as
 *  broadcastCards. */
export function vmaEventCard(state) {
  const wrap = el('div')
  const v = state.vma
  if (!v) return wrap

  const card = el('section', 'vma-banner' + (v.chestReady ? ' chest-ready' : ''))
  // (7) Both can be true at once (e.g. a Power Hour that falls inside a
  // Double Day) — show every tag that applies, not just the first match.
  const tags = []
  if (v.isPowerHour) tags.push('<span class="vma-tag power">⚡ POWER HOUR</span>')
  if (v.isDoubleDay) tags.push('<span class="vma-tag double">🔥 DOUBLE DAY</span>')

  if (v.ended) {
    card.innerHTML = `
      <div class="vma-banner-head"><span class="vma-dot"></span>EVENT ENDED</div>
      <div class="vma-banner-title">${esc(v.title || 'VMA Voting Mission')}</div>
      <p class="vma-banner-msg">Voting has closed, but you still have a Supply Chest to claim.</p>
      <div class="vma-banner-progress${v.chestReady ? ' is-ready' : ''}">${v.chestReady ? '📦 Supply Chest ready!' : `📦 ${v.chestFill}/${v.chestThreshold}`}</div>
    `
    const go = el('button', 'btn btn-primary vma-banner-btn' + (v.chestReady ? ' has-dot' : ''), 'CLAIM CHEST')
    go.onclick = () => openVmaMission()
    card.appendChild(go)
    wrap.appendChild(card)
    return wrap
  }

  const progressLine = v.chestReady
    ? '<div class="vma-banner-progress is-ready">📦 Supply Chest ready!</div>'
    : `<div class="vma-banner-progress">Today: ${v.todayVotes}/${v.todayCap} across both categories &middot; 📦 ${v.chestFill}/${v.chestThreshold}</div>`
  card.innerHTML = `
    <div class="vma-banner-head"><span class="vma-dot"></span>LIVE EVENT ${tags.join(' ')}</div>
    <div class="vma-banner-title">${esc(v.title || 'VMA Voting Mission')}</div>
    <p class="vma-banner-msg">Vote, send your proof, and earn Supply Chests.</p>
    ${progressLine}
  `
  const go = el('button', 'btn btn-primary vma-banner-btn' + (v.chestReady ? ' has-dot' : ''), 'ENTER MISSION')
  go.onclick = () => openVmaMission()
  card.appendChild(go)
  wrap.appendChild(card)
  return wrap
}

/* ── the mission sheet ─────────────────────────────────────────────────── */

async function fetchStatus() {
  const [res, chest] = await Promise.all([
    call('getVmaStatus', { agentNo: getAgentNo() }),
    call('getChestStatus', { agentNo: getAgentNo() }),
  ])
  if (res.success) res._chest = chest.success ? chest : null
  return res
}

export async function openVmaMission() {
  const sheet = el('div', 'sheet vma-sheet')
  sheet.append(el('div', 'eyebrow', 'VMA SIGNAL MISSION'), el('div', 'vma-loading', 'Loading mission status…'))
  showOverlay(sheet)

  const res = await fetchStatus()
  if (!res.success) {
    sheet.innerHTML = ''
    sheet.append(el('div', 'eyebrow', 'VMA SIGNAL MISSION'), el('p', 'muted', "Couldn't load the mission right now — try again in a moment."))
    const close = el('button', 'btn btn-ghost', 'Close')
    close.onclick = hideOverlay
    sheet.appendChild(close)
    return
  }
  paintMissionSheet(sheet, res)
}

function showMissionSheet(status) {
  const sheet = el('div', 'sheet vma-sheet')
  paintMissionSheet(sheet, status)
  showOverlay(sheet)
}

function paintMissionSheet(sheet, status) {
  sheet.innerHTML = ''
  const cfg = status.config || {}
  sheet.append(el('div', 'eyebrow', 'VMA SIGNAL MISSION'))

  // (7) Not mutually exclusive — show every condition that's actually true.
  const tags = []
  if (status.isPowerHour) tags.push('<div class="vma-flag power">⚡ POWER HOUR · voting is boosted right now</div>')
  if (status.isDoubleDay) tags.push('<div class="vma-flag double">🔥 DOUBLE DAY · up to double votes count today</div>')
  if (tags.length) sheet.appendChild(el('div', '', tags.join('')))

  sheet.appendChild(el('div', 'vma-timer', `⏳ Voting ${esc(timeLeft(cfg.period_end_utc))}`))

  if (status.pendingTotal > 0) {
    sheet.appendChild(el('div', 'vma-pending-flag',
      `⏳ ${status.pendingTotal} proof${status.pendingTotal === 1 ? '' : 's'} under review<br><span class="muted">We'll update your votes once it's approved.</span>`))
  }

  const cats = el('div', 'vma-categories')
  for (const c of cfg.categories || []) {
    const remaining = status.remaining?.[c] ?? 0
    const cap = status.dailyCap || 0
    const done = remaining <= 0
    const pending = status.pendingByCategory?.[c] || 0
    const row = el('div', 'vma-cat-row' + (done ? ' is-done' : ''))
    row.innerHTML = `
      <span class="vma-cat-name">${esc(cfg.category_labels?.[c] || c)}</span>
      <span class="vma-cat-count">${done ? `${cap} / ${cap} ✓` : `${cap - remaining} / ${cap}`}${pending ? ` &middot; ${pending} pending` : ''}</span>
    `
    cats.appendChild(row)
  }
  sheet.appendChild(cats)

  // (6) The mission never told players WHERE to actually vote — it jumped
  // straight to "upload proof" as if the vote already happened. This is
  // step 1 of the real flow: vote on MTV first, come back to upload after.
  if (cfg.url) {
    const voteLink = el('a', 'btn btn-ghost vma-mtv-link', 'VOTE ON MTV ↗')
    voteLink.href = cfg.url
    voteLink.target = '_blank'
    voteLink.rel = 'noopener noreferrer'
    sheet.appendChild(voteLink)
  }

  const addBtn = el('button', 'btn btn-primary vma-add-btn', 'ADD VOTES')
  addBtn.disabled = !status.open
  addBtn.onclick = () => openCategoryStep(status)
  sheet.appendChild(addBtn)
  if (!status.open) sheet.appendChild(el('p', 'muted', 'Voting isn\'t open right now.'))

  if (status._chest) sheet.appendChild(chestSection(status._chest))

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
}

/* ── Supply Chest ───────────────────────────────────────────────────────── */

function chestStage(pct) {
  // dark/closed → faint purple glow → stronger glow → gold/ready, driven by
  // one CSS custom property so the visual states live entirely in CSS.
  const stage = pct >= 100 ? 'ready' : pct >= 66 ? 'strong' : pct >= 33 ? 'faint' : 'dark'
  return stage
}

function chestSection(chest) {
  const box = el('div', 'vma-chest')
  const pct = Math.min(100, Math.round((chest.fillCount / chest.threshold) * 100))
  const capped = chest.opensToday >= chest.dailyCap

  const visual = el('div', `vma-chest-box stage-${chestStage(pct)}`)
  visual.innerHTML = `<div class="vma-chest-glow"></div><div class="vma-chest-icon">📦</div>`
  box.appendChild(visual)

  box.appendChild(el('div', 'eyebrow', 'SUPPLY CHEST'))
  const full = chest.fillCount >= chest.threshold
  if (chest.ready && !capped) {
    box.appendChild(el('div', 'vma-chest-count is-ready', 'CHEST READY'))
    const open = el('button', 'btn btn-primary vma-add-btn', 'OPEN CHEST')
    open.onclick = () => runChestOpen(box, chest)
    box.appendChild(open)
  } else if (full && capped) {
    // Clamped, never a >threshold ratio like "100/50" — reads like a
    // broken progress bar otherwise. The overflow itself is still safe
    // (never discarded), just not shown as raw numbers here.
    box.appendChild(el('div', 'vma-chest-count is-ready', 'CHEST READY'))
    box.appendChild(el('p', 'muted', "You've opened your chests for today — more tomorrow."))
  } else {
    box.appendChild(el('div', 'vma-chest-count', `${chest.fillCount} / ${chest.threshold}`))
    const votesLeft = Math.max(0, chest.threshold - chest.fillCount)
    box.appendChild(el('p', 'muted', `${votesLeft} vote${votesLeft === 1 ? '' : 's'} until your next chest`))
  }
  return box
}

const REDUCED = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

async function runChestOpen(box, chest) {
  const btn = box.querySelector('.vma-add-btn')
  if (btn) btn.disabled = true
  const res = await call('openChest', { agentNo: getAgentNo() })
  if (!res.success) {
    toast(res.error === 'daily_open_cap_reached' ? "You've opened your chests for today." : "Couldn't open that right now.")
    if (btn) btn.disabled = false
    return
  }
  await playChestReveal(box, res.reward)
}

const REWARD_COPY = {
  charge_cell: { icon: '🔋', name: '+1 Charge Cell' },
  xp: { icon: '⚡', name: (d) => `+${d.amount || 10} XP` },
  streak_freeze: { icon: '🧊', name: '+1 Streak Freeze' },
  extension: { icon: '⏳', name: '+1 Deadline Extension' },
  badge: { icon: '🎖️', name: 'Rare Badge' },
  backup_pass: { icon: '🤝', name: 'Backup Pass' },
}

/** Shake → purple light leaks out → flash → reward card. Backup Pass and
 *  the event badge (the two rewards meant to feel special) get a longer,
 *  brighter beat than a plain resource tick. Respects reduced-motion by
 *  skipping straight to the reward card. */
async function playChestReveal(box, reward) {
  const visual = box.querySelector('.vma-chest-box')
  const big = reward.kind === 'badge' || reward.kind === 'backup_pass'
  const buzz = (pattern) => { try { navigator.vibrate?.(pattern) } catch {} }

  if (!REDUCED()) {
    visual.classList.add('shaking')
    buzz(20)
    await new Promise((r) => setTimeout(r, big ? 900 : 550))
    visual.classList.remove('shaking')
    visual.classList.add('bursting')
    buzz(big ? [30, 60, 30, 60, 90] : [30, 60, 40])
    await new Promise((r) => setTimeout(r, 420))
  }

  const copy = REWARD_COPY[reward.kind] || { icon: '🎁', name: 'Reward' }
  const name = typeof copy.name === 'function' ? copy.name(reward) : copy.name

  box.innerHTML = ''
  const card = el('div', 'vma-chest-reward' + (big ? ' big' : ''))
  card.innerHTML = `
    <div class="vma-chest-reward-icon">${copy.icon}</div>
    <div class="vma-chest-reward-name">${esc(name)}</div>
    ${reward.kind === 'backup_pass' ? '<p class="muted">Get help from another agent on one track or album mission. Find it in Pack when you\'re ready.</p>' : ''}
    ${reward.kind === 'badge' ? '<p class="muted">Added to your Badge Collection.</p>' : ''}
  `
  box.appendChild(card)
  const nice = el('button', 'btn btn-primary vma-add-btn', 'Nice')
  nice.onclick = async () => {
    const fresh = await fetchStatus()
    if (fresh.success) showMissionSheet(fresh)
  }
  box.appendChild(nice)
}

/* ── step 1: choose category ───────────────────────────────────────────── */

function openCategoryStep(status) {
  const cfg = status.config || {}
  const sheet = el('div', 'sheet vma-sheet')
  sheet.append(el('div', 'eyebrow', 'ADD VOTES'), el('h3', '', 'What did you vote for?'))

  const tiles = el('div', 'vma-tiles')
  for (const c of cfg.categories || []) {
    const remaining = status.remaining?.[c] ?? 0
    const tile = el('button', 'vma-tile' + (remaining <= 0 ? ' is-full' : ''))
    tile.type = 'button'
    tile.disabled = remaining <= 0
    tile.innerHTML = `
      <span class="vma-tile-name">${esc(cfg.category_labels?.[c] || c)}</span>
      <span class="vma-tile-sub">BTS — SWIM</span>
      ${remaining <= 0 ? '<span class="vma-tile-full">Today\'s limit reached</span>' : ''}
    `
    tile.onclick = () => openUploadStep(status, c)
    tiles.appendChild(tile)
  }
  sheet.appendChild(tiles)

  const back = el('button', 'btn btn-ghost', 'Back')
  back.onclick = () => showMissionSheet(status)
  sheet.appendChild(back)
  showOverlay(sheet)
}

/* ── step 2: upload + scan ─────────────────────────────────────────────── */

const MAX_BYTES = 5 * 1024 * 1024

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** A real vote screenshot has BTS/the song title printed over a photo
 *  (album art, a concert still, ...), not flat text on a plain background,
 *  and the watermark code is small colored text a player adds by hand —
 *  neither reliably survives a single OCR pass, but which one fails varies
 *  screenshot to screenshot (verified against real user screenshots: a
 *  clearly-readable watermark was still missed on the raw pass alone).
 *  Grayscale + a contrast stretch is a standard, cheap OCR preprocessing
 *  step that recovers a different subset of text than the raw image does.
 *  openScanStep runs OCR on both this and the raw file and merges the text
 *  before checking, rather than picking one pass and accepting its blind
 *  spots. Runs entirely in-browser via canvas; the ORIGINAL file (not this
 *  processed version) is still what gets uploaded as proof. */
function loadImageBitmap(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

async function preprocessForOcr(file) {
  try {
    const img = await loadImageBitmap(file)
    const canvas = document.createElement('canvas')
    // Upscale small screenshots — Tesseract does noticeably better above
    // ~1500px on the long edge; most phone screenshots are already larger
    // than this, so this mostly matters for a cropped/downscaled upload.
    const scale = Math.max(1, Math.min(2, 1600 / Math.max(img.width, img.height)))
    canvas.width = img.width * scale
    canvas.height = img.height * scale
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(img.src)

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const d = imageData.data
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      // Contrast stretch around a fixed midpoint rather than a hard
      // black/white threshold — a real threshold is too aggressive for
      // screenshots that mix a dark UI chrome with a bright photo area in
      // the same frame; this keeps some gradient while still sharply
      // separating light text from whatever's behind it.
      const boosted = Math.max(0, Math.min(255, (gray - 128) * 1.8 + 128))
      d[i] = d[i + 1] = d[i + 2] = boosted
    }
    ctx.putImageData(imageData, 0, 0)
    return canvas
  } catch {
    return file // preprocessing is a best-effort improvement, never a hard requirement
  }
}

/** A second fallback aimed specifically at colored annotation text. Normal
 * grayscale makes bright red writing surprisingly dark; using the strongest
 * RGB channel keeps red/purple/white lettering bright, then a binary split
 * separates it from the dark vote-page background. This pass only runs when
 * the cheaper raw + grayscale passes still cannot see today's code. */
async function preprocessColoredTextForOcr(file) {
  try {
    const img = await loadImageBitmap(file)
    const canvas = document.createElement('canvas')
    const scale = Math.max(1, Math.min(2, 1800 / Math.max(img.width, img.height)))
    canvas.width = img.width * scale
    canvas.height = img.height * scale
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(img.src)

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const d = imageData.data
    for (let i = 0; i < d.length; i += 4) {
      const strongest = Math.max(d[i], d[i + 1], d[i + 2])
      const weakest = Math.min(d[i], d[i + 1], d[i + 2])
      const saturated = strongest - weakest > 45
      const value = saturated ? strongest : 0.85 * strongest + 0.15 * weakest
      const binary = value >= 125 ? 255 : 0
      d[i] = d[i + 1] = d[i + 2] = binary
    }
    ctx.putImageData(imageData, 0, 0)
    return canvas
  } catch {
    return file
  }
}

/** Same decision tree the backend runs (lib/vma-voting.ts::checkProofText),
 *  duplicated here ONLY so the player gets an instant, game-like checklist
 *  before spending an actual submission — the server always makes the real
 *  call regardless of what this predicts. */
function checkText(text, cfg, category, expectedCode) {
  const norm = text.toLowerCase().replace(/\s+/g, ' ')
  const has = (s) => norm.includes(s.toLowerCase())
  const hasAny = (arr) => !arr?.length || arr.some((k) => has(k))
  const displayedTotal = extractVoteTotal(text)

  return {
    // Third element = required for "SIGNAL CONFIRMED". BTS/song-title text
    // sits directly over a photo in the real screenshot (album art, a
    // concert still) and Tesseract genuinely struggles with that regardless
    // of preprocessing (verified directly, not assumed) — still shown for
    // transparency, but a miss on just these two no longer forces "SIGNAL
    // UNCLEAR" for an otherwise-real screenshot. Doesn't loosen anything
    // security-relevant: every submission goes to admin review either way
    // (see vma-voting.ts), and the admin can see the actual photo.
    checks: [
      // The mobile page uses a stylized VMA logo and often omits the category
      // heading from the scrolled viewport. These identity checks remain
      // useful hints for the reviewer, but only the vote total + today's code
      // gate upload; every submission is human-reviewed on the backend.
      ['MTV site', has('mtv') || has('vma') || has('vote.mtv.com'), false],
      ['BTS', has('bts'), false],
      ['SWIM', hasAny(cfg.category_keywords?.[category]), false],
      [cfg.category_labels?.[category] || 'Category', hasAny(cfg.category_match_keywords?.[category]), false],
      [displayedTotal != null ? `${displayedTotal} votes` : 'Vote total', displayedTotal != null, true],
      ["Today's code", watermarkMatches(text, expectedCode), true],
    ],
    displayedTotal,
  }
}

function openUploadStep(status, category) {
  const cfg = status.config || {}
  const sheet = el('div', 'sheet vma-sheet')
  sheet.append(el('div', 'eyebrow', 'ADD YOUR PROOF'))

  // (6) The old copy jumped straight to "make sure your screenshot shows
  // X" as if the player had already voted and wrote the code on somehow —
  // it never said WHERE to vote or that writing the code is something THEY
  // do (with their phone's markup tool) before uploading, not something
  // that appears automatically.
  const steps = el('div', 'vma-steps')
  steps.innerHTML = `
    <div class="vma-step${cfg.url ? '' : ' is-done'}"><b>1</b><span>${cfg.url ? `<a href="${esc(cfg.url)}" target="_blank" rel="noopener noreferrer">Vote on MTV</a> for BTS in ${esc(cfg.category_labels?.[category] || category)}` : `Vote on MTV for BTS in ${esc(cfg.category_labels?.[category] || category)}`}</span></div>
    <div class="vma-step"><b>2</b><span>Take a screenshot after voting</span></div>
    <div class="vma-step"><b>3</b><span>Write <b>${esc(status.watermarkCode)}</b> somewhere on the screenshot (your phone's markup/annotate tool) — pick a spot with good contrast, like a dark area, so it stays easy to read</span></div>
    <div class="vma-step"><b>4</b><span>Upload it below</span></div>
  `
  sheet.appendChild(steps)
  sheet.appendChild(el('p', 'muted', 'Make sure the screenshot also shows BTS, SWIM, and your vote total.'))

  const input = el('input')
  input.type = 'file'
  input.accept = 'image/jpeg,image/png'
  input.hidden = true
  const pick = el('button', 'btn btn-primary vma-add-btn', 'UPLOAD SCREENSHOT')
  pick.onclick = () => input.click()
  sheet.append(pick, input)

  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    if (!['image/jpeg', 'image/jpg', 'image/png'].includes(file.type)) {
      toast('Please choose a JPG or PNG image'); return
    }
    if (file.size > MAX_BYTES) {
      toast('That image is too large — please choose one under 5MB'); return
    }
    await openScanStep(status, category, file)
  }

  const back = el('button', 'btn btn-ghost', 'Back')
  back.onclick = () => openCategoryStep(status)
  sheet.appendChild(back)
  showOverlay(sheet)
}

/* ── step 3: scan ──────────────────────────────────────────────────────── */

async function openScanStep(status, category, file) {
  const cfg = status.config || {}
  const sheet = el('div', 'sheet vma-sheet vma-scan')
  sheet.append(el('div', 'eyebrow', 'SCANNING SIGNAL'))
  const spinner = el('div', 'vma-scan-spinner', 'Scanning proof…')
  sheet.appendChild(spinner)
  const list = el('div', 'vma-scan-list')
  sheet.appendChild(list)
  showOverlay(sheet)

  let base64, ocrText = ''
  try {
    base64 = await fileToBase64(file)
    const worker = await getOcrWorker()
    // Two passes, merged: the raw file and a grayscale/contrast-boosted
    // version each recover text the other one misses (verified against a
    // real screenshot where the watermark — plainly readable to a human —
    // was dropped on the raw pass alone). Sequential, not parallel: a
    // Tesseract.js worker processes one recognize() job at a time anyway,
    // and this keeps the two results unambiguous instead of racing.
    const rawResult = await worker.recognize(file)
    let combined = String(rawResult?.data?.text || '')
    try {
      const boosted = await preprocessForOcr(file)
      const boostedResult = await worker.recognize(boosted)
      combined += '\n' + String(boostedResult?.data?.text || '')
    } catch {
      // preprocessing/second pass is a best-effort improvement — the raw
      // pass's text above is still used even if this one fails
    }
    // The example mobile proof writes YOONGI19 in red over a dark card.
    // Luminance-based grayscale suppresses red, so run one color-aware pass
    // only when the first two passes still miss the expected code.
    if (!watermarkMatches(combined, status.watermarkCode)) {
      try {
        const colored = await preprocessColoredTextForOcr(file)
        const coloredResult = await worker.recognize(colored)
        combined += '\n' + String(coloredResult?.data?.text || '')
      } catch {
        // best-effort fallback; the raw and grayscale results remain usable
      }
    }
    ocrText = combined
  } catch {
    ocrText = ''
  }

  const { checks, displayedTotal } = checkText(ocrText, cfg, category, status.watermarkCode)
  const allGood = checks.filter(([, , required]) => required !== false).every(([, ok]) => ok) && displayedTotal != null

  // Reveal one at a time — the "gamify it" beat. Real OCR already
  // finished; this is purely a paced reveal of a result we already have.
  for (let i = 0; i < checks.length; i++) {
    await new Promise((r) => setTimeout(r, 260))
    const [label, ok, required] = checks[i]
    // A missed optional check (BTS/song text over a photo — see checkText)
    // reads as "couldn't confirm," not "wrong," so it doesn't get the same
    // alarm-red ✕ a real failure gets.
    const cls = ok ? ' ok' : required === false ? ' soft' : ' bad'
    const mark = ok ? '✓' : required === false ? '–' : '✕'
    const row = el('div', 'vma-scan-row' + cls, `<span>${mark}</span>${esc(label)}`)
    list.appendChild(row)
  }
  await new Promise((r) => setTimeout(r, 200))
  spinner.remove()

  const resultBox = el('div', 'vma-scan-result')
  if (allGood) {
    resultBox.appendChild(el('div', 'vma-scan-headline good', 'PROOF READY'))
    const send = el('button', 'btn btn-primary vma-add-btn', 'SEND FOR REVIEW')
    send.onclick = () => submitVote(status, category, base64, file.type, ocrText, displayedTotal)
    resultBox.appendChild(send)
  } else {
    resultBox.appendChild(el('div', 'vma-scan-headline bad', 'SIGNAL UNCLEAR'))

    // The watermark code is the one check that exists specifically to stop
    // an old/reused screenshot from being submitted — letting "Send for
    // review" bypass it defeats the whole point, since it'd become the
    // default path for anyone who never bothers adding the code at all.
    // This is also the one failure that's 100% the player's own to fix (add
    // the code, re-upload), unlike OCR misreading something that's
    // genuinely there — so it gets its own message and no escape hatch.
    const watermarkFailed = !checks.find(([label]) => label === "Today's code")?.[1]
    if (watermarkFailed) {
      resultBox.appendChild(el('p', 'muted', `We couldn't find today's code on your screenshot. Add ${esc(status.watermarkCode)} to it (your phone's markup/annotate tool), then upload again.`))
      const retry = el('button', 'btn btn-primary vma-add-btn', 'Try another screenshot')
      retry.onclick = () => openUploadStep(status, category)
      resultBox.appendChild(retry)
      sheet.appendChild(resultBox)
      return
    }

    resultBox.appendChild(el('p', 'muted', "We couldn't confirm everything clearly."))

    // (4) No more silent "|| 1" guess when OCR can't read a number — that
    // fake total became the permanent record with no way to fix it later.
    // If OCR DID find a number, use it (some other check just failed);
    // otherwise ask the player directly rather than inventing one.
    let countInput = null
    if (displayedTotal == null) {
      resultBox.appendChild(el('div', 'vma-count-label', 'How many votes does the screenshot show?'))
      countInput = el('input', 'vma-count-input')
      countInput.type = 'number'
      countInput.min = '1'
      countInput.max = '10000'
      countInput.placeholder = 'e.g. 10'
      resultBox.appendChild(countInput)
    }

    const retry = el('button', 'btn btn-primary vma-add-btn', 'Try another screenshot')
    retry.onclick = () => openUploadStep(status, category)
    const review = el('button', 'btn btn-ghost', 'Send for review')
    review.onclick = () => {
      const manual = countInput ? Math.floor(Number(countInput.value)) : null
      const total = displayedTotal ?? manual
      if (!total || total < 1) { toast('Enter how many votes the screenshot shows'); return }
      submitVote(status, category, base64, file.type, ocrText, total)
    }
    resultBox.append(retry, review)
  }
  sheet.appendChild(resultBox)
}

/* ── step 4: submit + confirm ──────────────────────────────────────────── */

async function submitVote(status, category, imageBase64, imageMime, ocrText, displayedTotal) {
  const sheet = el('div', 'sheet vma-sheet')
  sheet.append(el('div', 'eyebrow', 'VMA SIGNAL MISSION'), el('div', 'vma-loading', 'Sending…'))
  showOverlay(sheet)

  const res = await call('logVmaVote', {
    agentNo: getAgentNo(), category, displayedTotal, imageBase64, imageMime, ocrText,
  })

  sheet.innerHTML = ''
  sheet.appendChild(el('div', 'eyebrow', 'VMA SIGNAL MISSION'))

  if (!res.success) {
    const messages = {
      daily_cap_reached: "You've hit today's voting limit for this category.",
      duplicate_screenshot: 'This screenshot has already been used.',
      voting_closed: 'Voting has closed.',
      bad_image_type: 'Please use a JPG or PNG image.',
      image_too_large: 'That image is too large — please choose one under 5MB.',
    }
    sheet.appendChild(el('p', 'muted', messages[res.error] || "Couldn't send that — please try again."))
    const close = el('button', 'btn btn-ghost', 'Close')
    close.onclick = hideOverlay
    sheet.appendChild(close)
    return
  }

  if (res.verifyStatus === 'pending') {
    sheet.appendChild(el('div', 'vma-scan-headline', 'PROOF RECEIVED'))
    sheet.appendChild(el('p', 'muted', "We're checking this one. Your votes will be added once approved."))
  } else {
    sheet.appendChild(el('div', 'vma-scan-headline good vma-pulse', `+${res.creditedVotes} VOTES SENT`))
    sheet.appendChild(el('p', 'muted', `${res.remaining} more allowed today in this category.`))
  }

  const done = el('button', 'btn btn-primary vma-add-btn', 'Nice')
  done.onclick = async () => {
    const fresh = await fetchStatus()
    if (fresh.success) showMissionSheet(fresh)
    else hideOverlay()
  }
  sheet.appendChild(done)
}
