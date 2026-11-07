// War of Cards stats, the Card Champion badge and the unlock record, against
// real Postgres (PGlite). Matches are finished through the real
// rc_run_ami_commit, so the badge trigger runs exactly as it will in
// production.
//   PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite/dist/index.js node --test <this file>
// Without PGLITE_MODULE the suite is skipped (and says so).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

const ROOT = new URL('../../../', import.meta.url)
const migration = (name) => readFileSync(new URL(`migrations/${name}`, ROOT), 'utf8')
const RUN_AMI = migration('20261018120000_rc_run_ami.sql')
const AWARD = migration('20260828120000_rc_badge_pool_preferences.sql')
const TEMPLATE = migration('20261107115000_rc_card_champion_badge_template.sql')
const STATS = migration('20261107120000_rc_war_of_cards_stats.sql')
const modulePath = process.env.PGLITE_MODULE
const skip = modulePath ? false : 'set PGLITE_MODULE to run the SQL suite'

const AGENTS = ['AGENT000', 'AGENT001', 'AGENT002', 'AGENT003']
const STUBS = `
  create role anon; create role authenticated; create role service_role;
  create table rc_agents (agent_no text primary key);
  create table rc_players (agent_no text primary key references rc_agents, codename text, equipped_badge_id text);
  create table rc_agent_charge (agent_no text primary key references rc_agents, charged_until timestamptz);
  create table rc_config (key text primary key, value jsonb);
  insert into rc_agents values ${AGENTS.map((a) => `('${a}')`).join(', ')};
  create schema realtime;
  create function realtime.send(payload jsonb, event text, topic text, private boolean) returns void language sql as $$ select $$;
  create table rc_badge_catalog (id text primary key, section text, rarity text, name text, unlock_hint text, sort_order int, active boolean default true, created_at timestamptz default now());
  create table rc_badge_art (id bigint generated always as identity primary key, template_id text references rc_badge_catalog (id), storage_path text, member text, pool text, active boolean default true);
  create table rc_badges (agent_no text, badge_id text, artwork_id bigint, earned_at timestamptz default now(), primary key (agent_no, badge_id));
`

// One engine for the whole file (PGlite is heavy on this machine); each test
// runs in a transaction that is rolled back afterwards.
let engine = null
async function setup(t) {
  if (!engine) {
    const { PGlite } = await import(pathToFileURL(modulePath).href)
    engine = new PGlite()
    await engine.exec(STUBS)
    await engine.exec(RUN_AMI)
    await engine.exec(AWARD)
    await engine.exec(TEMPLATE)
    await engine.exec(TEMPLATE) // re-runnable
    await engine.exec(STATS)
    await engine.exec(STATS)
  }
  await engine.exec('begin')
  t.after(() => engine.exec('rollback'))
  return engine
}

/** Play one match to its end through rc_run_ami_commit. `results` is one
 *  result per seat ('won' | 'played' | 'forfeited' | 'last_standing'). */
const CODE_CHARS = 'ABCDEFGHIJKLMNPQRSTUVWXYZ23456789'
let roomNo = 0
let clock = Date.parse('2026-11-05T01:00:00Z')
/** A unique 6-character room code (no 0, O or 1, like the real ones). */
const nextCode = () => {
  let n = ++roomNo
  let code = ''
  for (let i = 0; i < 6; i++) { code = CODE_CHARS[n % CODE_CHARS.length] + code; n = Math.floor(n / CODE_CHARS.length) }
  return code
}

/** Every test runs in one transaction, where now() never moves, so each
 *  match gets its own end time unless the test names one. */
