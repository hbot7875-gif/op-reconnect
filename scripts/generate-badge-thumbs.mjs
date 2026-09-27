#!/usr/bin/env node
// Pre-renders the badge-art thumbnails that js/badge-art.js asks for.
//
// WHY THIS EXISTS. Supabase bills Storage Image Transformations per DISTINCT
// ORIGIN IMAGE per billing period — not per request, and not per variant. The
// Badge Drawer showed every badge in a player's collection through
// /render/image/, so the account's monthly distinct-image count tracked the
// 340 photos held across live collections against a 100-image Pro allowance.
// Resizing here instead, with sharp, on this machine, costs zero
// transformations: the output is uploaded as an ordinary Storage object and
// served from /object/public/ forever after.
//
// SAFE BY DEFAULT. This script never deletes, never overwrites and never
// touches rc_badge_art or any other table. It only ever PUTs new objects
// under `thumb/`, and without --upload it writes nothing at all.
//
//   node scripts/generate-badge-thumbs.mjs             # dry run: report only
//   node scripts/generate-badge-thumbs.mjs --upload    # generate + upload
//   node scripts/generate-badge-thumbs.mjs --upload --force   # redo existing
//
// AFTER A BADGE VAULT UPLOAD SESSION, run it again. It is idempotent: already
// thumbnailed originals are skipped, so a re-run only picks up what is new.
// Until it is run, new badges simply serve their original through the
// fallback in js/badge-art.js — correct pixels, nothing billed.
//
// Needs SUPABASE_SERVICE_ROLE_KEY in the environment (listing and uploading
// are privileged). The key is never printed.

import sharp from 'sharp'
import { THUMB_PX, THUMB_DIR, thumbStoragePath } from '../js/badge-art.js'

const BUCKET = 'badge-art'
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lcvmwlioqpyaprxicdfl.supabase.co'
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const args = new Set(process.argv.slice(2))
const UPLOAD = args.has('--upload')
const FORCE = args.has('--force')

// WebP at 82 is visually lossless at this size and roughly halves quality-75
// JPEG. The tiles are square-cropped by CSS `object-fit: cover`, so `cover`
// here reproduces exactly what the transform endpoint was returning.
const QUALITY = 82

if (!KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set. Export it and re-run.')
  process.exit(1)
}

const auth = { apikey: KEY, Authorization: `Bearer ${KEY}` }
const bytes = (n) => `${(n / 1024).toFixed(1)} KB`

/** Every object in the bucket, walked a page at a time. Storage's list route
 *  is per-prefix and non-recursive, so this descends by hand; `id === null`
 *  marks a synthetic folder row rather than a file. */
async function listAll(prefix = '') {
  const out = []
  for (let offset = 0; ; ) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }),
    })
    if (!res.ok) throw new Error(`list ${prefix || '/'} failed: ${res.status}`)
    const page = await res.json()
    if (!page.length) break
    for (const row of page) {
      const path = prefix ? `${prefix}${row.name}` : row.name
      if (row.id === null) out.push(...await listAll(`${path}/`))
      else out.push({ path, size: Number(row?.metadata?.size) || 0 })
    }
    offset += page.length
    if (page.length < 100) break
  }
  return out
}

async function main() {
  console.log(`Listing ${BUCKET}…`)
  const all = await listAll()
  const thumbs = new Set(all.filter((o) => o.path.startsWith(THUMB_DIR)).map((o) => o.path))
  const originals = all.filter((o) => !o.path.startsWith(THUMB_DIR))

  const todo = []
  let alreadyDone = 0
  for (const o of originals) {
    const dest = thumbStoragePath(o.path)
    if (!dest) continue
    if (thumbs.has(dest) && !FORCE) { alreadyDone++; continue }
    todo.push({ ...o, dest })
  }

  console.log(`  originals:        ${originals.length}`)
  console.log(`  thumbs present:   ${thumbs.size}`)
  console.log(`  already covered:  ${alreadyDone}`)
  console.log(`  to generate:      ${todo.length}`)
  console.log(UPLOAD ? '\nGenerating and uploading…\n' : `\nDRY RUN — generating locally to measure, uploading nothing.\n`)

  let srcBytes = 0, outBytes = 0, ok = 0
  const failures = []

  for (const [i, item] of todo.entries()) {
    const label = `[${String(i + 1).padStart(3)}/${todo.length}] ${item.path}`
    try {
      // The bucket is public, so the original reads without the key.
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${item.path}`)
      if (!res.ok) throw new Error(`download ${res.status}`)
      const input = Buffer.from(await res.arrayBuffer())

      const out = await sharp(input)
        .resize(THUMB_PX, THUMB_PX, { fit: 'cover', position: 'centre' })
        .webp({ quality: QUALITY })
        .toBuffer()

      srcBytes += input.length
      outBytes += out.length

      if (UPLOAD) {
        const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${item.dest}`, {
          method: FORCE ? 'PUT' : 'POST',
          headers: { ...auth, 'Content-Type': 'image/webp', 'Cache-Control': '31536000', 'x-upsert': FORCE ? 'true' : 'false' },
          body: out,
        })
        if (!up.ok) throw new Error(`upload ${up.status} ${(await up.text()).slice(0, 120)}`)
      }
      ok++
      console.log(`${label}  ${bytes(input.length)} → ${bytes(out.length)}`)
    } catch (err) {
      failures.push({ path: item.path, error: String(err.message || err) })
      console.log(`${label}  FAILED — ${err.message || err}`)
    }
  }

  console.log(`\n${UPLOAD ? 'Uploaded' : 'Would upload'}: ${ok}/${todo.length}`)
  if (ok) {
    console.log(`Source bytes read:      ${(srcBytes / 1048576).toFixed(2)} MB`)
    console.log(`Thumbnail bytes:        ${(outBytes / 1048576).toFixed(2)} MB  (avg ${bytes(outBytes / ok)})`)
    console.log(`Added storage:          ${(outBytes / 1048576).toFixed(2)} MB`)
  }
  if (failures.length) {
    console.log(`\n${failures.length} failed — these keep serving their original via the fallback:`)
    for (const f of failures) console.log(`  ${f.path}: ${f.error}`)
  }
  process.exit(failures.length ? 1 : 0)
}

main().catch((err) => { console.error(err.message || err); process.exit(1) })
