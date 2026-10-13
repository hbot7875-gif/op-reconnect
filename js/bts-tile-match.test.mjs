// BTS artist-tile matcher. Uses 48×48 greyscale thumbnails of the two
// artist tiles from the launch reference certificate (bts-tile-fixtures.js)
// to build synthetic certificates — the certificate itself, which shows its
// number, is never committed. The real-image run (original, resized,
// JPEG/WebP, brightness, contrast, crops, phone screenshots, other BTS
// photos) is reported in the release notes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { matchBtsTile, certificateRegion, MATCH_THRESHOLD, UNCLEAR_THRESHOLD } from './bts-tile-match.js'
import { BTS_TILE_REF_24, BTS_TILE_REF_12 } from './bts-tile-reference.js'
import { BTS_TILE_48, OTHER_TILE_48 } from './bts-tile-fixtures.js'

/** A blank RGBA canvas. */
function canvas(w, h, rgb = [238, 238, 246]) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4)
  return { width: w, height: h, data }
}

/** Draws a 48×48 grey thumbnail at (x, y), scaled to `size`, bilinear,
 *  through an optional per-pixel transform (v → [r, g, b]). */
function draw(img, thumb, x, y, size, tf = (v) => [v, v, v]) {
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const fx = (dx / size) * 47
      const fy = (dy / size) * 47
      const x0 = Math.floor(fx)
      const y0 = Math.floor(fy)
      const x1 = Math.min(47, x0 + 1)
      const y1 = Math.min(47, y0 + 1)
      const ax = fx - x0
      const ay = fy - y0
      const v = thumb[y0 * 48 + x0] * (1 - ax) * (1 - ay) + thumb[y0 * 48 + x1] * ax * (1 - ay)
        + thumb[y1 * 48 + x0] * (1 - ax) * ay + thumb[y1 * 48 + x1] * ax * ay
      const [r, g, b] = tf(v)
      const i = ((y + dy) * img.width + (x + dx)) * 4
      img.data[i] = r
      img.data[i + 1] = g
      img.data[i + 2] = b
    }
  }
  return img
}

/** A certificate-shaped image: two artist tiles side by side. */
function certificate({ left = BTS_TILE_48, right = OTHER_TILE_48, scale = 1, tf, bg } = {}) {
  const w = Math.round(400 * scale)
  const h = Math.round(600 * scale)
  const size = Math.round(145 * scale)
  const img = canvas(w, h, bg)
  draw(img, left, Math.round(48 * scale), Math.round(170 * scale), size, tf)
  draw(img, right, Math.round(208 * scale), Math.round(170 * scale), size, tf)
  return img
}

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)))

test('reference vectors are normalised (zero mean, unit length)', () => {
  for (const ref of [BTS_TILE_REF_24, BTS_TILE_REF_12]) {
    const mean = ref.reduce((s, x) => s + x, 0) / ref.length
    const norm = Math.sqrt(ref.reduce((s, x) => s + x * x, 0))
    assert.ok(Math.abs(mean) < 1e-3, `mean ${mean}`)
    assert.ok(Math.abs(norm - 1) < 1e-3, `norm ${norm}`)
  }
  assert.equal(BTS_TILE_REF_24.length, 576)
  assert.ok(MATCH_THRESHOLD > UNCLEAR_THRESHOLD)
})

test('matches the BTS tile: as-is, smaller, larger, in the right-hand slot', () => {
  for (const [label, img] of [
    ['as-is', certificate()],
    ['60% size', certificate({ scale: 0.6 })],
    ['160% size', certificate({ scale: 1.6 })],
    ['right-hand slot', certificate({ left: OTHER_TILE_48, right: BTS_TILE_48 })],
  ]) {
    const r = matchBtsTile(img)
    assert.equal(r.result, 'match', `${label}: ${JSON.stringify(r)}`)
  }
})

test('tolerates brightness, contrast and noise changes', () => {
  let seed = 7
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  for (const [label, tf] of [
    ['brighter', (v) => Array(3).fill(clamp(v * 1.15 + 10))],
    ['darker', (v) => Array(3).fill(clamp(v * 0.8))],
    ['more contrast', (v) => Array(3).fill(clamp((v - 128) * 1.3 + 128))],
    ['less contrast', (v) => Array(3).fill(clamp((v - 128) * 0.7 + 128))],
    ['compression-like noise', (v) => Array(3).fill(clamp(v + (rnd() - 0.5) * 24))],
  ]) {
    const r = matchBtsTile(certificate({ tf }))
    assert.equal(r.result, 'match', `${label}: ${JSON.stringify(r)}`)
  }
})

test('tolerates the certificate sitting inside a larger phone screenshot', () => {
  const shot = canvas(720, 1560, [16, 16, 20])
  const cert = certificate({ scale: 1.6 })
  for (let y = 0; y < cert.height; y++) {
    const src = cert.data.subarray(y * cert.width * 4, (y + 1) * cert.width * 4)
    shot.data.set(src, ((y + 200) * shot.width + 40) * 4)
  }
  const r = matchBtsTile(shot)
  assert.equal(r.result, 'match', JSON.stringify(r))
  const reg = certificateRegion(r.box, shot.width, shot.height)
  assert.ok(reg.x <= 40 + 5 && reg.y <= 200 + 5 && reg.x + reg.width >= 40 + 640 - 5, `card region ${JSON.stringify(reg)}`)
})

test('does not match other artists, empty tiles, inverted images or colour photos', () => {
  for (const [label, img] of [
    ['other artist in both slots', certificate({ left: OTHER_TILE_48, right: OTHER_TILE_48 })],
    ['empty grey tiles', certificate({ left: new Array(2304).fill(180), right: new Array(2304).fill(180) })],
    ['inverted BTS tile', certificate({ left: BTS_TILE_48.map((v) => 255 - v), right: OTHER_TILE_48 })],
  ]) {
    const r = matchBtsTile(img)
    assert.equal(r.result, 'no_match', `${label}: ${JSON.stringify(r)}`)
  }
  // Same shapes but strongly coloured: never an automatic match.
  const tinted = matchBtsTile(certificate({ tf: (v) => [clamp(v * 1.2 + 40), clamp(v * 0.7), clamp(v * 0.4)] }))
  assert.notEqual(tinted.result, 'match', JSON.stringify(tinted))
})

test('a tiny or blank image is unclear or no match, never a match', () => {
  assert.equal(matchBtsTile(canvas(40, 40)).result, 'unclear')
  assert.notEqual(matchBtsTile(canvas(400, 600)).result, 'match')
})

test('output carries only the result and reviewer numbers', () => {
  const r = matchBtsTile(certificate())
  assert.deepEqual(Object.keys(r).sort(), ['box', 'result', 'saturation', 'score'])
})
