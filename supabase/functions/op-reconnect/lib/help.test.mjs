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
  assert.equal(topicLabel('doubt'), 'General question')
  assert.equal(topicLabel('badges'), 'Badges & albums')
  assert.match(read('../../../../js/help.js'), /Be kind! We're ARMYs too/)
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
  assert.match(hud, /read\.onclick = \(\) => \{ hideOverlay\(\); openHelp\(\{ tab: 'mine' \}\) \}/, 'a reply opens My requests')
  const h = read('./handlers.ts')
  assert.match(h, /const helpPending = timed\('help', helpStateFor\(supabase, player\.agent_no\)/)
  assert.match(h, /warUnlockDue,\r?\n\s+help,/)
})

const modulePath = process.env.PGLITE_MODULE
test('the table: browser roles locked out, statuses and topics checked', { skip: modulePath ? false : 'set PGLITE_MODULE' }, async () => {
  const { PGlite } = await import(pathToFileURL(modulePath).href)
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table rc_agents (agent_no text primary key); insert into rc_agents values ('AGENT244');
    create schema storage; create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);`)
  await db.exec(read('../../../migrations/20261108150000_rc_help_requests.sql'))
  await db.exec(read('../../../migrations/20261108150000_rc_help_requests.sql'))
  await db.exec(read('../../../migrations/20261109120000_rc_help_doubt_topic.sql'))
  await db.exec(read('../../../migrations/20261109120000_rc_help_doubt_topic.sql'))
  await db.query("insert into rc_help_requests (agent_no, topic, message) values ('AGENT244', 'doubt', 'how do album passes work?')")
  await db.exec(read('../../../migrations/20261109130000_rc_help_screenshots.sql'))
  await db.exec(read('../../../migrations/20261109130000_rc_help_screenshots.sql'))
  const bucket = (await db.query("select public, file_size_limit from storage.buckets where id = 'help-shots'")).rows[0]
  assert.deepEqual(bucket, { public: false, file_size_limit: 2097152 }, 'a private bucket')
  await db.query("insert into rc_help_requests (agent_no, topic, message, screenshot_paths) values ('AGENT244', 'streams', 'see screenshots', array['AGENT244/a-1.jpg','AGENT244/a-2.jpg'])")
  await assert.rejects(db.query("insert into rc_help_requests (agent_no, topic, message, screenshot_paths) values ('AGENT244', 'streams', 'too many', array['a','b','c'])"))
  await db.query("insert into rc_help_requests (agent_no, topic, message) values ('AGENT244', 'streams', 'nothing counted today')")
  await assert.rejects(db.query("insert into rc_help_requests (agent_no, topic, message) values ('AGENT244', 'nope', 'x')"))
  await assert.rejects(db.query("update rc_help_requests set status = 'closed'"))
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await db.query(`select has_table_privilege('${role}', 'public.rc_help_requests', 'select') ok`)).rows[0].ok, false)
  }
})

test('a floating help button on every game screen opens Get help', () => {
  const fab = read('../../../../js/help-fab.js')
  assert.match(fab, /btn\.onclick = \(\) => openHelp\(\{ tab: Number\(getState\(\)\?\.help\?\.replyUnread\) \? 'mine' : 'new' \}\)/)
  assert.match(fab, /btn\.querySelector\('\.help-fab-dot'\)\.hidden = !replies/, 'a dot when the team replied')
  assert.match(read('../../../../js/ui-hud.js'), /paintHelpFab\(state\)/)
  const css = read('../../../../css/reconnect.css')
  assert.match(css, /\.help-fab \{ position: fixed; right: 16px; bottom: calc\(96px \+ env\(safe-area-inset-bottom\)\); z-index: 6;/)
  assert.match(css, /#game:has\(#scene \.ra-screen\) \.help-fab, body\.ra-playing \.help-fab/, 'never on the War of Cards table')
})

test('screenshots: up to 2, private links only, removed 30 days after resolving', async () => {
  const rules = await import('./help-rules.js')
  assert.equal(rules.HELP_SCREENSHOT_MAX, 2)
  assert.equal(rules.HELP_SCREENSHOT_KEEP_DAYS, 30)
  const server = read('./help.ts')
  assert.match(server, /createSignedUrls\(paths, SIGNED_TTL_SEC\)/, 'signed, short-lived links')
  assert.doesNotMatch(server, /getPublicUrl/, 'never a public link')
  assert.match(server, /if \(images\.length > HELP_SCREENSHOT_MAX\) return \{ ok: false, error: 'too_many_images' \}/)
  assert.match(server, /if \(bytes\.length > HELP_SCREENSHOT_BYTES\) return \{ ok: false, error: 'image_too_large' \}/)
  assert.match(server, /if \(error\) \{\s+if \(paths\.length\) await sb\.storage\.from\(SHOT_BUCKET\)\.remove\(paths\)/, 'no orphaned files if the row fails')
  assert.match(server, /\.eq\('status', 'resolved'\)\.lt\('updated_at', before\)/)
  assert.match(read('./sync-all.ts'), /await sweepHelpScreenshots\(supabase\)/)
  const ui = read('../../../../js/help.js')
  assert.match(ui, /images: shots\.map\(\(s\) => \(\{ base64: s\.base64, mime: 'image\/jpeg' \}\)\)/)
  assert.match(ui, /Math\.min\(1, 1400 \/ Math\.max\(img\.naturalWidth, img\.naturalHeight\)\)/, 'shrunk on the phone')
})

test('the help sheet: New request and My requests tabs; replies read only when opened', () => {
  const ui = read('../../../../js/help.js')
  assert.match(ui, /data-tab="new" aria-selected="true">New request/)
  assert.match(ui, /data-tab="mine" aria-selected="false">My requests/)
  assert.match(ui, /if \(name === 'mine'\) \{[\s\S]{0,120}loadMine\(sheet\)/, 'replies load (and are marked read) only on My requests')
  assert.doesNotMatch(ui, /showOverlay\(sheet\)\s+loadMine\(sheet\)/, 'not loaded (or marked read) when the sheet opens on New request')
  assert.match(ui, /rows="3"/, 'starts at three lines')
  assert.match(read('./help.ts'), /const diagnostics = v\.topic === 'streams' \? await diagnosticsFor/, 'stream details only for streaming problems, as the form says')
})

test('My requests reads like a conversation: a compact list, an unread badge, one short note', () => {
  const ui = read('../../../../js/help.js')
  assert.match(ui, /<span class="help-tab-badge" aria-label="\$\{unread\} new repl/, 'My requests (1)')
  assert.match(ui, /<em class="help-new">New reply<\/em>/, 'new reply marked on its row, separate from the status')
  assert.match(ui, /help-bubble is-me[\s\S]{0,200}help-bubble is-team/, 'their message, then the team reply')
  assert.match(ui, /const open = r\.isNewReply \|\| \(i === 0 && !res\.requests\.some\(\(x\) => x\.isNewReply\)\)/, 'a new reply opens itself')
  assert.match(ui, /Only you and the team see this\. Be kind! We're ARMYs too/)
  assert.match(ui, /class="help-info-more" hidden>[^<]*we automatically include your streaming source/, 'the rest behind the info button')
})

test('a one-time pop-up introduces Get help, never during a game or over another sheet', () => {
  const intro = read('../../../../js/help-intro.js')
  assert.match(intro, /if \(localStorage\.getItem\(`\$\{KEY\}\$\{agentNo\}`\) === '1'\) return/, 'once per agent on this device')
  assert.match(intro, /document\.body\.classList\.contains\('ra-playing'\) \|\| getScreen\(\)\?\.name === 'runami'/)
  assert.match(intro, /if \(overlay && !overlay\.hidden\) return/)
  assert.match(intro, /ask\.onclick = \(\) => \{ hideOverlay\(\); openHelp\(\) \}/)
  assert.match(read('../../../../js/main.js'), /checkForHelpIntro\(state\)/)
})
