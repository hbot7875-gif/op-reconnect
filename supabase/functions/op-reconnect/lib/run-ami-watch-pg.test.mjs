// Executes the RUN AMI watchers migration (20261025000000) on a real Postgres
// engine (PGlite), on top of the two it builds on, and drives its RPCs: watch
// mid-match and in a full room, no Bomb needed, the per-room cap, one watch
// per agent, sitting in ends the watch, a closed room ends every watch, a
// watcher's chat is tagged and pings the room without touching any version,
// and browser roles can reach none of it. Also runs the anon lock-down
// (20261025000500) against tables shaped like production's.
//
// realtime.send is a stand-in that records what was broadcast. PGlite is not
// a project dependency: point PGLITE_MODULE at an installed copy (see
// vote-campaign-sql.test.mjs); without it the suite is skipped.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ROOT = new URL('../../../', import.meta.url)
const migration = (name) => readFileSync(new URL(`migrations/${name}`, ROOT), 'utf8')
const MAIN = migration('20261018120000_rc_run_ami.sql')
const CHAT = migration('20261018150000_rc_run_ami_chat.sql')
const WATCH = migration('20261025000000_rc_run_ami_watchers.sql')
const LOCK = migration('20261025000500_rc_lock_spotify_tables.sql')

const modulePath = process.env.PGLITE_MODULE
const skip = modulePath ? false : 'set PGLITE_MODULE to run the SQL suite'

const STUBS = `
  create role anon; create role authenticated; create role service_role;
  create table rc_agents (agent_no text primary key);
  create table rc_players (agent_no text primary key references rc_agents, codename text, equipped_badge_id text);
  create table rc_agent_charge (agent_no text primary key references rc_agents, charged_until timestamptz);
  create table rc_config (key text primary key, value jsonb);
  insert into rc_agents values ('AGENT000'), ('AGENT050'), ('AGENT120'), ('AGENT140'), ('AGENT196'), ('AGENT900');
  insert into rc_agent_charge values ('AGENT000', now() + interval '1 day'), ('AGENT050', now() + interval '1 day'),
    ('AGENT120', now() + interval '1 day'), ('AGENT140', now() + interval '1 day'), ('AGENT196', now() + interval '1 day'),
    ('AGENT900', now() - interval '1 hour');
  create schema realtime;
  create table realtime.sent (id bigserial primary key, payload jsonb, event text, topic text);
  create function realtime.send(payload jsonb, event text, topic text, private boolean) returns void language sql as
    $$ insert into realtime.sent (payload, event, topic) values (payload, event, topic) $$;
  -- Shaped like production's three tables: RLS off, every browser grant.
  create table spotify_oauth (id text primary key, refresh_token text);
  create table bts_song_catalog (id text primary key, songs jsonb);
  create table spotify_filler_library (id text primary key);
  grant all on spotify_oauth, bts_song_catalog, spotify_filler_library to anon, authenticated;
`

let engine = null
async function fresh(t) {
  if (!engine) {
    const { PGlite } = await import(pathToFileURL(modulePath).href)
    engine = new PGlite()
    await engine.exec(STUBS)
    await engine.exec(MAIN)
    await engine.exec(CHAT)
    await engine.exec(WATCH)
    await engine.exec(WATCH) // re-runs cleanly
    await engine.exec(LOCK)
    await engine.exec(LOCK)
  }
  await engine.exec('begin')
  t.after(() => engine.exec('rollback'))
  return engine
}
test.after(() => engine?.close())

const rpc = async (db, sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0]
const watch = (db, agent, code = 'AMI7K2', max = 20) => rpc(db, 'select rc_run_ami_watch_room($1, $2, $3)', [agent, code, max])
const openWatches = async (db, agent) => Number(await rpc(db, 'select count(*) from rc_run_ami_watchers where agent_no = $1 and left_at is null', [agent]))

async function lobby(db, agents = ['AGENT000', 'AGENT050']) {
  assert.equal((await rpc(db, 'select rc_run_ami_create_room($1, $2, $3)', [agents[0], 'AMI7K2', 't'.repeat(40)])).ok, true)
  for (const a of agents.slice(1)) assert.equal((await rpc(db, 'select rc_run_ami_join_room($1, $2)', [a, 'AMI7K2'])).ok, true)
  return (await db.query('select id, version from rc_run_ami_rooms where code = $1', ['AMI7K2'])).rows[0]
}

test('watch mid-match, in a full room, with a dark Bomb; seated agents can\'t watch elsewhere', { skip }, async (t) => {
  const db = await fresh(t)
  const room = await lobby(db, ['AGENT000', 'AGENT050', 'AGENT120', 'AGENT140'])
  assert.equal((await rpc(db, 'select rc_run_ami_join_room($1, $2)', ['AGENT196', 'AMI7K2'])).error, 'room_full')
  await db.query(`update rc_run_ami_rooms set status = 'in_match' where id = $1`, [room.id])
  assert.equal((await watch(db, 'AGENT196')).ok, true)
  assert.equal((await watch(db, 'AGENT900')).ok, true) // dark Bomb: watching powers nothing
  assert.deepEqual(await watch(db, 'AGENT196'), { ok: true, room_id: room.id, already: true })
  const seatedHere = await watch(db, 'AGENT050')
  assert.equal(seatedHere.seated, true)
  assert.equal(await openWatches(db, 'AGENT050'), 0)
  assert.equal((await watch(db, 'AGENT000', 'ZZZZZZ')).error, 'room_not_found')
})

