// The retention sweep's step three ("clear refs") against rc_vma_votes as
// production has it: proof_path NOT NULL from 20260819091000. The older SQL
// suite built a simplified table with a nullable proof_path, which is why it
// passed while every hourly sweep since 2026-10-26 failed with
// "null value in column proof_path of relation rc_vma_votes violates not-null
// constraint". This suite uses the real column rules and the real function
// from 20261013150000, and checks the fix (20261112130000) clears only
// references to deleted files and touches nothing else a vote, a reward or
// the PC Giveaway depends on.
//
//   PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite/dist/index.js node --test <this file>
// Without it the suite is skipped (and says so).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ROOT = new URL('../../../', import.meta.url)
const migration = (name) => readFileSync(new URL(`migrations/${name}`, ROOT), 'utf8')
const FIX = migration('20261112130000_rc_vma_proof_path_clearable.sql')
// The live definition of the step-three function (last migration that defines it).
const CAMPAIGNS = migration('20261013150000_rc_vote_campaigns.sql')
const start = CAMPAIGNS.indexOf('create or replace function public.rc_clear_expired_proof_refs')
const CLEAR_FN = CAMPAIGNS.slice(start, CAMPAIGNS.indexOf('$$;', start) + 3)

const modulePath = process.env.PGLITE_MODULE
const skip = modulePath ? false : 'set PGLITE_MODULE to run the SQL suite'

// rc_vma_votes column for column as production reports it (information_schema,
// 2026-11-12), and the minimal neighbours the function reads or writes.
const SCHEMA = `
create role anon; create role authenticated; create role service_role;
create table rc_agents (agent_no text primary key);
create table rc_vma_votes (
  id bigserial primary key,
  agent_no text not null references rc_agents (agent_no),
  category text not null check (category in ('song_of_the_year', 'best_kpop')),
  vote_day date not null,
  votes_logged integer not null check (votes_logged >= 0 and votes_logged <= 20),
  is_power_hour boolean not null default false,
  is_double_day boolean not null default false,
  proof_path text not null,
  image_hash text not null unique,
  ocr_text text,
  watermark_ok boolean not null default false,
  verify_status text not null default 'pending' check (verify_status in ('pending', 'verified', 'rejected')),
  verify_note text,
  verified_at timestamptz,
  voted_at timestamptz not null default now(),
  event_id text not null default 'vma_2026',
  displayed_total integer not null default 0,
  image_mime text, expected_code text, reviewed_by text, reviewed_at timestamptz, admin_note text
);
create table rc_storage_deletion_queue (
  id bigserial primary key, bucket text not null, path text not null, reason text not null,
  queued_at timestamptz not null default now(), deleted_at timestamptz, unique (bucket, path)
);
create table rc_campaign_proofs (
  id bigserial primary key, agent_no text not null, campaign_id text not null, mission_id text,
  vote_day date not null, status text not null, proof_path text, image_hash text
);
${CLEAR_FN}
insert into rc_agents values ('AGENT001'), ('AGENT002');
insert into rc_vma_votes (agent_no, category, vote_day, votes_logged, proof_path, image_hash, ocr_text, verify_status, verified_at, displayed_total)
values ('AGENT001', 'best_kpop', '2026-09-01', 10, 'AGENT001/1.jpg', 'h1', 'BTS 10 votes', 'verified', '2026-09-01 10:00+00', 10),
       ('AGENT001', 'song_of_the_year', '2026-09-02', 20, 'AGENT001/2.jpg', 'h2', 'BTS 20 votes', 'verified', '2026-09-02 10:00+00', 20),
       ('AGENT002', 'best_kpop', '2026-09-03', 0, 'AGENT002/3.jpg', 'h3', null, 'rejected', null, 0),
       ('AGENT002', 'best_kpop', '2026-09-04', 10, 'AGENT002/4.jpg', 'h4', 'BTS 10 votes', 'verified', '2026-09-04 10:00+00', 10);
-- Storage confirmed three files gone; AGENT002/4.jpg is queued but NOT yet deleted.
insert into rc_storage_deletion_queue (bucket, path, reason, deleted_at) values
  ('vma-vote-proofs', 'AGENT001/1.jpg', 'vote_proof_expired', now()),
  ('vma-vote-proofs', 'AGENT001/2.jpg', 'vote_proof_expired', now()),
  ('vma-vote-proofs', 'AGENT002/3.jpg', 'vote_proof_expired', now()),
  ('vma-vote-proofs', 'AGENT002/4.jpg', 'vote_proof_expired', null);
-- A MAMA campaign proof (what the PC Giveaway counts) and a purged one.
insert into rc_campaign_proofs (agent_no, campaign_id, mission_id, vote_day, status, proof_path, image_hash) values
  ('AGENT001', 'mama_2026_r2', 'm1', '2026-11-01', 'verified', 'AGENT001/c1.jpg', 'c1'),
  ('AGENT002', 'mama_2026_r2', 'm1', '2026-11-02', 'verified', 'AGENT002/c2.jpg', 'c2');
insert into rc_storage_deletion_queue (bucket, path, reason, deleted_at) values
  ('campaign-proofs', 'AGENT002/c2.jpg', 'agent_purged', now());
`

