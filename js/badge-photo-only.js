// The photo inside a Polaroid badge, on its own: for the agent avatar spots
// (top bar, Agent ID, Rankings), which show just the photo like any other
// badge. The Badge Collection, story, reveal and leaderboard keep the whole
// Polaroid.
//
// The frame geometry is known exactly (badge-frames.js polaroidLayout), so
// the photo window is cut out of the uploaded art and straightened (the
// frame is tilted), once per image per page load, in a canvas. Badge art is
// served with Access-Control-Allow-Origin: *, so the canvas stays readable.
// Until a cut is ready (or if it fails) the full Polaroid is shown instead.

import { polaroidLayout } from './badge-frames.js'

const OUT = 256 // px: a square the size of the largest avatar spot at 2x and more
const INSET = 0.965 // just inside the window, clear of its rounded corners
const cache = new Map() // key -> data URL | null (failed)
const pending = new Map() // key -> Promise

const keyOf = (url, frame) => `${frame}|${url}`

/** The photo-only image if it is ready, else null (and starts making it). */
export function photoOnlyCached(url, frame) {
  const key = keyOf(url, frame)
  if (cache.has(key)) return cache.get(key)
  photoOnly(url, frame)
  return null
}

/** Resolves to a data URL of the photo inside the frame, or null. */
export function photoOnly(url, frame) {
  const key = keyOf(url, frame)
  if (cache.has(key)) return Promise.resolve(cache.get(key))
  if (pending.has(key)) return pending.get(key)
  const job = new Promise((resolve) => {
    if (typeof Image === 'undefined' || typeof document === 'undefined') { resolve(null); return }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    img.onload = () => {
      try { resolve(cutPhoto(img, frame)) } catch (_) { resolve(null) }
    }
    img.onerror = () => resolve(null)
    img.src = url
  }).then((result) => { cache.set(key, result); pending.delete(key); return result })
  pending.set(key, job)
  return job
}

/** Where the photo window sits, as fractions of the art's side: its centre
 *  in the frame's own (unrotated) coordinates, its side, and the tilt. */
export function photoWindow(frame) {
  const L = polaroidLayout(1, frame)
  return { cx: 0.5, cy: L.y + L.side + L.photo / 2, side: L.photo, tilt: L.tilt }
}

function cutPhoto(img, frame) {
  const n = img.naturalWidth || img.width
  if (!n) return null
  const w = photoWindow(frame)
  const canvas = document.createElement('canvas')
  canvas.width = OUT
  canvas.height = OUT
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // canvas <- the window, scaled to fill <- undo the frame's tilt <- the art
  ctx.translate(OUT / 2, OUT / 2)
  ctx.scale(OUT / (w.side * n * INSET), OUT / (w.side * n * INSET))
  ctx.translate(-w.cx * n, -w.cy * n)
  ctx.translate(n / 2, n / 2)
  ctx.rotate((-w.tilt * Math.PI) / 180)
  ctx.translate(-n / 2, -n / 2)
  ctx.drawImage(img, 0, 0, n, n)
  return canvas.toDataURL('image/webp', 0.92)
}

/** Swap a Polaroid <img> for the photo-only cut once it is ready: the
 *  holder loses `is-polaroid`, so the spot falls back to its normal badge
 *  look. Used where a screen rendered before the cut was ready. */
export function swapToPhotoOnly(imgEl, holderEl, url, frame) {
  photoOnly(url, frame).then((src) => {
    if (!src || !imgEl?.isConnected) return
    imgEl.removeAttribute('data-badge-full')
    imgEl.src = src
    holderEl?.classList.remove('is-polaroid')
  })
}
