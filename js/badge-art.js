// Badge photo thumbnails. Every badge photo in the vault is a full-size
// upload (measured 30–80 KB each); the Rankings list alone showed 51 of them
// as 34px icons — ~2.5 MB per open on a phone. Supabase Storage can resize
// on the fly at /render/image/... (a 38 KB jpg came back as 1.7 KB at 64px),
// so icons and grid tiles ask for exactly the pixels they draw. The story
// sheet and share cards keep the original URL.
//
// Only public badge-art URLs are rewritten; anything else passes through.

const OBJECT_PREFIX = '/storage/v1/object/public/badge-art/'
const RENDER_PREFIX = '/storage/v1/render/image/public/badge-art/'

export function badgeThumb(url, px = 64) {
  if (!url || typeof url !== 'string' || !url.includes(OBJECT_PREFIX)) return url
  // 2× for retina — icons are 34px, drawn from a 68px source; grid tiles
  // ~94px from ~188px. Cover keeps the face crop the CSS expects.
  const size = Math.round(px * 2)
  return `${url.replace(OBJECT_PREFIX, RENDER_PREFIX)}?width=${size}&height=${size}&resize=cover&quality=75`
}