async function freshDb() {
  const { PGlite } = await import(pathToFileURL(modulePath).href)
  const db = new PGlite()
  await db.exec(SCHEMA)
  return db
}
const rows = async (db, sql) => (await db.query(sql)).rows
const votes = (db) => rows(db, `select id, agent_no, category, vote_day::text, votes_logged, image_hash, verify_status, verified_at::text, displayed_total, proof_path, ocr_text from rc_vma_votes order by id`)

test('before the fix: clearing references fails on production\'s NOT NULL (the hourly sweep error)', { skip }, async () => {
  const db = await freshDb()
  await assert.rejects(db.query('select rc_clear_expired_proof_refs()'), /null value in column "proof_path" of relation "rc_vma_votes" violates not-null constraint/)
  // and the campaign statement in the same function never ran
  assert.equal((await rows(db, `select count(*)::int n from rc_campaign_proofs where proof_path is null`))[0].n, 0)
})

test('after the fix: only references to files Storage deleted are cleared', { skip }, async () => {
  const db = await freshDb()
  await db.exec(FIX)
  const before = await votes(db)
  const n = (await rows(db, 'select rc_clear_expired_proof_refs() n'))[0].n
  assert.equal(n, 4, '3 VMA rows + 1 purged campaign proof')
  const after = await votes(db)
  assert.deepEqual(after.map((v) => v.proof_path), [null, null, null, 'AGENT002/4.jpg'], 'the not-yet-deleted file keeps its reference')
  assert.deepEqual(after.map((v) => v.ocr_text), [null, null, null, 'BTS 10 votes'])
  // everything a vote, a reward or a badge depends on is untouched
  const keep = (v) => { const { proof_path, ocr_text, ...rest } = v; return rest }
  assert.deepEqual(after.map(keep), before.map(keep))
  // a second run finds nothing new and still succeeds
  assert.equal((await rows(db, 'select rc_clear_expired_proof_refs() n'))[0].n, 0)
})

test('verified votes and the giveaway\'s proof counts are unchanged', { skip }, async () => {
  const db = await freshDb()
  await db.exec(FIX)
  const count = async () => rows(db, `select (select count(*)::int from rc_vma_votes where verify_status = 'verified') vma_verified,
    (select coalesce(sum(votes_logged), 0)::int from rc_vma_votes where verify_status = 'verified') vma_votes,
    (select count(distinct (agent_no, vote_day))::int from rc_campaign_proofs where status = 'verified') campaign_verified_days`)
  const before = await count()
  await db.query('select rc_clear_expired_proof_refs()')
  assert.deepEqual(await count(), before)
  // the purged agent's campaign proof loses only its path, never its row or status
  assert.deepEqual(await rows(db, `select agent_no, status, proof_path from rc_campaign_proofs order by id`),
    [{ agent_no: 'AGENT001', status: 'verified', proof_path: 'AGENT001/c1.jpg' }, { agent_no: 'AGENT002', status: 'verified', proof_path: null }])
})

test('a new vote still cannot be stored without its screenshot', { skip }, async () => {
  const db = await freshDb()
  await db.exec(FIX)
  const ins = (path, hash) => db.query(`insert into rc_vma_votes (agent_no, category, vote_day, votes_logged, proof_path, image_hash) values ('AGENT001', 'best_kpop', '2026-09-10', 10, $1, $2)`, [path, hash])
  await assert.rejects(ins(null, 'n1'), /needs its proof screenshot/)
  await assert.rejects(ins('', 'n2'), /needs its proof screenshot/)
  await ins('AGENT001/10.jpg', 'n3')
  // the reused-screenshot block still works after a reference is cleared
  await db.query('select rc_clear_expired_proof_refs()')
  await assert.rejects(ins('AGENT001/11.jpg', 'h1'), /duplicate key value violates unique constraint/)
})

test('the fix is safe to run twice and changes no other column rule', { skip }, async () => {
  const db = await freshDb()
  await db.exec(FIX)
  await db.exec(FIX)
  const cols = await rows(db, `select column_name, is_nullable from information_schema.columns where table_name = 'rc_vma_votes' and is_nullable = 'YES' order by 1`)
  assert.deepEqual(cols.map((c) => c.column_name),
    ['admin_note', 'expected_code', 'image_mime', 'ocr_text', 'proof_path', 'reviewed_at', 'reviewed_by', 'verified_at', 'verify_note'])
  assert.equal((await rows(db, `select count(*)::int n from pg_trigger where tgname = 'rc_vma_votes_require_proof'`))[0].n, 1)
})
