// Admin deletion must go through the one canonical purge.
//
// adminDeleteAgent used to carry its own list of 23 tables. Its own docstring
// said the point was "exactly one place that knows how to fully remove an
// agent, not two that can drift apart" -- and by 2026-09-28 there were two and
// they had drifted. The list missed ten tables, never queued VMA proof files
// for deletion (stranding them in Storage with no record of their paths), and
// DELETED generated_playlists and rc_reconnect_missions where the canonical
// purge preserves them -- the mission delete cascading to every other player's
// participation and messages.
//
// Unlike the other admin-agent guards, these are behavioural: the module
// imports cleanly under Node, so the tests drive the real function with a
// recording client and assert what it actually does. A source-level check
// could be satisfied by code that still reaches a table by another route.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

globalThis.Deno = globalThis.Deno || { env: { get: () => undefined } }
const { adminDeleteAgent, adminDeleteInactiveAgents } = await import('./admin-agent.ts')

const AGENT = { agent_no: 'AGENT042', handle: 'someone', email: 'a@b.c', lb_username: null, created_at: '2026-01-01' }

/** A Supabase stand-in that records every table operation and RPC. Any write
 *  path the function still uses shows up in `calls`. */
function mockDb({ agent = AGENT, rpc = {} } = {}) {
  const calls = { rpc: [], deletes: [], updates: [], inserts: [], selects: [] }
  const thenable = (value) => {
    const chain = {
      eq: () => chain, in: () => chain, is: () => chain, not: () => chain,
      select: () => chain, limit: () => chain, order: () => chain,
      maybeSingle: async () => value,
      single: async () => value,
      then: (res) => Promise.resolve(value).then(res),
    }
    return chain
  }
  const db = {
    from(table) {
      calls.selects.push(table)
      return {
        select: () => thenable({ data: table === 'rc_agents' ? agent : null, error: null }),
        delete: () => { calls.deletes.push(table); return thenable({ data: null, error: null }) },
        update: (patch) => { calls.updates.push([table, patch]); return thenable({ data: null, error: null }) },
        insert: (row) => { calls.inserts.push([table, row]); return thenable({ data: null, error: null }) },
      }
    },
    async rpc(name, args) {
      calls.rpc.push([name, args])
      if (name in rpc) return rpc[name]
      return { data: null, error: null }
    },
  }
  return { db, calls }
}

test('admin deletion delegates to rc_purge_agent_data', async () => {
  const { db, calls } = mockDb({ rpc: { rc_purge_agent_data: { data: true, error: null } } })
  const out = await adminDeleteAgent(db, { agentNo: 'AGENT042' })

  assert.deepEqual(out, { success: true, deleted: { agentNo: 'AGENT042', handle: 'someone' } })
  const purges = calls.rpc.filter(([n]) => n === 'rc_purge_agent_data')
  assert.equal(purges.length, 1, 'the purge must be called exactly once')
  assert.deepEqual(purges[0][1], { p_agent_no: 'AGENT042', p_reason: 'manual_admin' })
})

test('the caller-supplied reason is passed through unchanged', async () => {
  const { db, calls } = mockDb({ rpc: { rc_purge_agent_data: { data: true, error: null } } })
  await adminDeleteAgent(db, { agentNo: 'AGENT042', reason: 'duplicate_account' })
  assert.equal(calls.rpc[0][1].p_reason, 'duplicate_account')
})

test('the manual table list is gone -- it deletes nothing itself', async () => {
  const { db, calls } = mockDb({ rpc: { rc_purge_agent_data: { data: true, error: null } } })
  await adminDeleteAgent(db, { agentNo: 'AGENT042' })
  assert.deepEqual(calls.deletes, [], `still deleting directly from: ${calls.deletes}`)
  assert.deepEqual(calls.updates, [], `still updating directly: ${JSON.stringify(calls.updates)}`)
})

test('it cannot independently delete missions or generated playlists', async () => {
  // The two the old list destroyed where the canonical purge preserves them.
  const { db, calls } = mockDb({ rpc: { rc_purge_agent_data: { data: true, error: null } } })
  await adminDeleteAgent(db, { agentNo: 'AGENT042' })
  for (const t of ['rc_reconnect_missions', 'generated_playlists', 'rc_reconnect_participants', 'rc_reconnect_messages']) {
    assert.ok(!calls.deletes.includes(t), `${t} is still deleted directly`)
    assert.ok(!calls.updates.some(([tbl]) => tbl === t), `${t} is still updated directly`)
  }
})

test('it no longer writes rc_deleted_agent_log itself', async () => {
  // The purge writes it, before the rows it reads from are gone. A second
  // insert here would log every admin deletion twice.
  const { db, calls } = mockDb({ rpc: { rc_purge_agent_data: { data: true, error: null } } })
  await adminDeleteAgent(db, { agentNo: 'AGENT042' })
  assert.deepEqual(calls.inserts, [], `still inserting: ${JSON.stringify(calls.inserts)}`)
})

