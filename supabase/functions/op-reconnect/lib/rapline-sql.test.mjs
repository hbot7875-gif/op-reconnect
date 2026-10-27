// Rap Line to 1B storage, against real Postgres (PGlite).
//   PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite/dist/index.js node --test <this file>
// Without PGLITE_MODULE the suite is skipped (and says so).
//
// "Save new figures only when the source changes": a re-fetch of the same
// history must write nothing, a changed day must update in place, and the
// tables must stay closed to anon/authenticated.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const MIGRATION = readFileSync(new URL('../../../migrations/20261027200000_rc_rapline_tracker.sql', import.meta.url), 'utf8')
const modulePath = process.env.PGLITE_MODULE
const skip = modulePath ? false : 'set PGLITE_MODULE to run the SQL suite'
const WF = '1AZjCZSGEjlxUufFQwSszF'

async function setup() {
  const { PGlite } = await import(pathToFileURL(modulePath).href)
  const db = new PGlite()
  await db.exec('create role anon; create role authenticated; create role service_role;')
  await db.exec(MIGRATION)
  await db.exec(MIGRATION) // re-runnable
  return db
}
const store = async (db, id, points) =>
  (await db.query('select rc_rapline_store($1, $2::jsonb) as n', [id, JSON.stringify(points)])).rows[0].n

test('a re-fetch writes nothing; only new or changed days are saved', { skip }, async () => {
  const db = await setup()
  const pts = [{ day: '2026-10-26', streams: 458_160_611 }, { day: '2026-10-27', streams: 458_468_618 }]
  assert.equal(await store(db, WF, pts), 2)
  assert.equal(await store(db, WF, pts), 0)
  assert.equal(await store(db, WF, [...pts, { day: '2026-10-28', streams: 458_800_000 }]), 1)
  assert.equal(await store(db, WF, [{ day: '2026-10-27', streams: 458_468_700 }]), 1)
  const rows = (await db.query('select day::text, streams::bigint from rc_rapline_daily order by day')).rows
  assert.deepEqual(rows.map((r) => [r.day, Number(r.streams)]), [
    ['2026-10-26', 458_160_611], ['2026-10-27', 458_468_700], ['2026-10-28', 458_800_000],
  ])
})

test('rejects bad ids and malformed payloads', { skip }, async () => {
  const db = await setup()
  await assert.rejects(store(db, 'not-an-id', []), /bad spotify id/)
  await assert.rejects(db.query('select rc_rapline_store($1, $2::jsonb)', [WF, '{"day":"2026-10-27"}']), /must be an array/)
  await assert.rejects(store(db, WF, [{ day: '2026-10-27', streams: -5 }]), /check/)
})

test('tables and the store function are closed to anon and authenticated', { skip }, async () => {
  const db = await setup()
  for (const role of ['anon', 'authenticated']) {
    for (const t of ['rc_rapline_daily', 'rc_rapline_requests']) {
      const r = await db.query('select has_table_privilege($1, $2, $3) as ok', [role, `public.${t}`, 'select'])
      assert.equal(r.rows[0].ok, false, `${role} can read ${t}`)
    }
    const f = await db.query('select has_function_privilege($1, $2, $3) as ok', [role, 'public.rc_rapline_store(text, jsonb)', 'execute'])
    assert.equal(f.rows[0].ok, false, `${role} can run rc_rapline_store`)
  }
})
