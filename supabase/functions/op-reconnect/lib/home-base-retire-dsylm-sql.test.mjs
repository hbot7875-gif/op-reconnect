// Retiring Home Base's "Don't Say You Love Me" goal, against real Postgres.
//   PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite/dist/index.js node --test <this file>
// Without PGLITE_MODULE the suite is skipped (and says so).
//
// The goal must leave new activations AND every active run, without touching
// finished runs, other districts, other goals, or the order of what's left.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const MIGRATION = readFileSync(new URL('../../../migrations/20261028140000_rc_home_base_retire_dsylm.sql', import.meta.url), 'utf8')
const modulePath = process.env.PGLITE_MODULE
const skip = modulePath ? false : 'set PGLITE_MODULE to run the SQL suite'

const g = (id) => ({ id, label: id, target: 20, keys: [id] })
const goals = (ids) => JSON.stringify({ trackGoals: ids.map(g), albumGoals: [{ id: 'home-base-album-echo' }], reconnect: null, meta: { mode: 'exam' } })

async function setup() {
  const { PGlite } = await import(pathToFileURL(modulePath).href)
  const db = new PGlite()
  await db.exec(`
    create table rc_goals (id text primary key, active boolean not null default true, updated_at timestamptz);
    create table rc_player_districts (agent_no text, district_id text, status text, goals jsonb);
    insert into rc_goals (id) values ('home-base-dsylm'), ('home-base-haegeum'), ('home-base-album-echo');
  `)
  const rows = [
    ['A1', 'relay-zero-hq', 'active', ['home-base-dsylm', 'home-base-haegeum', 'home-base-dna']],
    ['A2', 'relay-zero-hq', 'active', ['home-base-haegeum', 'home-base-dsylm']],
    ['A3', 'relay-zero-hq', 'active', ['home-base-dsylm']],
    ['R1', 'relay-zero-hq', 'restored', ['home-base-dsylm', 'home-base-haegeum']],
    ['O1', 'mono-tae-pier', 'active', ['home-base-dsylm']],
  ]
  for (const [a, d, s, ids] of rows) {
    await db.query('insert into rc_player_districts values ($1, $2, $3, $4::jsonb)', [a, d, s, goals(ids)])
  }
  return db
}
const ids = async (db, agent) =>
  (await db.query(`select goals->'trackGoals' t from rc_player_districts where agent_no = $1`, [agent])).rows[0].t.map((x) => x.id)

test('the goal leaves new runs and every active Home Base run, nothing else', { skip }, async () => {
  const db = await setup()
  await db.exec(MIGRATION)

  const active = (await db.query(`select id, active from rc_goals order by id`)).rows
  assert.deepEqual(active, [
    { id: 'home-base-album-echo', active: true },
    { id: 'home-base-dsylm', active: false },
    { id: 'home-base-haegeum', active: true },
  ])
  assert.deepEqual(await ids(db, 'A1'), ['home-base-haegeum', 'home-base-dna'])  // order kept
  assert.deepEqual(await ids(db, 'A2'), ['home-base-haegeum'])
  assert.deepEqual(await ids(db, 'A3'), [])                                       // empty array, not null
  assert.deepEqual(await ids(db, 'R1'), ['home-base-dsylm', 'home-base-haegeum']) // finished run untouched
  assert.deepEqual(await ids(db, 'O1'), ['home-base-dsylm'])                      // other district untouched
  const echo = (await db.query(`select goals->'albumGoals' a from rc_player_districts where agent_no = 'A1'`)).rows[0].a
  assert.deepEqual(echo, [{ id: 'home-base-album-echo' }])
})

test('re-running is a no-op', { skip }, async () => {
  const db = await setup()
  await db.exec(MIGRATION)
  await db.exec(MIGRATION)
  assert.deepEqual(await ids(db, 'A1'), ['home-base-haegeum', 'home-base-dna'])
})
