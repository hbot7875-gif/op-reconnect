// A ReConnect recruit's free "Leave team" (rc_reconnect_recruit_leave, called
// by reconnect-missions.ts leaveRecruitTeam). The SQL runs for real on PGlite:
// pooled plays stay frozen with the team, a late scrobble refuses the stale
// snapshot, a local member can't use it to dodge the priced Quest Exit, and
// browser roles can't call it.
//
// PGlite is not a project dependency. Point PGLITE_MODULE at an installed
// copy (see vote-campaign-sql.test.mjs); without it the SQL tests are skipped.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const MIGRATION = read('../../../migrations/20261024230000_rc_reconnect_recruit_leave.sql')
const missions = read('./reconnect-missions.ts')
const index = read('../index.ts')
const screen = read('../../../../js/screen-district.js')

const modulePath = process.env.PGLITE_MODULE
const skip = modulePath ? false : 'set PGLITE_MODULE to run the SQL suite'

// The production columns these tables carry that the function touches.
const STUBS = `
  create role anon; create role authenticated; create role service_role;
  create table rc_reconnect_missions (id uuid primary key, district_id text not null, status text not null default 'open');
  create table rc_reconnect_participants (mission_id uuid, agent_no text, status text, joined_at timestamptz default now(),
    left_at timestamptz, contribution_frozen integer, primary key (mission_id, agent_no));
  create table rc_player_districts (agent_no text, district_id text, status text);
  create table rc_scrobbles (id bigserial primary key, agent_no text);
`
const M = '00000000-0000-4000-8000-000000000001'

async function fresh() {
  const { PGlite } = await import(pathToFileURL(modulePath).href)
  const db = new PGlite()
  await db.exec(STUBS)
  await db.exec(MIGRATION)
  await db.exec(`
    insert into rc_reconnect_missions values ('${M}', 'mono-urmi-terrace', 'open');
    insert into rc_reconnect_participants (mission_id, agent_no, status) values
      ('${M}', 'AGENT311', 'joined'), ('${M}', 'AGENT312', 'joined'), ('${M}', 'AGENT455', 'joined');
    insert into rc_player_districts values
      ('AGENT311', 'mono-urmi-terrace', 'active'), ('AGENT312', 'mono-urmi-terrace', 'active'),
      ('AGENT455', 'relay-zero-hq', 'active');
    insert into rc_scrobbles (agent_no) values ('AGENT455'), ('AGENT311');
  `)
  return db
}
const leave = async (db, agent, contribution, highWater) => (await db.query(
  'select public.rc_reconnect_recruit_leave($1, $2, $3, $4) as r', [agent, M, contribution, highWater])).rows[0].r
const row = async (db, agent) => (await db.query(
  'select status, contribution_frozen, left_at is not null as left from rc_reconnect_participants where agent_no = $1', [agent])).rows[0]

test('a recruit leaves with their pooled plays frozen for the team', { skip }, async () => {
  const db = await fresh()
  assert.deepEqual(await leave(db, 'AGENT455', 8, 2), { success: true, contributionKept: 8 })
  assert.deepEqual(await row(db, 'AGENT455'), { status: 'left', contribution_frozen: 8, left: true })
  assert.equal((await db.query(`select status from rc_reconnect_missions`)).rows[0].status, 'open')
  // Gone means gone: a second tap finds no joined row.
  assert.equal((await leave(db, 'AGENT455', 8, 2)).error, 'not_in_mission')
})

test('a play newer than the snapshot refuses it, so the frozen count is never short', { skip }, async () => {
  const db = await fresh()
  await db.exec(`insert into rc_scrobbles (agent_no) values ('AGENT455')`)
  assert.equal((await leave(db, 'AGENT455', 8, 2)).error, 'contribution_changed')
  assert.equal((await row(db, 'AGENT455')).status, 'joined')
})

test('an agent restoring the district must use the priced Quest Exit', { skip }, async () => {
  const db = await fresh()
  assert.equal((await leave(db, 'AGENT311', 14, 99)).error, 'use_quest_exit')
  assert.equal((await row(db, 'AGENT311')).status, 'joined')
})

test('a finished mission cannot be left, and the last member out cancels it', { skip }, async () => {
  const db = await fresh()
  await db.exec(`update rc_reconnect_missions set status = 'complete'`)
  assert.equal((await leave(db, 'AGENT455', 8, 99)).error, 'mission_complete')
  await db.exec(`update rc_reconnect_missions set status = 'open';
    update rc_reconnect_participants set status = 'left' where agent_no <> 'AGENT455'`)
  assert.equal((await leave(db, 'AGENT455', 8, 99)).success, true)
  assert.equal((await db.query(`select status from rc_reconnect_missions`)).rows[0].status, 'cancelled')
})

test('browser roles cannot call it', { skip }, async () => {
  const db = await fresh()
  for (const role of ['anon', 'authenticated']) {
    await db.exec('begin')
    await db.exec(`set local role ${role}`)
    await assert.rejects(leave(db, 'AGENT455', 8, 99), /permission denied/)
    await db.exec('rollback')
  }
})

test('the edge action is routed, refuses local members, retries a stale snapshot', () => {
  assert.match(index, /leaveRecruitTeam: \{ auth: 'agent', handler: async \(sb, p\) => leaveRecruitTeam\(sb, await loadContent\(sb\), p\) \}/)
  const fn = missions.slice(missions.indexOf('export async function leaveRecruitTeam'))
  assert.match(fn, /if \(pd\?\.status === 'active'\) return \{ success: false, error: 'use_quest_exit' \}/)
  assert.match(fn, /questExitContributionEvidence/)
  assert.match(fn, /rc_reconnect_recruit_leave/)
  assert.match(fn, /if \(lastError !== 'contribution_changed'\) break/)
})

test('the panel offers it only to a joined recruit on an open team, then goes home', () => {
  assert.match(screen, /const leaveRow = myRow\?\.status === 'joined' && res\.recruit && m\.status === 'open' \? recruitLeaveRow\(d, res, myRow\) : null/)
  assert.match(screen, /call\('leaveRecruitTeam', \{ agentNo: getAgentNo\(\), districtId: d\.id \}\)/)
  assert.match(screen, /if \(home\?\.wardId\) goDistrict\(home\.wardId, home\.id\)/)
})
