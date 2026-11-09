// Help portal: request rules, the safe details attached, who can answer, and
// the wiring (Settings, bell, game state). The table itself is checked
// against real Postgres when PGLITE_MODULE is set.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import {
  HELP_OWNER, HELP_TOPICS, validateHelpRequest, helpDiagnostics, diagnosticsLine, topicLabel,
} from './help-rules.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

test('a request needs a topic and a real message', () => {
  assert.equal(validateHelpRequest({ topic: 'nope', message: 'my streams are missing' }).error, 'bad_topic')
  assert.equal(validateHelpRequest({ topic: 'streams', message: 'help' }).error, 'too_short')
  assert.equal(validateHelpRequest({ topic: 'streams', message: 'x'.repeat(1001) }).error, 'too_long')
  assert.deepEqual(validateHelpRequest({ topic: 'streams', message: '  my streams are missing  ' }), { ok: true, topic: 'streams', message: 'my streams are missing' })
  assert.deepEqual(HELP_TOPICS.map((t) => t.id), ['streams', 'doubt', 'reconnect', 'badges', 'voting', 'account', 'other'])
  assert.equal(topicLabel('doubt'), 'Doubt / question')
  assert.match(read('../../../../js/help.js'), /Please keep it kind and respectful/)
  assert.equal(topicLabel('streams'), 'Streams not counting')
})

test('attached details are yes/no connections and sync health — never usernames, IDs or PINs', () => {
  const d = helpDiagnostics({
    source: 'musicat', connections: { musicat: 'secret-id-123', listenbrainz: '' },
    sync: { source: 'musicat', lastSuccessAt: '2026-11-08T13:47:00Z', newestAtProvider: '2026-11-07T14:33:49Z', lastError: null, failures: 0 },
    lastPlayAt: '2026-11-07T14:33:49Z', district: 'mono-urmi-terrace',
  })
  assert.deepEqual(d.connections, { listenbrainz: false, statsfm: false, musicat: true })
  assert.doesNotMatch(JSON.stringify(d), /secret-id-123/)
  assert.match(diagnosticsLine(d), /^Source: musicat · last play 2026-11-07T14:33:49Z · newest at provider 2026-11-07T14:33:49Z · last sync ok/)
  const server = read('./help.ts')
  assert.match(server, /connections: \{ listenbrainz: !!a\?\.lb_username, statsfm: !!a\?\.statsfm_username, musicat: !!a\?\.musicat_public_id \}/)
  assert.doesNotMatch(server, /scrobble_pin|password_hash|session_token|params\.diagnostics/, 'nothing secret, nothing from the browser')
})

test('only AGENT000 reads the inbox and replies; agents see only their own', () => {
  const server = read('./help.ts')
  assert.equal(HELP_OWNER, 'AGENT000')
  assert.match(server, /export async function helpInbox[\s\S]{0,120}if \(agentOf\(params\) !== HELP_OWNER\) return \{ success: false, error: 'not_owner' \}/)
  assert.match(server, /export async function helpReply[\s\S]{0,160}if \(owner !== HELP_OWNER\) return \{ success: false, error: 'not_owner' \}/)
  assert.match(server, /\.eq\('agent_no', agentNo\)\.order\('created_at', \{ ascending: false \}\)\.limit\(10\)/)
  assert.match(server, /if \(\(open \|\| 0\) >= HELP_OPEN_LIMIT\)/)
  const idx = read('../index.ts')
  for (const r of ['submitHelpRequest', 'getMyHelpRequests', 'helpInbox', 'helpReply']) assert.match(idx, new RegExp(`${r}: \\{ auth: 'agent'`))
})

test('wiring: Settings rows, the bell, and the game state', () => {
  const settings = read('../../../../js/screen-settings.js')
  assert.match(settings, /name: 'Get help'/)
  assert.match(settings, /name: 'Help inbox'/)
  const hud = read('../../../../js/ui-hud.js')
  assert.match(hud, /const helpSignal = \(state\?\.help\?\.replyUnread \|\| 0\) \+ \(state\?\.help\?\.inboxOpen \|\| 0\)/)
  assert.match(hud, /read\.onclick = \(\) => \{ hideOverlay\(\); openHelp\(\) \}/)
  const h = read('./handlers.ts')
  assert.match(h, /const helpPending = timed\('help', helpStateFor\(supabase, player\.agent_no\)/)
  assert.match(h, /warUnlockDue,\r?\n\s+help,/)
})

const modulePath = process.env.PGLITE_MODULE
test('the table: browser roles locked out, statuses and topics checked', { skip: modulePath ? false : 'set PGLITE_MODULE' }, async () => {
  const { PGlite } = await import(pathToFileURL(modulePath).href)
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table rc_agents (agent_no text primary key); insert into rc_agents values ('AGENT244');`)
  await db.exec(read('../../../migrations/20261108150000_rc_help_requests.sql'))
  await db.exec(read('../../../migrations/20261108150000_rc_help_requests.sql'))
  await db.exec(read('../../../migrations/20261109120000_rc_help_doubt_topic.sql'))
  await db.exec(read('../../../migrations/20261109120000_rc_help_doubt_topic.sql'))
  await db.query("insert into rc_help_requests (agent_no, topic, message) values ('AGENT244', 'doubt', 'how do album passes work?')")
  await db.query("insert into rc_help_requests (agent_no, topic, message) values ('AGENT244', 'streams', 'nothing counted today')")
  await assert.rejects(db.query("insert into rc_help_requests (agent_no, topic, message) values ('AGENT244', 'nope', 'x')"))
  await assert.rejects(db.query("update rc_help_requests set status = 'closed'"))
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await db.query(`select has_table_privilege('${role}', 'public.rc_help_requests', 'select') ok`)).rows[0].ok, false)
  }
})

test('a floating help button on every game screen opens Get help', () => {
  const fab = read('../../../../js/help-fab.js')
  assert.match(fab, /btn\.onclick = \(\) => openHelp\(\)/)
  assert.match(fab, /btn\.querySelector\('\.help-fab-dot'\)\.hidden = !replies/, 'a dot when the team replied')
  assert.match(read('../../../../js/ui-hud.js'), /paintHelpFab\(state\)/)
  const css = read('../../../../css/reconnect.css')
  assert.match(css, /\.help-fab \{ position: fixed; right: 16px; bottom: calc\(96px \+ env\(safe-area-inset-bottom\)\); z-index: 6;/)
  assert.match(css, /#game:has\(#scene \.ra-screen\) \.help-fab, body\.ra-playing \.help-fab/, 'never on the War of Cards table')
})
