// Does this MAMA 2026 voting certificate show the BTS artist tile?
//
// Every BTS Fans' Choice certificate uses the same official BTS artist
// image, so this is template matching against one known picture — not face
// recognition, not identification of anyone. No embeddings, no external
// service: a few hundred lines of arithmetic over pixels.
//
// Method (pure, no DOM — Node tests run the exact code the admin panel runs):
//   1. luminance and saturation integral images of the upload;
//   2. search square windows over several scales and positions (the tile can
//      sit in either artist slot, inside a phone screenshot of any size);
//   3. sample each window's inner area into a GRID×GRID grid of box means;
//   4. Pearson correlation with the reference grid — zero-mean, unit-norm,
//      so overall brightness and contrast changes cancel out;
//   5. a coarse pass finds candidates, a fine pass re-centres the best ones
//      (tolerates resizing and small crops);
//   6. the BTS tile is a black-and-white photo, so a high-colour window is
//      never called a match on correlation alone.
// Returns only 'match' | 'unclear' | 'no_match' plus numbers for reviewers.
import { BTS_TILE_REF_24, BTS_TILE_REF_12 } from './bts-tile-reference.js'

export const MATCH_THRESHOLD = 0.86   // ≥ this, and low colour → match
export const UNCLEAR_THRESHOLD = 0.70 // ≥ this → unclear (a reviewer decides)
export const MAX_MATCH_SATURATION = 0.08 // mean chroma; the BTS tile is black and white
const INSET = 0.08 // skip the tile's rounded corners and edge bleed

/** Luminance (0–1) and chroma (0–1) integral images of RGBA/RGB pixels. */
export function integrals({ width: w, height: h, data, channels = 4 }) {
  const L = new Float64Array((w + 1) * (h + 1))
  const S = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let rl = 0
    let rs = 0
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels
      const r = data[i] / 255
      const g = data[i + 1] / 255
      const b = data[i + 2] / 255
      const mx = Math.max(r, g, b)
      const mn = Math.min(r, g, b)
      rl += 0.299 * r + 0.587 * g + 0.114 * b
      rs += mx - mn // chroma: dark compression noise stays near zero
      const o = (y + 1) * (w + 1) + (x + 1)
      L[o] = L[o - (w + 1)] + rl
      S[o] = S[o - (w + 1)] + rs
    }
  }
  return { w, h, L, S }
}

function boxMean(I, W1, x0, y0, x1, y1) {
  const a = Math.max(0, Math.floor(x0))
  const b = Math.max(0, Math.floor(y0))
  const c = Math.max(a + 1, Math.ceil(x1))
  const d = Math.max(b + 1, Math.ceil(y1))
  return (I[d * W1 + c] - I[b * W1 + c] - I[d * W1 + a] + I[b * W1 + a]) / ((c - a) * (d - b))
}

/** A window's inner area as a zero-mean, unit-length grid vector. */
export function windowVector(ii, x, y, size, grid) {
  const W1 = ii.w + 1
  const pad = size * INSET
  const inner = size - 2 * pad
  const cell = inner / grid
  const v = new Float64Array(grid * grid)
  let mean = 0
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const x0 = x + pad + gx * cell
      const y0 = y + pad + gy * cell
      const m = boxMean(ii.L, W1, x0, y0, x0 + cell, y0 + cell)
      v[gy * grid + gx] = m
      mean += m
    }
  }
  mean /= v.length
  let norm = 0
  for (let i = 0; i < v.length; i++) { v[i] -= mean; norm += v[i] * v[i] }
  norm = Math.sqrt(norm)
  if (norm < 1e-6) return null // flat area: nothing to compare
  for (let i = 0; i < v.length; i++) v[i] /= norm
  return v
}

