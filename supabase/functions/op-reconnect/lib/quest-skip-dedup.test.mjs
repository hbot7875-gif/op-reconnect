// Quest Skip's dedup key, and the handler that hid it being wrong.
//
// rc_xp_ledger has a UNIQUE index on dedup_key ALONE. Skip wrote
// `quest_skip:<mission>`, so the first member of a quest to pay for a skip
// claimed that key globally and every other member of the SAME quest hit a
// unique violation — rolled back, and reported as 'already_skipped' to people
// who had never skipped anything. Measured on production 2026-09-30: one paid
// skip on mission b9099cde, five still-joined members blocked behind it.
//
// Source-level assertions, in the same spirit as mission-preservation.test.mjs:
// what went wrong was one expression and one exception handler inside a SQL
// function, so that is what these check. The behavioural half — two agents
// actually skipping the same mission, and the charge landing exactly once —
// lives in scripts/quest-skip-dedup-verify.sql, which runs against a real
// database inside a transaction it rolls back.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

function readMigration(name) {
  for (const dir of ['migrations', 'pending']) {
    try { return read(`../../../${dir}/${name}`) } catch { /* try the next one */ }
  }
  throw new Error(`${name} is in neither supabase/migrations/ nor supabase/pending/`)
}

const sql = readMigration('20260930074500_rc_quest_skip_agent_scoped_dedup.sql')

/** Executable statements only — this file explains the old behaviour at length
 *  in prose, and matching that prose would pass while the code kept the bug. */
const code = sql
  .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

const OLD_KEY = "'quest_skip:' || p_mission::text"
const NEW_KEY = "'quest_skip:' || p_agent || ':' || p_mission::text"

/** Both live skip implementations. v2 is what the Edge Function calls; v1 is
 *  still installed, so it is fixed too rather than left as a loaded gun. */
const FUNCTIONS = ['rc_quest_skip_v2', 'rc_quest_skip']

/* ── D · the key itself ────────────────────────────────────────────────── */

/** The dedup_key each function WRITES, as opposed to the ones it looks up.
 *  The legacy guard deliberately mentions the old format too, so anything
 *  asserting on the whole file would match the guard and prove nothing. */
