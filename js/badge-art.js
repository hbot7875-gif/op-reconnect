// Badge photo thumbnails.
//
// Every badge photo in the vault is a full-size upload (measured 30–80 KB
// each); the Rankings list alone showed 51 of them as 34px icons — ~2.5 MB
// per open on a phone. That used to be fixed with Supabase's on-the-fly
// /render/image/ endpoint, which resized beautifully but is billed per
// DISTINCT ORIGIN IMAGE per month, not per request. 340 badge photos sit in
// live player collections against a 100-image Pro allowance, so the Badge
// Drawer alone took the account to 173% in two days.
//
// The thumbnails are therefore pre-rendered ONCE, locally, by
// scripts/generate-badge-thumbs.mjs (sharp) and stored as ordinary objects
// beside the originals. They are served from /object/public/, so no
// transformation is ever billed however often they are viewed.
//
// The story sheet, the Agent ID avatar crop and the share cards keep the
// original URL — they want full resolution. Anything that is not a public
// badge-art URL passes straight through.

const OBJECT_PREFIX = '/storage/v1/object/public/badge-art/'

// One size serves all three call sites: the Badge Drawer's ~94px tile at 2×.
// Rankings (60px) and the HUD crest (48px) draw the same file smaller. Giving
// them their own sizes would cost nothing in transformations now, but three
// objects per badge instead of one — and at this size the saving is a couple
// of KB, well under what a second request costs.
export const THUMB_PX = 188
export const THUMB_DIR = `thumb/${THUMB_PX}/`

/** The static thumbnail URL for a public badge-art URL, or the URL unchanged
 *  if it isn't one.
 *
 *  The thumbnail keeps the original's whole path INCLUDING its extension and
 *  appends `.webp`, so `cute/a.jpg` and `cute/a.webp` can never collide on a
 *  single thumbnail. */
export function badgeThumb(url) {
  if (!url || typeof url !== 'string') return url
  const at = url.indexOf(OBJECT_PREFIX)
  if (at < 0) return url
  const cut = at + OBJECT_PREFIX.length
  const path = url.slice(cut)
  // Never re-thumbnail a thumbnail, and leave a URL carrying a query or hash
  // alone rather than guessing where its object path ends.
  if (!path || path.startsWith(THUMB_DIR) || /[?#]/.test(path)) return url
  return `${url.slice(0, cut)}${THUMB_DIR}${path}.webp`
}

/** Storage object path for a thumbnail, given the original's storage path.
 *  Shared with the generator script so both sides cannot drift. */
export function thumbStoragePath(storagePath) {
  const p = String(storagePath || '')
  if (!p || p.startsWith(THUMB_DIR)) return null
  return `${THUMB_DIR}${p}.webp`
}

/** A missing thumbnail must never fall back to /render/image/ — that would
 *  reintroduce the billed transformation this whole file exists to avoid. It
 *  falls back to the ORIGINAL object instead: identical pixels, a few KB more,
 *  and nothing billed. That is also what makes a freshly uploaded badge safe
 *  before the generator has next been run.
 *
 *  `error` does not bubble, so this listens in the capture phase; one listener
 *  then covers every <img> the HUD, Rankings and the Drawer build by
 *  innerHTML, including ones created long after load. */
export function installBadgeThumbFallback(doc) {
  const d = doc || (typeof document === 'undefined' ? null : document)
  if (!d || d.__badgeThumbFallback) return d
  d.__badgeThumbFallback = true
  d.addEventListener('error', (ev) => {
    const img = ev && ev.target
    if (!img || img.tagName !== 'IMG') return
    const full = img.getAttribute('data-badge-full')
    // One retry only — if the original 404s too there is nothing left to try,
    // and swapping src on every error would loop.
    if (!full || img.getAttribute('data-badge-fallback')) return
    img.setAttribute('data-badge-fallback', '1')
    img.src = full
  }, true)
  return d
}

installBadgeThumbFallback()
