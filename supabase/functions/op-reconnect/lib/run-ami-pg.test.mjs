// Executes the RUN AMI migrations (20261018120000 and its cron schedule
// 20261018120500) against a real Postgres engine (PGlite) and drives the
// RPCs the Edge Function calls: the Bomb gate, one seat per agent, the
// lobby-changed refusal at start, the version compare-and-set and action
// idempotency in commit, the sweep's idle short-circuit, and that browser
// roles can neither read the tables nor run the functions.
//
// PGlite has no pg_cron, pg_net, Vault or Realtime, so those get the
// smallest stand-ins with the production signatures. What this can't prove
// is how the real extensions behave; the SQL itself runs for real.
//
// PGlite is not a project dependency. Point PGLITE_MODULE at an installed
// copy (see vote-campaign-sql.test.mjs); without it the suite is skipped.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

const ROOT = new URL('../../../', import.meta.url)
const migration = (name) => readFileSync(new URL(`migrations/${name}`, ROOT), 'utf8')
const MAIN = migration('20261018120000_rc_run_ami.sql')
const SCHEDULE = migration('20261018120500_rc_run_ami_sweep_schedule.sql')

const modulePath = process.env.PGLITE_MODULE
const skip = modulePath ? false : 'set PGLITE_MODULE to run the SQL suite'

const STUBS = `
  create role anon; create role authenticated; create role service_role;
  create table rc_agents (agent_no text primary key);
  create table rc_players (agent_no text primary key references rc_agents, codename text, equipped_badge_id text);
  create table rc_agent_charge (agent_no text primary key references rc_agents, charged_until timestamptz);
  create table rc_config (key text primary key, value jsonb);
  insert into rc_agents values ('AGENT000'), ('AGENT050'), ('AGENT120'), ('AGENT140'), ('AGENT900');
  insert into rc_agent_charge values ('AGENT000', now() + interval '1 day'), ('AGENT050', now() + interval '1 day'),
    ('AGENT120', now() + interval '1 day'), ('AGENT140', now() + interval '1 day'), ('AGENT900', now() - interval '1 hour');
  create schema realtime;
  create function realtime.send(payload jsonb, event text, topic text, private boolean) returns void language sql as $$ select $$;
  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean not null default true);
  -- Production's 11 jobs when this shipped (names from cron.job, 2026-10-18).
  insert into cron.job (jobname, schedule, command) values
    ('rc-battle-chat-retention', '0 3 * * *', 'select 1'),
    ('rc-capture-listenbrainz', '0 3 * * *', 'select 1'),
    ('rc-capture-musicat', '0 3 * * *', 'select 1'),
    ('rc-capture-statsfm', '0 3 * * *', 'select 1'),
    ('rc-delete-inactive-agents', '0 3 * * *', 'select 1'),
    ('rc-inactive-reminders', '0 3 * * *', 'select 1'),
    ('rc-mnet-verify-kick', '0 3 * * *', 'select 1'),
    ('rc-purge-deleted-agent-log', '0 3 * * *', 'select 1'),
    ('rc-queue-expired-vote-proofs', '0 3 * * *', 'select 1'),
    ('rc-storage-sweep', '0 3 * * *', 'select 1'),
    ('rc-vote-pulse', '0 3 * * *', 'select 1');
  create function cron.schedule(n text, s text, c text) returns bigint language sql as
    $$ insert into cron.job (jobname, schedule, command) values (n, s, c)
       on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
  create function cron.unschedule(n text) returns boolean language plpgsql as
    $$ begin delete from cron.job where jobname = n; if not found then raise exception 'no job %', n; end if; return true; end $$;
  create schema net;
  create table net.calls (id bigserial primary key, url text, body jsonb);
  create function net.http_post(url text, headers jsonb, body jsonb) returns bigint language sql as
    $$ insert into net.calls (url, body) values (url, body) returning id $$;
  create schema vault;
  create table vault.decrypted_secrets (name text, decrypted_secret text, created_at timestamptz default now());
`