const writtenKeys = () =>
  [...code.matchAll(/values \(p_agent, -v_xp, 'quest_skip', 'spend', ([^,]+),/g)].map((m) => m[1].trim())

test('D · the dedup key is agent-scoped in every skip function', () => {
  for (const fn of FUNCTIONS) {
    assert.match(code, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`), `${fn} is not replaced`)
  }
  const written = writtenKeys()
  assert.equal(written.length, 2, 'expected one ledger write per function')
  for (const key of written) {
    assert.equal(key, NEW_KEY, `a skip still writes the mission-only key: ${key}`)
  }
  // The old format survives ONLY inside the legacy lookup, never as a write.
  assert.ok(!written.some((k) => k === OLD_KEY), 'the mission-only key must no longer be written')
})

test('D · two agents on one mission produce different keys', () => {
  // The key is built from p_agent and p_mission, so it is distinct per agent
  // by construction. Modelled here the way SQL concatenates it.
  const key = (agent, mission) => `quest_skip:${agent}:${mission}`
  const M = 'b9099cde-5274-4c8f-b419-9f265748848c'
  assert.notEqual(key('AGENT050', M), key('AGENT120', M))
  // ...and identical for the same agent replaying the same mission, which is
  // what keeps C and G below true.
  assert.equal(key('AGENT050', M), key('AGENT050', M))
})

test('E · an old mission-only key cannot collide with a new agent-scoped one', () => {
  // AGENT120's historical row is `quest_skip:<mission>`. AGENT050's new row is
  // `quest_skip:AGENT050:<mission>`. Different strings, so the unique index on
  // dedup_key cannot put them in conflict — which is why no backfill and no
  // index change is needed.
  const M = 'b9099cde-5274-4c8f-b419-9f265748848c'
  assert.notEqual(`quest_skip:${M}`, `quest_skip:AGENT050:${M}`)
})

/* ── A / B / C / F / G · what the key means for charging ───────────────── */

test('A+B · every written key carries the agent, so two members cannot collide', () => {
  // A (agent A skips M) and B (agent B skips the SAME M) both succeed exactly
  // because neither can claim the other's key. The assertion that makes both
  // true is that p_agent is part of every key actually written.
  const written = writtenKeys()
  assert.equal(written.length, 2, 'expected a ledger write in each function')
  for (const key of written) {
    assert.ok(key.includes('p_agent'), `a written key still omits the agent: ${key}`)
    assert.ok(key.includes('p_mission'), `a written key stopped being per-mission: ${key}`)
  }
})

test('C+G · a same-agent replay still collides, so it cannot charge twice', () => {
  // The idempotency is the unique index plus the key. Keeping p_mission in the
  // key is what makes a replay by the SAME agent hit it.
  assert.ok(NEW_KEY.includes('p_mission'), 'the key must still be per-mission')
  assert.ok(NEW_KEY.includes('p_agent'), 'the key must also be per-agent')
  // And the collision must still be reported as already_skipped, not as a new
  // error the client has no message for.
  assert.match(code, /if v_constraint = 'rc_xp_ledger_dedup_key_key' then\s*\n\s*return jsonb_build_object\('success', false, 'error', 'already_skipped'\);/)
})

test('F · one successful skip still writes exactly one of each row', () => {
  // Unchanged from before this migration: one ledger spend, one cell
  // deduction, one skip row, guarded by row counts that abort the transaction.
  assert.equal(code.split('insert into public.rc_xp_ledger').length - 1, 2, 'one ledger insert per function')
  assert.equal(code.split('insert into public.rc_quest_skips').length - 1, 2, 'one skip insert per function')
  assert.match(code, /if v_rows <> 1 then raise exception 'quest_exit_balance_changed'; end if;/)
  assert.match(code, /if v_rows <> 1 then raise exception 'quest_exit_membership_changed'; end if;/)
})

/* ── the legacy replay case ────────────────────────────────────────────── */

test('legacy · an agent who skipped under the OLD key cannot pay again', () => {
  // Agent-scoping the key fixes the cross-agent collision but would otherwise
  // drop idempotency for anyone who skipped before it: their historical
  // 'quest_skip:<mission>' row can no longer collide with their new
  // 'quest_skip:<agent>:<mission>' one. This guard restores it explicitly.
  for (const fn of FUNCTIONS) {
    const body = code.slice(code.indexOf(`FUNCTION public.${fn}(`))
    const guard = body.slice(0, body.indexOf('if v_cells > 0 then'))
    assert.match(guard, /if exists \(\s*\n\s*select 1 from public\.rc_xp_ledger/, `${fn} has no legacy replay guard`)
    assert.match(guard, /where agent_no = p_agent/, `${fn}'s guard is not scoped to the agent`)
    // Both formats, or a legacy skipper slips through.
    assert.match(guard, /'quest_skip:' \|\| p_mission::text/, `${fn}'s guard misses the legacy key`)
    assert.match(guard, /'quest_skip:' \|\| p_agent \|\| ':' \|\| p_mission::text/, `${fn}'s guard misses the new key`)
    assert.match(guard, /'error', 'already_skipped'/, `${fn}'s guard returns the wrong code`)
  }
})

test('legacy · the guard runs before anything is charged', () => {
  for (const fn of FUNCTIONS) {
    const body = code.slice(code.indexOf(`FUNCTION public.${fn}(`))
    const guardAt = body.indexOf('select 1 from public.rc_xp_ledger')
    const cellsAt = body.indexOf('if v_cells > 0 then')
    const ledgerAt = body.indexOf('insert into public.rc_xp_ledger')
    const skipRowAt = body.indexOf('insert into public.rc_quest_skips')
    assert.ok(guardAt > 0, `${fn}: no guard`)
    assert.ok(guardAt < cellsAt, `${fn}: guard runs after the cell deduction`)
    assert.ok(guardAt < ledgerAt, `${fn}: guard runs after the XP spend`)
    assert.ok(guardAt < skipRowAt, `${fn}: guard runs after the skip row`)
  }
})

test('legacy · a DIFFERENT agent on the same mission is not blocked by it', () => {
  // The guard filters on agent_no, so AGENT120's historical key is invisible
  // to AGENT050's attempt. This is the entire point of the migration and the
  // one thing the guard must not undo.
  const M = 'b9099cde-5274-4c8f-b419-9f265748848c'
  const legacyRowOwnedBy120 = { agent_no: 'AGENT120', dedup_key: `quest_skip:${M}` }
  // Modelling the guard's predicate exactly as written in SQL.
  const blocks = (row, agent) =>
    row.agent_no === agent &&
    [`quest_skip:${M}`, `quest_skip:${agent}:${M}`].includes(row.dedup_key)
  assert.equal(blocks(legacyRowOwnedBy120, 'AGENT120'), true, 'the legacy owner must be blocked')
  assert.equal(blocks(legacyRowOwnedBy120, 'AGENT050'), false, 'a different agent must NOT be blocked')
})

test('legacy · a free exit still does not block a later paid skip', () => {
  // Free exits write no ledger row at all — the insert is guarded by v_xp > 0
  // — so the guard cannot see them. cancel_join / teammate_rescue / expired
  // therefore keep behaving exactly as they did before this migration.
  assert.match(code, /if v_xp > 0 then\s*\n\s*(--[^\n]*\n\s*)?insert into public\.rc_xp_ledger/)
  const guardBlock = code.slice(code.indexOf('select 1 from public.rc_xp_ledger'))
  assert.ok(!/free_reason/.test(guardBlock.slice(0, 400)), 'the guard must not reason about free exits')
})

/* ── H · the handler stops lying ───────────────────────────────────────── */

test('H · an unrelated unique violation is not reported as already_skipped', () => {
  for (const fn of FUNCTIONS) {
    const body = code.slice(code.indexOf(`FUNCTION public.${fn}(`))
    const handler = body.slice(body.indexOf('exception when unique_violation'))
    assert.match(handler, /get stacked diagnostics v_constraint = constraint_name;/, `${fn} does not inspect the constraint`)
    assert.match(handler, /return jsonb_build_object\('success', false, 'error', 'skip_conflict'\);/, `${fn} has no distinct error for an unexpected collision`)
  }
  // The bare catch-all is gone from both.
  assert.ok(!/exception\s*\n\s*when unique_violation then\s*\n\s*return jsonb_build_object\('success', false, 'error', 'already_skipped'\);/.test(code),
    'a bare unique_violation handler still relabels everything')
})

test('H · an unexpected collision is logged, not shown raw to the player', () => {
  assert.match(code, /raise warning 'rc_quest_skip unexpected unique violation on constraint %', v_constraint;/)
  // skip_conflict is a code, not a constraint name — nothing database-internal
  // is returned to the client.
  assert.ok(!/jsonb_build_object\([^)]*v_constraint/.test(code), 'the constraint name must not be returned to the caller')
})

test('the narrowed handler declares the variable it reads', () => {
  assert.equal(code.split('v_constraint text;').length - 1, 2, 'both functions must declare v_constraint')
})

/* ── I / J · nothing else moved ────────────────────────────────────────── */

test('I · pricing is untouched — both functions still take it from the quote', () => {
  // Neither function decides a price. Each asks its quote function, and this
  // migration replaces neither quote — rc_quest_skip_price is not even
  // referenced here, which is a stronger guarantee than matching its call.
  assert.match(code, /v_xp := \(q->>'costXp'\)::integer;/)
  assert.match(code, /v_cells := \(q->>'costCells'\)::integer;/)
  assert.equal(code.split("v_xp := (q->>'costXp')::integer;").length - 1, 2, 'both functions')
  assert.ok(!code.includes('rc_quest_skip_price'), 'the price function is untouched by this migration')
  assert.ok(!/CREATE OR REPLACE FUNCTION public\.rc_quest_skip_quote/.test(code), 'the quotes must not be replaced')
  // And no literal price is introduced.
  assert.ok(!/v_xp\s*:=\s*\d/.test(code), 'an XP cost is hard-coded')
  assert.ok(!/v_cells\s*:=\s*\d/.test(code), 'a cell cost is hard-coded')
})

test('J · waiver, cooldown, waiting period and expiry semantics are unchanged', () => {
  assert.match(code, /v_waives_requirement := v_free is null or v_free = 'system_stuck';/)
  assert.match(code, /'error', 'on_cooldown'/)
  assert.match(code, /'error', 'too_soon'/)
  assert.match(code, /'error', 'insufficient'/)
  // The quote remains the single source of all of it.
  assert.match(code, /q := public\.rc_quest_skip_quote_v2\(p_agent, p_mission, p_evidence, p_scrobble_high_water\);/)
})

test('the migration replaces function bodies and nothing else', () => {
  for (const forbidden of [/\balter table\b/i, /\balter index\b/i, /\bcreate index\b/i, /\bdrop\s+\w/i,
                           /\bdelete from\b/i, /\bgrant\b/i, /\btruncate\b/i]) {
    assert.ok(!forbidden.test(code), `migration performs ${forbidden}`)
  }
  // No historical row is rewritten: the only writes are inside the functions.
  assert.ok(!/update public\.rc_xp_ledger/i.test(code), 'historical ledger rows must not be rewritten')
  assert.ok(!/update public\.rc_quest_skips/i.test(code), 'historical skip rows must not be rewritten')
})

test('the advisory lock that makes the exit atomic is still there', () => {
  assert.match(code, /perform pg_advisory_xact_lock\(hashtextextended\('rc_quest_skip\|' \|\| p_agent, 0\)\);/)
})
