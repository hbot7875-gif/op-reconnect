// rc_inactive_agent_deletion_preview (migration 20261112170000) against a real
// Postgres engine (PGlite). The preview must name exactly the agents the
// scheduled job would delete — same candidates (charge or verified vote, minus
// leave) and the same email/warning gate — and must not delete anything.
//
//   PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite/dist/index.js node --test <this file>
// Without PGLITE_MODULE the suite is skipped (and says so).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const mig = (f) => readFileSync(new URL(`../../../migrations/${f}`, import.meta.url), 'utf8')
const CANDIDATES = mig('20261101090000_rc_votes_count_as_activity.sql')
const RETENTION = mig('20260928060000_rc_privacy_retention.sql')
const PREVIEW = mig('20261112170000_rc_inactive_deletion_preview.sql')
const pick = (src, re, what) => { const m = src.match(re); if (!m) throw new Error(`missing ${what}`); return m[0] }
const WARNINGS_TABLE = pick(RETENTION, /create table if not exists rc_inactivity_warnings[\s\S]*?\n\);/, 'warnings table')
const NOTICE = pick(RETENTION, /create or replace function rc_warning_notice_days\(\)[\s\S]*?\$\$;/, 'notice days')
const VALID = pick(RETENTION, /create or replace function rc_warning_valid_days\(\)[\s\S]*?\$\$;/, 'valid days')
const SCHEDULED = pick(RETENTION, /create or replace function rc_delete_inactive_agents_scheduled[\s\S]*?\n\$\$;/, 'scheduled job')

const modulePath = process.env.PGLITE_MODULE
const skip = modulePath ? false : 'set PGLITE_MODULE to run the SQL suite'
const DAY = 86_400_000
const ago = (days) => new Date(Date.now() - days * DAY).toISOString()

