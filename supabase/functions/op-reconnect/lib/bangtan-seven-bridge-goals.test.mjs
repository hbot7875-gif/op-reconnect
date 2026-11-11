// Bangtan Seven Bridge — migration 20261112120000 on a real Postgres engine
// (PGlite), then the rows through the game's own freezeGoals: 13 track goals,
// 7 album goals and a two-stage quest whose War of Cards stage survives the
// freeze.
//
//   PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite/dist/index.js node <this file>
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { freezeGoals } from './districts.ts'
import { hasWarStage } from './reconnect-war-stage.js'
import { normKeyFull } from './text.ts'

const MIGRATION = readFileSync(new URL('../../../migrations/20261112120000_rc_bangtan_seven_bridge_goals.sql', import.meta.url), 'utf8')
const modulePath = process.env.PGLITE_MODULE
const skip = modulePath ? false : 'set PGLITE_MODULE to run the SQL suite'
const D = 'mono-bangtan-seven-bridge'

async function applied() {
  const { PGlite } = await import(pathToFileURL(modulePath).href)
  const db = new PGlite()
  await db.exec(`
    create table rc_goals (id text primary key, kind text not null, label text not null, artist text,
      aliases jsonb not null default '[]', tracks jsonb, target int not null default 1, active boolean not null default true,
      sort_order int not null default 0, district_id text, variant text, config jsonb not null default '{}',
      updated_at timestamptz not null default now());
    create table rc_reconnect_missions (id uuid primary key default gen_random_uuid(), status text not null default 'open',
      phase text not null default 'streaming');
  `)
  await db.exec(MIGRATION)
  return db
}

test('migration: cards_unlocked_at column and 21 goals, idempotent', { skip }, async () => {
  const db = await applied()
  const col = (await db.query(`select data_type from information_schema.columns where table_name = 'rc_reconnect_missions' and column_name = 'cards_unlocked_at'`)).rows
  assert.deepEqual(col, [{ data_type: 'timestamp with time zone' }])
  const counts = (await db.query(`select kind, count(*)::int n from rc_goals where district_id = $1 group by kind order by kind`, [D])).rows
  assert.deepEqual(counts, [{ kind: 'album', n: 7 }, { kind: 'reconnect', n: 1 }, { kind: 'track', n: 13 }])
  await db.exec(MIGRATION) // re-applying is a no-op
  assert.equal((await db.query(`select count(*)::int n from rc_goals`)).rows[0].n, 21)
})

test('targets: tracks 50/40/30, albums 5/3/2, as asked', { skip }, async () => {
  const db = await applied()
  const rows = (await db.query(`select kind, label, target from rc_goals where district_id = $1 and kind <> 'reconnect' order by sort_order`, [D])).rows
  const t = Object.fromEntries(rows.map((r) => [r.label, r.target]))
  for (const s of ['Swim', 'Haegeum', 'Wild Flower', "Killin' It Girl", 'Aliens']) assert.equal(t[s], 50, s)
  for (const s of ['Running Wild', 'Spring Day', 'One More Night', 'Hooligan', 'Rainy Days']) assert.equal(t[s], 40, s)
  for (const s of ['Lie', 'Rain', 'Forever Rain']) assert.equal(t[s], 30, s)
  for (const a of ['ARIRANG', 'Keep Swimming']) assert.equal(t[a], 5, a)
  for (const a of ['Happy', 'Dark & Wild']) assert.equal(t[a], 3, a)
  for (const a of ['Proof', 'Right Place, Wrong Person', 'D-DAY']) assert.equal(t[a], 2, a)
})

test('freezeGoals: real keys, and the quest keeps its War of Cards stage', { skip }, async () => {
  const db = await applied()
  const goals = (await db.query(`select * from rc_goals where active order by sort_order`)).rows
  const content = { goals, config: {}, districts: [], wards: [] }
  const frozen = freezeGoals(content, 'steady', { id: D, is_tutorial: false })
  assert.equal(frozen.trackGoals.length, 13)
  assert.equal(frozen.albumGoals.length, 7)
  const keys = Object.fromEntries(frozen.trackGoals.map((g) => [g.label, g.keys]))
  assert.ok(keys.Haegeum.includes(normKeyFull('해금')), 'Korean alias kept (stored decomposed, as the game matches it)')
  assert.ok(keys["Killin' It Girl"].includes('killin it girl'))
  assert.deepEqual(keys.Lie, ['lie'])
  assert.ok(frozen.albumGoals.every((a) => a.tracks.length >= 6 && a.tracks.every((t) => t.keys.length)), 'every album song has keys')
  assert.equal(frozen.reconnect.variant, 'connect')
  const cfg = frozen.reconnect.config
  assert.equal(cfg.requiredAgents, 4)
  assert.deepEqual(cfg.sharedTrack, { keys: ['danger'], label: 'Danger', target: 150 })
  assert.deepEqual(cfg.warOfCards, { gamesEach: 1 })
  assert.equal(hasWarStage(cfg), true)
})
