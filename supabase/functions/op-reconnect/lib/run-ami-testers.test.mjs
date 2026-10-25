// War of Cards testers: the owner-only rules (run-ami-testers.js) on an
// in-memory store, and the migration's posture checked against its SQL text.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createTesterService, RUN_AMI_OWNER } from './run-ami-testers.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

function setup() {
  const agents = { AGENT000: 'HQ', AGENT050: 'MOCHI', AGENT120: 'KOYA', AGENT777: 'FRESH' }
  const rows = new Map([['AGENT000', 1], ['AGENT050', 2]])
  const store = {
    async hasTester(a) { return rows.has(a) },
    async listTesters() { return [...rows.entries()].sort((x, y) => x[1] - y[1]).map(([agentNo, addedAt]) => ({ agentNo, addedAt })) },
    async addTester(a) { if (!agents[a]) return { ok: false, error: 'tester_no_agent' }; rows.set(a, rows.size + 1); return { ok: true } },
    async removeTester(a) { rows.delete(a) },
    async names(nos) { return new Map(nos.map((n) => [n, agents[n] || 'AGENT'])) },
  }
  return { rows, svc: createTesterService({ store }) }
}

test('the owner is always a tester; others only while listed', async () => {
  const { svc, rows } = setup()
  rows.delete('AGENT000')
  assert.equal(await svc.isTester(RUN_AMI_OWNER), true)
  assert.equal(await svc.isTester('AGENT050'), true)
  assert.equal(await svc.isTester('AGENT120'), false)
  assert.equal(await svc.isTester(''), false)
})

test('only AGENT000 can see or change the list', async () => {
  const { svc } = setup()
  for (const r of [await svc.list('AGENT050'), await svc.add('AGENT050', '120'), await svc.remove('AGENT050', '050')]) {
    assert.deepEqual(r, { success: false, error: 'not_owner' })
  }
})

test('the owner adds and removes testers by agent number, and gets the fresh list back', async () => {
  const { svc } = setup()
  const added = await svc.add('AGENT000', '120')
  assert.equal(added.success, true)
  assert.deepEqual(added.testers.map((t) => `${t.agentNo}:${t.name}:${t.owner}`), ['AGENT000:HQ:true', 'AGENT050:MOCHI:false', 'AGENT120:KOYA:false'])
  assert.equal(await svc.isTester('AGENT120'), true)
  const removed = await svc.remove('AGENT000', 'agent 50')
  assert.deepEqual(removed.testers.map((t) => t.agentNo), ['AGENT000', 'AGENT120'])
  assert.equal(await svc.isTester('AGENT050'), false)
})

test('bad numbers, unknown agents, duplicates and the owner are refused', async () => {
  const { svc } = setup()
  assert.equal((await svc.add('AGENT000', 'mochi')).error, 'tester_bad_agent')
  assert.equal((await svc.add('AGENT000', '999')).error, 'tester_no_agent')
  assert.equal((await svc.add('AGENT000', '050')).error, 'tester_exists')
  assert.equal((await svc.add('AGENT000', '000')).error, 'tester_exists')
  assert.equal((await svc.remove('AGENT000', '000')).error, 'tester_owner')
  assert.equal((await svc.remove('AGENT000', '120')).error, 'tester_not_found')
})

test('migration: RLS on, nothing for browser roles, seeded with the first five', () => {
  const sql = read('../../../migrations/20261025190000_rc_run_ami_testers.sql').replace(/--[^\n]*/g, '')
  assert.match(sql, /alter table public\.rc_run_ami_testers enable row level security/)
  assert.match(sql, /revoke all on public\.rc_run_ami_testers from public, anon, authenticated/)
  assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated)/)
  assert.doesNotMatch(sql, /create policy/)
  assert.match(sql, /'AGENT000', 'AGENT050', 'AGENT120', 'AGENT140', 'AGENT196'/)
})

test('routes, gate and game state use the live list', () => {
  const index = read('../index.ts')
  const runAmi = read('./run-ami.ts')
  const handlers = read('./handlers.ts')
  for (const r of ['runAmiTesters', 'runAmiTesterAdd', 'runAmiTesterRemove']) assert.match(index, new RegExp(`${r}: \\{ auth: 'agent'`))
  assert.match(runAmi, /\(await testers\(supabase\)\.isTester\(agentNo\)\.catch\(\(\) => false\)\) \|\| albumService\(supabase\)\.isComplete\(agentNo\)/)
  assert.doesNotMatch(runAmi, /isRunAmiTester/)
  assert.match(handlers, /const runAmiTester = await runAmiTesterForState\(supabase, player\.agent_no\)/)
})
