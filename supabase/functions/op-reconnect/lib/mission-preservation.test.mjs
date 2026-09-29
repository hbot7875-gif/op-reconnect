// Retiring a mission's creator must not delete anyone else's ReConnect history.
//
// It did. rc_purge_agent_data deleted every mission its subject had created,
// and rc_reconnect_participants and rc_reconnect_messages both hang off
// rc_reconnect_missions(id) with ON DELETE CASCADE -- so other players' rows
// went with it. Measured 2026-09-28: 398 of 575 participant rows and 363 of
// 497 message rows belong to someone other than the mission creator, across 85
// active agents; a 13-account backfill had already destroyed ~35 of them.
//
// These are source-level assertions, in the same spirit as
// retired-ingestion.test.mjs: what went wrong was a single statement in a SQL
// function, so a single statement in a SQL function is what these check. The
// behavioural half -- actually purging an agent and counting what survives --
// lives in scripts/preserve-missions-verify.sql, which runs against a real
// database inside a transaction it rolls back.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

/** Migrations move from supabase/pending/ to supabase/migrations/ when they are
 *  applied, so resolve by name rather than pinning a directory. */
function readMigration(name) {
  for (const dir of ['migrations', 'pending']) {
    try { return read(`../../../${dir}/${name}`) } catch { /* try the next one */ }
  }
  throw new Error(`${name} is in neither supabase/migrations/ nor supabase/pending/`)
}

const proposed = readMigration('20260928120000_rc_preserve_missions_on_purge.sql')
const applied = read('../../../migrations/20260928060000_rc_privacy_retention.sql')

/** Executable statements only: comments and blank lines stripped, whitespace
 *  collapsed. The comments were rewritten wholesale; the logic is what matters. */
function statements(sql) {
  const out = []
  for (const line of sql.split('\n')) {
    let s = '', q = null
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (q) { s += c; if (c === q) q = null }
      else if (c === "'" || c === '"') { q = c; s += c }
      else if (c === '-' && line[i + 1] === '-') break
      else s += c
    }
    const t = s.replace(/\s+/g, ' ').trim()
    if (t) out.push(t)
  }
  return out
}

/** rc_purge_agent_data's body as it appears in the applied migration. */
function appliedPurgeBody() {
  const lines = applied.split('\n')
  const start = lines.findIndex((l) => l.startsWith('create or replace function rc_purge_agent_data'))
  assert.ok(start > -1, 'rc_purge_agent_data not found in the applied migration')
  const end = lines.findIndex((l, i) => i > start && l.trim() === '$$;')
  assert.ok(end > -1, 'unterminated rc_purge_agent_data')
  return statements(lines.slice(start, end + 1).join('\n'))
}

const MISSION_DELETE = 'delete from rc_reconnect_missions where created_by = r.agent_no;'
const MISSION_ANON = "update rc_reconnect_missions set created_by = '__deleted__' where created_by = r.agent_no;"

test('the mission is preserved, not deleted', () => {
  const s = statements(proposed)
  assert.ok(s.includes(MISSION_ANON), 'the anonymising update is missing')
  assert.ok(!s.includes(MISSION_DELETE), 'the mission DELETE is still there')
})

test('other agents keep their participant rows and messages', () => {
  const s = statements(proposed)
  // Nothing may touch these by mission -- that is the cascade path.
  for (const t of ['rc_reconnect_participants', 'rc_reconnect_messages']) {
    const byMission = s.filter((x) => x.includes(t) && /mission_id/.test(x))
    assert.deepEqual(byMission, [], `${t} is being touched by mission_id: ${byMission}`)
  }
  // And the cascade can no longer fire, because no mission row is deleted.
  assert.deepEqual(s.filter((x) => /^delete from rc_reconnect_missions/.test(x)), [])
})

test("the retiring agent's own participation and messages are still deleted", () => {
  const s = statements(proposed)
  assert.ok(s.includes('delete from rc_reconnect_participants where agent_no = r.agent_no;'))
  assert.ok(s.includes('delete from rc_reconnect_messages where agent_no = r.agent_no;'))
  // Invites they sent are still un-named rather than deleted.
  assert.ok(s.includes('update rc_reconnect_participants set invited_by = null where invited_by = r.agent_no;'))
})

test('exactly one statement changed from the applied function', () => {
  const before = appliedPurgeBody()
  const after = statements(proposed)
  assert.equal(after.length, before.length, 'statement count changed')
  const diff = before.map((l, i) => [l, after[i]]).filter(([a, b]) => a !== b)
  assert.equal(diff.length, 1, `expected 1 changed statement, got ${diff.length}: ${JSON.stringify(diff)}`)
  assert.deepEqual(diff[0], [MISSION_DELETE, MISSION_ANON])
})

