// Runs migration 20261013150000 against a real Postgres engine (PGlite) and
// exercises the rules only the database can enforce: one credit per mission
// per KST day, duplicate proofs, idempotent retries, gift fill only from
// verified proofs, a Voting Gift that cannot open twice, server-side team
// assignment, battle points, Battle Gift claims, the 5-day badge and the
// Vote Pulse snapshot.
//
// PGlite is not a project dependency. Point PGLITE_MODULE at an installed
// copy and run this file directly (node --test's worker can run out of
// memory on a small machine):
//   PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite/dist/index.js node <this file>
// On a low-memory machine add  --no-wasm-dynamic-tiering --liftoff-only
// Without it the suite is skipped (and says so), never silently passed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ROOT = new URL('../../../', import.meta.url)
const migration = (name) => readFileSync(new URL(`migrations/${name}`, ROOT), 'utf8')
const MIGRATION = migration('20261013150000_rc_vote_campaigns.sql')
const OFFSET_MIGRATION = migration('20261014090000_rc_campaign_cert_utc_offset.sql')
const SELF_SERVICE_MIGRATION = migration('20261019120000_rc_vote_proof_self_service.sql')
const MINUTE_MIGRATION = migration('20261020090000_rc_vote_duplicate_minute.sql')
const REPLACE_MIGRATION = migration('20261020120000_rc_vote_x_replacement.sql')
const HUB_MIGRATIONS = ['20261015150000_rc_battle_hub.sql', '20261016090000_rc_battle_team_today.sql',
  '20261016120000_rc_battle_team_ig_default_on.sql', '20261016150000_rc_battle_team_ig_open.sql'].map(migration)
const ROUND2_MIGRATION = migration('20261026180000_rc_mama_round2.sql')
const DAESANG_MIGRATION = migration('20261027120000_rc_mama_daesang_badge.sql')
const TERMS_MIGRATION = migration('20261027180000_rc_mama_round2_terms.sql')
// The same file without its own transaction, to re-run inside a test's.
const ROUND2_BODY = ROUND2_MIGRATION.replace(/^(begin|commit);\r?$/gm, '')

const modulePath = process.env.PGLITE_MODULE
const skip = modulePath ? false : 'set PGLITE_MODULE to run the SQL suite'
const AGENTS = Array.from({ length: 12 }, (_, i) => `AGENT${String(i + 1).padStart(3, '0')}`)