function corr(a, b) {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

function windowSaturation(ii, x, y, size) {
  const pad = size * INSET
  return boxMean(ii.S, ii.w + 1, x + pad, y + pad, x + size - pad, y + size - pad)
}

/**
 * img: { width, height, data, channels? } (RGBA by default).
 * Returns { result, score, saturation, box } — result is the only thing a
 * player-facing surface may ever see.
 */
export function matchBtsTile(img, opts = {}) {
  const ref24 = opts.ref24 || BTS_TILE_REF_24
  const ref12 = opts.ref12 || BTS_TILE_REF_12
  const ii = integrals(img)
  const { w, h } = ii
  const short = Math.min(w, h)
  if (short < 60) return { result: 'unclear', score: 0, saturation: null, box: null }

  // Coarse: tile sizes from 15% to 50% of the image width (a certificate
  // alone ≈ 36%; a phone screenshot of the certificate page ≈ 30–34%).
  const cands = []
  for (let size = Math.max(40, w * 0.15); size <= Math.min(w * 0.5, h); size *= 1.07) {
    const step = Math.max(2, size / 10)
    for (let y = 0; y + size <= h; y += step) {
      for (let x = 0; x + size <= w; x += step) {
        const v = windowVector(ii, x, y, size, 12)
        if (!v) continue
        const s = corr(v, ref12)
        if (s > 0.35) cands.push({ s, x, y, size })
      }
    }
  }
  cands.sort((a, b) => b.s - a.s)
  const seeds = []
  for (const c of cands) {
    if (seeds.length >= 6) break
    if (seeds.every((d) => Math.abs(d.x - c.x) > d.size / 3 || Math.abs(d.y - c.y) > d.size / 3)) seeds.push(c)
  }

  // Fine: re-centre and re-scale around each seed on the full grid.
  let best = { s: -1, x: 0, y: 0, size: 0 }
  for (const sd of seeds) {
    for (const k of [0.94, 0.97, 1, 1.03, 1.06]) {
      const size = sd.size * k
      const step = Math.max(1, size / 48)
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = sd.x + dx * step
          const y = sd.y + dy * step
          if (x < 0 || y < 0 || x + size > w || y + size > h) continue
          const v = windowVector(ii, x, y, size, 24)
          if (!v) continue
          const s = corr(v, ref24)
          if (s > best.s) best = { s, x, y, size }
        }
      }
    }
  }
  if (best.s < 0) return { result: 'no_match', score: 0, saturation: null, box: null }
  const saturation = windowSaturation(ii, best.x, best.y, best.size)
  const score = Math.round(best.s * 1000) / 1000
  let result = 'no_match'
  if (best.s >= MATCH_THRESHOLD && saturation <= MAX_MATCH_SATURATION) result = 'match'
  else if (best.s >= UNCLEAR_THRESHOLD) result = 'unclear'
  return {
    result, score, saturation: Math.round(saturation * 1000) / 1000,
    box: { x: Math.round(best.x), y: Math.round(best.y), size: Math.round(best.size) },
  }
}

/** Builds reference vectors from a tile image (used once, offline). */
export function referenceVectors(tileImg) {
  const ii = integrals(tileImg)
  const size = Math.min(ii.w, ii.h)
  return { ref24: windowVector(ii, 0, 0, size, 24), ref12: windowVector(ii, 0, 0, size, 12) }
}

/**
 * Where the certificate card probably is, from the matched tile's box —
 * the reference layout has the tile 286px wide on a 790×1199 card. The
 * crop is generous enough for the tile sitting in either artist slot, and
 * lets OCR read the card's own text instead of a whole phone screen.
 */
export function certificateRegion(box, width, height) {
  if (!box) return null
  const u = box.size / 286
  const x0 = Math.max(0, Math.floor(box.x - 420 * u))
  const x1 = Math.min(width, Math.ceil(box.x + 286 * u + 420 * u))
  const y0 = Math.max(0, Math.floor(box.y - 340 * u))
  const y1 = Math.min(height, Math.ceil(box.y + 286 * u + 600 * u))
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}