let engine = null
async function fresh(t) {
  if (!engine) {
    const { PGlite } = await import(pathToFileURL(modulePath).href)
    engine = new PGlite()
    await engine.exec(STUBS)
    await engine.exec(MAIN)
    await engine.exec(SCHEDULE)
    await engine.exec(SCHEDULE) // the schedule migration re-runs cleanly
  }
  await engine.exec('begin')
  t.after(() => engine.exec('rollback'))
  return engine
}
test.after(() => engine?.close())

const rpc = async (db, sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0]

async function lobby(db, agents = ['AGENT000', 'AGENT050']) {
  const created = await rpc(db, 'select rc_run_ami_create_room($1, $2, $3)', [agents[0], 'AMI7K2', 't'.repeat(40)])
  assert.equal(created.ok, true, JSON.stringify(created))
  for (const a of agents.slice(1)) assert.equal((await rpc(db, 'select rc_run_ami_join_room($1, $2)', [a, 'AMI7K2'])).ok, true)
  const room = (await db.query('select id, version from rc_run_ami_rooms where code = $1', ['AMI7K2'])).rows[0]
  return { roomId: room.id, version: room.version, agents }
}

async function start(db, { roomId, version, agents }) {
  return rpc(db, `select rc_run_ami_start_match($1, $2, $3, $4, $5, $6, $7, $8::smallint, $9)`,
    [roomId, agents[0], version, agents, { turn: 0 }, { secret: true }, new Date(Date.now() + 30000).toISOString(), 1,
      JSON.stringify([{ type: 'MATCH_STARTED', seat: null, pub: { players: agents.length }, priv: {} }])])
}

const commit = (db, matchId, expected, actionId = randomUUID(), status = 'active') => rpc(db,
  `select rc_run_ami_commit($1, $2, $3, $4, $5, $6, $7::smallint, $8, $9, $10, $11, $12)`,
  [matchId, expected, { turn: 1 }, { secret: 2 }, status, status === 'active' ? new Date(Date.now() + 30000).toISOString() : null,
    status === 'active' ? null : 0, status === 'active' ? null : 'played_out',
    JSON.stringify([{ type: 'CARD_PLAYED', seat: 0, pub: {}, priv: {} }]), 'AGENT000', actionId,
    status === 'active' ? null : JSON.stringify([0, 1, 2].map((seat) => ({ seat, result: seat ? 'played' : 'won', final_cards: seat ? 3 : 0,
      forfeit_reason: null, run_ami_calls: seat ? 0 : 1, times_caught: 0, catches: 0, timeouts: 0 })))])

test("both migrations apply on a real Postgres engine with production's 11 cron jobs present; the schedule adds one", { skip }, async (t) => {
  const db = await fresh(t)
  const tables = (await db.query(`select tablename from pg_tables where tablename like 'rc_run_ami%' order by 1`)).rows.map((r) => r.tablename)
  assert.deepEqual(tables, ['rc_run_ami_events', 'rc_run_ami_match_players', 'rc_run_ami_match_secrets', 'rc_run_ami_matches', 'rc_run_ami_rooms', 'rc_run_ami_seats'])
  const mine = (await db.query(`select jobname, schedule from cron.job where jobname like 'rc-run-ami%'`)).rows
  assert.deepEqual(mine, [{ jobname: 'rc-run-ami-sweep', schedule: '* * * * *' }])
  assert.equal(Number(await rpc(db, 'select count(*) from cron.job')), 12, "production's 11 jobs kept, plus this one")
})