test('proof cleanup is inherited, not reimplemented', async () => {
  // The TS side must not queue proof files itself -- asserted on behaviour,
  // not on the source, because the docstring legitimately names the function
  // when explaining why the old list was wrong.
  const { db, calls } = mockDb({ rpc: { rc_purge_agent_data: { data: true, error: null } } })
  await adminDeleteAgent(db, { agentNo: 'AGENT042' })
  assert.deepEqual(calls.rpc.map(([n]) => n), ['rc_purge_agent_data'],
    'the only RPC may be the canonical purge')
  // ...because the canonical purge does it, before deleting the vote rows that
  // hold the only copy of the paths.
  const purge = readFileSync(fileURLToPath(new URL('../../../migrations/20260928120000_rc_preserve_missions_on_purge.sql', import.meta.url)), 'utf8')
  const queueAt = purge.indexOf('rc_queue_agent_proof_files')
  const votesAt = purge.indexOf('delete from rc_vma_votes')
  assert.ok(queueAt > -1, 'the purge no longer queues proof files')
  assert.ok(votesAt > -1, 'the purge no longer deletes vote rows')
  assert.ok(queueAt < votesAt, 'proofs must be queued BEFORE the vote rows are deleted')
})

test('agent-number validation is unchanged, and runs before anything else', async () => {
  for (const bad of ['', 'AGENT', 'AGENT1', 'AGENT12', '__deleted__', 'nonsense', 'AGENTXYZ']) {
    const { db, calls } = mockDb()
    const out = await adminDeleteAgent(db, { agentNo: bad })
    assert.deepEqual(out, { success: false, error: 'agent_no_invalid' }, `accepted ${JSON.stringify(bad)}`)
    assert.deepEqual(calls.rpc, [], 'nothing may be called for an invalid agent number')
    assert.deepEqual(calls.selects, [], 'not even a lookup')
  }
  // And it still normalises the way it always did.
  const { db, calls } = mockDb({ rpc: { rc_purge_agent_data: { data: true, error: null } } })
  await adminDeleteAgent(db, { agentNo: '  agent042  ' })
  assert.equal(calls.rpc[0][1].p_agent_no, 'AGENT042')
})

test('authorization is unchanged -- still the central admin gate', () => {
  const index = readFileSync(fileURLToPath(new URL('../index.ts', import.meta.url)), 'utf8')
  const line = index.split('\n').find((l) => l.includes('adminDeleteAgent:'))
  assert.ok(line, 'the route is missing')
  assert.match(line, /auth: 'admin'/, 'admin deletion must stay admin-gated')
  // The function itself must not have grown its own auth check or bypass.
  const src = readFileSync(fileURLToPath(new URL('./admin-agent.ts', import.meta.url)), 'utf8')
  assert.ok(!/isAdminAuthorized/.test(src), 'auth belongs in the central route gate, not here')
})

test('a missing or failing RPC fails closed -- no fallback deletion', async () => {
  // settings.ts retireAccount falls back to deactivation; an admin delete must
  // not quietly do something less thorough than it claims.
  const { db, calls } = mockDb({
    rpc: { rc_purge_agent_data: { data: null, error: { message: 'could not find the function' } } },
  })
  const out = await adminDeleteAgent(db, { agentNo: 'AGENT042' })
  assert.deepEqual(out, { success: false, error: 'purge_failed:could not find the function' })
  assert.deepEqual(calls.deletes, [], 'it must not fall back to deleting things itself')
  assert.deepEqual(calls.inserts, [], 'and must not log a deletion that did not happen')
})

test('a purge that reports false returns agent_not_found', async () => {
  const { db } = mockDb({ rpc: { rc_purge_agent_data: { data: false, error: null } } })
  const out = await adminDeleteAgent(db, { agentNo: 'AGENT042' })
  assert.deepEqual(out, { success: false, error: 'agent_not_found' })
})

test('an unknown agent is rejected before the purge is called', async () => {
  const { db, calls } = mockDb({ agent: null })
  const out = await adminDeleteAgent(db, { agentNo: 'AGENT999' })
  assert.deepEqual(out, { success: false, error: 'agent_not_found' })
  assert.deepEqual(calls.rpc, [], 'the purge must not be called for an agent that is not there')
})

test('adminDeleteInactiveAgents still delegates through adminDeleteAgent', async () => {
  const candidates = [{ agent_no: 'AGENT101' }, { agent_no: 'AGENT102' }]
  const { db, calls } = mockDb({
    rpc: {
      rc_inactive_agent_candidates: { data: candidates, error: null },
      rc_purge_agent_data: { data: true, error: null },
    },
  })
  const out = await adminDeleteInactiveAgents(db, { dryRun: false })
  assert.equal(out.success, true)

  const purges = calls.rpc.filter(([n]) => n === 'rc_purge_agent_data')
  assert.equal(purges.length, 2, 'one purge per candidate')
  assert.deepEqual(purges.map(([, a]) => a.p_agent_no).sort(), ['AGENT101', 'AGENT102'])
  // The reason still identifies the scheduled path, not a manual admin action.
  for (const [, a] of purges) assert.equal(a.p_reason, 'inactive_14d')
  assert.deepEqual(calls.deletes, [], 'the scheduled path must not delete directly either')
})

test('adminDeleteInactiveAgents still defaults to a dry run', async () => {
  // Opt OUT, not opt in: a missing or misspelled flag must never delete.
  const { db, calls } = mockDb({
    rpc: { rc_inactive_agent_candidates: { data: [{ agent_no: 'AGENT101' }], error: null } },
  })
  const out = await adminDeleteInactiveAgents(db, {})
  assert.equal(out.dryRun, true)
  assert.deepEqual(calls.rpc.filter(([n]) => n === 'rc_purge_agent_data'), [])
})