async function playMatch(db, players, results, { endReason = 'played_out', turns = 40, endedAt = null } = {}) {
  if (!endedAt) { clock += 60_000; endedAt = new Date(clock).toISOString() }
  const room = randomUUID()
  const match = randomUUID()
  await db.query(`insert into rc_run_ami_rooms (id, code, host_agent_no, topic, status, current_match_id)
                  values ($1, $2, $3, repeat('t', 40), 'in_match', null)`, [room, nextCode(), players[0]])
  await db.query(`insert into rc_run_ami_matches (id, room_id, public_state, rules_version) values ($1, $2, '{}'::jsonb, 1)`, [match, room])
  await db.query(`insert into rc_run_ami_match_secrets (match_id, state) values ($1, '{}'::jsonb)`, [match])
  for (const [seat, agent] of players.entries()) {
    await db.query('insert into rc_run_ami_match_players (match_id, seat, agent_no) values ($1, $2, $3)', [match, seat, agent])
  }
  const winner = results.findIndex((r) => r === 'won' || r === 'last_standing')
  const r = await db.query(`select rc_run_ami_commit($1, 1, $2::jsonb, '{}'::jsonb, 'finished', null, $3::smallint, $4, '[]'::jsonb, $5, null, $6::jsonb) as res`, [
    match, JSON.stringify({ turnNo: turns }), winner < 0 ? null : winner, endReason, players[0],
    JSON.stringify(results.map((result, seat) => ({ seat, result, final_cards: result === 'won' ? 0 : 3, forfeit_reason: result === 'forfeited' ? 'left' : null, run_ami_calls: 0, times_caught: 0, catches: 0, timeouts: 0 }))),
  ])
  assert.equal(r.rows[0].res.ok, true, JSON.stringify(r.rows[0].res))
  await db.query('update rc_run_ami_matches set ended_at = $2 where id = $1', [match, endedAt])
  return match
}
const board = async (db, since = null) => Object.fromEntries((await db.query(
  'select agent_no, played, wins, current_streak, best_streak from rc_war_leaderboard($1)', [since])).rows
  .map((r) => [r.agent_no, [r.played, r.wins, r.current_streak, r.best_streak]]))

test('what counts: played-out wins, losses incl. forfeits; never walkovers or abandoned games', { skip }, async (t) => {
  const db = await setup(t)
  await playMatch(db, ['AGENT000', 'AGENT001'], ['won', 'played'])
  await playMatch(db, ['AGENT000', 'AGENT001'], ['played', 'won'])
  await playMatch(db, ['AGENT000', 'AGENT002'], ['won', 'forfeited'])
  await playMatch(db, ['AGENT000', 'AGENT003'], ['last_standing', 'forfeited'], { endReason: 'last_standing', turns: 3 })
  await playMatch(db, ['AGENT001', 'AGENT002'], ['won', 'played'], { turns: 6 }) // too short to be a game
  assert.deepEqual(await board(db), {
    AGENT000: [3, 2, 1, 1], // W, L, W — the walkover isn't a win
    AGENT001: [2, 1, 1, 1], // L, W; the 6-turn game counts for nothing, so the streak stands
    AGENT002: [1, 0, 0, 0], // left a game: that's a loss
    AGENT003: [1, 0, 0, 0], // quitting into a walkover is still a loss
  })
})

test('farming cap: 3 wins a KST day against the same opponents', { skip }, async (t) => {
  const db = await setup(t)
  for (let i = 0; i < 5; i++) await playMatch(db, ['AGENT000', 'AGENT001'], ['won', 'played'])
  await playMatch(db, ['AGENT000', 'AGENT002'], ['won', 'played'])
  const b = await board(db)
  assert.deepEqual(b.AGENT000, [4, 4, 4, 4], '3 against AGENT001 + 1 against AGENT002')
  assert.deepEqual(b.AGENT001, [5, 0, 0, 0], 'losses all count')
})

test('weekly view only counts from the week start; streaks stay lifetime', { skip }, async (t) => {
  const db = await setup(t)
  await playMatch(db, ['AGENT000', 'AGENT001'], ['won', 'played'], { endedAt: '2026-11-01T12:00:00Z' })
  await playMatch(db, ['AGENT000', 'AGENT002'], ['won', 'played'], { endedAt: '2026-11-02T12:00:00Z' })
  const week = await board(db, '2026-11-01T15:00:00Z')
  assert.deepEqual(week.AGENT000, [1, 1, 2, 2])
  assert.deepEqual((await board(db)).AGENT000, [2, 2, 2, 2])
})

