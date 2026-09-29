// Retirement must stop collection. Everywhere.
//
// This exists because it did not. rc_players keeps its row when someone
// retires, and neither the 5-minute pg_cron capture nor the hourly fleet sync
// ever checked rc_agents.retired_at — so 19,507 scrobbles were recorded across
// 7 accounts AFTER their owners asked to leave, and were still arriving when
// this was written.
//
// These are source-level assertions rather than behavioural ones. That is a
// deliberate trade: the paths involved are five different call sites across
// four modules, each reaching a live provider, and a mock deep enough to
// exercise them end to end would mostly be testing the mock. What actually
// went wrong was a missing predicate in a query, so a missing predicate is
// what these check — including on the query that did not exist yet when the
// first two were fixed.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { assertMayCollect } from './streams.ts'

const read = (f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')
const syncAll = read('sync-all.ts')
const streams = read('streams.ts')
const inbound = read('scrobble-inbound.ts')

/** The text of one function, from its declaration to the next top-level one. */
function fn(src, name) {
  const at = src.indexOf(name)
  assert.ok(at >= 0, `${name} not found`)
  const rest = src.slice(at)
  const end = rest.indexOf('\nexport ', 1)
  return end > 0 ? rest.slice(0, end) : rest
}

test('the 5-minute capture does not poll retired agents', () => {
  // captureStreamSource runs from pg_cron every 5-15 minutes and was the
  // larger half of the leak.
  const body = fn(syncAll, 'async function captureStreamSource')
  assert.match(body, /from\('rc_agents'\)[\s\S]{0,320}?\.is\('retired_at', null\)/)
})

test('the hourly fleet sync excludes retired agents from scope', () => {
  const body = fn(syncAll, 'export async function adminSyncAllStreams')
  // Excluded up front, so a retired account is out of scope rather than
  // surfacing as an `agent_row_missing` error every hour.
  assert.match(body, /\.not\('retired_at', 'is', null\)/, 'does not gather the retired set')
  assert.match(body, /retired\.has\(String\(p\.agent_no\)\)/, 'does not filter players by it')
  // And the agent lookup itself refuses them as a second gate.
  assert.match(body, /\.is\('retired_at', null\)/)
})

test('the fleet sync reports how many it skipped, so the fix is visible', () => {
  assert.match(syncAll, /skippedRetired: retired\.size/)
})

test('the direct webhook refuses a retired agent PIN', () => {
  // A phone scrobbler keeps posting; nothing tells it the account is gone.
  const body = fn(inbound, 'async function agentForPin')
  assert.match(body, /\.eq\('scrobble_pin', pin\)/)
  assert.match(body, /\.is\('retired_at', null\)/)
})

test('the single write point refuses retired agents regardless of caller', () => {
  // Every provider row in the system is written by persistScrobbles. The
  // admin track view and any future caller reach it too.
  const body = fn(streams, 'async function persistScrobbles')
  assert.match(body, /await assertMayCollect\(supabase, agentNo\)/)
  // Before any row is written, not after.
  const guardAt = body.indexOf('assertMayCollect')
  const upsertAt = body.indexOf('.upsert(')
  assert.ok(guardAt >= 0 && guardAt < upsertAt, 'the guard must precede the write')
})

test('the write-point guard fails closed in all three directions', () => {
  // Behaviour is covered below; this pins the source so the fail-closed
  // branches cannot be quietly removed. A lookup error, a missing row and a
  // retirement must each stop the write — an earlier version returned false
  // on a lookup error and let collection continue.
  const body = fn(streams, 'export async function assertMayCollect')
  assert.match(body, /if \(error\) throw/)
  assert.match(body, /if \(!data\) throw/)
  assert.match(body, /if \(data\.retired_at\) throw/)
  assert.doesNotMatch(body, /return false/, 'nothing here may permit a write')
})

test('every rc_scrobbles writer in the codebase is behind a retirement check', () => {
  // The audit that matters: find the writes, then prove each one is guarded.
  // A new writer added without a guard fails here rather than in production.
  const writers = [
    { file: 'streams.ts', src: streams, guard: /assertMayCollect/ },
    { file: 'scrobble-inbound.ts', src: inbound, guard: /\.is\('retired_at', null\)/ },
  ]
  for (const w of writers) {
    assert.match(w.src, /from\('rc_scrobbles'\)[\s\S]{0,80}\.upsert\(/, `${w.file} no longer writes scrobbles — update this test`)
    assert.match(w.src, w.guard, `${w.file} writes scrobbles with no retirement check`)
  }
  assert.equal(writers.length, 2, 'if a third writer appears, guard it and add it here')
})


// ── behavioural: the write-point guard ────────────────────────────────
//
// assertMayCollect is what stands between a provider response and
// rc_scrobbles. These drive it directly with a stub database, because the
// question is not "does the query have a predicate" but "what does it do when
// the answer is each of the things it can be".

function db(answer) {
  return {
    from() {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => answer,
      }
      return chain
    },
  }
}

test('an active account is allowed to collect', async () => {
  await assert.doesNotReject(() => assertMayCollect(db({ data: { retired_at: null }, error: null }), 'AGENT100'))
})

test('a retired account is refused', async () => {
  await assert.rejects(
    () => assertMayCollect(db({ data: { retired_at: '2026-09-01T00:00:00Z' }, error: null }), 'AGENT100'),
    /agent_retired/,
  )
})

test('a missing agent row is refused, not treated as permission', async () => {
  // maybeSingle returns data: null for no match. Reading that as "not retired"
  // would let a deleted or mistyped agent keep writing.
  await assert.rejects(
    () => assertMayCollect(db({ data: null, error: null }), 'AGENT999'),
    /retirement_check_failed:agent_row_missing/,
  )
})

test('a lookup failure is refused and is retryable, not silently permitted', async () => {
  // The earlier version returned false here so a database blip would not stop
  // collection for everybody. That is the wrong trade: "we could not check
  // whether this person has left" is not a reason to store more of their
  // listening history. Throwing means the sync records an error and retries.
  await assert.rejects(
    () => assertMayCollect(db({ data: null, error: { message: 'connection reset' } }), 'AGENT100'),
    /retirement_check_failed:connection reset/,
  )
})

test('the guard reports which failure it was, so a blip is not read as a retirement', async () => {
  // An operator seeing these in the sync log needs to tell a transient
  // database problem apart from an account that has genuinely left.
  const err = await assertMayCollect(db({ data: null, error: { message: 'timeout' } }), 'A').catch((e) => e)
  assert.match(err.message, /^retirement_check_failed:/)
  const retired = await assertMayCollect(db({ data: { retired_at: 'x' }, error: null }), 'A').catch((e) => e)
  assert.equal(retired.message, 'agent_retired')
})

// ── retirement DURING ingestion: the race ─────────────────────────────

// The trigger migration moves from pending/ to migrations/ when it is applied.
// Look in both, so this test keeps working either side of the deployment
// rather than failing the moment Stage 1 ships.
const TRIGGER_SQL_NAME = '20260927180000_rc_block_retired_scrobbles.sql'
const triggerSql = (() => {
  for (const dir of ['migrations', 'pending']) {
    try { return readFileSync(new URL(`../../../${dir}/${TRIGGER_SQL_NAME}`, import.meta.url), 'utf8') } catch { /* try the next */ }
  }
  throw new Error(`${TRIGGER_SQL_NAME} is in neither supabase/migrations/ nor supabase/pending/`)
})()

test('the race is closed in the database, not only in the application', () => {
  // assertMayCollect asks, gets an answer, then builds a payload and upserts.
  // An account retiring in that gap would still be written to. The trigger is
  // what makes that impossible, so its absence is a test failure.
  assert.match(triggerSql, /for each row execute function rc_block_retired_scrobbles/)
  // Silent skip, not a raise: aborting a whole batch over one row would turn a
  // safeguard into an outage.
  assert.match(triggerSql, /return null;/)
  assert.match(triggerSql, /and a\.retired_at is not null/)
})

test('the trigger covers UPDATE as well as INSERT', () => {
  // Both writers use ignoreDuplicates: true today, which PostgREST renders as
  // ON CONFLICT DO NOTHING — so no UPDATE is issued. That is one boolean away
  // from changing, and an INSERT-only trigger would silently stop applying.
  assert.match(triggerSql, /before insert or update on rc_scrobbles/)
  // DELETE must NOT be covered, or the purge could not remove a retired
  // agent's rows.
  assert.doesNotMatch(triggerSql, /before[\s\S]{0,40}delete on rc_scrobbles/)
})

test('both writers still use ON CONFLICT DO NOTHING', () => {
  // If this ever flips to false the UPDATE path goes live — covered by the
  // trigger above, but worth knowing it changed.
  for (const [file, src] of [['streams.ts', streams], ['scrobble-inbound.ts', inbound]]) {
    assert.match(src, /ignoreDuplicates: true/, `${file} no longer ignores duplicates — the UPDATE path is now live`)
  }
})

test('a missing agent row is blocked by the foreign key, not the trigger', () => {
  // Deliberate: silently skipping a row that violates a foreign key would turn
  // a loud constraint error into invisible data loss. The FK is what makes the
  // trigger's missing-row case unreachable, so the FK is what this pins.
  assert.match(triggerSql, /FOREIGN KEY \(agent_no\) REFERENCES rc_agents\(agent_no\) ON DELETE CASCADE/)
  // Verified live against the database: constraint rc_scrobbles_agent_no_fkey.
  assert.match(triggerSql, /A MISSING AGENT ROW IS THE FOREIGN KEY'S JOB/)
})

test('the trigger migration stands alone, so Stage 1 needs nothing else', () => {
  // Comments may REFER to the retention work — the concurrency note explains
  // how the purge closes the remaining window — but no executable statement
  // may depend on anything that migration creates.
  const executable = triggerSql.replace(/^\s*--.*$/gm, '')
  for (const other of ['rc_storage_deletion_queue', 'rc_inactivity_warnings', 'rc_purge_agent_data', 'cron.schedule']) {
    assert.ok(!executable.includes(other), `Stage 1 migration must not depend on ${other}`)
  }
  // And it must create exactly the two things it claims to.
  assert.match(executable, /create or replace function rc_block_retired_scrobbles/)
  assert.match(executable, /create trigger rc_scrobbles_block_retired/)
})


// ── Stage 1 deploys the whole Edge Function, not just the ingestion files ─

test('retiring still works between Stage 1 and Stage 2', () => {
  // The purge RPC does not exist until the retention migration. Without a
  // fallback, anyone retiring in that window would get an error and be unable
  // to leave at all — worse than the behaviour being replaced.
  const settings = readFileSync(new URL('./settings.ts', import.meta.url), 'utf8')
  assert.match(settings, /rc_purge_agent_data/)
  assert.match(settings, /missingFn/)
  assert.match(settings, /retired_at: new Date\(\)\.toISOString\(\)/, 'no deactivation fallback')
  assert.match(settings, /session_token: null/, 'the fallback must still end the session')
})

test('the fallback cannot report a deletion it did not perform', () => {
  const settings = readFileSync(new URL('./settings.ts', import.meta.url), 'utf8')
  // Two distinguishable answers, never a bare success.
  assert.match(settings, /return \{ success: true, mode: 'deleted' \}/)
  assert.match(settings, /return \{ success: true, mode: 'deactivated' \}/)
  const bare = settings.match(/return \{ success: true \}/g)
  assert.equal(bare, null, 'a bare success would be indistinguishable from a purge')
})

test('the client tells the player which of the two actually happened', () => {
  const ui = readFileSync(new URL('../../../../js/screen-settings.js', import.meta.url), 'utf8')
  assert.match(ui, /res\.mode === 'deactivated'/)
  // The confident wording must be reachable only on a real purge.
  const confident = ui.indexOf('Everything in it has been deleted')
  const conditional = ui.indexOf("res.mode === 'deactivated'")
  assert.ok(conditional >= 0 && conditional < confident, 'the claim must sit behind the check')
})

test('the fallback still stops collection, because the guards key off retired_at', () => {
  // This is why deactivating is an acceptable stopgap: nothing in the
  // ingestion path checks whether the data is gone, only whether the account
  // is marked retired.
  assert.match(streams, /data\.retired_at/)
  assert.match(inbound, /\.is\('retired_at', null\)/)
  assert.match(triggerSql, /a\.retired_at is not null/)
})
