// Static badge thumbnails: the URL rewrite, and the fallback that has to
// catch a missing one.
//
// The asymmetry these tests exist to protect: serving an original where a
// thumbnail was expected costs a few KB, but rewriting to something that
// doesn't exist — or falling back to /render/image/ — costs either a broken
// badge or the billed transformation this whole change removes.

import test from 'node:test'
import assert from 'node:assert/strict'
import { badgeThumb, thumbStoragePath, installBadgeThumbFallback, THUMB_PX, THUMB_DIR } from './badge-art.js'

const BASE = 'https://lcvmwlioqpyaprxicdfl.supabase.co/storage/v1/object/public/badge-art/'
const orig = (p) => BASE + p
const thumb = (p) => `${BASE}${THUMB_DIR}${p}.webp`

test('a public badge-art URL is rewritten to its static thumbnail', () => {
  assert.equal(badgeThumb(orig('set1/taehyung.jpg')), thumb('set1/taehyung.jpg'))
  assert.equal(badgeThumb(orig('vault/pct-50/2026-09-01T10-00-00-000Z-ab12cd.webp')),
    thumb('vault/pct-50/2026-09-01T10-00-00-000Z-ab12cd.webp'))
})

test('the thumbnail is served from /object/public/, never /render/image/', () => {
  const out = badgeThumb(orig('set1/taehyung.jpg'))
  assert.ok(out.includes('/storage/v1/object/public/'))
  assert.ok(!out.includes('/render/image/'))
  // and it carries no transform parameters at all
  assert.ok(!/[?&](width|height|resize|quality)=/.test(out))
})

test('the original extension is kept, so .jpg and .webp cannot collide', () => {
  const a = badgeThumb(orig('cute/a.jpg'))
  const b = badgeThumb(orig('cute/a.webp'))
  assert.notEqual(a, b)
  assert.ok(a.endsWith('cute/a.jpg.webp'))
  assert.ok(b.endsWith('cute/a.webp.webp'))
})

test('a thumbnail URL is never thumbnailed again', () => {
  const once = badgeThumb(orig('set1/taehyung.jpg'))
  assert.equal(badgeThumb(once), once, 'double rewrite would 404')
  assert.equal(badgeThumb(thumb('deep/nested/x.png')), thumb('deep/nested/x.png'))
})

test('URLs carrying a query or hash pass through untouched', () => {
  // Where the object path ends is a guess once a query is involved, and a
  // wrong guess is a broken image. Serve the original instead.
  for (const suffix of ['?t=123', '?download=1&x=2', '#frag', '?']) {
    const u = orig('set1/taehyung.jpg') + suffix
    assert.equal(badgeThumb(u), u, suffix)
  }
})

test('anything that is not a public badge-art URL passes through', () => {
  for (const u of [
    'https://example.com/a.png',
    'https://lcvmwlioqpyaprxicdfl.supabase.co/storage/v1/object/public/vma-vote-proofs/x.jpg',
    'https://lcvmwlioqpyaprxicdfl.supabase.co/storage/v1/render/image/public/badge-art/x.jpg?width=128',
    '', null, undefined, 0, 42, {},
  ]) {
    assert.equal(badgeThumb(u), u, String(u))
  }
})

test('an empty object path is left alone', () => {
  assert.equal(badgeThumb(BASE), BASE)
})

test('paths with parentheses survive intact — 171 real files have them', () => {
  // publicArtUrl interpolates the raw storage path with no encoding, and the
  // WHATWG URL parser leaves sub-delims alone, so both sides must agree on the
  // unencoded form. Checked against all 422 live paths; kept here as a guard.
  const u = badgeThumb(orig('set1/jhope(1).jpg'))
  assert.equal(u, thumb('set1/jhope(1).jpg'))
  assert.equal(new URL(u).href, u, 'URL normalisation must not rewrite the path')
})

test('thumbStoragePath and badgeThumb cannot drift apart', () => {
  for (const p of ['set1/taehyung.jpg', 'vault/pct-100/x-y.webp', 'set1/jhope(1).jpg', 'a b/c+d.png']) {
    assert.equal(badgeThumb(orig(p)), BASE + thumbStoragePath(p))
  }
  assert.equal(thumbStoragePath(''), null)
  assert.equal(thumbStoragePath(`${THUMB_DIR}set1/a.jpg.webp`), null, 'never nests thumb/ inside thumb/')
})

test('the thumbnail size covers the largest call site', () => {
  // Badge Drawer tile is ~94 CSS px and wants 2x; Rankings 60, HUD crest 48.
  assert.ok(THUMB_PX >= 94 * 2)
  assert.equal(THUMB_DIR, `thumb/${THUMB_PX}/`)
})

// ---- fallback ------------------------------------------------------------

const fakeDoc = () => {
  const handlers = []
  return {
    addEventListener(type, fn, capture) { handlers.push({ type, fn, capture }) },
    fire(target) { for (const h of handlers) if (h.type === 'error') h.fn({ target }) },
    handlers,
  }
}

const fakeImg = (attrs = {}) => {
  const a = { ...attrs }
  return {
    tagName: 'IMG', src: attrs.src || '',
    getAttribute: (k) => (k in a ? a[k] : null),
    setAttribute: (k, v) => { a[k] = v },
  }
}

test('a missing thumbnail falls back to the original object', () => {
  const doc = fakeDoc()
  installBadgeThumbFallback(doc)
  const img = fakeImg({ src: thumb('set1/taehyung.jpg'), 'data-badge-full': orig('set1/taehyung.jpg') })
  doc.fire(img)
  assert.equal(img.src, orig('set1/taehyung.jpg'))
  assert.ok(!img.src.includes('/render/image/'), 'fallback must never re-enter the billed endpoint')
})

test('the fallback listens in the capture phase, because error does not bubble', () => {
  const doc = fakeDoc()
  installBadgeThumbFallback(doc)
  assert.equal(doc.handlers.length, 1)
  assert.equal(doc.handlers[0].type, 'error')
  assert.equal(doc.handlers[0].capture, true)
})

test('the fallback fires once, so a broken original cannot loop', () => {
  const doc = fakeDoc()
  installBadgeThumbFallback(doc)
  const img = fakeImg({ src: thumb('x.jpg'), 'data-badge-full': orig('x.jpg') })
  doc.fire(img)
  img.src = 'CHANGED-BY-BROWSER'
  doc.fire(img)
  assert.equal(img.src, 'CHANGED-BY-BROWSER', 'second error must be ignored')
})

test('the fallback ignores images it does not own, and non-images', () => {
  const doc = fakeDoc()
  installBadgeThumbFallback(doc)

  const other = fakeImg({ src: 'https://example.com/a.png' })   // no data-badge-full
  doc.fire(other)
  assert.equal(other.src, 'https://example.com/a.png')

  const notAnImage = { tagName: 'SCRIPT', getAttribute: () => orig('x.jpg'), setAttribute() {} , src: 'keep' }
  doc.fire(notAnImage)
  assert.equal(notAnImage.src, 'keep')

  assert.doesNotThrow(() => doc.fire(null))
  assert.doesNotThrow(() => doc.fire(undefined))
})

test('installing twice does not double-handle', () => {
  const doc = fakeDoc()
  installBadgeThumbFallback(doc)
  installBadgeThumbFallback(doc)
  assert.equal(doc.handlers.length, 1)
})

test('importing the module without a document is safe', () => {
  assert.equal(typeof globalThis.document, 'undefined')
  assert.doesNotThrow(() => installBadgeThumbFallback())
})
