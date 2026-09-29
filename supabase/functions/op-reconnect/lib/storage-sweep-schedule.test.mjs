// The Storage deletion queue had no drain.
//
// sweepStorageDeletions was reachable only from adminSyncAllStreams, and
// nothing has called that on a schedule since the fleet sync stopped running
// hourly. So rc-queue-expired-vote-proofs queued expired VMA proofs at 03:40
// every day and nothing ever deleted them; on 2026-09-28 the queue held 50
// rows, all pending, none ever attempted.
//
// These guard the two properties that make the new schedule safe to add: it
// must not weaken the lease/ownership machinery, and it must not become a way
// to reach the 'qa' rehearsal rows.

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

const migration = readMigration('20260928130000_rc_storage_sweep_schedule.sql')
const indexSrc = read('../index.ts')
const reminders = read('../../../migrations/20260928060000_rc_privacy_retention.sql')

/** Executable statements only. */
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

test('the migration only adds an invoker and a schedule', () => {
  const s = statements(migration).join('\n')
  // The lease and completion machinery must not be redefined here.
  for (const fn of ['rc_next_storage_deletions', 'rc_mark_storage_deleted',
    'rc_mark_storage_failed', 'rc_clear_expired_proof_refs', 'rc_queue_expired_vote_proofs',
    'rc_storage_lease_seconds', 'rc_storage_queue_max_attempts']) {
    assert.ok(!s.includes(fn), `${fn} must not be touched by the scheduling migration`)
  }
  assert.deepEqual(statements(migration).filter((x) => /create table|alter table|drop /i.test(x)), [])
  // Exactly one function is created, and it is the invoker.
  const fns = statements(migration).filter((x) => /create or replace function/i.test(x))
  assert.equal(fns.length, 1)
  assert.match(fns[0], /rc_invoke_storage_sweep/)
})

test('the qa exclusion is left entirely alone', () => {
  const s = statements(migration).join('\n')
  assert.ok(!/'qa'/.test(s), 'the scheduling migration must not mention qa at all')
  // The cron sends no reason, so p_reason stays null and the claim keeps its
  // `q.reason <> 'qa'` branch.
  assert.match(migration, /'action', 'cronStorageSweep', 'cronToken', cron_token/)
  assert.ok(!/'reason'/.test(migration), 'the cron must not pass a reason')
})

test('the parked orphan reconciliation is not touched', () => {
  const s = statements(migration).join('\n')
  assert.ok(!s.includes('orphan_reconciliation'),
    'the reason/exclusion decision belongs to that separate review')
  assert.ok(!s.includes('rc_reconcile'), 'must not reference the orphan migration')
})

test('the Edge action forwards no caller-controlled options', () => {
  const line = indexSrc.split('\n').find((l) => l.includes('cronStorageSweep:'))
  assert.ok(line, 'the cronStorageSweep action is missing')
  assert.match(line, /auth: 'cron'/, 'the sweep must require the cron token')
  // (sb) not (sb, p): forwarding params would expose days/limit/reason, and
  // reason is what keeps the qa rows unreachable.
  assert.match(line, /handler: \(sb\) => sweepStorageDeletions\(sb\)/,
    'the handler must not forward params')
  assert.match(indexSrc, /import \{ sweepStorageDeletions \} from '\.\/lib\/proof-retention\.ts'/)
})

test('the invoker matches the established cron pattern', () => {
  // Same Vault secret, same missing-token behaviour as the reminder invoker,
  // so there is one thing to rotate and one failure mode to understand.
  for (const needle of ['vault.decrypted_secrets', 'rc_stream_sync_token', 'net.http_post']) {
    assert.ok(migration.includes(needle), `invoker is missing ${needle}`)
    assert.ok(reminders.includes(needle), `reminder invoker no longer uses ${needle}`)
  }
  assert.match(migration, /raise warning 'rc_stream_sync_token is missing from Vault/)
  assert.match(migration, /security definer/)
  assert.match(migration, /set search_path to 'public', 'pg_temp'/)
  // SECURITY DEFINER + a Vault read must never be callable from a browser role.
  assert.match(migration, /revoke all on function public\.rc_invoke_storage_sweep\(\) from public, anon, authenticated;/)
  assert.match(migration, /grant execute on function public\.rc_invoke_storage_sweep\(\) to service_role;/)
  assert.match(reminders, /revoke all on function rc_invoke_inactive_reminders\(\) from public, anon, authenticated;/)
})

test('it schedules exactly one job and asserts the resulting count', () => {
  const s = statements(migration)
  const scheduled = s.filter((x) => /cron\.schedule\(/.test(x))
  assert.equal(scheduled.length, 1, 'expected exactly one cron.schedule')
  assert.match(scheduled[0], /'rc-storage-sweep', '25 \* \* \* \*'/)
  // Unschedule-then-schedule, so re-running is safe.
  assert.ok(s.some((x) => /cron\.unschedule\('rc-storage-sweep'\)/.test(x)))
  // And it refuses to leave the schedule set in an unexpected state.
  assert.match(migration, /expected 8 cron jobs after this migration/)
  assert.match(migration, /expected exactly 1 active rc-storage-sweep job/)
})

test('the sweep it calls still uses a lease it owns', () => {
  // Not changed by this work, but the whole reason the schedule is safe to add.
  const sweep = read('./proof-retention.ts')
  assert.match(sweep, /const owner = crypto\.randomUUID\(\)/)
  assert.match(sweep, /rc_next_storage_deletions', \{ p_limit: limit, p_owner: owner/)
  assert.match(sweep, /rc_mark_storage_deleted', \{ p_ids: ids, p_owner: owner \}/)
  assert.match(sweep, /rc_mark_storage_failed', \{ p_ids: ids, p_error: error\.message, p_owner: owner \}/)
})
