// PC Giveaway — migration 20261109180000 against a real Postgres engine
// (PGlite): the review list's rules, the freeze lock and the one-time draw.
//
//   PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite/dist/index.js node --test <this file>
// Without PGLITE_MODULE the suite is skipped (and says so).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const MIGRATION = readFileSync(new URL('../../../migrations/20261109180000_rc_pc_giveaway.sql', import.meta.url), 'utf8')
const modulePath = process.env.PGLITE_MODULE
const skip = modulePath ? false : 'set PGLITE_MODULE to run the SQL suite'
const C = 'mama_r2'
const RULES = { vote_mission: 'mnet', vote_num: 8, vote_den: 12, stream_num: 6, stream_den: 12, dup_window_s: 600, exclude_agents: ['AGENT000'] }
// Battle: 12 KST days, Oct 28 – Nov 8.
const DAYS = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, 9, 28 + i)).toISOString().slice(0, 10))
const kstNoon = (day) => Math.floor(Date.parse(`${day}T12:00:00+09:00`) / 1000)

async function setup() {
  const { PGlite } = await import(pathToFileURL(modulePath).href)
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create function rc_kst_day(p_at timestamptz default now()) returns date language sql stable
      as $$ select (p_at at time zone 'Asia/Seoul')::date $$;
    create table rc_agents (agent_no text primary key, handle text, retired_at timestamptz);
    create table rc_vote_campaigns (id text primary key, opens_at timestamptz, closes_at timestamptz, battle jsonb);
    create table rc_campaign_teams (campaign_id text, agent_no text, team text, assigned_via text,
      started_at timestamptz default now(), assigned_at timestamptz, show_ig boolean not null default false, show_ig_at timestamptz,
      primary key (campaign_id, agent_no));
    create table rc_campaign_proofs (id bigserial primary key, campaign_id text, mission_id text, agent_no text, vote_day date, status text);
    create table rc_scrobbles (id bigserial primary key, agent_no text, source text, track_name text, listened_at bigint);
    create table rc_daily_activity (agent_no text, kst_date date, raw_streams int, primary key (agent_no, kst_date));
    insert into rc_vote_campaigns values ('${C}', '2026-10-28T18:00:00+09:00', '2026-11-08T23:59:59+09:00',
      '{"teams":[{"id":"aliens","label":"ALIENS"},{"id":"hooligans","label":"HOOLIGANS"}]}');
  `)
  await db.exec(MIGRATION)
  return db
}

async function member(db, agent, { team = 'aliens', via = 'carried', joined = null, handle = agent.toLowerCase(), showIg = null, retired = false } = {}) {
  await db.query('insert into rc_agents values ($1, $2, $3)', [agent, handle, retired ? new Date().toISOString() : null])
  await db.query(`insert into rc_campaign_teams (campaign_id, agent_no, team, assigned_via, assigned_at, show_ig, show_ig_at)
                  values ($1, $2, $3, $4, $5, $6, $7)`,
  [C, agent, team, via, joined ? `${joined}T20:00:00+09:00` : null, showIg === true, showIg === null ? null : new Date().toISOString()])
}
async function votes(db, agent, days, { status = 'verified', mission = 'mnet' } = {}) {
  for (const d of days) await db.query('insert into rc_campaign_proofs (campaign_id, mission_id, agent_no, vote_day, status) values ($1, $2, $3, $4, $5)', [C, mission, agent, d, status])
}
async function plays(db, agent, days, source = 'webhook', offset = 0) {
  for (const d of days) await db.query('insert into rc_scrobbles (agent_no, source, track_name, listened_at) values ($1, $2, $3, $4)', [agent, source, 'Butter', kstNoon(d) + offset])
}
const candidates = async (db) => (await db.query('select rc_giveaway_candidates($1, $2, $3) as j', [C, 'aliens', RULES])).rows[0].j
const byAgent = (list) => Object.fromEntries(list.map((c) => [c.agent_no, c]))

test('review list: proportional windows, unique streaming days and exclusions', { skip }, async () => {
  const db = await setup()
  // Full window, exactly at the thresholds (8 voting, 6 streaming days).
  await member(db, 'A1', { handle: 'koya.nav' }); await votes(db, 'A1', DAYS.slice(0, 8)); await plays(db, 'A1', DAYS.slice(0, 6))
  // One voting day short; rejected and X proofs don't count.
  await member(db, 'A2'); await votes(db, 'A2', DAYS.slice(0, 7)); await votes(db, 'A2', [DAYS[8]], { status: 'rejected' })
  await votes(db, 'A2', [DAYS[9]], { mission: 'x' }); await plays(db, 'A2', DAYS)
  // Joined Nov 6 at 20:00 KST: 3-day window → needs 2 voting + 2 streaming days.
  await member(db, 'A3', { via: 'choice', joined: '2026-11-06' }); await votes(db, 'A3', DAYS.slice(9, 11)); await plays(db, 'A3', DAYS.slice(9, 11))
  // Five real streaming days, plus copies from a second source 90 s later.
  // The copy of the day-5 play lands just past midnight KST on day 6: it must
  // NOT create a sixth streaming day.
  await member(db, 'A4'); await votes(db, 'A4', DAYS)
  await plays(db, 'A4', DAYS.slice(0, 5)); await plays(db, 'A4', DAYS.slice(0, 5), 'lb-like', 90)
  await db.query('insert into rc_scrobbles (agent_no, source, track_name, listened_at) values ($1, $2, $3, $4), ($1, $5, $3, $6)',
    ['A4', 'webhook', 'Dynamite', kstNoon(DAYS[4]) + 12 * 3600 - 30, 'lb-like', kstNoon(DAYS[4]) + 12 * 3600 + 60])
  // A day recorded only as a live total (no stored plays) still counts.
  await member(db, 'A5', { showIg: false, handle: 'hidden.one' }); await votes(db, 'A5', DAYS)
  await plays(db, 'A5', DAYS.slice(0, 5)); await db.query('insert into rc_daily_activity values ($1, $2, 40)', ['A5', DAYS[11]])
  await member(db, 'A6', { retired: true }); await votes(db, 'A6', DAYS); await plays(db, 'A6', DAYS)
  await member(db, 'AGENT000'); await votes(db, 'AGENT000', DAYS); await plays(db, 'AGENT000', DAYS)
  await member(db, 'H1', { team: 'hooligans' }); await votes(db, 'H1', DAYS); await plays(db, 'H1', DAYS)

  const c = byAgent(await candidates(db))
  assert.equal(Object.keys(c).length, 7, 'only the requested team')
  assert.equal(c.H1, undefined)
  assert.deepEqual([c.A1.eligible, c.A1.vote_days, c.A1.vote_need, c.A1.stream_days, c.A1.stream_need, c.A1.display], [true, 8, 8, 6, 6, '@koya.nav'])
  assert.equal(c.A2.eligible, false); assert.equal(c.A2.vote_days, 7); assert.match(c.A2.reason, /Voting 7 of 12 days \(needs 8\)/)
  assert.deepEqual([c.A3.joined, c.A3.days, c.A3.vote_need, c.A3.stream_need, c.A3.eligible], ['2026-11-06', 3, 2, 2, true])
  assert.equal(c.A4.stream_days, 5, 'duplicates from a second source add no day'); assert.equal(c.A4.eligible, false)
  assert.deepEqual([c.A5.stream_days, c.A5.eligible, c.A5.display], [6, true, 'A5'])
  assert.deepEqual([c.A6.eligible, c.A6.reason], [false, 'Account retired'])
  assert.deepEqual([c.AGENT000.eligible, c.AGENT000.reason], [false, 'Admin account'])
})

test('freeze locks the reviewed list; one official draw only', { skip }, async () => {
  const db = await setup()
  for (const a of ['A1', 'A2', 'A3']) { await member(db, a); await votes(db, a, DAYS); await plays(db, a, DAYS) }
  const prep = (await db.query('select rc_giveaway_prepare($1, $2, $3, $4) as j', ['pc1', C, 'aliens', RULES])).rows[0].j
  const g0 = (await db.query(`select status, team_label from rc_giveaways where id = 'pc1'`)).rows[0]
  assert.deepEqual(g0, { status: 'draft', team_label: 'ALIENS' })

  await assert.rejects(db.query('select rc_giveaway_draw($1, 3, 0, 1)', ['pc1']), /not_frozen/)
  await assert.rejects(db.query('select rc_giveaway_freeze($1, $2, 3)', ['pc1', '2020-01-01T00:00:00Z']), /list_changed_review_again/)
  await assert.rejects(db.query('select rc_giveaway_freeze($1, $2, 2)', ['pc1', prep.prepared_at]), /count_mismatch/)
  const fr = (await db.query('select rc_giveaway_freeze($1, $2, 3) as j', ['pc1', prep.prepared_at])).rows[0].j
  assert.equal(fr.entries, 3); assert.match(fr.entries_hash, /^[0-9a-f]{64}$/)

  // Frozen: no refresh, no edits, no delete.
  await assert.rejects(db.query('select rc_giveaway_prepare($1, $2, $3, $4)', ['pc1', C, 'aliens', RULES]), /giveaway_locked/)
  await assert.rejects(db.query(`update rc_giveaways set entries = '[]' where id = 'pc1'`), /giveaway_locked/)
  await assert.rejects(db.query(`update rc_giveaways set status = 'draft' where id = 'pc1'`), /giveaway_locked/)
  await assert.rejects(db.query(`delete from rc_giveaways where id = 'pc1'`), /giveaway_locked/)

  await assert.rejects(db.query('select rc_giveaway_draw($1, 4, 0, 1)', ['pc1']), /count_mismatch/)
  await assert.rejects(db.query('select rc_giveaway_draw($1, 3, 3, 1)', ['pc1']), /bad_index/)
  const d = (await db.query('select rc_giveaway_draw($1, 3, 1, 123456) as j', ['pc1'])).rows[0].j
  assert.deepEqual([d.winner_index, d.winner_display], [1, '@a2'])
  const row = (await db.query(`select winner_agent_no, entry_count, random_value, entries_hash from rc_giveaway_draws where giveaway_id = 'pc1'`)).rows[0]
  assert.deepEqual([row.winner_agent_no, row.entry_count, Number(row.random_value), row.entries_hash], ['A2', 3, 123456, fr.entries_hash])

  // A second official winner is impossible, and the stored draw can't be changed.
  await assert.rejects(db.query('select rc_giveaway_draw($1, 3, 0, 1)', ['pc1']), /already_drawn/)
  await assert.rejects(db.query(`update rc_giveaway_draws set winner_index = 0 where giveaway_id = 'pc1'`), /giveaway_draw_is_final/)
  await assert.rejects(db.query(`delete from rc_giveaway_draws where giveaway_id = 'pc1'`), /giveaway_draw_is_final/)
  assert.equal((await db.query(`select status from rc_giveaways where id = 'pc1'`)).rows[0].status, 'drawn')
})