async function setup() {
  const { PGlite } = await import(pathToFileURL(modulePath).href)
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table rc_agents (agent_no text primary key, handle text, email text, created_at timestamptz default now(), retired_at timestamptz);
    create table rc_players (agent_no text primary key, codename text, mode text, last_seen_at timestamptz, appear_offline boolean);
    create table rc_agent_charge (agent_no text primary key, last_fed_at timestamptz);
    create table rc_feed_events (agent_no text, event_type text, created_at timestamptz);
    create table rc_campaign_proofs (agent_no text, status text, verified_at timestamptz, submitted_at timestamptz);
    create table rc_player_leaves (agent_no text, starts_at timestamptz, ends_at timestamptz, ended_at timestamptz);
    create table rc_scrobbles (agent_no text, listened_at bigint);
    create table rc_player_districts (agent_no text, district_id text, status text, activated_at timestamptz,
      deadline_extended boolean, deadline_extension_hours integer);
    create table rc_districts (id text primary key, name text);
    create table purged (agent_no text, reason text);
    create function rc_purge_agent_data(p_agent text, p_reason text) returns boolean language sql
      as $$ insert into purged values (p_agent, p_reason); select true $$;
  `)
  await db.exec(CANDIDATES)
  await db.exec([WARNINGS_TABLE, NOTICE, VALID, SCHEDULED].join('\n'))
  await db.exec(PREVIEW)
  return db
}

/** One agent: charged `fed` days ago, optional email, vote, leave and warning. */
async function agent(db, no, { fed, email = null, vote = null, leave = null, warned = null, attempted = null, ok = true, retired = false }) {
  await db.query('insert into rc_agents (agent_no, handle, email, created_at, retired_at) values ($1, $2, $3, $4, $5)',
    [no, no.toLowerCase(), email, ago(60), retired ? ago(1) : null])
  await db.query('insert into rc_players (agent_no, codename) values ($1, $2)', [no, `Code ${no}`])
  await db.query('insert into rc_agent_charge values ($1, $2)', [no, ago(fed)])
  if (vote != null) await db.query("insert into rc_campaign_proofs values ($1, 'verified', $2, $2)", [no, ago(vote)])
  if (leave) await db.query('insert into rc_player_leaves values ($1, $2, $3, null)', [no, ago(leave[0]), ago(leave[1])])
  if (warned !== null || attempted !== null) {
    await db.query(`insert into rc_inactivity_warnings (agent_no, first_warned_at, last_warned_at, last_attempt_at, warn_count, last_delivery_ok)
                    values ($1, $2, $3, $4, $5, $6)`,
    [no, ago(warned ?? attempted), warned != null ? ago(warned) : null, ago(attempted ?? warned), warned != null ? 1 : 0, ok])
  }
}

async function fixture(db) {
  await agent(db, 'AGENT101', { fed: 16 })                                     // no email → deleted
  await agent(db, 'AGENT102', { fed: 18, email: 'b@x.io', warned: 3 })         // warned 3 days ago → deleted
  await agent(db, 'AGENT103', { fed: 15, email: 'c@x.io', warned: 1 })         // still in the 2-day notice
  await agent(db, 'AGENT104', { fed: 70, email: 'd@x.io', warned: 50 })        // warning lapsed (>45 days)
  await agent(db, 'AGENT105', { fed: 20, email: 'e@x.io' })                    // never warned
  await agent(db, 'AGENT106', { fed: 20, email: 'f@x.io', attempted: 1, ok: false }) // delivery failed
  await agent(db, 'AGENT107', { fed: 20, leave: [12, 2] })                     // 10 leave days → 10 after leave
  await agent(db, 'AGENT108', { fed: 20, vote: 3 })                            // a verified vote 3 days ago
  await agent(db, 'AGENT109', { fed: 11 })                                     // at risk
  await agent(db, 'AGENT110', { fed: 2, email: 'j@x.io' })                     // active
  await agent(db, 'AGENT001', { fed: 40 })                                     // protected
  await agent(db, 'AGENT111', { fed: 40, retired: true })                      // retired
}

const preview = async (db) => (await db.query('select * from rc_inactive_agent_deletion_preview(9, 14)')).rows
const byNo = (rows) => Object.fromEntries(rows.map((r) => [r.agent_no, r]))

test('preview lists the leave- and vote-adjusted clock from 9 days, with warning state', { skip }, async () => {
  const db = await setup()
  await fixture(db)
  const rows = byNo(await preview(db))
  assert.deepEqual(Object.keys(rows).sort(),
    ['AGENT101', 'AGENT102', 'AGENT103', 'AGENT104', 'AGENT105', 'AGENT106', 'AGENT107', 'AGENT109'])
  assert.ok(Number(rows.AGENT107.days_inactive) < 11, 'leave days are subtracted')
  assert.equal(rows.AGENT108, undefined, 'a recent verified vote resets the clock')
  assert.equal(rows.AGENT001, undefined)
  assert.equal(rows.AGENT111, undefined)
  assert.equal(rows.AGENT101.has_email, false)
  assert.equal(rows.AGENT103.warn_count, 1)
  assert.ok(new Date(rows.AGENT103.eligible_from) > new Date(), 'notice period still running')
  assert.equal(rows.AGENT106.last_warned_at, null)
  assert.equal(rows.AGENT106.last_delivery_ok, false)
  const eligible = Object.values(rows).filter((r) => r.eligible).map((r) => r.agent_no).sort()
  assert.deepEqual(eligible, ['AGENT101', 'AGENT102'])
})

test('eligible == exactly what the scheduled job deletes, and the preview deletes nothing', { skip }, async () => {
  const db = await setup()
  await fixture(db)
  const eligible = (await preview(db)).filter((r) => r.eligible).map((r) => r.agent_no).sort()
  assert.equal((await db.query('select count(*)::int as n from purged')).rows[0].n, 0, 'preview is read-only')
  const deleted = (await db.query('select deleted_agent_no from rc_delete_inactive_agents_scheduled(14)')).rows.map((r) => r.deleted_agent_no).sort()
  assert.deepEqual(eligible, deleted)
})

test('the preview is STABLE and only service_role may call it', { skip }, async () => {
  const db = await setup()
  const fn = (await db.query(`select provolatile, prosecdef from pg_proc where proname = 'rc_inactive_agent_deletion_preview'`)).rows[0]
  assert.equal(fn.provolatile, 's')
  const grants = (await db.query(`select grantee from information_schema.routine_privileges
    where routine_name = 'rc_inactive_agent_deletion_preview'`)).rows.map((r) => r.grantee)
  assert.ok(grants.includes('service_role'))
  for (const role of ['anon', 'authenticated', 'PUBLIC']) assert.ok(!grants.includes(role), role)
})

test('the migration only adds the read-only function', () => {
  const sql = PREVIEW.replace(/--.*$/gm, '')
  assert.doesNotMatch(sql, /\b(insert|update|delete|truncate|alter|drop)\b/i)
  assert.match(sql, /\bstable\b/)
  // the gate is the scheduled job's own clause, word for word
  for (const clause of ["coalesce(a.email, '') = ''", 'w.last_warned_at <= now() - make_interval(days => rc_warning_notice_days())',
    'w.last_warned_at >= now() - make_interval(days => rc_warning_valid_days())']) {
    assert.ok(SCHEDULED.includes(clause) && sql.includes(clause), clause)
  }
})