test('Card Champion: a new badge every 10 counted wins, each once, all kept', { skip }, async (t) => {
  const db = await setup(t)
  const mine = async () => (await db.query("select badge_id, artwork_id from rc_badges where agent_no = 'AGENT000' order by badge_id")).rows
  const opponents = ['AGENT001', 'AGENT002', 'AGENT003']
  // Earlier days, so the 3-a-day cap per opponent never bites here.
  const win = (i) => playMatch(db, ['AGENT000', opponents[i % 3]], ['won', 'played'], { endedAt: `2026-10-${String(i + 1).padStart(2, '0')}T12:00:00Z` })
  for (let i = 0; i < 9; i++) await win(i)
  assert.deepEqual(await mine(), [], '9 wins: not yet')
  await playMatch(db, ['AGENT000', 'AGENT001'], ['last_standing', 'forfeited'], { endReason: 'last_standing' })
  assert.deepEqual(await mine(), [], 'a walkover is not the 10th win')
  await win(9)
  assert.deepEqual((await mine()).map((r) => r.badge_id), ['achievement_card_champion:10'], '10th counted win')
  for (let i = 10; i < 19; i++) await win(i)
  assert.equal((await mine()).length, 1, '19 wins: still one, never a duplicate')
  // Art uploaded after the first award fills in on a later win; badges stay.
  await db.query("insert into rc_badge_art (template_id, storage_path, member, pool) values ('achievement_card_champion', 'vault/x.webp', 'BTS', 'hot')")
  await win(19)
  const rows = await mine()
  assert.deepEqual(rows.map((r) => r.badge_id), ['achievement_card_champion:10', 'achievement_card_champion:20'], '20 wins: a second badge')
  assert.ok(rows.every((r) => r.artwork_id != null), 'both have their photo')
  for (let i = 20; i < 25; i++) await win(i)
  assert.equal((await mine()).length, 2, '25 wins: still two')
})

test('a broken badge check never blocks a match result', { skip }, async (t) => {
  const db = await setup(t)
  await db.exec("update rc_badge_catalog set active = false where id = 'achievement_card_champion'")
  await db.exec('alter table rc_badges rename to rc_badges_gone')
  for (let i = 0; i < 10; i++) await playMatch(db, ['AGENT000', ['AGENT001', 'AGENT002', 'AGENT003'][i % 3]], ['won', 'played'], { endedAt: `2026-10-${String(i + 10)}T12:00:00Z` })
  assert.equal((await board(db)).AGENT000[1], 10, 'every result saved')
})

test('the unlock record, the template, and browser roles locked out', { skip }, async (t) => {
  const db = await setup(t)
  const tpl = (await db.query("select section, rarity, name, active from rc_badge_catalog where id = 'achievement_card_champion'")).rows[0]
  assert.deepEqual(tpl, { section: 'achievement', rarity: 'rare', name: 'War of Cards — Card Champion', active: true })
  await db.query("insert into rc_war_unlock_notices (agent_no) values ('AGENT001') on conflict do nothing")
  await db.query("insert into rc_war_unlock_notices (agent_no) values ('AGENT001') on conflict do nothing")
  assert.equal((await db.query('select count(*)::int n from rc_war_unlock_notices')).rows[0].n, 1)
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await db.query(`select has_table_privilege('${role}', 'public.rc_war_unlock_notices', 'select') ok`)).rows[0].ok, false)
    for (const fn of ['rc_war_outcomes()', 'rc_war_leaderboard(timestamptz)']) {
      assert.equal((await db.query(`select has_function_privilege('${role}', 'public.${fn}', 'execute') ok`)).rows[0].ok, false, fn)
    }
  }
})
