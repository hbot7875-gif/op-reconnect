// Automatic Mnet certificate verification (MAMA 2026 first).
//
// Runs in GitHub Actions (.github/workflows/mnet-auto-verify.yml): started
// right after an upload (workflow_dispatch from the Edge Function) and
// every 5 minutes as a safety net. Each run:
//   1. asks op-reconnect for proofs still `verifying` (adminListCampaignProofs),
//   2. runs the trusted check — the exact steps of the admin panel's check
//      (js/mnet-trusted-check.js), with sharp + tesseract.js in place of a
//      canvas — on the server-stored image,
//   3. reports the result with adminRecordCampaignChecks. The server and
//      database decide: all checks pass → verified (credit applied once, in
//      the same transaction); anything else → In review.
//
// Safe to run twice, retry or overlap: the database locks the proof row and
// only acts while it is still `verifying`; a second report gets
// `status_changed` and changes nothing. A proof that fails to process stays
// `verifying` and is simply tried again on the next run.
//
// Never logs OCR text, the certificate number or the participation time.
//
//   ADMIN_KEY=… node scripts/mnet-verify-worker.mjs           # verify
//   ADMIN_KEY=… DRY_RUN=1 node scripts/mnet-verify-worker.mjs # check only, record nothing
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { trustedCheckWith } from '../js/mnet-trusted-check.js'

const FUNCTION_URL = process.env.OP_FUNCTION_URL || 'https://lcvmwlioqpyaprxicdfl.supabase.co/functions/v1/op-reconnect'
const ACTOR = 'auto-check'
const IMAGE_TIMEOUT_MS = 20_000
const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const GIVE_UP_AFTER_MS = 30 * 60_000

/** sharp + tesseract.js primitives for trustedCheckWith. Same parameters as
 *  the browser: page-segmentation mode 11, the self-hosted best_int English
 *  model, 2× greyscale/contrast copy, matcher input capped at 1400 px. */
export async function nodeIo() {
  const require = createRequire(import.meta.url)
  const { default: sharp } = await import('sharp')
  const { createWorker } = await import('tesseract.js')
  const langPath = join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int')
  const worker = await createWorker('eng', 1, { langPath, cacheMethod: 'none' })
  await worker.setParameters({ tessedit_pageseg_mode: '11' })
  const io = {
    ocr: async (buf) => (await worker.recognize(buf)).data.text,
    contrast: async (buf) => {
      const { width, height } = await sharp(buf).metadata()
      const scale = Math.max(1, Math.min(2, 1600 / width))
      // CSS contrast(c) is (v − 128)·c + 128.
      return sharp(buf).resize(Math.round(width * scale), Math.round(height * scale))
        .grayscale().linear(1.6, -0.6 * 128).png().toBuffer()
    },
    pixels: async (buf, maxWidth = 1400) => {
      const { width } = await sharp(buf).metadata()
      const w = Math.round(width * Math.min(1, maxWidth / width))
      const { data, info } = await sharp(buf).resize({ width: w }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      return { img: { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) }, raw: data, info }
    },
    crop: ({ raw, info }, r) => sharp(raw, { raw: { width: info.width, height: info.height, channels: 4 } })
      .extract({ left: r.x, top: r.y, width: r.width, height: r.height }).png().toBuffer(),
    // The "Participation Date" row across the full width, 3× (capped), for
    // the date-only last pass. Located from the OCR's own line boxes.
    dateRow: async (buf) => {
      const { data } = await worker.recognize(buf, {}, { blocks: true })
      const line = (data.blocks || []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines)).find((l) => /participation/i.test(l.text))
      if (!line) return null
      const { width, height } = await sharp(buf).metadata()
      const h = line.bbox.y1 - line.bbox.y0
      const top = Math.max(0, line.bbox.y0 - Math.round(h * 0.6))
      const rowHeight = Math.min(height - top, h + 2 * Math.round(h * 0.6))
      if (rowHeight <= 0) return null
      return sharp(buf).extract({ left: 0, top, width, height: rowHeight })
        .resize({ width: Math.min(width * 3, 3200) }).grayscale().normalise().png().toBuffer()
    },
    // Under 1000 px wide, an upscaled, sharpened copy for one more read.
    enlarge: async (buf) => {
      const { width } = await sharp(buf).metadata()
      if (!width || width >= 1000) return null
      return sharp(buf).resize({ width: 1400, kernel: 'lanczos3' }).grayscale().normalise().sharpen().png().toBuffer()
    },
    close: () => worker.terminate(),
  }
  return io
}

