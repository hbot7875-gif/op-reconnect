// Browser side of a voting proof: fingerprint, clean, and (optionally) read.
//
//   1. hash the ORIGINAL file, before anything touches it, so the same
//      screenshot is recognised however it is re-encoded later;
//   2. re-encode through a canvas to a plain JPEG — that drops EXIF,
//      including GPS location, before a single byte leaves the phone;
//   3. OCR is assistive only: it produces three booleans for a friendly
//      pre-check. The text itself never leaves this module, and the server
//      never uses the booleans to decide anything.
//
// The admin panel reuses ocrCertificate() for its trusted check run, on the
// server-stored image rather than anything a player sent.
import {
  evaluateCertificateText, certificateNumberFromText, certificateNumberConsensus, participationTime,
} from '../supabase/functions/op-reconnect/lib/vote-campaign-rules.js'

export async function sha256OfBlob(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** A plain JPEG copy with no metadata, longest side capped. */
export async function reencodeImage(file, { maxSide = 2000, quality = 0.9 } = {}) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff' // transparent PNG areas become white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode_failed'))), 'image/jpeg', quality))
  return blob
}

export async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(s)
}

let workerPromise = null
async function ocrWorker() {
  if (workerPromise) return workerPromise
  workerPromise = (async () => {
    // Loaded only when a certificate is actually checked; same self-hosted
    // runtime the VMA scanner uses (vite.config.js copies it to /ocr).
    const { createWorker } = await import('tesseract.js')
    const origin = window.location.origin
    const worker = await createWorker('eng', 1, {
      workerPath: `${origin}/ocr/worker.min.js`,
      corePath: `${origin}/ocr/core`,
      langPath: `${origin}/ocr/lang`,
    })
    await worker.setParameters({ tessedit_pageseg_mode: '11' })
    return worker
  })().catch((e) => { workerPromise = null; throw e })
  return workerPromise
}

/** Upscaled greyscale copy: small certificate text reads far better. */
async function contrastCopy(blob) {
  const bitmap = await createImageBitmap(blob)
  const scale = Math.max(1, Math.min(2, 1600 / bitmap.width))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  ctx.filter = 'grayscale(1) contrast(1.6)'
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  return canvas
}

/** OCR passes over one image: the three text checks, plus every pass's
 *  text kept in memory only for the trusted check's number/time reads. */
async function ocrPasses(source, mission, voteDay, window) {
  const worker = await ocrWorker()
  const texts = [(await worker.recognize(source)).data.text]
  const first = evaluateCertificateText(texts[0], mission, voteDay, window)
  if (first.certificate && first.category && first.date) return { checks: first, texts }
  texts.push((await worker.recognize(await contrastCopy(source))).data.text)
  const second = evaluateCertificateText(texts[1], mission, voteDay, window)
  return { checks: { certificate: first.certificate || second.certificate, category: first.category || second.category, date: first.date || second.date }, texts }
}

/** Three booleans for a certificate image (certificate, category, date).
 *  Never returns or keeps the text. This is the player's pre-check. */
export async function ocrCertificate(source, mission, voteDay, window) {
  return (await ocrPasses(source, mission, voteDay, window)).checks
}

/** Pixels for the image matcher, capped so a huge screenshot stays quick. */
async function imagePixels(blob, maxWidth = 1400) {
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, maxWidth / bitmap.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  return { canvas, img: ctx.getImageData(0, 0, canvas.width, canvas.height) }
}

/**
 * The trusted Mnet check (admin "Run checks", on the server-stored image):
 * the BTS artist-tile match, then OCR of the whole image and of the
 * certificate card the match located. Returns booleans, the image result,
 * and — for duplicate detection only — the certificate number (when at
 * least two passes read exactly the same value; otherwise null, never a
 * guess) and the participation time. Those two go straight to the server,
 * which fingerprints them and keeps neither.
 */
export async function trustedCertificateCheck(blob, mission, voteDay, window) {
  const { matchBtsTile, certificateRegion } = await import('./bts-tile-match.js')
  const { canvas, img } = await imagePixels(blob)
  const tile = matchBtsTile(img)
  const pass = await ocrPasses(blob, mission, voteDay, window)
  let text = pass.checks
  const texts = [...pass.texts]
  const region = certificateRegion(tile.box, canvas.width, canvas.height)
  if (region) {
    const card = document.createElement('canvas')
    card.width = region.width
    card.height = region.height
    card.getContext('2d').drawImage(canvas, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height)
    const p2 = await ocrPasses(card, mission, voteDay, window)
    texts.push(...p2.texts)
    text = { certificate: text.certificate || p2.checks.certificate, category: text.category || p2.checks.category, date: text.date || p2.checks.date }
  }
  const len = Number(mission?.certificate?.number_length) || 16
  const certificateNumber = certificateNumberConsensus(texts.map((t) => certificateNumberFromText(t, len)), len)
  const at = texts.map(participationTime).find(Boolean) || null
  return { checks: { ...text, bts: tile.result, btsScore: tile.score }, certificateNumber, participationAt: at ? at.toISOString() : null }
}