/** The production tables this migration touches, at the shape it uses them. */
function stubs() {
  const retention = migration('20260928060000_rc_privacy_retention.sql')
  const queueDdl = retention.match(/create table if not exists rc_storage_deletion_queue \([\s\S]*?\n\);/)[0]
  const award = migration('20260828120000_rc_badge_pool_preferences.sql')
  const awardFn = award.match(/create or replace function rc_award_badge\([\s\S]*?\n\$\$;/)[0]
  return `
    create role anon; create role authenticated; create role service_role;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean,
      file_size_limit bigint, allowed_mime_types text[]);
    create table rc_agents (agent_no text primary key);
    create table rc_players (agent_no text primary key references rc_agents on delete cascade,
      charge_cells integer default 0, wings integer default 0,
      streak_freeze_charges integer default 0, deadline_extension_charges integer default 0);
    create table rc_player_items (id bigserial primary key, agent_no text, item_id text, used_at timestamptz);
    create table rc_xp_ledger (id bigserial primary key, agent_no text, amount integer, source text,
      kind text default 'earn', dedup_key text unique, meta jsonb, created_at timestamptz default now());
    create table rc_badge_catalog (id text primary key, section text, rarity text default 'common',
      name text, unlock_hint text, sort_order integer default 0, active boolean default true,
      created_at timestamptz default now());
    create table rc_badge_art (id bigserial primary key, template_id text, active boolean default true, pool text);
    create table rc_badges (agent_no text, badge_id text, artwork_id bigint, earned_at timestamptz default now(),
      unique (agent_no, badge_id));
    create table rc_vma_votes (id bigserial primary key, agent_no text, event_id text,
      proof_path text, ocr_text text, image_hash text, votes_logged integer default 0);
    create table rc_supply_chest_progress (agent_no text, event_id text, fill_count integer, primary key (agent_no, event_id));
    create table rc_config (key text primary key, value jsonb);
    insert into rc_config values ('vma_2026', '{"title":"VMA"}'), ('supply_chest', '{"threshold":50}');
    ${queueDdl}
    ${awardFn}
    insert into rc_agents values ${AGENTS.map((a) => `('${a}')`).join(', ')};
    insert into rc_players (agent_no) values ${AGENTS.map((a) => `('${a}')`).join(', ')};
  `
}

const H = (c) => c.repeat(64)

// One engine for the whole file (each instance is a full Postgres in WASM);
// every test runs in a transaction that is rolled back afterwards, so each
// starts from the freshly migrated state.
let engine = null
async function fresh(t) {
  if (!engine) {
    const { PGlite } = await import(pathToFileURL(modulePath).href)
    engine = new PGlite()
    await engine.exec(stubs())
    await engine.exec(MIGRATION)
    await engine.exec(OFFSET_MIGRATION)
    await engine.exec(OFFSET_MIGRATION) // re-runnable
    await engine.exec(SELF_SERVICE_MIGRATION)
    await engine.exec(SELF_SERVICE_MIGRATION) // re-runnable
    await engine.exec(MINUTE_MIGRATION)
    await engine.exec(MINUTE_MIGRATION) // re-runnable
    await engine.exec(REPLACE_MIGRATION)
    await engine.exec(REPLACE_MIGRATION) // re-runnable
    // Round 2 also touches the Event Hub's chat and team columns.
    await engine.exec('alter table rc_players add column codename text; create table rc_cache (key text primary key, value jsonb, updated_at timestamptz);')
    for (const m of HUB_MIGRATIONS) await engine.exec(m)
    await engine.exec(ROUND2_MIGRATION)
    await engine.exec(ROUND2_MIGRATION) // re-runnable
    await engine.exec(DAESANG_MIGRATION)
    await engine.exec(DAESANG_MIGRATION) // re-runnable
    await engine.exec(TERMS_MIGRATION)
    await engine.exec(TERMS_MIGRATION) // re-runnable
    // The real freezes (Oct 23, Nov 9) pass while this suite lives on, and a
    // frozen battle stamps no points. Tests run before a far-off freeze;
    // freezeNow() moves it when a test needs one. The approved times are
    // checked against the migration files instead.
    await engine.exec(`update rc_vote_campaigns set battle = battle || '{"freeze_at": "2099-01-01T00:00:00Z"}'::jsonb`)
  }
  await engine.exec('begin')
  t.after(() => engine.exec('rollback'))
  return engine
}
test.after(() => engine?.close())

const q1 = async (db, sql, params = []) => (await db.query(sql, params)).rows[0]
const json = async (db, sql, params) => Object.values(await q1(db, sql, params))[0]
const n = async (db, sql, params) => Number(Object.values(await q1(db, sql, params))[0])

async function submit(db, o) {
  // Every proof needs a MAMA team first (rc_campaign_submit_proof's
  // team_required rule). Joining is a no-op for an agent already on a team.
  const agent = o.agent ?? 'AGENT001'
  if (o.mission === 'x' && o.status === 'verified' && !o.author) o.author = agent.toLowerCase()
  if (o.mission === 'x' && o.author && !o.unregistered) {
    await json(db, `select rc_campaign_register_x_handle($1,$2,$3) as r`, [o.campaign ?? 'mama_2026', agent, o.author])
  }
  if (!o.noTeam) await joinTeam(db, agent, o.team ?? 'hooligans')
  return json(db, `select rc_campaign_submit_proof($1,$2,$3,$4::date,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15) as r`, [
    o.campaign ?? 'mama_2026', o.mission ?? 'mnet', agent, o.day ?? '2026-10-14',
    o.status ?? 'verifying', JSON.stringify(o.checks ?? {}), JSON.stringify(o.client ?? {}), o.method ?? null, null,
    o.path ?? null, o.hash ?? null, o.orig ?? null, o.post ?? null, o.postUrl ?? null, o.author ?? null,
  ])
}
const transition = (db, id, from, to, method = 'reviewer_ocr', checks = null) =>
  json(db, 'select rc_campaign_transition($1,$2::text[],$3,$4::jsonb,$5,$6,$7) as r',
    [id, from, to, checks ? JSON.stringify(checks) : null, method, method === 'admin' ? 'HT' : null, null])
const fill = (db, agent = 'AGENT001') =>
  n(db, `select coalesce((select fill from rc_vote_gift_progress where campaign_id='mama_2026' and agent_no=$1),0)`, [agent])
let seq = 0
/** A verified X proof — the simplest way to make one verified mission. */
async function verifiedX(db, agent = 'AGENT001', day = '2026-10-14', author = agent.toLowerCase()) {
  seq++
  return submit(db, { mission: 'x', agent, day, status: 'verified', post: String(1846000000000000000n + BigInt(seq)), author })
}
async function joinTeam(db, agent, team) {
  await json(db, `select rc_campaign_team_start('mama_2026',$1) as r`, [agent])
  return json(db, `select rc_campaign_team_choose('mama_2026',$1,$2) as r`, [agent, team])
}
const freezeNow = (db) => db.query(`update rc_vote_campaigns set battle = battle || jsonb_build_object('freeze_at', now() - interval '1 second') where id='mama_2026'`)
const battle = (db, agent = 'AGENT001') => json(db, `select rc_campaign_battle_state('mama_2026', $1) as r`, [agent])
const setBattle = (db, patch) => db.query(`update rc_vote_campaigns set battle = battle || $1::jsonb where id = 'mama_2026'`, [JSON.stringify(patch)])
const players = (db, agent = 'AGENT001') => q1(db, `select charge_cells, wings, streak_freeze_charges, deadline_extension_charges,
  (select count(*)::int from rc_player_items where agent_no = $1) as passes,
  (select coalesce(sum(amount),0)::int from rc_xp_ledger where agent_no = $1) as xp
  from rc_players where agent_no = $1`, [agent])

// ── Event config ──────────────────────────────────────────────────────

test('migration applies cleanly; MAMA config is isolated from VMA', { skip }, async (t) => {
  const db = await fresh(t)
  const c = await q1(db, `select * from rc_vote_campaigns where id = 'mama_2026'`)
  assert.equal(c.title, 'MAMA 2026')
  assert.equal(c.round_label, "Fans' Choice · Round 1")
  assert.equal(new Date(c.opens_at).toISOString(), '2026-10-12T10:00:00.000Z', '19:00 KST')
  const [mnet, x] = c.missions
  assert.deepEqual([mnet.max_daily, x.max_daily, x.max_handles], [3, 3, 3])
  assert.equal(mnet.vote_url, 'https://mnetplus.world/event/2026-mama?deeplink=mnetplus%3A%2F%2Fvote%2Ftemplates%2Fmama-fans-choice-vote-r1%2F6ab09532c314bb17315adc4e%3Furl_fallback_type%3Dupdate&missionType=MAMA_2026_FANS_CHOICE_VOTE_1ST_SHARE&refererCode=')
  assert.deepEqual(mnet.certificate.category_keywords, ["fans' choice category 1st vote", 'fans choice category 1st vote'])
  assert.equal(JSON.stringify(mnet).includes('bts'), false, 'the certificate has no BTS text to look for — the image check covers it')
  assert.deepEqual(x.hashtags, ['2026MAMAVOTE', 'BTS'])
  assert.equal(new Date(c.closes_at).toISOString(), '2026-10-22T14:59:59.000Z', '23:59:59 KST')
  assert.deepEqual([c.gift.name, c.gift.threshold, c.gift.daily_open_cap, c.gift.rolls], ['Voting Gift', 5, 2, 3])
  assert.deepEqual(c.gift.pool.map((p) => [p.kind, p.weight, p.amount]), [
    ['charge_cell', 30, 1], ['xp', 20, 10], ['streak_freeze', 15, 1], ['extension', 10, 1], ['wings', 15, 1], ['backup_pass', 10, 1]])
  assert.equal(c.gift.pool.reduce((s, p) => s + p.weight, 0), 100)
  assert.deepEqual(c.rewards, { badge_template_id: 'event_mama_2026', badge_verified_days: 5 })
  assert.deepEqual(c.battle.teams.map((x) => x.label), ['HOOLIGANS', 'ALIENS'])
  assert.deepEqual(c.battle.milestones, [200, 500, 900, 1400, 2200])
  assert.match(MIGRATION, /"freeze_at": "2026-10-23T12:00:00\+09:00"/, 'Oct 23 12:00 KST')
  assert.deepEqual(c.battle.gift.pool.map((p) => [p.kind, p.weight, p.amount]), [
    ['charge_cell', 32, 1], ['xp', 26, 10], ['wings', 17, 1], ['streak_freeze', 15, 1], ['extension', 6, 1], ['backup_pass', 4, 1]])
  assert.equal(c.battle.gift.pool.reduce((s, p) => s + p.weight, 0), 100)
  assert.deepEqual([c.battle.gift.rolls_min, c.battle.gift.rolls_max], [1, 2])
  assert.deepEqual(c.battle.winner_reward, [{ kind: 'xp', amount: 20 }, { kind: 'charge_cell', amount: 1 }])
  assert.equal(JSON.stringify(c.battle).includes('badge'), false, 'no badge in the Battle Gift pool')
  assert.deepEqual([c.pulse.enabled, c.pulse.exclude_retweets], [false, false], 'Pulse off until the Apify token is proven; reposts not excluded')
  assert.equal(JSON.stringify(c).includes('vma'), false)
  assert.equal(JSON.stringify(c.gift).includes('badge'), false, 'no badge in the gift pool')
  const cfg = (await db.query(`select key, value from rc_config order by key`)).rows
  assert.deepEqual(cfg.map((r) => [r.key, r.value]), [['supply_chest', { threshold: 50 }], ['vma_2026', { title: 'VMA' }]])
  assert.equal((await q1(db, `select public from storage.buckets where id = 'campaign-proofs'`)).public, false)
})

test('window: Oct 12 (partial day from 19:00 KST) through Oct 22 counts; outside does not', { skip }, async (t) => {
  const db = await fresh(t)
  assert.equal((await submit(db, { hash: H('a'), day: '2026-10-11' })).error, 'voting_closed')
  assert.equal((await submit(db, { hash: H('b'), day: '2026-10-12' })).success, true)
  assert.equal((await submit(db, { hash: H('c'), day: '2026-10-22' })).success, true)
  assert.equal((await submit(db, { hash: H('d'), day: '2026-10-23' })).error, 'voting_closed')
})

test('rc_kst_day turns over at 00:00 KST (15:00 UTC), not UTC midnight', { skip }, async (t) => {
  const db = await fresh(t)
  const r = await q1(db, `select rc_kst_day('2026-10-13T14:59:59Z')::text as a, rc_kst_day('2026-10-13T15:00:00Z')::text as b,
    rc_kst_day('2026-10-12T10:00:00Z')::text as c`)
  assert.deepEqual([r.a, r.b, r.c], ['2026-10-13', '2026-10-14', '2026-10-12'])
})

// ── Proofs ────────────────────────────────────────────────────────────

test('Mnet: three distinct certificates fit one KST day; the fourth is refused', { skip }, async (t) => {
  const db = await fresh(t)
  const a = await submit(db, { hash: H('a'), client: { artist: true, category: true, date: true } })
  assert.deepEqual([a.success, a.status], [true, 'verifying'])
  assert.equal(await fill(db), 0, 'a verifying proof adds nothing, whatever the browser said')
  assert.equal((await battle(db)).total, 0, 'and no battle point')
  assert.equal((await submit(db, { hash: H('b') })).success, true)
  assert.equal((await submit(db, { hash: H('c') })).success, true)
  assert.equal((await submit(db, { hash: H('d') })).error, 'daily_mission_limit')
  assert.equal((await submit(db, { hash: H('e'), day: '2026-10-15' })).success, true)
})

test('submit refuses a status the server did not earn', { skip }, async (t) => {
  const db = await fresh(t)
  assert.equal((await submit(db, { hash: H('a'), status: 'rejected' })).error, 'bad_status')
})

test('duplicate screenshot blocked across agents (stored or original hash)', { skip }, async (t) => {
  const db = await fresh(t)
  await submit(db, { hash: H('a'), orig: H('1') })
  assert.equal((await submit(db, { agent: 'AGENT002', hash: H('a'), orig: H('2') })).error, 'duplicate_proof')
  assert.equal((await submit(db, { agent: 'AGENT002', hash: H('b'), orig: H('1') })).error, 'duplicate_proof')
})

test('X: three handles can vote daily; each handle and URL only credit once', { skip }, async (t) => {
  const db = await fresh(t)
  await joinTeam(db, 'AGENT001', 'hooligans')
  const x = await submit(db, { mission: 'x', status: 'verified', post: '1846000000000000001', author: 'one' })
  assert.equal(x.status, 'verified')
  const retry = await submit(db, { mission: 'x', status: 'verified', post: '1846000000000000001', author: 'one' })
  assert.deepEqual([retry.success, retry.retry, retry.id], [true, true, x.id])
  assert.equal(await fill(db), 1, 'retry adds no fill')
  assert.equal((await battle(db)).total, 1, 'retry adds no point')
  assert.equal((await submit(db, { mission: 'x', agent: 'AGENT002', status: 'verified', post: '1846000000000000001', author: 'other' })).error, 'duplicate_proof')
  assert.equal((await submit(db, { mission: 'x', status: 'verified', post: '1846000000000000002', author: 'one' })).error, 'x_handle_daily_limit')
  assert.equal((await submit(db, { mission: 'x', status: 'verified', post: '1846000000000000003', author: 'two' })).success, true)
  assert.equal((await submit(db, { mission: 'x', status: 'verified', post: '1846000000000000004', author: 'three' })).success, true)
  assert.deepEqual([await fill(db), (await battle(db)).total], [3, 3])
})

test('combined: six verified missions add exactly six fills and six battle/community points; retries add none', { skip }, async (t) => {
  const db = await fresh(t)
  await joinTeam(db, 'AGENT001', 'aliens')
  for (const [i, ch] of ['a', 'b', 'c'].entries()) {
    const proof = await submit(db, { hash: H(ch) })
    assert.equal((await transition(db, proof.id, ['verifying'], 'verified', 'reviewer_ocr', { certificate: true, category: true, date: true, bts: 'match' })).success, true)
    assert.equal((await json(db, 'select rc_campaign_apply_verified($1) as r', [proof.id])).applied, false, `Mnet retry ${i + 1}`)
  }
  for (const [i, handle] of ['one', 'two', 'three'].entries()) {
    const proof = await submit(db, { mission: 'x', status: 'verified', post: String(1846000000000000100n + BigInt(i)), author: handle })
    assert.equal(proof.success, true)
    const retry = await submit(db, { mission: 'x', status: 'verified', post: String(1846000000000000100n + BigInt(i)), author: handle })
    assert.equal(retry.retry, true)
  }
  assert.deepEqual([await fill(db), (await battle(db)).total], [6, 6])
  assert.equal(await n(db, `select count(*) from rc_vote_gift_fills where campaign_id='mama_2026' and agent_no='AGENT001'`), 6)
})

test('verified Mnet adds fill once, even if applied again', { skip }, async (t) => {
  const db = await fresh(t)
  await joinTeam(db, 'AGENT001', 'aliens')
  const a = await submit(db, { hash: H('a') })
  assert.equal((await transition(db, a.id, ['verifying'], 'verified', 'reviewer_ocr', { artist: true, category: true, date: true })).success, true)
  assert.equal(await fill(db), 1)
  assert.equal((await json(db, 'select rc_campaign_apply_verified($1) as r', [a.id])).applied, false)
  assert.equal((await transition(db, a.id, ['verifying'], 'verified')).error, 'status_changed')
  assert.equal(await fill(db), 1)
  assert.equal((await battle(db)).total, 1)
})

test('review and rejected proofs add nothing; rejection frees a daily slot', { skip }, async (t) => {
  const db = await fresh(t)
  const a = await submit(db, { hash: H('a') })
  assert.equal((await transition(db, a.id, ['verifying'], 'review', 'reviewer_ocr', { artist: true, category: false, date: true })).status, 'review')
  assert.equal((await transition(db, a.id, ['verifying', 'review'], 'rejected', 'admin')).status, 'rejected')
  assert.equal(await fill(db), 0)
  assert.equal((await battle(db)).total, 0)
  const row = await q1(db, 'select reviewed_by, reviewed_at is not null as at from rc_campaign_proofs where id = $1', [a.id])
  assert.deepEqual([row.reviewed_by, row.at], ['HT', true])
  const b = await submit(db, { hash: H('b') })
  assert.equal(b.success, true)
  assert.equal((await transition(db, a.id, ['rejected'], 'verified', 'admin')).success, true, 'a distinct certificate can re-enter while below the cap')
  assert.equal((await transition(db, b.id, ['verifying'], 'verified', 'admin')).success, true)
  assert.equal(await fill(db), 2)
})

test('verified credit is never taken back by a transition', { skip }, async (t) => {
  const db = await fresh(t)
  const a = await submit(db, { hash: H('a') })
  await transition(db, a.id, ['verifying'], 'verified')
  assert.equal((await transition(db, a.id, ['verified'], 'rejected', 'admin')).error, 'bad_transition')
})

test('no per-mission XP: verifying a proof grants no XP', { skip }, async (t) => {
  const db = await fresh(t)
  await verifiedX(db)
  assert.equal((await players(db)).xp, 0)
})

// ── MAMA badge ────────────────────────────────────────────────────────

test('MAMA badge: 5 different KST days (partial Oct 12 counts, not a streak), awarded once', { skip }, async (t) => {
  const db = await fresh(t)
  const badges = () => n(db, `select count(*) from rc_badges where badge_id = 'event_mama_2026'`)
  for (const day of ['2026-10-12', '2026-10-14', '2026-10-16', '2026-10-18']) await verifiedX(db, 'AGENT001', day)
  // Two missions on one day are still one day.
  const m = await submit(db, { hash: H('a'), day: '2026-10-18' })
  await transition(db, m.id, ['verifying'], 'verified')
  assert.equal(await badges(), 0, '4 different days is not enough')
  await verifiedX(db, 'AGENT001', '2026-10-21')
  assert.equal(await badges(), 1)
  await verifiedX(db, 'AGENT001', '2026-10-22')
  assert.equal(await badges(), 1, 'awarded once only')
})

// ── Voting Gift ───────────────────────────────────────────────────────

test('Voting Gift: 3 weighted rolls from the pool; leftover fill carries over', { skip }, async (t) => {
  const db = await fresh(t)
  for (const day of ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']) await verifiedX(db, 'AGENT001', day)
  assert.equal(await fill(db), 6)
  const r = await json(db, `select rc_vote_gift_open('mama_2026','AGENT001',gen_random_uuid()) as r`)
  assert.equal(r.success, true)
  assert.equal(r.rewards.length, 3)
  for (const g of r.rewards) assert.ok(['charge_cell', 'xp', 'streak_freeze', 'extension', 'wings', 'backup_pass'].includes(g.kind))
  assert.equal(r.fillRemaining, 1)
  const p = await players(db)
  const sum = (k) => r.rewards.filter((g) => g.kind === k).reduce((s, g) => s + g.amount, 0)
  assert.deepEqual([p.charge_cells, p.wings, p.streak_freeze_charges, p.deadline_extension_charges, p.passes, p.xp],
    [sum('charge_cell'), sum('wings'), sum('streak_freeze'), sum('extension'), sum('backup_pass'), sum('xp')],
    'every rolled reward was granted exactly once')
})

test('Voting Gift: retry replays; 2 opens per KST day; the cap resets next KST day', { skip }, async (t) => {
  const db = await fresh(t)
  await db.query(`update rc_vote_campaigns set gift = gift || '{"threshold":1}' where id='mama_2026'`)
  for (const day of ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']) await verifiedX(db, 'AGENT001', day)
  const rid = '11111111-1111-4111-8111-111111111111'
  const first = await json(db, `select rc_vote_gift_open('mama_2026','AGENT001',$1::uuid) as r`, [rid])
  const before = await players(db)
  const replay = await json(db, `select rc_vote_gift_open('mama_2026','AGENT001',$1::uuid) as r`, [rid])
  assert.deepEqual([replay.success, replay.replay], [true, true])
  assert.deepEqual(replay.rewards, first.rewards, 'the same result, not a new roll')
  assert.deepEqual(await players(db), before, 'nothing granted twice')
  assert.equal((await json(db, `select rc_vote_gift_open('mama_2026','AGENT002',$1::uuid) as r`, [rid])).error, 'bad_request')
  assert.equal((await json(db, `select rc_vote_gift_open('mama_2026','AGENT001',gen_random_uuid()) as r`)).success, true)
  assert.equal((await json(db, `select rc_vote_gift_open('mama_2026','AGENT001',gen_random_uuid()) as r`)).error, 'daily_limit')
  await db.query(`update rc_vote_gift_opens set kst_day = kst_day - 1`)
  assert.equal((await json(db, `select rc_vote_gift_open('mama_2026','AGENT001',gen_random_uuid()) as r`)).success, true)
  assert.equal(await fill(db), 1)
})

test('Voting Gift: not enough fill, and pending/rejected proofs add none', { skip }, async (t) => {
  const db = await fresh(t)
  await submit(db, { hash: H('a') })
  assert.equal((await json(db, `select rc_vote_gift_open('mama_2026','AGENT001',gen_random_uuid()) as r`)).error, 'not_enough_fill')
})

test('weighted pick only ever returns grantable kinds and respects zero weights', { skip }, async (t) => {
  const db = await fresh(t)
  const pool = JSON.stringify([{ kind: 'badge', weight: 99 }, { kind: 'wings', weight: 1, amount: 1 }, { kind: 'xp', weight: 0, amount: 10 }])
  for (let i = 0; i < 20; i++) assert.equal((await json(db, `select rc_vote_pick_reward($1::jsonb) as r`, [pool])).kind, 'wings')
  assert.equal(await json(db, `select rc_vote_pick_reward('[]'::jsonb) as r`), null)
})

// ── Teams ─────────────────────────────────────────────────────────────

test('team choice within 7s locks for the event; never changes after', { skip }, async (t) => {
  const db = await fresh(t)
  const s = await json(db, `select rc_campaign_team_start('mama_2026','AGENT001') as r`)
  assert.equal(s.team, null)
  assert.ok(s.deadline)
  assert.equal((await json(db, `select rc_campaign_team_choose('mama_2026','AGENT001','aliens') as r`)).team, 'aliens')
  assert.equal((await json(db, `select rc_campaign_team_choose('mama_2026','AGENT001','hooligans') as r`)).team, 'aliens')
  assert.equal((await json(db, `select rc_campaign_team_start('mama_2026','AGENT001') as r`)).team, 'aliens', 'start again = same team')
  assert.equal((await json(db, `select rc_campaign_team_choose('mama_2026','AGENT002','martians') as r`)).error, 'team_invalid')
})

test('a second start (refresh / other device) keeps the original countdown', { skip }, async (t) => {
  const db = await fresh(t)
  const first = await json(db, `select rc_campaign_team_start('mama_2026','AGENT001') as r`)
  const again = await json(db, `select rc_campaign_team_start('mama_2026','AGENT001') as r`)
  assert.equal(again.startedAt, first.startedAt)
  assert.equal(await n(db, `select count(*) from rc_campaign_teams`), 1)
})

test('timeout: a late pick is ignored and the smaller team is assigned, once', { skip }, async (t) => {
  const db = await fresh(t)
  for (const a of ['AGENT002', 'AGENT003']) {
    await json(db, `select rc_campaign_team_start('mama_2026',$1) as r`, [a])
    await json(db, `select rc_campaign_team_choose('mama_2026',$1,'hooligans') as r`, [a])
  }
  await json(db, `select rc_campaign_team_start('mama_2026','AGENT001') as r`)
  await db.query(`update rc_campaign_teams set started_at = now() - interval '10 seconds' where agent_no = 'AGENT001'`)
  const late = await json(db, `select rc_campaign_team_choose('mama_2026','AGENT001','hooligans') as r`)
  assert.deepEqual([late.team, late.via], ['aliens', 'timeout'])
  const again = await json(db, `select rc_campaign_team_resolve('mama_2026','AGENT001') as r`)
  assert.equal(again.team, 'aliens', 'never re-assigned')
  assert.equal(await n(db, `select count(*) from rc_campaign_teams where agent_no='AGENT001'`), 1)
})

test('simultaneous timeouts balance the teams instead of piling onto one side', { skip }, async (t) => {
  const db = await fresh(t)
  for (const a of ['AGENT001', 'AGENT002', 'AGENT003']) {
    await json(db, `select rc_campaign_team_start('mama_2026',$1) as r`, [a])
    await json(db, `select rc_campaign_team_choose('mama_2026',$1,'hooligans') as r`, [a])
  }
  const late = AGENTS.slice(3, 12)
  for (const a of late) await json(db, `select rc_campaign_team_start('mama_2026',$1) as r`, [a])
  await db.query(`update rc_campaign_teams set started_at = now() - interval '10 seconds' where team is null`)
  for (const a of late) await json(db, `select rc_campaign_team_resolve('mama_2026',$1) as r`, [a])
  const sizes = (await battle(db)).teamSizes
  assert.equal(sizes.hooligans + sizes.aliens, 12)
  assert.ok(Math.abs(sizes.hooligans - sizes.aliens) <= 1, JSON.stringify(sizes))
})

test('an exact tie on timeout is broken at random, not always the same side', { skip }, async (t) => {
  const db = await fresh(t)
  const seen = new Set()
  for (let i = 0; i < 16 && seen.size < 2; i++) {
    await db.exec('savepoint s')
    await json(db, `select rc_campaign_team_start('mama_2026','AGENT001') as r`)
    await db.query(`update rc_campaign_teams set started_at = now() - interval '10 seconds'`)
    seen.add((await json(db, `select rc_campaign_team_resolve('mama_2026','AGENT001') as r`)).team)
    await db.exec('rollback to savepoint s')
  }
  assert.equal(seen.size, 2)
})

// ── Battle score ──────────────────────────────────────────────────────

test('battle: +1 per verified mission to the agent team and the community total; mine counted', { skip }, async (t) => {
  const db = await fresh(t)
  await joinTeam(db, 'AGENT001', 'hooligans')
  await joinTeam(db, 'AGENT002', 'aliens')
  await verifiedX(db, 'AGENT001', '2026-10-13')
  await verifiedX(db, 'AGENT001', '2026-10-14')
  await verifiedX(db, 'AGENT002', '2026-10-14')
  await submit(db, { agent: 'AGENT002', hash: H('e') }) // pending: nothing
  const b = await battle(db, 'AGENT001')
  assert.deepEqual([b.teams.hooligans, b.teams.aliens, b.total, b.mine, b.frozen, b.winners], [2, 1, 3, 2, false, null])
})

test('team safeguard: no MAMA team, no proof — joining first keeps the battle point', { skip }, async (t) => {
  const db = await fresh(t)
  const refused = await submit(db, { mission: 'x', status: 'verified', post: '1846000000000000077', noTeam: true })
  assert.equal(refused.error, 'team_required')
  assert.equal(await n(db, `select count(*) from rc_campaign_proofs`), 0, 'nothing stored, nothing credited')
  assert.equal(await fill(db), 0)
  await joinTeam(db, 'AGENT001', 'aliens')
  const ok = await submit(db, { mission: 'x', status: 'verified', post: '1846000000000000077' })
  assert.equal(ok.success, true)
  const b = await battle(db)
  assert.deepEqual([b.teams.aliens, b.total, await fill(db)], [1, 1, 1], 'team point, community point and gift fill stay consistent')
  assert.equal((await q1(db, `select battle_team from rc_campaign_proofs`)).battle_team, 'aliens')
})
test('the team on a proof is stamped once and never follows a later change', { skip }, async (t) => {
  const db = await fresh(t)
  await joinTeam(db, 'AGENT001', 'hooligans')
  await verifiedX(db)
  await db.query(`update rc_campaign_teams set team = 'aliens'`) // not possible through any function; proves the stamp
  const b = await battle(db)
  assert.deepEqual([b.teams.hooligans, b.teams.aliens], [1, 0])
})

test('freeze: later verifications fill the gift and count badge days but move no score or milestone', { skip }, async (t) => {
  const db = await fresh(t)
  await joinTeam(db, 'AGENT001', 'hooligans')
  await joinTeam(db, 'AGENT002', 'aliens')
  await verifiedX(db, 'AGENT001', '2026-10-13')
  const pending = await submit(db, { agent: 'AGENT002', hash: H('f'), day: '2026-10-22' })
  await freezeNow(db)
  await transition(db, pending.id, ['verifying'], 'verified', 'admin') // reviewed after the freeze
  const b = await battle(db, 'AGENT002')
  assert.deepEqual([b.teams.hooligans, b.teams.aliens, b.total, b.frozen, b.winners], [1, 0, 1, true, ['hooligans']])
  assert.equal(await fill(db, 'AGENT002'), 1, 'gift fill still counts')
  assert.equal(await n(db, `select count(distinct vote_day) from rc_campaign_proofs where agent_no='AGENT002' and status='verified'`), 1, 'badge day still counts')
  await setBattle(db, { milestones: [2] })
  assert.equal((await json(db, `select rc_battle_gift_claim('mama_2026','AGENT001',0,gen_random_uuid()) as r`)).error, 'not_reached',
    'a post-freeze proof cannot unlock a milestone')
})

test('winner reward: after the freeze only, winners who scored, once; ties reward both teams', { skip }, async (t) => {
  const db = await fresh(t)
  await joinTeam(db, 'AGENT001', 'hooligans')
  await joinTeam(db, 'AGENT002', 'aliens')
  await joinTeam(db, 'AGENT003', 'hooligans')
  await verifiedX(db, 'AGENT001', '2026-10-13')
  await verifiedX(db, 'AGENT001', '2026-10-14')
  await verifiedX(db, 'AGENT002', '2026-10-14')
  const claim = (a, rid = null) => json(db, `select rc_battle_winner_claim('mama_2026',$1,coalesce($2::uuid, gen_random_uuid())) as r`, [a, rid])
  assert.equal((await claim('AGENT001')).error, 'not_final')
  await freezeNow(db)
  const rid = '33333333-3333-4333-8333-333333333333'
  const won = await claim('AGENT001', rid)
  assert.deepEqual([won.success, won.team], [true, 'hooligans'])
  assert.deepEqual(won.rewards, [{ kind: 'xp', amount: 20 }, { kind: 'charge_cell', amount: 1 }])
  const p = await players(db)
  assert.deepEqual([p.xp, p.charge_cells], [20, 1])
  assert.equal((await claim('AGENT001', rid)).replay, true)
  assert.equal((await claim('AGENT001')).error, 'already_claimed')
  assert.deepEqual([(await players(db)).xp, (await players(db)).charge_cells], [20, 1], 'granted once')
  assert.equal((await claim('AGENT002')).error, 'not_winner', 'the losing team loses nothing, but gets no winner reward')
  assert.equal((await claim('AGENT003')).error, 'not_contributor', 'on the winning team but never scored')
  assert.equal((await claim('AGENT004')).error, 'not_contributor')
})

test('winner reward on a tie: contributors on both teams', { skip }, async (t) => {
  const db = await fresh(t)
  await joinTeam(db, 'AGENT001', 'hooligans')
  await joinTeam(db, 'AGENT002', 'aliens')
  await verifiedX(db, 'AGENT001')
  await verifiedX(db, 'AGENT002')
  await freezeNow(db)
  assert.deepEqual((await battle(db)).winners, ['aliens', 'hooligans'])
  for (const a of ['AGENT001', 'AGENT002']) {
    assert.equal((await json(db, `select rc_battle_winner_claim('mama_2026',$1,gen_random_uuid()) as r`, [a])).success, true, a)
  }
})

// ── Battle Gifts ──────────────────────────────────────────────────────

test('Battle Gift: an unconfigured milestone index is refused', { skip }, async (t) => {
  const db = await fresh(t)
  await setBattle(db, { gift: { pool: null } })
  await joinTeam(db, 'AGENT001', 'hooligans')
  await verifiedX(db)
  assert.equal((await json(db, `select rc_battle_gift_claim('mama_2026','AGENT001',0,gen_random_uuid()) as r`)).error, 'not_configured')
})

test('Battle Gift: the approved 200-point first milestone, 1–2 rolls from the approved pool', { skip }, async (t) => {
  const db = await fresh(t)
  const agents = AGENTS
  for (const [i, a] of agents.entries()) await joinTeam(db, a, i % 2 ? 'aliens' : 'hooligans')
  const days = ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']
  let made = 0
  for (const d of days) for (const a of agents) for (let h = 1; h <= 3 && made < 200; h++) {
    await verifiedX(db, a, d, `${a.toLowerCase()}_${h}`)
    made++
  }
  assert.equal((await battle(db)).total, 200)
  const c = await json(db, `select rc_battle_gift_claim('mama_2026','AGENT001',0,gen_random_uuid()) as r`)
  assert.equal(c.success, true)
  assert.ok(c.rewards.length >= 1 && c.rewards.length <= 2)
  for (const r of c.rewards) assert.ok(['charge_cell', 'xp', 'wings', 'streak_freeze', 'extension', 'backup_pass'].includes(r.kind))
  assert.equal((await json(db, `select rc_battle_gift_claim('mama_2026','AGENT001',1,gen_random_uuid()) as r`)).error, 'not_reached')
})

test('Battle Gift: reached milestone, contributors only, once per milestone, retry replays', { skip }, async (t) => {
  const db = await fresh(t)
  await setBattle(db, { milestones: [2, 50], gift: { rolls_min: 1, rolls_max: 2, pool: [{ kind: 'charge_cell', weight: 1, amount: 1 }] } })
  await joinTeam(db, 'AGENT001', 'hooligans')
  await joinTeam(db, 'AGENT002', 'aliens')
  await verifiedX(db, 'AGENT001', '2026-10-13')
  assert.equal((await json(db, `select rc_battle_gift_claim('mama_2026','AGENT001',0,gen_random_uuid()) as r`)).error, 'not_reached')
  await verifiedX(db, 'AGENT002', '2026-10-13')
  const rid = '22222222-2222-4222-8222-222222222222'
  const c = await json(db, `select rc_battle_gift_claim('mama_2026','AGENT001',0,$1::uuid) as r`, [rid])
  assert.equal(c.success, true)
  assert.ok(c.rewards.length >= 1 && c.rewards.length <= 2)
  const cells = (await players(db)).charge_cells
  assert.equal(cells, c.rewards.length)
  const replay = await json(db, `select rc_battle_gift_claim('mama_2026','AGENT001',0,$1::uuid) as r`, [rid])
  assert.deepEqual([replay.replay, replay.rewards], [true, c.rewards])
  assert.equal((await json(db, `select rc_battle_gift_claim('mama_2026','AGENT001',0,gen_random_uuid()) as r`)).error, 'already_claimed')
  assert.equal((await players(db)).charge_cells, cells, 'nothing granted twice')
  assert.equal((await json(db, `select rc_battle_gift_claim('mama_2026','AGENT003',0,gen_random_uuid()) as r`)).error, 'not_contributor')
  assert.equal((await json(db, `select rc_battle_gift_claim('mama_2026','AGENT002',0,gen_random_uuid()) as r`)).success, true, 'every contributor can claim')
  assert.equal((await json(db, `select rc_battle_gift_claim('mama_2026','AGENT001',1,gen_random_uuid()) as r`)).error, 'not_reached')
  assert.equal((await json(db, `select rc_battle_gift_claim('mama_2026','AGENT001',9,gen_random_uuid()) as r`)).error, 'not_configured')
})

// ── Vote Pulse ────────────────────────────────────────────────────────

test('Pulse: runs add up, failures keep the last count, a replayed run counts once', { skip }, async (t) => {
  const db = await fresh(t)
  const finish = (ref, status, counted, newest, complete = true) => json(db,
    `select rc_vote_pulse_finish('mama_2026',$1,$2,$3,$4::numeric,$5,$6,$7,null) as r`, [ref, status, counted, newest, complete, counted, 0.01])
  assert.equal((await json(db, `select rc_vote_pulse_begin('mama_2026','run1') as r`)).success, true)
  assert.equal((await json(db, `select rc_vote_pulse_begin('mama_2026','run2') as r`)).error, 'run_pending')
  assert.equal(Number((await finish('run1', 'ok', 120, '1846000000000000500')).total), 120)
  assert.equal((await finish('run1', 'ok', 120, '1846000000000000500')).replay, true)
  await json(db, `select rc_vote_pulse_begin('mama_2026','run2') as r`)
  await finish('run2', 'failed', 0, null)
  let p = await q1(db, `select * from rc_vote_pulse`)
  assert.deepEqual([Number(p.total_count), p.last_status], [120, 'failed'], 'a failure never resets the count')
  await finish(null, 'exhausted', 0, null)
  await json(db, `select rc_vote_pulse_begin('mama_2026','run3') as r`)
  await finish('run3', 'partial', 600, '1846000000000009999', false)
  p = await q1(db, `select * from rc_vote_pulse`)
  assert.deepEqual([Number(p.total_count), Number(p.previous_count), p.complete, String(p.cursor_post_id)], [720, 120, false, '1846000000000009999'])
  assert.equal(Number(p.spent_usd), 0.04, 'every run that cost money is counted, failed or not')
  assert.equal((await finish('run9', 'ok', 5, '1')).error, 'not_pending')
})

test('Pulse is display only: it touches no proof, fill, team or badge table', { skip }, async (t) => {
  const db = await fresh(t)
  await json(db, `select rc_vote_pulse_begin('mama_2026','r') as r`)
  await json(db, `select rc_vote_pulse_finish('mama_2026','r','ok',500,'1846000000000000500'::numeric,true,500,0,null) as r`)
  for (const tbl of ['rc_campaign_proofs', 'rc_vote_gift_progress', 'rc_campaign_teams', 'rc_badges', 'rc_xp_ledger']) {
    assert.equal(await n(db, `select count(*) from ${tbl}`), 0, tbl)
  }
  assert.equal((await battle(db)).total, 0)
})

// ── Retention, deletion, lockdown ─────────────────────────────────────

test('retention: purge queues campaign files; refs clear only after deletion', { skip }, async (t) => {
  const db = await fresh(t)
  await submit(db, { hash: H('a'), path: 'mama_2026/AGENT001/2026-10-14-mnet.jpg' })
  await db.query(`insert into rc_vma_votes (agent_no, event_id, proof_path) values ('AGENT001','vma_2026','AGENT001/1.jpg')`)
  assert.equal(await n(db, `select rc_queue_agent_proof_files('AGENT001')`), 2)
  const rows = (await db.query(`select bucket from rc_storage_deletion_queue order by bucket`)).rows
  assert.deepEqual(rows.map((r) => r.bucket), ['campaign-proofs', 'vma-vote-proofs'])
  assert.equal(await n(db, `select rc_clear_expired_proof_refs()`), 0, 'nothing cleared before Storage confirms')
  await db.query(`update rc_storage_deletion_queue set deleted_at = now()`)
  assert.equal(await n(db, `select rc_clear_expired_proof_refs()`), 2)
  const p = await q1(db, `select proof_path, image_hash from rc_campaign_proofs`)
  assert.deepEqual([p.proof_path, p.image_hash], [null, H('a')])
})

test('retention: expired campaign proofs are queued 30 days after close', { skip }, async (t) => {
  const db = await fresh(t)
  await submit(db, { hash: H('a'), path: 'mama_2026/AGENT001/x.jpg' })
  assert.equal(await n(db, `select rc_queue_expired_campaign_proofs(30)`), 0)
  await db.query(`update rc_vote_campaigns set opens_at = now() - interval '60 days', closes_at = now() - interval '31 days'`)
  assert.equal(await n(db, `select rc_queue_expired_campaign_proofs(30)`), 1)
})

test('agent deletion cascades every new table', { skip }, async (t) => {
  const db = await fresh(t)
  await setBattle(db, { milestones: [1], gift: { pool: [{ kind: 'wings', weight: 1, amount: 1 }] } })
  await joinTeam(db, 'AGENT001', 'hooligans')
  await verifiedX(db)
  await freezeNow(db)
  await json(db, `select rc_battle_winner_claim('mama_2026','AGENT001',gen_random_uuid()) as r`)
  await json(db, `select rc_battle_gift_claim('mama_2026','AGENT001',0,gen_random_uuid()) as r`)
  await db.query(`insert into rc_agent_x_handles (campaign_id, agent_no, x_handle) values ('mama_2026','AGENT001', 'someone')`)
  await db.exec(`delete from rc_players where agent_no='AGENT001'; delete from rc_agents where agent_no='AGENT001'`)
  for (const tbl of ['rc_campaign_proofs', 'rc_agent_x_handles', 'rc_vote_gift_progress', 'rc_vote_gift_fills',
    'rc_campaign_teams', 'rc_battle_gift_claims', 'rc_battle_winner_claims']) {
    assert.equal(await n(db, `select count(*) from ${tbl}`), 0, tbl)
  }
})

test('X handles: up to three event-stable accounts; fourth and cross-agent reuse refused', { skip }, async (t) => {
  const db = await fresh(t)
  for (const h of ['one', 'two', 'three']) assert.equal((await json(db, `select rc_campaign_register_x_handle('mama_2026','AGENT001',$1) as r`, [h])).success, true)
  assert.equal((await json(db, `select rc_campaign_register_x_handle('mama_2026','AGENT001','four') as r`)).error, 'x_handle_limit')
  assert.equal((await json(db, `select rc_campaign_register_x_handle('mama_2026','AGENT002','one') as r`)).error, 'x_handle_taken')
  assert.equal((await json(db, `select rc_campaign_register_x_handle('mama_2026','AGENT001','one') as r`)).replay, true, 're-registering does not rotate or consume another slot')
  assert.equal(await n(db, `select count(*) from rc_agent_x_handles where campaign_id='mama_2026' and agent_no='AGENT001'`), 3)
})

test('anon and authenticated cannot call the new functions or read the tables', { skip }, async (t) => {
  const db = await fresh(t)
  const names = ['rc_campaign_submit_proof', 'rc_campaign_register_x_handle', 'rc_campaign_transition', 'rc_vote_gift_open', 'rc_campaign_apply_verified',
    'rc_vote_grant_reward', 'rc_vote_pick_reward', 'rc_campaign_team_start', 'rc_campaign_team_choose',
    'rc_campaign_team_resolve', 'rc_campaign_battle_state', 'rc_battle_gift_claim', 'rc_campaign_battle_total', 'rc_campaign_record_trusted_checks',
    'rc_battle_winner_claim', 'rc_vote_pulse_begin',
    'rc_vote_pulse_finish', 'rc_queue_expired_campaign_proofs']
  const fns = (await db.query(`
    select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon,
           has_function_privilege('authenticated', p.oid, 'execute') as auth,
           has_function_privilege('service_role', p.oid, 'execute') as svc,
           coalesce(array_to_string(p.proconfig, ','), '') as cfg
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any($1)`, [names])).rows
  assert.equal(fns.length, names.length)
  for (const f of fns) {
    assert.deepEqual([f.anon, f.auth, f.svc], [false, false, true], f.proname)
    assert.match(f.cfg, /search_path=public, pg_temp/, f.proname)
  }
  for (const tbl of ['rc_campaign_proofs', 'rc_agent_x_handles', 'rc_campaign_teams', 'rc_battle_gift_claims', 'rc_battle_winner_claims', 'rc_vote_pulse']) {
    assert.equal((await q1(db, `select has_table_privilege('anon', $1, 'select') as a`, [tbl])).a, false, tbl)
  }
})

// ── Duplicate certificates (number / minute fingerprints) ─────────────

const FP = (c) => c.repeat(64)
const PASS = { certificate: true, category: true, date: true, bts: 'match' }
const record = (db, id, certFp = null, timeFp = null, status = 'verified') => json(db,
  `select rc_campaign_record_trusted_checks($1,$2,$3::jsonb,$4,'reviewer',$5,$6) as r`,
  [id, status, JSON.stringify(PASS), status === 'verified' ? 'all_checks_passed' : 'unclear:bts', certFp, timeFp])

test('same certificate, same screenshot → blocked at submit', { skip }, async (t) => {
  const db = await fresh(t)
  await submit(db, { hash: H('a') })
  assert.equal((await submit(db, { agent: 'AGENT002', hash: H('a') })).error, 'duplicate_proof')
})

test('own certificate re-screenshot/compressed to different bytes → rejected, never credited twice', { skip }, async (t) => {
  const db = await fresh(t)
  const first = await submit(db, { hash: H('a'), agent: 'AGENT001' })
  assert.equal((await record(db, first.id, FP('c'), FP('d'))).status, 'verified')
  // Same agent and day, but a re-screenshot (different bytes) of the same certificate.
  const copy = await submit(db, { hash: H('b'), agent: 'AGENT001' })
  const r = await record(db, copy.id, FP('c'), FP('e'))
  assert.equal(r.status, 'rejected', 'certain: their own certificate again')
  const row = await q1(db, `select status, verify_note, duplicate_of, duplicate_kind from rc_campaign_proofs where id = $1`, [copy.id])
  assert.deepEqual([row.status, row.verify_note, Number(row.duplicate_of), row.duplicate_kind], ['rejected', 'duplicate_certificate', first.id, 'certificate'])
  assert.deepEqual([await fill(db, 'AGENT001'), (await battle(db)).total], [1, 1], 'no second fill, no second point')
  assert.equal(await n(db, `select count(*) from rc_campaign_proofs where agent_no = 'AGENT001' and status <> 'rejected'`), 1, 'the daily slot is freed for a new certificate')
})

test('another agent\'s certificate → still review (who owns it is a human call); the copy can stand if the original was the bad one', { skip }, async (t) => {
  const db = await fresh(t)
  const first = await submit(db, { hash: H('a'), agent: 'AGENT001' })
  assert.equal((await record(db, first.id, FP('c'), FP('d'))).status, 'verified')
  const copy = await submit(db, { hash: H('b'), agent: 'AGENT002' })
  assert.equal((await record(db, copy.id, FP('c'), FP('e'))).status, 'review')
  const row = await q1(db, `select verify_note, duplicate_kind from rc_campaign_proofs where id = $1`, [copy.id])
  assert.deepEqual([row.verify_note, row.duplicate_kind], ['duplicate_certificate', 'certificate'])
  assert.equal((await transition(db, copy.id, ['review'], 'verified', 'admin')).error, 'duplicate_certificate')
  assert.equal((await battle(db)).total, 1, 'no second point')
  await db.query(`update rc_campaign_proofs set status = 'rejected' where id = $1`, [first.id])
  assert.equal((await transition(db, copy.id, ['review'], 'verified', 'admin')).success, true)
})

test('same agent, same certificate on a later day → rejected as a duplicate', { skip }, async (t) => {
  const db = await fresh(t)
  const a = await submit(db, { hash: H('a'), day: '2026-10-13' })
  await record(db, a.id, FP('c'))
  const b = await submit(db, { hash: H('b'), day: '2026-10-14' })
  assert.equal((await record(db, b.id, FP('c'))).status, 'rejected')
})

test('X accounts: a player removes only an account with no counted or pending vote; slots and limits hold', { skip }, async (t) => {
  const db = await fresh(t)
  const reg = (agent, h) => json(db, `select rc_campaign_register_x_handle('mama_2026', $1, $2) as r`, [agent, h])
  const rm = (agent, h) => json(db, `select rc_campaign_remove_x_handle('mama_2026', $1, $2) as r`, [agent, h])
  for (const h of ['one', 'two', 'three']) assert.equal((await reg('AGENT001', h)).success, true)
  assert.equal((await reg('AGENT001', 'four')).error, 'x_handle_limit')
  await db.query(`insert into rc_campaign_proofs (campaign_id, mission_id, agent_no, vote_day, status, post_id, post_author)
                  values ('mama_2026', 'x', 'AGENT001', '2026-10-14', 'verified', '1845000000000000111', 'one'),
                         ('mama_2026', 'x', 'AGENT001', '2026-10-14', 'review', '1845000000000000222', 'two'),
                         ('mama_2026', 'x', 'AGENT001', '2026-10-13', 'rejected', '1845000000000000333', 'three')`)
  assert.equal((await rm('AGENT001', 'one')).error, 'x_handle_has_votes', 'credited: admin only')
  assert.equal((await rm('AGENT001', 'two')).error, 'x_handle_has_votes', 'pending: admin only')
  assert.equal((await rm('AGENT002', 'three')).error, 'x_handle_not_linked', 'someone else\'s account')
  assert.equal((await rm('AGENT001', 'three')).success, true, 'only a rejected post: free to go')
  assert.equal((await reg('AGENT001', 'four')).success, true, 'the freed slot can be used')
  assert.equal((await reg('AGENT001', 'five')).error, 'x_handle_limit', 'still three at most')
  assert.equal(await n(db, `select count(*) from rc_campaign_proofs where agent_no = 'AGENT001'`), 3, 'history untouched')
})

test('different certificate numbers → both credited', { skip }, async (t) => {
  const db = await fresh(t)
  const a = await submit(db, { hash: H('a'), agent: 'AGENT001' })
  const b = await submit(db, { hash: H('b'), agent: 'AGENT002' })
  assert.equal((await record(db, a.id, FP('c'), FP('d'))).status, 'verified')
  assert.equal((await record(db, b.id, FP('e'), FP('f'))).status, 'verified')
  assert.equal((await battle(db)).total, 2)
})

test('number unreadable (no fingerprint): no guess — same minute from another agent goes to review, reviewer may verify', { skip }, async (t) => {
  const db = await fresh(t)
  const a = await submit(db, { hash: H('a'), agent: 'AGENT001' })
  assert.equal((await record(db, a.id, null, FP('d'))).status, 'verified')
  const b = await submit(db, { hash: H('b'), agent: 'AGENT002' })
  assert.equal((await record(db, b.id, null, FP('d'))).status, 'review')
  const row = await q1(db, `select verify_note, duplicate_kind from rc_campaign_proofs where id = $1`, [b.id])
  assert.deepEqual([row.verify_note, row.duplicate_kind], ['possible_duplicate_certificate', 'possible'])
  assert.equal((await transition(db, b.id, ['review'], 'verified', 'admin')).success, true, 'two people can vote in the same minute')
  const c = await submit(db, { hash: H('c'), agent: 'AGENT003' })
  assert.equal((await record(db, c.id, null, null)).status, 'verified', 'nothing read at all: existing checks stand')
})

test('same minute, both numbers read and different → two people voting at once: both credited, no flag', { skip }, async (t) => {
  const db = await fresh(t)
  const a = await submit(db, { hash: H('a'), agent: 'AGENT001' })
  const b = await submit(db, { hash: H('b'), agent: 'AGENT002' })
  assert.equal((await record(db, a.id, FP('c'), FP('d'))).status, 'verified')
  assert.equal((await record(db, b.id, FP('e'), FP('d'))).status, 'verified')
  const row = await q1(db, `select verify_note, duplicate_of, duplicate_kind from rc_campaign_proofs where id = $1`, [b.id])
  assert.deepEqual([row.verify_note, row.duplicate_of, row.duplicate_kind], ['all_checks_passed', null, null])
  assert.equal((await battle(db)).total, 2)
})

test('same minute, but the other proof\'s number was unreadable → still possible, for a person to look at', { skip }, async (t) => {
  const db = await fresh(t)
  const a = await submit(db, { hash: H('a'), agent: 'AGENT001' })
  assert.equal((await record(db, a.id, null, FP('d'))).status, 'verified')
  const b = await submit(db, { hash: H('b'), agent: 'AGENT002' })
  assert.equal((await record(db, b.id, FP('e'), FP('d'))).status, 'review')
  const row = await q1(db, `select verify_note, duplicate_of, duplicate_kind from rc_campaign_proofs where id = $1`, [b.id])
  assert.deepEqual([row.verify_note, Number(row.duplicate_of), row.duplicate_kind], ['possible_duplicate_certificate', a.id, 'possible'])
})

test('same minute and same number from another agent → still a confirmed duplicate, blocked from credit', { skip }, async (t) => {
  const db = await fresh(t)
  const a = await submit(db, { hash: H('a'), agent: 'AGENT001' })
  await record(db, a.id, FP('c'), FP('d'))
  const b = await submit(db, { hash: H('b'), agent: 'AGENT002' })
  assert.equal((await record(db, b.id, FP('c'), FP('d'))).status, 'review')
  const row = await q1(db, `select verify_note, duplicate_kind from rc_campaign_proofs where id = $1`, [b.id])
  assert.deepEqual([row.verify_note, row.duplicate_kind], ['duplicate_certificate', 'certificate'])
  assert.equal((await transition(db, b.id, ['review'], 'verified', 'admin')).error, 'duplicate_certificate')
})

test('different numbers in the same minute never skip other uncertain checks', { skip }, async (t) => {
  const db = await fresh(t)
  const a = await submit(db, { hash: H('a'), agent: 'AGENT001' })
  await record(db, a.id, FP('c'), FP('d'))
  const b = await submit(db, { hash: H('b'), agent: 'AGENT002' })
  const r = await record(db, b.id, FP('e'), FP('d'), 'review')
  assert.equal(r.status, 'review')
  const row = await q1(db, `select verify_note, duplicate_kind from rc_campaign_proofs where id = $1`, [b.id])
  assert.deepEqual([row.verify_note, row.duplicate_kind], ['unclear:bts', null])
})

test('the new rule leaves earlier flags alone', { skip }, async (t) => {
  const db = await fresh(t)
  const a = await submit(db, { hash: H('a'), agent: 'AGENT001' })
  await record(db, a.id, FP('c'), FP('d'))
  const b = await submit(db, { hash: H('b'), agent: 'AGENT002' })
  await db.query(`update rc_campaign_proofs set status = 'review', verify_note = 'possible_duplicate_certificate', duplicate_of = $1, duplicate_kind = 'possible', cert_fingerprint = $2, cert_time_fingerprint = $3 where id = $4`, [a.id, FP('e'), FP('d'), b.id])
  await db.exec(MINUTE_MIGRATION)
  const row = await q1(db, `select status, duplicate_kind from rc_campaign_proofs where id = $1`, [b.id])
  assert.deepEqual([row.status, row.duplicate_kind], ['review', 'possible'], 'pending proof unchanged; a reviewer decides')
})

test('only fingerprints are stored; nothing in the database holds a raw number or time', { skip }, async (t) => {
  const db = await fresh(t)
  const a = await submit(db, { hash: H('a') })
  await record(db, a.id, FP('c'), FP('d'))
  const dump = JSON.stringify((await db.query(`select * from rc_campaign_proofs`)).rows) + JSON.stringify((await db.query(`select * from rc_campaign_cert_claims`)).rows)
  assert.ok(dump.includes(FP('c')))
  const cols = (await db.query(`select column_name from information_schema.columns where table_name in ('rc_campaign_proofs','rc_campaign_cert_claims')`)).rows.map((r) => r.column_name)
  for (const bad of ['certificate_number', 'cert_number', 'participation_at', 'ocr_text', 'raw_text']) assert.equal(cols.includes(bad), false, bad)
  await assert.rejects(db.query(`update rc_campaign_proofs set cert_fingerprint = 'No. 7A0B3E8U3K4UIKQZ'`), 'the column accepts only a 64-hex fingerprint')
})

test('phone UTC offset column: real offsets only, null allowed', { skip }, async (t) => {
  const db = await fresh(t)
  await verifiedX(db)
  const id = await n(db, `select max(id) from rc_campaign_proofs`)
  for (const ok of [330, -720, 840, 345, 0, null]) {
    await db.query(`update rc_campaign_proofs set cert_utc_offset_min = $1 where id = $2`, [ok, id])
  }
  for (const bad of [331, 900, -735]) {
    await db.exec('savepoint s')
    await assert.rejects(db.query(`update rc_campaign_proofs set cert_utc_offset_min = $1 where id = $2`, [bad, id]), /check/i, String(bad))
    await db.exec('rollback to savepoint s')
  }
})

// ── X account replacement (suspended / deleted / inaccessible) ────────

const xreg = (db, agent, h) => json(db, `select rc_campaign_register_x_handle('mama_2026', $1, $2) as r`, [agent, h])
const xrequest = (db, agent, oldH, newH, reason = 'suspended', note = null) =>
  json(db, `select rc_campaign_request_x_replacement('mama_2026', $1, $2, $3, $4, $5) as r`, [agent, oldH, newH, reason, note])
const xdecide = (db, id, decision, note = null) => json(db, `select rc_campaign_decide_x_replacement($1, $2, 'HT', $3) as r`, [id, decision, note])
const activeHandles = async (db, agent = 'AGENT001') => (await db.query(
  `select x_handle from rc_agent_x_handles where campaign_id = 'mama_2026' and agent_no = $1 and retired_at is null order by x_handle`, [agent])).rows.map((r) => r.x_handle)
const credits = async (db, agent = 'AGENT001') => JSON.stringify([
  (await db.query(`select * from rc_campaign_proofs where agent_no = $1 order by id`, [agent])).rows,
  (await db.query(`select * from rc_vote_gift_fills where agent_no = $1 order by created_at`, [agent])).rows,
  await fill(db, agent), (await battle(db, agent)).total,
])

test('replacement after verified votes: history, gift fill and team points stay; the old account is retired, not deleted', { skip }, async (t) => {
  const db = await fresh(t)
  await verifiedX(db, 'AGENT001', '2026-10-13', 'one')
  await verifiedX(db, 'AGENT001', '2026-10-14', 'one')
  await verifiedX(db, 'AGENT001', '2026-10-14', 'two')
  assert.equal((await xreg(db, 'AGENT001', 'three')).success, true)
  const before = await credits(db)

  const r = await xrequest(db, 'AGENT001', 'one', 'newone', 'suspended', 'Suspended on Oct 15')
  assert.deepEqual([r.success, r.status], [true, 'pending'])
  assert.equal((await xrequest(db, 'AGENT001', 'two', 'other')).error, 'x_replacement_pending', 'one request at a time')
  assert.equal((await xreg(db, 'AGENT002', 'newone')).error, 'x_handle_taken', 'a requested handle is reserved')
  assert.deepEqual(await activeHandles(db), ['one', 'three', 'two'], 'nothing changes before approval')

  assert.deepEqual(await xdecide(db, r.id, 'approve', 'checked X profile'), { success: true, id: r.id, status: 'approved' })
  assert.deepEqual(await activeHandles(db), ['newone', 'three', 'two'], 'the new account takes the slot; still 3 active')
  const old = await q1(db, `select retired_at is not null as retired, replaced_by, agent_no from rc_agent_x_handles where x_handle = 'one'`)
  assert.deepEqual([old.retired, old.replaced_by, old.agent_no], [true, 'newone', 'AGENT001'], 'retired, kept, still theirs')
  assert.equal(await credits(db), before, 'verified votes, days, gift fill and team points unchanged')
  assert.equal((await xdecide(db, r.id, 'reject')).error, 'already_decided')

  // The old account earns nothing new, can't come back, and nobody else can take it.
  const late = await submit(db, { mission: 'x', agent: 'AGENT001', day: '2026-10-15', status: 'verified', post: '1846000000000009001', author: 'one', unregistered: true })
  assert.equal(late.error, 'x_handle_unregistered')
  assert.equal((await xreg(db, 'AGENT001', 'one')).error, 'x_handle_retired')
  assert.equal((await xreg(db, 'AGENT002', 'one')).error, 'x_handle_taken')
  assert.equal((await json(db, `select rc_campaign_remove_x_handle('mama_2026','AGENT001','one') as r`)).error, 'x_handle_not_linked', 'history is never deleted')
  assert.equal((await xreg(db, 'AGENT001', 'four')).error, 'x_handle_limit', 'max 3 active')
  // The new account works.
  const ok = await submit(db, { mission: 'x', agent: 'AGENT001', day: '2026-10-15', status: 'verified', post: '1846000000000009002', author: 'newone', unregistered: true })
  assert.equal(ok.status, 'verified')
  // No rotation: one approved replacement this event.
  assert.equal((await xrequest(db, 'AGENT001', 'two', 'another')).error, 'x_replacement_limit')
})

test('replacement during the same voting day: still 3 X votes that day across old and new accounts', { skip }, async (t) => {
  const db = await fresh(t)
  await verifiedX(db, 'AGENT001', '2026-10-14', 'one')
  await verifiedX(db, 'AGENT001', '2026-10-14', 'two')
  await xreg(db, 'AGENT001', 'three')
  const r = await xrequest(db, 'AGENT001', 'one', 'fresh', 'deleted')
  await xdecide(db, r.id, 'approve')
  const x = (post, author) => submit(db, { mission: 'x', agent: 'AGENT001', day: '2026-10-14', status: 'verified', post, author, unregistered: true })
  assert.equal((await x('1846000000000009101', 'fresh')).status, 'verified', 'third vote today, from the new account')
  assert.equal((await x('1846000000000009102', 'three')).error, 'daily_mission_limit', 'the retired account’s vote still counts toward today’s 3')
  assert.equal(await n(db, `select count(*) from rc_campaign_proofs where agent_no = 'AGENT001' and vote_day = '2026-10-14' and status = 'verified'`), 3)
  assert.equal((await x('1846000000000009103', 'fresh')).error, 'x_handle_daily_limit', 'still one vote per account per day')
})

test('a vote made before retirement can still be verified by a reviewer; one sent after cannot', { skip }, async (t) => {
  const db = await fresh(t)
  await verifiedX(db, 'AGENT001', '2026-10-13', 'one')
  const pend = await submit(db, { mission: 'x', agent: 'AGENT001', day: '2026-10-14', status: 'review', post: '1846000000000009201', author: 'one' })
  await db.query(`update rc_campaign_proofs set submitted_at = now() - interval '1 hour' where id = $1`, [pend.id])
  const r = await xrequest(db, 'AGENT001', 'one', 'fresh', 'locked')
  await xdecide(db, r.id, 'approve')
  const after = await submit(db, { mission: 'x', agent: 'AGENT001', day: '2026-10-15', status: 'review', post: '1846000000000009202', author: 'one', unregistered: true })
  await db.query(`update rc_campaign_proofs set submitted_at = now() + interval '1 minute' where id = $1`, [after.id])
  assert.equal((await transition(db, pend.id, ['review'], 'verified', 'admin')).status, 'verified', 'posted while the account worked')
  assert.equal((await transition(db, after.id, ['review'], 'verified', 'admin')).error, 'x_handle_unregistered', 'posted after it was retired')
})

test('replacement requests: only for an own account with votes; no taken handles; reject changes nothing', { skip }, async (t) => {
  const db = await fresh(t)
  await verifiedX(db, 'AGENT001', '2026-10-14', 'one')
  await xreg(db, 'AGENT001', 'spare')
  await verifiedX(db, 'AGENT002', '2026-10-14', 'theirs')
  assert.equal((await xrequest(db, 'AGENT001', 'spare', 'fresh')).error, 'x_handle_no_votes', 'no votes: just remove it')
  assert.equal((await xrequest(db, 'AGENT001', 'theirs', 'fresh')).error, 'x_handle_not_linked')
  assert.equal((await xrequest(db, 'AGENT001', 'one', 'theirs')).error, 'x_handle_taken', 'another agent’s account')
  assert.equal((await xrequest(db, 'AGENT001', 'one', 'spare')).error, 'x_handle_taken', 'already linked')
  assert.equal((await xrequest(db, 'AGENT001', 'one', 'one')).error, 'bad_handle')
  assert.equal((await xrequest(db, 'AGENT001', 'one', 'Bad Handle!')).error, 'bad_handle')
  assert.equal((await xrequest(db, 'AGENT001', 'one', 'fresh', 'password')).error, 'bad_reason')
  const a = await xrequest(db, 'AGENT001', 'one', 'fresh')
  assert.equal((await xrequest(db, 'AGENT002', 'theirs', 'fresh')).error, 'x_handle_taken', 'two agents can’t ask for the same account')
  const before = await credits(db)
  assert.equal((await xdecide(db, a.id, 'reject', 'still active on X')).status, 'rejected')
  assert.deepEqual(await activeHandles(db), ['one', 'spare'])
  assert.equal(await credits(db), before)
  const again = await xrequest(db, 'AGENT001', 'one', 'fresh')
  assert.equal(again.success, true, 'a rejected request can be sent again')
  // Approval re-checks: the new handle got linked elsewhere in the meantime.
  await db.query(`insert into rc_agent_x_handles (campaign_id, agent_no, x_handle) values ('mama_2026', 'AGENT003', 'fresh')`)
  assert.equal((await xdecide(db, again.id, 'approve')).error, 'x_handle_taken')
  assert.deepEqual(await activeHandles(db), ['one', 'spare'], 'nothing half-done')
  assert.equal((await q1(db, `select status from rc_x_handle_replacements where id = $1`, [again.id])).status, 'pending')
})

test('replacement functions and table are service-role only', { skip }, async (t) => {
  const db = await fresh(t)
  for (const fn of ['rc_campaign_request_x_replacement(text,text,text,text,text,text)', 'rc_campaign_decide_x_replacement(bigint,text,text,text)']) {
    assert.equal((await q1(db, `select has_function_privilege('anon', $1, 'execute') as a`, [fn])).a, false, fn)
    assert.equal((await q1(db, `select has_function_privilege('authenticated', $1, 'execute') as a`, [fn])).a, false, fn)
  }
  assert.equal((await q1(db, `select has_table_privilege('anon', 'rc_x_handle_replacements', 'select') as a`)).a, false)
  const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'rc_x_handle_replacements'`)).rows.map((r) => r.column_name)
  for (const bad of ['password', 'login', 'email', 'token']) assert.equal(cols.some((c) => c.includes(bad)), false, bad)
})

// ── MAMA 2026 · Round 2 (migration 20261026180000) ─────────────────────

const R2 = 'mama_2026_r2'
const r2Join = async (db, agent, team) => {
  await json(db, `select rc_campaign_team_start($1,$2) as r`, [R2, agent])
  return json(db, `select rc_campaign_team_choose($1,$2,$3) as r`, [R2, agent, team])
}
const r2State = (db, agent) => json(db, `select rc_campaign_team_state($1,$2) as r`, [R2, agent])
/** A verified X proof in a given round (the agent must already have a side there). */
async function verifiedXIn(db, campaign, agent, day) {
  seq++
  const author = `${agent.toLowerCase()}r${campaign.length}`.slice(0, 15)
  await json(db, `select rc_campaign_register_x_handle($1,$2,$3) as r`, [campaign, agent, author])
  return json(db, `select rc_campaign_submit_proof($1,'x',$2,$3::date,'verified','{}'::jsonb,'{}'::jsonb,null,null,null,null,null,$4,null,$5) as r`,
    [campaign, agent, day, String(1847000000000000000n + BigInt(seq)), author])
}

test('round 2: its own row, the approved window and config; Round 1 untouched', { skip }, async (t) => {
  const db = await fresh(t)
  const r2 = await q1(db, `select * from rc_vote_campaigns where id = $1`, [R2])
  assert.equal(new Date(r2.opens_at).toISOString(), '2026-10-28T09:00:00.000Z')
  assert.equal(new Date(r2.closes_at).toISOString(), '2026-11-08T14:59:59.000Z')
  assert.deepEqual(r2.battle.teams.map((x) => x.id), ['hooligans', 'aliens'])
  assert.equal(r2.battle.carry_teams_from, 'mama_2026')
  assert.ok(Date.parse(r2.battle.promo_from) < Date.parse(r2.opens_at), 'promo before voting')
  assert.match(ROUND2_MIGRATION, /"freeze_at": "2026-11-09T12:00:00\+09:00"/, 'Nov 9 12:00 KST')
  assert.deepEqual(r2.missions.find((m) => m.id === 'x').hashtags, ['2026MAMAVOTE', 'BTS'])
  assert.equal(r2.missions.find((m) => m.id === 'x').exclusive_hashtags, true)
  assert.deepEqual(r2.rewards.badge_scope, ['mama_2026'])
  assert.equal(r2.pulse.enabled, false)
  const r1 = await q1(db, `select * from rc_vote_campaigns where id = 'mama_2026'`)
  assert.deepEqual(r1.battle.milestones, [200, 500, 900, 1400, 2200], 'Round 1 config unchanged')
  assert.equal(r1.rewards.badge_scope, undefined)
})

test('round 2: Round 1 sides carry over with each agent’s Instagram choice; no side, no carry', { skip }, async (t) => {
  const db = await fresh(t)
  await joinTeam(db, 'AGENT001', 'hooligans')
  await joinTeam(db, 'AGENT002', 'aliens')
  await json(db, `select rc_campaign_team_start('mama_2026','AGENT003') as r`) // started, never picked
  await db.query(`update rc_campaign_teams set show_ig = false, show_ig_at = now() where campaign_id = 'mama_2026' and agent_no = 'AGENT002'`)
  await db.exec(ROUND2_BODY)
  const rows = (await db.query(`select agent_no, team, assigned_via, show_ig, show_ig_at is not null as chose from rc_campaign_teams where campaign_id = $1 order by agent_no`, [R2])).rows
  assert.deepEqual(rows.map((r) => [r.agent_no, r.team, r.assigned_via]), [['AGENT001', 'hooligans', 'carried'], ['AGENT002', 'aliens', 'carried']])
  assert.deepEqual([rows[1].show_ig, rows[1].chose], [false, true], 'an explicit "off" stays off')
  assert.equal((await r2State(db, 'AGENT001')).team, 'hooligans')
  // A carried side is locked like any other: a pick can't move it.
  await r2Join(db, 'AGENT001', 'aliens')
  assert.equal((await r2State(db, 'AGENT001')).team, 'hooligans')
  // Re-running the migration changes nothing.
  await db.exec(ROUND2_BODY)
  assert.equal(await n(db, `select count(*) from rc_campaign_teams where campaign_id = $1`, [R2]), 2)
})

test('round 2: new agents pick a side before voting opens; recruits and head counts are counted', { skip }, async (t) => {
  const db = await fresh(t)
  await joinTeam(db, 'AGENT001', 'hooligans')
  await db.exec(ROUND2_BODY)
  await r2Join(db, 'AGENT004', 'aliens')
  await r2Join(db, 'AGENT005', 'aliens')
  const b = await json(db, `select rc_campaign_battle_state($1,'') as r`, [R2])
  assert.deepEqual(b.teamSizes, { hooligans: 1, aliens: 2 })
  assert.deepEqual(b.recruits, { hooligans: 0, aliens: 2 }, 'carried agents are not recruits')
  assert.deepEqual([b.total, b.teams.hooligans, b.teams.aliens], [0, 0, 0])
})

test('round 2: no proof before its first voting day; scores and gifts are separate from Round 1', { skip }, async (t) => {
  const db = await fresh(t)
  await joinTeam(db, 'AGENT001', 'hooligans')
  await verifiedX(db, 'AGENT001', '2026-10-20') // a Round 1 point
  await db.exec(ROUND2_BODY)
  await json(db, `select rc_campaign_register_x_handle($1,'AGENT001','agent001early') as r`, [R2])
  const early = await json(db, `select rc_campaign_submit_proof($1,'x','AGENT001','2026-10-27'::date,'verified','{}'::jsonb,'{}'::jsonb,null,null,null,null,null,'1847999999999999999',null,'agent001early') as r`, [R2])
  assert.equal(early.error, 'voting_closed')
  const ok = await verifiedXIn(db, R2, 'AGENT001', '2026-10-29')
  assert.equal(ok.success, true)
  const r1 = await json(db, `select rc_campaign_battle_state('mama_2026','') as r`)
  const r2 = await json(db, `select rc_campaign_battle_state($1,'') as r`, [R2])
  assert.deepEqual([r1.teams.hooligans, r1.total, r2.teams.hooligans, r2.total], [1, 1, 1, 1])
  assert.equal(await n(db, `select coalesce((select fill from rc_vote_gift_progress where campaign_id=$1 and agent_no='AGENT001'),0)`, [R2]), 1, 'own Voting Gift')
})

test('round 2: the MAMA badge counts verified days across both rounds, once', { skip }, async (t) => {
  const db = await fresh(t)
  await joinTeam(db, 'AGENT001', 'hooligans')
  for (const d of ['2026-10-13', '2026-10-15', '2026-10-17']) await verifiedX(db, 'AGENT001', d)
  await db.exec(ROUND2_BODY)
  const badge = (a = 'AGENT001') => n(db, `select count(*) from rc_badges where agent_no=$1 and badge_id='event_mama_2026'`, [a])
  assert.equal(await badge(), 0)
  await verifiedXIn(db, R2, 'AGENT001', '2026-10-29')
  assert.equal(await badge(), 0, '4 days')
  await verifiedXIn(db, R2, 'AGENT001', '2026-10-30')
  assert.equal(await badge(), 1, '3 + 2 days')
  await verifiedXIn(db, R2, 'AGENT001', '2026-10-31')
  assert.equal(await badge(), 1, 'awarded once')
  // Round 1's own rule is unchanged: its days alone.
  await joinTeam(db, 'AGENT002', 'aliens')
  for (const d of ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']) await verifiedX(db, 'AGENT002', d)
  assert.equal(await badge('AGENT002'), 0)
})

test('round 2: team chat opens with the promo window, not before; closed after voting', { skip }, async (t) => {
  const db = await fresh(t)
  await db.exec(ROUND2_BODY)
  await r2Join(db, 'AGENT004', 'aliens')
  const send = (body) => json(db, `select rc_battle_chat_send($1,'AGENT004',$2,null) as r`, [R2, body])
  await db.query(`update rc_vote_campaigns set opens_at = now() + interval '2 days', closes_at = now() + interval '14 days',
    battle = battle || jsonb_build_object('promo_from', now() - interval '1 hour') where id = $1`, [R2])
  assert.equal((await send('aliens, we land at 18:00')).ok, true, 'promo: open')
  await db.query(`update rc_vote_campaigns set battle = battle || jsonb_build_object('promo_from', now() + interval '1 hour') where id = $1`, [R2])
  assert.equal((await send('too early')).error, 'chat_closed', 'before the promo')
  await db.query(`update rc_vote_campaigns set battle = battle - 'promo_from' where id = $1`, [R2])
  assert.equal((await send('no promo set')).error, 'chat_closed', 'no promo window → opens with voting, as in Round 1')
  await db.query(`update rc_vote_campaigns set opens_at = now() - interval '14 days', closes_at = now() - interval '1 second' where id = $1`, [R2])
  assert.equal((await send('after')).error, 'chat_closed')
})

test('round 2 recruit bonus: every 3 new agents who scored = +1 for their side; carried and non-voting recruits never count', { skip }, async (t) => {
  const db = await fresh(t)
  await joinTeam(db, 'AGENT001', 'hooligans') // a Round 1 side: carried, never a recruit
  await db.exec(ROUND2_BODY)
  const state = () => json(db, `select rc_campaign_battle_state($1,'') as r`, [R2])
  await verifiedXIn(db, R2, 'AGENT001', '2026-10-29')
  for (const a of ['AGENT004', 'AGENT005', 'AGENT006', 'AGENT007']) await r2Join(db, a, 'aliens')
  let b = await state()
  assert.deepEqual([b.qualified.aliens, b.bonus.aliens, b.teams.aliens], [0, 0, 0], 'joining alone earns nothing')
  for (const a of ['AGENT004', 'AGENT005']) await verifiedXIn(db, R2, a, '2026-10-29')
  b = await state()
  assert.deepEqual([b.qualified.aliens, b.bonus.aliens, b.teams.aliens], [2, 0, 2], 'two voters: no bonus yet')
  await verifiedXIn(db, R2, 'AGENT006', '2026-10-29')
  b = await state()
  assert.deepEqual([b.qualified.aliens, b.bonus.aliens, b.votes.aliens, b.teams.aliens], [3, 1, 3, 4], 'third voter: +1')
  await verifiedXIn(db, R2, 'AGENT006', '2026-10-30')
  b = await state()
  assert.equal(b.qualified.aliens, 3, 'a recruit counts once, however often they vote')
  assert.deepEqual([b.qualified.hooligans, b.bonus.hooligans, b.teams.hooligans], [0, 0, 1], 'carried agents are not recruits')
  assert.equal(b.total, 5, 'the community total (milestones) is verified votes only')
})

test('round 2 recruit bonus decides the winner; after the freeze it stops with the votes', { skip }, async (t) => {
  const db = await fresh(t)
  await joinTeam(db, 'AGENT001', 'hooligans')
  await joinTeam(db, 'AGENT002', 'hooligans')
  await db.exec(ROUND2_BODY)
  for (const a of ['AGENT001', 'AGENT002']) { await verifiedXIn(db, R2, a, '2026-10-29'); await verifiedXIn(db, R2, a, '2026-10-30') } // 4 votes
  for (const a of ['AGENT004', 'AGENT005']) await r2Join(db, a, 'aliens')
  for (const a of ['AGENT004', 'AGENT005']) await verifiedXIn(db, R2, a, '2026-10-29') // 2 votes
  await r2Join(db, 'AGENT006', 'aliens')
  const pending = await json(db, `select rc_campaign_submit_proof($1,'mnet','AGENT006','2026-10-31'::date,'verifying','{}'::jsonb,'{}'::jsonb,null,null,null,$2,null,null,null,null) as r`, [R2, H('9')])
  await verifiedXIn(db, R2, 'AGENT006', '2026-10-30') // 3 votes, 3 recruits who voted → +1 = 4: a tie
  await db.query(`update rc_vote_campaigns set battle = battle || jsonb_build_object('freeze_at', now() - interval '1 second') where id = $1`, [R2])
  let b = await json(db, `select rc_campaign_battle_state($1,'') as r`, [R2])
  assert.deepEqual([b.teams.hooligans, b.teams.aliens, b.winners], [4, 4, ['aliens', 'hooligans']], 'the bonus point turns a loss into a draw')
  await transition(db, pending.id, ['verifying'], 'verified', 'admin') // after the freeze: no point, no change
  b = await json(db, `select rc_campaign_battle_state($1,'') as r`, [R2])
  assert.deepEqual([b.teams.aliens, b.bonus.aliens], [4, 1])
  // The winner reward reads the same state: both sides' contributors may claim.
  const r = await json(db, `select rc_battle_winner_claim($1,'AGENT004',gen_random_uuid()) as r`, [R2])
  assert.equal(r.success, true)
})

test('Round 1 has no recruit bonus: its scores are votes only', { skip }, async (t) => {
  const db = await fresh(t)
  for (const a of ['AGENT004', 'AGENT005', 'AGENT006']) { await joinTeam(db, a, 'aliens'); await verifiedX(db, a, '2026-10-14') }
  const b = await battle(db)
  assert.deepEqual([b.teams.aliens, b.bonus.aliens, b.total], [3, 0, 3])
})

test('MAMA 2026 · Daesang: 7 verified days in Round 2 alone, awarded once; the MAMA badge rule unchanged', { skip }, async (t) => {
  const db = await fresh(t)
  await joinTeam(db, 'AGENT001', 'hooligans')
  for (const d of ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']) await verifiedX(db, 'AGENT001', d)
  await db.exec(ROUND2_BODY)
  await db.exec(DAESANG_MIGRATION.replace(/^(begin|commit);\r?$/gm, ''))
  const has = (id) => n(db, `select count(*) from rc_badges where agent_no='AGENT001' and badge_id=$1`, [id])
  assert.equal(await has('event_mama_2026'), 1, 'Round 1 days already earned the MAMA badge')
  assert.equal(await has('event_mama_2026_daesang'), 0, 'Round 1 days never count for the Round 2 badge')
  const days = ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']
  for (const d of days) await verifiedXIn(db, R2, 'AGENT001', d)
  assert.equal(await has('event_mama_2026_daesang'), 0, '6 days')
  await verifiedXIn(db, R2, 'AGENT001', '2026-11-03')
  assert.equal(await has('event_mama_2026_daesang'), 1, '7th day')
  await verifiedXIn(db, R2, 'AGENT001', '2026-11-04')
  assert.equal(await has('event_mama_2026_daesang'), 1, 'once')
  const cat = await q1(db, `select name, rarity, active from rc_badge_catalog where id = 'event_mama_2026_daesang'`)
  assert.deepEqual([cat.name, cat.rarity, cat.active], ['MAMA 2026 · Daesang', 'rare', true])
  const r2 = await q1(db, `select rewards, battle from rc_vote_campaigns where id = $1`, [R2])
  assert.deepEqual(r2.rewards.extra_badges, [{ template_id: 'event_mama_2026_daesang', name: 'MAMA 2026 · Daesang', verified_days: 7 }])
  assert.deepEqual(r2.battle.milestones, [400, 1000, 1800, 2700, 3800])
})

test('round 2 names: Round 2 · Fans’ Choice, three named categories; nothing a rule reads has changed', { skip }, async (t) => {
  const db = await fresh(t)
  const r2 = await q1(db, `select round_label, missions, opens_at, closes_at from rc_vote_campaigns where id = $1`, [R2])
  assert.equal(r2.round_label, "Round 2 · Fans' Choice")
  const [mnet, x] = r2.missions
  assert.deepEqual([mnet.id, x.id], ['mnet', 'x'], 'order kept')
  assert.deepEqual(mnet.categories.map((c) => c.name), ["Fans' Choice Male", "Fans' Choice Female", "VISA Fans' Choice of the Year"])
  assert.equal(mnet.categories[2].tag, 'Daesang')
  assert.ok(mnet.guide.some((g) => g.includes("VISA Fans' Choice of the Year (the Daesang)")))
  assert.ok(x.guide.some((g) => g.includes("VISA Fans' Choice of the Year")))
  // Untouched: the schedule, certificate keywords, hashtags and limits.
  assert.equal(new Date(r2.opens_at).toISOString(), '2026-10-28T09:00:00.000Z')
  assert.equal(new Date(r2.closes_at).toISOString(), '2026-11-08T14:59:59.000Z')
  assert.deepEqual(mnet.certificate.category_keywords, ["fans' choice category 2nd vote", "fans choice category 2nd vote", "fans' choice of the year", "fans choice of the year"])
  assert.deepEqual([mnet.max_daily, x.max_daily, x.max_handles, x.exclusive_hashtags], [3, 3, 3, true])
  assert.deepEqual(x.hashtags, ['2026MAMAVOTE', 'BTS'])
})
