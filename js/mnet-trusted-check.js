// The trusted Mnet certificate check, independent of where it runs.
//
// The same steps run in two places:
//   * the admin panel's "Retry checks" (browser canvas + tesseract worker,
//     voting-proof.js), and
//   * the automatic worker (Node + sharp + tesseract, scripts/mnet-verify-worker.mjs).
// Each passes an `io` adapter for its own image and OCR primitives; the
// order of passes, the text rules, the BTS tile match and the number/time
// reads are all here, once.
//
//   io.ocr(source)            → OCR text of an image
//   io.contrast(source)       → upscaled greyscale/contrast copy (a source)
//   io.pixels(source)         → { img: {width, height, data(RGBA)}, ... } capped at 1400 px wide
//   io.crop(scaled, region)   → the region of a pixels() result, as a source
//   io.dateRow(source)        → optional: the "Participation Date" row alone,
//                               enlarged, as a source (or null if not found)
//   io.enlarge(source)        → optional: a small screenshot scaled up and
//                               sharpened, as a source (or null if it's big)
//
// Nothing here returns or keeps OCR text. The certificate number and
// participation time leave only as values for the server to fingerprint.
import {
  evaluateCertificateText, certificateNumberFromText, certificateNumberConsensus, participationTime,
} from '../supabase/functions/op-reconnect/lib/vote-campaign-rules.js'

/** OCR passes over one image: the three text checks, plus every pass's
 *  text kept in memory only for the number/time reads. A second, higher-
 *  contrast pass runs only when the first didn't read everything. */
export async function ocrPassesWith(io, source, mission, voteDay, window) {
  const texts = [await io.ocr(source)]
  const first = evaluateCertificateText(texts[0], mission, voteDay, window)
  if (first.certificate && first.category && first.date) return { checks: first, texts }
  texts.push(await io.ocr(await io.contrast(source)))
  const second = evaluateCertificateText(texts[1], mission, voteDay, window)
  return { checks: { certificate: first.certificate || second.certificate, category: first.category || second.category, date: first.date || second.date }, texts }
}

/**
 * The BTS artist-tile match, then OCR of the whole image and of the
 * certificate card the match located. Returns booleans, the image result,
 * and — for duplicate detection only — the certificate number (when at
 * least two passes read exactly the same value; otherwise null, never a
 * guess) and the participation time.
 */
export async function trustedCheckWith(io, source, mission, voteDay, window) {
  const { matchBtsTile, certificateRegion } = await import('./bts-tile-match.js')
  const scaled = await io.pixels(source)
  const tile = matchBtsTile(scaled.img)
  const pass = await ocrPassesWith(io, source, mission, voteDay, window)
  let text = pass.checks
  const texts = [...pass.texts]
  const region = certificateRegion(tile.box, scaled.img.width, scaled.img.height)
  if (region) {
    const p2 = await ocrPassesWith(io, await io.crop(scaled, region), mission, voteDay, window)
    texts.push(...p2.texts)
    text = { certificate: text.certificate || p2.checks.certificate, category: text.category || p2.checks.category, date: text.date || p2.checks.date }
  }
  // Last resort, for the date only: Mnet prints the participation time small,
  // grey and right-aligned, and whole-image passes can drop it entirely
  // (seen 2026-10-15). Read that row on its own, enlarged. Same date rule,
  // same window — nothing is loosened. Adapters without dateRow skip it.
  if (io.dateRow && (!text.date || !texts.some((t) => participationTime(t)))) {
    const row = await io.dateRow(source)
    if (row) {
      const t = await io.ocr(row)
      texts.push(t)
      text = { ...text, date: text.date || evaluateCertificateText(t, mission, voteDay, window).date }
    }
  }
  // Small screenshots (forwarded or cropped) lose the small print: read an
  // enlarged copy once more for whatever is still missing. Same rules — it
  // can only find words that are really there (seen 2026-10-19).
  if (io.enlarge && !(text.certificate && text.category && text.date)) {
    const big = await io.enlarge(source)
    if (big) {
      const p3 = await ocrPassesWith(io, big, mission, voteDay, window)
      texts.push(...p3.texts)
      text = { certificate: text.certificate || p3.checks.certificate, category: text.category || p3.checks.category, date: text.date || p3.checks.date }
    }
  }
  const len = Number(mission?.certificate?.number_length) || 16
  const certificateNumber = certificateNumberConsensus(texts.map((t) => certificateNumberFromText(t, len)), len)
  // Read as KST on purpose: this only feeds the duplicate-time fingerprint,
  // which must be the same printed minute whoever uploads the certificate.
  const at = texts.map((t) => participationTime(t)).find(Boolean) || null
  return { checks: { ...text, bts: tile.result, btsScore: tile.score }, certificateNumber, participationAt: at ? at.toISOString() : null }
}
