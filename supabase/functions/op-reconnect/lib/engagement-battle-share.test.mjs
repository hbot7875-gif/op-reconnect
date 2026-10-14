// MAMA Battle share usage events ('battle_share' in rc_engagement_events):
// what may be stored, that every share-sheet action sends one, and that the
// migration admits the new type without losing the old ones.
//
// The database part needs PGlite (not a project dependency):
//   PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite/dist/index.js node --test <this file>
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { battleShareMetadata, BATTLE_SHARE_ACTIONS } from './battle-share-events.js'

const ROOT = new URL('../../../../', import.meta.url)
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8')
const OLD_TYPES = ['app_opened', 'screen_viewed', 'district_opened', 'reconnect_opened', 'invite_sent', 'invite_accepted', 'queue_built', 'stream_detected']
const MIGRATION = 'supabase/migrations/20261014140000_rc_engagement_battle_share.sql'

test('metadata: only the fixed action / style / outcome words are kept', () => {
  assert.deepEqual(battleShareMetadata({ action: 'opened', style: 'V2' }), { action: 'opened', style: 'V2' })
  assert.deepEqual(battleShareMetadata({ action: 'share_poster', style: 'V1', outcome: 'shared' }), { action: 'share_poster', style: 'V1', outcome: 'shared' })
  assert.deepEqual(
    battleShareMetadata({ action: 'copy_text', style: 'V3', outcome: 'copied', lines: { hooligans: 'secret' }, text: 'MAMA Battle is live', agentNo: 'AGENT001' }),
    { action: 'copy_text', style: 'V3', outcome: 'copied' }, 'team lines, share text and anything else are dropped')
  assert.deepEqual(battleShareMetadata({ action: 'save', style: 'A1', outcome: 'exploded' }), { action: 'save' }, 'unknown style/outcome dropped')
  for (const bad of [null, {}, { action: 'deleted_everything' }, { action: 'OPENED' }, 'opened']) assert.equal(battleShareMetadata(bad), null)
  assert.deepEqual(BATTLE_SHARE_ACTIONS, ['opened', 'share_poster', 'share_link', 'try_style', 'save', 'copy_link', 'copy_text'])
})

test('share sheet sends one battle_share event per action, never the team lines', () => {
  const src = read('js/voting.js')
  assert.match(src, /import \{ trackEngagement \} from '\.\/engagement\.js'/)
  assert.match(src, /trackEngagement\('battle_share', \{ screen: 'voting', metadata: \{ action: 'opened', style: first \} \}\)/)
  for (const action of ['share_poster', 'share_link', 'try_style', 'save', 'copy_link', 'copy_text'])
    assert.match(src, new RegExp(`trackShare\\('${action}'`), action)
  const helper = src.slice(src.indexOf('const trackShare'), src.indexOf('function releaseShare'))
  assert.doesNotMatch(helper, /lines|drafts|text/, 'the helper never reads typed text')
  const typing = src.slice(src.indexOf('function onLineInput'), src.indexOf('async function redrawPreview'))
  assert.doesNotMatch(typing, /trackShare|trackEngagement/, 'typing a team line is not tracked')
})

test('Edge Function accepts battle_share with sanitised metadata and reports it', () => {
  const ts = read('supabase/functions/op-reconnect/lib/engagement.ts')
  assert.match(ts, /const CLIENT_EVENTS = new Set<EngagementEventType>\(\[[\s\S]*'battle_share',[\s\S]*\]\)/)
  assert.match(ts, /if \(eventType === 'battle_share'\) \{\s*const m = battleShareMetadata\(rawMetadata\)\s*if \(!m\) return \{ success: false, error: 'invalid_engagement_event' \}\s*metadata = m/)
  assert.match(ts, /battleShare: BATTLE_SHARE_ACTIONS\.map/, 'admin report breaks the counts down by action')
})

test('migration keeps every existing type and adds battle_share; privacy page discloses it', () => {
  const sql = read(MIGRATION)
  for (const t of [...OLD_TYPES, 'battle_share']) assert.ok(sql.includes(`'${t}'`), t)
  assert.match(sql, /drop constraint if exists rc_engagement_events_event_type_check/)
  const privacy = read('privacy.html')
  assert.match(privacy, /opening the app, opening a district, viewing a screen, building a queue/, 'existing disclosure kept')
  assert.match(privacy, /which MAMA Battle share options you use \(never the text you type on a poster\)/)
})

const modulePath = process.env.PGLITE_MODULE
test('database: battle_share accepted, unknown types still refused, old types still fine', { skip: modulePath ? false : 'set PGLITE_MODULE to run the SQL check' }, async () => {
  const { PGlite } = await import(pathToFileURL(modulePath).href)
  const db = new PGlite()
  try {
    await db.exec('create table rc_players (agent_no text primary key);')
    await db.exec(read('supabase/migrations/20260815130000_rc_engagement_events.sql'))
    await db.exec(read(MIGRATION))
    await db.exec(read(MIGRATION)) // re-runnable
    const ins = (type) => db.query(`insert into rc_engagement_events (agent_no, event_type, metadata) values ('AGENT001', $1, '{"action":"opened"}')`, [type])
    await ins('battle_share')
    for (const t of OLD_TYPES) await ins(t)
    await assert.rejects(ins('battle_shared'), /check/i)
    const { rows } = await db.query(`select count(*)::int as n from rc_engagement_events where event_type = 'battle_share'`)
    assert.equal(rows[0].n, 1)
  } finally {
    await db.close()
  }
})