test('browser roles can read no RUN AMI table and run no RUN AMI function', { skip }, async (t) => {
  const db = await fresh(t)
  // Each refusal aborts the statement, so each runs in its own savepoint.
  const denied = async (sql) => {
    await db.exec('savepoint probe')
    await assert.rejects(db.query(sql), /permission denied/, sql)
    await db.exec('rollback to savepoint probe')
  }
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set local role ${role}`)
    await denied('select * from rc_run_ami_rooms')
    await denied('select * from rc_run_ami_match_secrets')
    await denied('select * from rc_run_ami_events')
    await denied(`select rc_run_ami_create_room('AGENT000', 'ZZZZZZ', 'x')`)
    await denied(`select rc_run_ami_commit(null, 1, null, null, 'active', null, null, null, null, null, null, null)`)
    await denied('select rc_invoke_run_ami_sweep()')
    await db.exec('reset role')
  }
})

test('the Bomb gate and one seat per agent hold in the database', { skip }, async (t) => {
  const db = await fresh(t)
  assert.deepEqual(await rpc(db, `select rc_run_ami_create_room('AGENT900', 'DARK22', 'x')`), { ok: false, error: 'bomb_dark' })
  await lobby(db)
  assert.equal((await rpc(db, `select rc_run_ami_create_room('AGENT000', 'OTHER2', 'y')`)).error, 'already_seated')
  assert.equal((await rpc(db, `select rc_run_ami_join_room('AGENT900', 'AMI7K2')`)).error, 'bomb_dark')
})

test('start refuses a lobby that changed since the deal; commit is compare-and-set and idempotent', { skip }, async (t) => {
  const db = await fresh(t)
  const l = await lobby(db)
  assert.equal((await rpc(db, `select rc_run_ami_join_room('AGENT120', 'AMI7K2')`)).ok, true)
  assert.equal((await start(db, l)).error, 'stale', 'a seat joined after the state was dealt')

  const fresh3 = { ...l, agents: ['AGENT000', 'AGENT050', 'AGENT120'], version: (await db.query('select version from rc_run_ami_rooms where id = $1', [l.roomId])).rows[0].version }
  const started = await start(db, fresh3)
  assert.equal(started.ok, true, JSON.stringify(started))

  const id = randomUUID()
  const first = await commit(db, started.match_id, 1, id)
  assert.equal(first.ok, true, JSON.stringify(first))
  assert.equal((await commit(db, started.match_id, 1)).reason, 'stale', 'an old version writes nothing')
  assert.equal((await commit(db, started.match_id, 2, id)).reason, 'duplicate', 'a replayed action id writes nothing')
  const m = (await db.query('select version, public_state from rc_run_ami_matches where id = $1', [started.match_id])).rows[0]
  assert.equal(m.version, 2)
  assert.deepEqual(m.public_state, { turn: 1 })

  const ended = await commit(db, started.match_id, 2, randomUUID(), 'finished')
  assert.equal(ended.ok, true, JSON.stringify(ended))
  const room = (await db.query('select status, current_match_id, last_match_id from rc_run_ami_rooms where id = $1', [l.roomId])).rows[0]
  assert.equal(room.status, 'waiting')
  assert.equal(room.current_match_id, null)
  assert.equal(room.last_match_id, started.match_id)
})

test('the sweep makes no HTTP call while idle, and one with the Vault token when a room is open', { skip }, async (t) => {
  const db = await fresh(t)
  assert.equal(await rpc(db, 'select rc_invoke_run_ami_sweep()'), null)
  assert.equal(Number(await rpc(db, 'select count(*) from net.calls')), 0)
  await lobby(db)
  assert.equal(await rpc(db, 'select rc_invoke_run_ami_sweep()'), null, 'no token in Vault: skipped')
  await db.exec(`insert into vault.decrypted_secrets (name, decrypted_secret) values ('rc_stream_sync_token', 'tok')`)
  assert.ok(await rpc(db, 'select rc_invoke_run_ami_sweep()'))
  const call = (await db.query('select url, body from net.calls')).rows[0]
  assert.match(call.url, /\/functions\/v1\/op-reconnect$/)
  assert.deepEqual(call.body, { action: 'cronRunAmiSweep', cronToken: 'tok' })
})
