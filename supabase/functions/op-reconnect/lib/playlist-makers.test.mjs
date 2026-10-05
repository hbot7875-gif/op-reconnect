// Who may add a district playlist, and what still bounds it.
//
// playlist-vault.ts cannot be imported from node (its dependency chain reaches
// an npm:/jsr: specifier), so these are source-level assertions -- the same
// approach the Stats.fm tests use for Deno-only modules. They are here to stop
// two specific regressions: the badge/playlist gates drifting apart again, and
// the per-day cap creeping back in.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const vault = readFileSync(new URL('./playlist-vault.ts', import.meta.url), 'utf8')
const badge = readFileSync(new URL('./badge-admin.ts', import.meta.url), 'utf8')
const settings = readFileSync(new URL('../../../../js/screen-settings.js', import.meta.url), 'utf8')
const makerPage = readFileSync(new URL('../../../../playlist-maker.html', import.meta.url), 'utf8')

const code = vault.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

test('every badge maker is a playlist maker', () => {
  assert.match(vault, /import \{ isBadgeEditor \} from '\.\/badge-admin\.ts'/)
  assert.match(code, /return await isBadgeEditor\(supabase, no\)/)
  // Reused, not reimplemented: a second rc_config read here is how the two
  // lists drifted apart in the first place.
  const configReads = [...code.matchAll(/eq\('key', '(\w+)'\)/g)].map((m) => m[1])
  assert.ok(!configReads.includes('badge_editors'),
    'playlist-vault must not read badge_editors itself; it calls isBadgeEditor')
})

test('the playlist_makers list still works on its own', () => {
  // Being on either list is enough; the badge check is a fallback, not a
  // replacement.
  assert.match(code, /eq\('key', 'playlist_makers'\)/)
  assert.match(code, /if \(listed\) return true/)
  assert.match(code, /if \(no === ALWAYS_PLAYLIST_MAKER\) return true/)
})

test('isBadgeEditor is exported and reads the badge allowlist', () => {
  assert.match(badge, /export async function isBadgeEditor/)
  assert.match(badge, /eq\('key', 'badge_editors'\)/)
})

test('there is no per-day cap on adding playlists', () => {
  assert.ok(!/SHARE_DAILY_LIMIT/.test(vault), 'the daily-limit constant must stay gone')
  assert.ok(!/playlists a day/i.test(vault), 'the daily-limit error message must stay gone')
  // The shape of the old check: a 24h window counted against this agent's
  // shared rows. Any of these creeping back means the cap is back.
  assert.ok(!/24 \* 60 \* 60 \* 1000/.test(code), 'no rolling 24h window may gate adding')
  assert.ok(!/gte\('created_at', since\)/.test(code))
})

test('adding is still restricted to approved makers', () => {
  // Removing the cap must not have removed the gate.
  const share = code.slice(code.indexOf('export async function shareCandyPlaylist'))
  assert.match(share, /if \(!\(await isPlaylistMaker\(supabase, agentNo\)\)\)/)
  assert.match(share, /Only approved playlist makers can add district playlists/)
})

test('the same playlist still cannot be added twice', () => {
  // This is what bounds abuse now that the per-day cap is gone, so it is not
  // optional.
  const share = code.slice(code.indexOf('export async function shareCandyPlaylist'))
  assert.match(share, /from\('generated_playlists'\)[\s\S]{0,120}eq\('playlist_id', playlistId\)/)
  assert.match(share, /alreadyThere: true/)
})

test('the copy tells agents who actually has access', () => {
  // Both surfaces used to name only playlist_makers, which is no longer the
  // whole answer.
  assert.match(settings, /every badge maker/)
  assert.match(makerPage, /Badge makers already have access/)
})
