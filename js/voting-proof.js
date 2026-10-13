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
// The trusted check itself (automatic worker, and the admin panel's retry)
// lives in mnet-trusted-check.js; this file supplies the browser primitives.
import { ocrPassesWith, trustedCheckWith } from './mnet-trusted-check.js'

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

// The browser's primitives for the shared trusted check (mnet-trusted-check.js).
const browserIo = {
  ocr: async (source) => (await (await ocrWorker()).recognize(source)).data.text,
  contrast: (source) => contrastCopy(source),
  pixels: (blob) => imagePixels(blob),
  crop: ({ canvas }, region) => {
    const card = document.createElement('canvas')
    card.width = region.width
    card.height = region.height
    card.getContext('2d').drawImage(canvas, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height)
    return card
  },
}

/** Three booleans for a certificate image (certificate, category, date).
 *  Never returns or keeps the text. This is the player's pre-check. */
export async function ocrCertificate(source, mission, voteDay, window) {
  return (await ocrPassesWith(browserIo, source, mission, voteDay, window)).checks
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
 * The trusted Mnet check on the server-stored image (admin "Retry checks";
 * the automatic worker runs the same steps in Node). See
 * mnet-trusted-check.js. The certificate number and participation time go
 * straight to the server, which fingerprints them and keeps neither.
 */
export async function trustedCertificateCheck(blob, mission, voteDay, window) {
  return trustedCheckWith(browserIo, blob, mission, voteDay, window)
}