/** POST one op-reconnect action. */
export function makeCaller(adminKey, url = FUNCTION_URL, fetchFn = fetch) {
  return async (action, params = {}) => {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-region': 'ap-northeast-2' },
      body: JSON.stringify({ action, adminKey, ...params }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok && body?.success !== false) return { success: false, error: `http_${res.status}` }
    return body
  }
}

async function downloadImage(url, fetchFn = fetch) {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`image_http_${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('image_too_large')
  return buf
}

/**
 * One pass over the queue. Returns a summary; never throws for a single
 * bad proof — that one stays `verifying` for the next run.
 */
export async function verifyPending({ call, check, download = downloadImage, dryRun = false, log = console.log, limit = 50 }) {
  const list = await call('adminListCampaignProofs', { status: 'verifying', limit })
  if (!list?.success) {
    // No campaign running is a normal, quiet state.
    if (list?.error === 'no_campaign') return { checked: 0, verified: 0, review: 0, skipped: 0, failed: 0 }
    throw new Error(`list_failed:${list?.error || 'unknown'}`)
  }
  const proofs = (list.proofs || []).filter((p) => p.kind === 'mnet_certificate')
  const out = { checked: 0, verified: 0, review: 0, skipped: 0, failed: 0 }
  for (const p of proofs) {
    if (!p.proofUrl) { out.skipped++; log(`proof ${p.id}: no stored image — left for review`); continue }
    try {
      const t = await check(await download(p.proofUrl), { certificate: p.certificate || {} }, p.vote_day, p.window || {})
      out.checked++
      const summary = `certificate=${t.checks.certificate} category=${t.checks.category} date=${t.checks.date} bts=${t.checks.bts} number=${t.certificateNumber ? 'read' : 'unread'} time=${t.participationAt ? 'read' : 'unread'}`
      if (dryRun) { log(`proof ${p.id}: DRY RUN ${summary}`); continue }
      const r = await call('adminRecordCampaignChecks', {
        proofId: p.id, checks: t.checks, certificateNumber: t.certificateNumber, participationAt: t.participationAt, admin: ACTOR,
      })
      if (r?.success) {
        if (r.status === 'verified') out.verified++
        else out.review++
        log(`proof ${p.id}: ${r.status} (${summary})`)
      } else if (r?.error === 'status_changed') {
        out.skipped++ // decided elsewhere (another run, or a reviewer) — nothing to do
        log(`proof ${p.id}: already ${r.status || 'decided'}`)
      } else {
        out.failed++
        log(`proof ${p.id}: record failed (${r?.error || 'unknown'})`)
      }
    } catch (e) {
      const why = String(e?.message || e).slice(0, 120)
      // Still failing well after upload (an unreadable file, say): hand it to
      // a reviewer rather than retrying forever. No credit either way.
      const age = Date.now() - new Date(p.submitted_at).getTime()
      if (!dryRun && age > GIVE_UP_AFTER_MS) {
        const r = await call('adminReviewCampaignProof', { proofId: p.id, decision: 'keep', note: 'auto_check_failed', admin: ACTOR }).catch(() => null)
        if (r?.success) { out.review++; log(`proof ${p.id}: check failed (${why}) — moved to review`); continue }
      }
      out.failed++
      log(`proof ${p.id}: check failed (${why}) — will retry next run`)
    }
  }
  return out
}

async function main() {
  const adminKey = process.env.ADMIN_KEY || ''
  if (!adminKey) { console.error('ADMIN_KEY is not set'); process.exit(1) }
  const dryRun = /^(1|true|yes)$/i.test(process.env.DRY_RUN || '')
  const call = makeCaller(adminKey)
  let io = null
  const check = async (buf, mission, voteDay, window) => {
    io ||= await nodeIo() // only load OCR when there is something to read
    return trustedCheckWith(io, buf, mission, voteDay, window)
  }
  try {
    const s = await verifyPending({ call, check, dryRun })
    console.log(`done: checked ${s.checked}, verified ${s.verified}, in review ${s.review}, skipped ${s.skipped}, failed ${s.failed}${dryRun ? ' (dry run)' : ''}`)
    if (s.failed) process.exitCode = 1
  } finally {
    await io?.close()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main()