test('rc_district_messages behaviour is untouched', () => {
  // Deleting DMs sent TO a retiring agent is deliberate and was reviewed
  // separately; this change must not quietly alter it in either direction.
  const s = statements(proposed)
  assert.deepEqual(s.filter((x) => x.includes('rc_district_messages')), [],
    'this migration must not mention rc_district_messages at all')
})

test('__deleted__ can never be a real agent number', () => {
  // rc_next_agent_no() is the only minting path, and auth.ts the only insert.
  const authSrc = read('./auth.ts')
  assert.match(authSrc, /rpc\('rc_next_agent_no'\)/, 'auth.ts no longer mints via rc_next_agent_no')
  const inserts = authSrc.match(/from\('rc_agents'\)\s*\n?\s*\.insert\(/g) || []
  assert.equal(inserts.length, 1, 'more than one insert into rc_agents')

  // Every minted number is AGENT + digits, so the sentinel is unreachable.
  const AGENT_NO = /^AGENT\d{3,}$/
  assert.ok(!AGENT_NO.test('__deleted__'))
  assert.ok(!AGENT_NO.test('__admin__'))
  assert.ok(AGENT_NO.test('AGENT001'))

  // And the admin surfaces reject it before any lookup happens.
  assert.match(read('./admin-agent.ts'), /\^AGENT\\d\{3,\}\$/, 'the agent_no format guard is gone')
})

test('creator-only actions cannot be performed as __deleted__', () => {
  const src = read('./reconnect-missions.ts')
  // The guard compares the mission's creator against the CALLER's agent number,
  // which always comes from a session and is therefore always AGENTnnn. A
  // strict comparison against '__deleted__' can never succeed.
  assert.match(src, /mission\.created_by !== agentNo/, 'the creator guard changed shape')
  assert.ok(!/mission\.created_by\s*!=[^=]/.test(src), 'loose inequality would be unsafe here')
  assert.match(src, /isCreator: m\.created_by === meAgentNo/, 'isCreator changed shape')

  // created_by must never reach the client -- only the derived boolean does.
  const payload = src.slice(src.indexOf('isCreator: m.created_by === meAgentNo'), src.indexOf('isCreator: m.created_by === meAgentNo') + 2000)
  assert.ok(!/createdBy:/.test(payload), 'created_by is being sent to the client')
})

test('the anonymising update cannot fire the mission badge trigger', () => {
  // rc_reconnect_missions carries an AFTER INSERT OR UPDATE trigger. Turning
  // the purge's DELETE into an UPDATE means that trigger now runs on every
  // retirement, which the DELETE never did. It is inert here, but only because
  // of two guards, and if either is removed retiring an agent would start
  // awarding mission_bond badges to their old teammates.
  const src = read('../../../migrations/20260819160000_rc_badge_reliability.sql')
  const fn = src.slice(src.indexOf('rc_award_reconnect_badges'))
  // Guard 1: nothing happens unless the mission is complete.
  assert.match(fn, /if new\.status <> 'complete' then return new; end if;/)
  // Guard 2: an UPDATE of an already-complete mission is a no-op. Our update
  // never touches status, so old.status = new.status -- meaning if guard 1
  // lets it through, guard 2 always catches it. Awarding is unreachable.
  assert.match(fn, /if tg_op = 'UPDATE' and old\.status = 'complete' then return new; end if;/)
  // And the purge must never write status, or the reasoning above collapses.
  const s = statements(proposed)
  assert.ok(!s.some((x) => /rc_reconnect_missions/.test(x) && /status/.test(x)),
    'the purge must not touch mission status')
})

test('normal mission behaviour is otherwise unchanged', () => {
  // No schema change: created_by stays NOT NULL text with no foreign key, so
  // nothing that reads or writes a mission needs to learn a new shape.
  const s = statements(proposed)
  assert.deepEqual(s.filter((x) => /alter table/i.test(x)), [], 'unexpected schema change')
  assert.deepEqual(s.filter((x) => /^drop /i.test(x)), [], 'unexpected drop')
  assert.deepEqual(s.filter((x) => /create index|create table/i.test(x)), [], 'unexpected DDL')
  // Exactly one function is replaced.
  const fns = s.filter((x) => /create or replace function/i.test(x))
  assert.equal(fns.length, 1)
  assert.match(fns[0], /rc_purge_agent_data/)
})