test('the cap holds, and a watcher moving rooms leaves the old one', { skip }, async (t) => {
  const db = await fresh(t)
  await lobby(db)
  assert.equal((await watch(db, 'AGENT120', 'AMI7K2', 1)).ok, true)
  assert.equal((await watch(db, 'AGENT140', 'AMI7K2', 1)).error, 'watchers_full')
  await rpc(db, 'select rc_run_ami_create_room($1, $2, $3)', ['AGENT196', 'RUNAM2', 'u'.repeat(40)])
  assert.equal((await watch(db, 'AGENT120', 'RUNAM2')).ok, true)
  assert.equal(await openWatches(db, 'AGENT120'), 1)
  const where = await rpc(db, `select r.code from rc_run_ami_watchers w join rc_run_ami_rooms r on r.id = w.room_id
                               where w.agent_no = 'AGENT120' and w.left_at is null`)
  assert.equal(where, 'RUNAM2')
})

test('taking a seat or creating a room ends the watch', { skip }, async (t) => {
  const db = await fresh(t)
  await lobby(db)
  await watch(db, 'AGENT120')
  assert.equal((await rpc(db, 'select rc_run_ami_join_room($1, $2)', ['AGENT120', 'AMI7K2'])).ok, true)
  assert.equal(await openWatches(db, 'AGENT120'), 0)
  await watch(db, 'AGENT140')
  assert.equal((await rpc(db, 'select rc_run_ami_create_room($1, $2, $3)', ['AGENT140', 'RUNAM2', 'u'.repeat(40)])).ok, true)
  assert.equal(await openWatches(db, 'AGENT140'), 0)
})

test('a closed room ends every watch; touch ends a stale or orphaned one', { skip }, async (t) => {
  const db = await fresh(t)
  const room = await lobby(db)
  await watch(db, 'AGENT120')
  await watch(db, 'AGENT140')
  assert.equal(await rpc(db, 'select rc_run_ami_watch_touch($1, 30)', ['AGENT120']), room.id)
  await db.query(`update rc_run_ami_watchers set last_seen_at = now() - interval '31 minutes' where agent_no = 'AGENT120'`)
  assert.equal(await rpc(db, 'select rc_run_ami_watch_touch($1, 30)', ['AGENT120']), null)
  await rpc(db, 'select rc_run_ami_leave_room($1)', ['AGENT050'])
  await rpc(db, 'select rc_run_ami_leave_room($1)', ['AGENT000']) // last seat: the room closes
  assert.equal(await openWatches(db, 'AGENT140'), 0)
  assert.equal(await rpc(db, 'select rc_run_ami_watch_touch($1, 30)', ['AGENT140']), null)
})

test('a watcher\'s chat is tagged and pings the room; no version moves', { skip }, async (t) => {
  const db = await fresh(t)
  const room = await lobby(db)
  await watch(db, 'AGENT196')
  await db.query('delete from realtime.sent')
  const sent = await rpc(db, `select rc_run_ami_chat_send('AGENT196', 'text', 'go go', 'Watcher')`)
  assert.equal(sent.ok, true)
  assert.equal(await rpc(db, `select watching from rc_run_ami_chat where id = $1`, [sent.id]), true)
  await rpc(db, `select rc_run_ami_chat_send('AGENT050', 'react', '🔥', 'Player')`)
  assert.equal(await rpc(db, `select watching from rc_run_ami_chat where body = '🔥'`), false)
  const pings = (await db.query(`select event, payload, topic from realtime.sent order by id`)).rows
  assert.deepEqual(pings.map((p) => [p.event, p.payload.k]), [['p', 'c'], ['p', 'c']])
  assert.equal(pings[0].topic, 'run-ami:' + 't'.repeat(40))
  assert.equal(await rpc(db, 'select version from rc_run_ami_rooms where id = $1', [room.id]), room.version)
  // Stopping the watch ends their chat too.
  await rpc(db, 'select rc_run_ami_unwatch($1)', ['AGENT196'])
  assert.equal((await rpc(db, `select rc_run_ami_chat_send('AGENT196', 'text', 'hi', 'W')`)).error, 'not_in_room')
})

test('browser roles reach no watcher table or function, nor the three locked tables', { skip }, async (t) => {
  const db = await fresh(t)
  const denied = async (sql) => {
    await db.exec('savepoint probe')
    await assert.rejects(db.query(sql), /permission denied/, sql)
    await db.exec('rollback to savepoint probe')
  }
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set local role ${role}`)
    await denied('select * from rc_run_ami_watchers')
    await denied(`select rc_run_ami_watch_room('AGENT000', 'AMI7K2', 20)`)
    await denied(`select rc_run_ami_unwatch('AGENT000')`)
    await denied(`select rc_run_ami_watch_touch('AGENT000', 30)`)
    await denied(`select rc_run_ami_ping(null, 'c')`)
    await denied(`select rc_run_ami_join_room('AGENT000', 'AMI7K2')`)
    await denied(`select rc_run_ami_chat_send('AGENT000', 'text', 'hi', 'HQ')`)
    await denied('select * from spotify_oauth')
    await denied(`insert into bts_song_catalog values ('x', null)`)
    await denied('delete from spotify_filler_library')
    await db.exec('reset role')
  }
  const rls = (await db.query(`select relname, relrowsecurity from pg_class where relname in ('spotify_oauth', 'bts_song_catalog', 'spotify_filler_library') order by 1`)).rows
  assert.deepEqual(rls.map((r) => r.relrowsecurity), [true, true, true])
})
