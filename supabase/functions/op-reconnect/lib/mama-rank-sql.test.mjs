// MAMA rank tracker storage, against real Postgres (PGlite).
//   PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite/dist/index.js node --test <this file>
// Without PGLITE_MODULE the suite is skipped (and says so).

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const MIGRATION = readFileSync(new URL('../../../migrations/20261102120000_rc_mama_rank_tracker.sql', import.meta.url), 'utf8')
const modulePath = process.env.PGLITE_MODULE
const skip = modulePath ? false : 'set PGLITE_MODULE to run the SQL suite'
const VOTE = '6acecda6f3778e1b06f5170b'

async function setup() {
  const { PGlite } = await import(pathToFileURL(modulePath).href)
  const db = new PGlite()
  await db.exec('create role anon; create role authenticated; create role service_role;')
  await db.exec(MIGRATION)
  await db.exec(MIGRATION) // re-runnable
  return db
}
const record = (db, ok, ranks, at, err = null, standings = null) => db.query(
  'select rc_mama_rank_record($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz, $8::jsonb) as id',
  ['mama_2026_r2', VOTE, ok, ok ? 200 : 503, err, ranks ? JSON.stringify(ranks) : null, at, standings ? JSON.stringify(standings) : null])
const R = (male, visa) => ({ male: { rank: male, of: 20 }, visa: { rank: visa, of: 40 } })

test('checks fold into the hour: first, last, best, worst, samples', { skip }, async () => {
  const db = await setup()
  await record(db, true, R(1, 3), '2026-11-02T16:00:05Z')
  await record(db, true, R(1, 2), '2026-11-02T16:15:05Z')
  await record(db, false, null, '2026-11-02T16:30:05Z', 'http_503')
  await record(db, true, R(2, 4), '2026-11-02T16:45:05Z')
  await record(db, true, R(1, 3), '2026-11-02T17:00:05Z', null, { male: [{ rank: 1, title: 'BTS' }], visa: [{ rank: 3, title: 'BTS' }] })
  const rows = (await db.query(`select category, hour::text, first_rank, last_rank, best_rank, worst_rank, of_count, samples
                                  from rc_mama_rank_hourly order by category, hour`)).rows
  assert.deepEqual(rows.map((r) => [r.category, r.hour.slice(11, 13), r.first_rank, r.last_rank, r.best_rank, r.worst_rank, r.of_count, r.samples]), [
    ['male', '16', 1, 2, 1, 2, 20, 3], ['male', '17', 1, 1, 1, 1, 20, 1],
    ['visa', '16', 3, 4, 2, 4, 40, 3], ['visa', '17', 3, 3, 3, 3, 40, 1],
  ])
  const checks = (await db.query('select ok, error, ranks from rc_mama_rank_checks order by checked_at')).rows
  assert.equal(checks.length, 5)
  assert.deepEqual([checks[2].ok, checks[2].error, checks[2].ranks], [false, 'http_503', null], 'a failure is logged, history untouched')
  const last = (await db.query('select standings from rc_mama_rank_checks order by checked_at desc limit 1')).rows[0]
  assert.deepEqual(last.standings.male, [{ rank: 1, title: 'BTS' }], 'full standings kept with the check')
})

test('a malformed success is refused whole', { skip }, async () => {
  const db = await setup()
  await assert.rejects(record(db, true, { male: { rank: 5, of: 3 }, visa: { rank: 1, of: 40 } }, '2026-11-02T16:00:00Z'), /bad rank for male/)
  assert.equal((await db.query('select count(*)::int n from rc_mama_rank_checks')).rows[0].n, 0)
  assert.equal((await db.query('select count(*)::int n from rc_mama_rank_hourly')).rows[0].n, 0)
})

test('Round 2 source row, and nothing granted to players', { skip }, async () => {
  const db = await setup()
  const src = (await db.query('select campaign_id, vote_id, artist, active from rc_mama_rank_source')).rows
  assert.deepEqual(src, [{ campaign_id: 'mama_2026_r2', vote_id: VOTE, artist: 'BTS', active: true }])
  for (const role of ['anon', 'authenticated']) {
    for (const t of ['rc_mama_rank_source', 'rc_mama_rank_checks', 'rc_mama_rank_hourly']) {
      const { rows } = await db.query(`select has_table_privilege('${role}', 'public.${t}', 'select') as ok`)
      assert.equal(rows[0].ok, false, `${role} on ${t}`)
    }
    const { rows } = await db.query(`select has_function_privilege('${role}', 'public.rc_mama_rank_record(text, text, boolean, integer, text, jsonb, timestamptz, jsonb)', 'execute') as ok`)
    assert.equal(rows[0].ok, false)
  }
})
