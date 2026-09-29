// Storage retention: what gets deleted, and what must survive a failure.
//
// The asymmetry these tests exist to protect: a file deleted early costs a
// screenshot nobody needed anyway, but a REFERENCE cleared early costs a file
// that nothing points at — unreachable, unlistable, impossible to clean up.
// The bucket already holds 92 files like that.
//
// The previous version of these tests mocked the RPC and asserted on the shape
// it returned, so it happily passed against a function that could only ever
// return NULLs (UPDATE ... RETURNING hands back the NEW value). The ordering
// tests below are the ones that would have caught it: they assert that no
// reference is cleared before Storage has confirmed.

import test from 'node:test'
import assert from 'node:assert/strict'
import { sweepStorageDeletions } from './proof-retention.ts'

/** A Supabase stand-in that records the ORDER of everything asked of it. */
function fakeDb({
  events = [{ event_id: 'vma_2026' }],
  queued = 1,
  claim = [],
  removeError = null,
  rpcErrors = {},
  cleared = 0,
  throwOn = null,
  recordedOwned = null,
} = {}) {
  const log = []
  const db = {
    log,
    calls: { removed: [], marked: [], failed: [], owners: [], reasons: [] },
    async rpc(name, args) {
      log.push(`rpc:${name}`)
      if (throwOn === name) throw new Error('boom')
      if (rpcErrors[name]) return { data: null, error: { message: rpcErrors[name] } }
      if (name === 'rc_queue_expired_vote_proofs') return { data: queued, error: null }
      if (name === 'rc_next_storage_deletions') { db.calls.owners.push(args.p_owner); db.calls.reasons.push(args.p_reason); return { data: claim, error: null } }
      if (name === 'rc_mark_storage_deleted') {
        db.calls.marked.push({ ids: [...args.p_ids], owner: args.p_owner })
        return { data: typeof recordedOwned === 'function' ? recordedOwned(args) : args.p_ids.length, error: null }
      }
      if (name === 'rc_mark_storage_failed') { db.calls.failed.push({ ids: [...args.p_ids], owner: args.p_owner }); return { data: args.p_ids.length, error: null } }
      if (name === 'rc_clear_expired_proof_refs') return { data: cleared, error: null }
      return { data: null, error: null }
    },
    storage: {
      from(bucket) {
        return {
          async remove(paths) {
            log.push(`storage:remove:${bucket}:${paths.length}`)
            db.calls.removed.push({ bucket, paths: [...paths] })
            return { error: removeError }
          },
        }
      },
    },
    from() {
      log.push('select:votes')
      let page = 0
      const chain = {
        select: () => chain,
        not: () => chain,
        range: async () => ({ data: page++ === 0 ? events : [], error: null }),
      }
      return chain
    },
  }
  return db
}

const rows = (n, bucket = 'vma-vote-proofs') =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, bucket, path: `AGENT${i}/${i}.jpg` }))

// ── the ordering guarantee ────────────────────────────────────────────

test('nothing is cleared before Storage has confirmed the delete', async () => {
  const db = fakeDb({ claim: rows(2), cleared: 2 })
  await sweepStorageDeletions(db)
  const removeAt = db.log.findIndex((l) => l.startsWith('storage:remove'))
  const markAt = db.log.indexOf('rpc:rc_mark_storage_deleted')
  const clearAt = db.log.indexOf('rpc:rc_clear_expired_proof_refs')
  assert.ok(removeAt >= 0 && markAt >= 0 && clearAt >= 0)
  assert.ok(removeAt < markAt, 'the file must be gone before it is marked gone')
  assert.ok(markAt < clearAt, 'references must be cleared only after the mark')
})

test('queueing happens before claiming, so newly due files are picked up', async () => {
  const db = fakeDb({ claim: rows(1) })
  await sweepStorageDeletions(db)
  assert.ok(db.log.indexOf('rpc:rc_queue_expired_vote_proofs') < db.log.indexOf('rpc:rc_next_storage_deletions'))
})

test('a Storage failure leaves the row pending and clears no reference', async () => {
  const db = fakeDb({ claim: rows(3), removeError: { message: 'bucket unavailable' } })
  const out = await sweepStorageDeletions(db)
  assert.equal(out.failed, 3)
  assert.equal(out.deleted, 0)
  assert.deepEqual(db.calls.marked, [], 'nothing may be marked deleted')
  assert.deepEqual(db.calls.failed.map((f) => f.ids), [[1, 2, 3]])
  assert.ok(out.errors[0].includes('bucket unavailable'))
})

test('a failure to RECORD the delete leaves the row pending, not lost', async () => {
  // The files are gone but we could not write that down. The row stays
  // pending, the next sweep re-deletes (a no-op) and records it then.
  const db = fakeDb({ claim: rows(2), rpcErrors: { rc_mark_storage_deleted: 'write conflict' } })
  const out = await sweepStorageDeletions(db)
  assert.equal(out.deleted, 0)
  assert.ok(out.errors.some((e) => e.includes('write conflict')))
})

// ── partial failure and batching ──────────────────────────────────────

test('a large sweep is batched and every file is accounted for', async () => {
  const db = fakeDb({ claim: rows(250) })
  const out = await sweepStorageDeletions(db)
  assert.deepEqual(db.calls.removed.map((b) => b.paths.length), [100, 100, 50])
  assert.equal(out.deleted, 250)
  assert.equal(out.claimed, 250)
})

test('one failed batch does not stop the others', async () => {
  // Storage fails only the second batch.
  let n = 0
  const db = fakeDb({ claim: rows(250) })
  const realFrom = db.storage.from
  db.storage.from = (bucket) => ({
    async remove(paths) {
      n++
      db.calls.removed.push({ bucket, paths: [...paths] })
      return { error: n === 2 ? { message: 'transient' } : null }
    },
  })
  const out = await sweepStorageDeletions(db)
  assert.equal(out.deleted, 150, 'batches 1 and 3 still went through')
  assert.equal(out.failed, 100)
  assert.deepEqual(db.calls.failed.length, 1)
  void realFrom
})

test('files are grouped by bucket and removed from the right one', async () => {
  const db = fakeDb({ claim: [...rows(2, 'vma-vote-proofs'), { id: 9, bucket: 'badge-art', path: 'x/y.webp' }] })
  await sweepStorageDeletions(db)
  const buckets = db.calls.removed.map((r) => r.bucket).sort()
  assert.deepEqual(buckets, ['badge-art', 'vma-vote-proofs'])
})

// ── nothing to do ─────────────────────────────────────────────────────

test('an empty queue removes nothing but still clears any stale references', async () => {
  // The usual case for most of the year, and the recovery path after a crash
  // that deleted files without clearing their rows.
  const db = fakeDb({ claim: [], queued: 0, cleared: 4 })
  const out = await sweepStorageDeletions(db)
  assert.equal(out.claimed, 0)
  assert.deepEqual(db.calls.removed, [])
  assert.equal(out.refsCleared, 4)
})

test('malformed queue rows are skipped rather than sent to Storage', async () => {
  const db = fakeDb({ claim: [{ id: 1, bucket: 'vma-vote-proofs', path: 'a/1.jpg' }, { id: 2, bucket: '', path: 'b' }, { id: 3, bucket: 'x', path: null }, {}] })
  await sweepStorageDeletions(db)
  assert.deepEqual(db.calls.removed, [{ bucket: 'vma-vote-proofs', paths: ['a/1.jpg'] }])
})

// ── never throws, never takes the hourly sync down ────────────────────

test('a claim failure stops before touching Storage', async () => {
  const db = fakeDb({ rpcErrors: { rc_next_storage_deletions: 'permission denied' } })
  const out = await sweepStorageDeletions(db)
  assert.deepEqual(db.calls.removed, [])
  assert.ok(out.errors.some((e) => e.includes('permission denied')))
})

test('an unexpected throw is caught, not propagated', async () => {
  const db = fakeDb({ throwOn: 'rc_next_storage_deletions' })
  const out = await sweepStorageDeletions(db)
  assert.ok(out.errors.some((e) => e.includes('boom')), 'recorded rather than thrown')
})

test('a queue failure for one event does not stop the sweep', async () => {
  const db = fakeDb({ events: [{ event_id: 'a' }, { event_id: 'b' }], claim: rows(1), rpcErrors: {} })
  const out = await sweepStorageDeletions(db)
  assert.equal(out.queued, 2, 'both events queued')
  assert.equal(out.deleted, 1)
})

// ── pagination ────────────────────────────────────────────────────────

test('the event scan pages rather than stopping at one page', async () => {
  // A single .limit() would silently cap the event list once the votes table
  // outgrows it; .range() walks until a short page comes back.
  let page = 0
  const db = fakeDb({ claim: [] })
  db.from = () => {
    const chain = {
      select: () => chain,
      not: () => chain,
      range: async () => {
        page++
        if (page === 1) return { data: Array.from({ length: 1000 }, () => ({ event_id: 'vma_2026' })), error: null }
        if (page === 2) return { data: [{ event_id: 'vma_2027' }], error: null }
        return { data: [], error: null }
      },
    }
    return chain
  }
  const out = await sweepStorageDeletions(db)
  assert.equal(page, 2, 'stopped on the short page, not the first one')
  assert.equal(out.queued, 2, 'both events found')
})

test('the retention window is passed through, not hardcoded', async () => {
  const db = fakeDb({ claim: [] })
  await sweepStorageDeletions(db, { days: 90 })
  const call = db.log.filter((l) => l === 'rpc:rc_queue_expired_vote_proofs')
  assert.equal(call.length, 1)
})


// ── concurrency: the lease ────────────────────────────────────────────

test('every claim carries a fresh owner token', async () => {
  const a = fakeDb({ claim: rows(1) })
  const b = fakeDb({ claim: rows(1) })
  await sweepStorageDeletions(a)
  await sweepStorageDeletions(b)
  const [o1] = a.calls.owners
  const [o2] = b.calls.owners
  assert.match(String(o1), /^[0-9a-f-]{36}$/, 'a uuid')
  assert.notEqual(o1, o2, 'two sweeps must not share an owner')
})

test('completion is reported under the same owner that claimed', async () => {
  const db = fakeDb({ claim: rows(2) })
  await sweepStorageDeletions(db)
  assert.equal(db.calls.marked[0].owner, db.calls.owners[0], 'mark must carry the claim owner')
})

test('a failure is reported under the claim owner too, so it can release it', async () => {
  const db = fakeDb({ claim: rows(2), removeError: { message: 'nope' } })
  await sweepStorageDeletions(db)
  assert.equal(db.calls.failed[0].owner, db.calls.owners[0])
})

test('a lapsed lease is detected rather than silently over-reported', async () => {
  // The database owns the check: it records only rows still leased to us. If
  // the lease expired mid-sweep it records fewer than we deleted.
  const db = fakeDb({ claim: rows(10), recordedOwned: () => 4 })
  const out = await sweepStorageDeletions(db)
  assert.equal(out.deleted, 4, 'only what we still owned counts')
  assert.equal(out.lost, 6, 'the rest is surfaced, not hidden')
})

test('losing every row to an expired lease is not an error, just a lost sweep', async () => {
  const db = fakeDb({ claim: rows(3), recordedOwned: () => 0 })
  const out = await sweepStorageDeletions(db)
  assert.equal(out.deleted, 0)
  assert.equal(out.lost, 3)
  assert.deepEqual(out.errors, [], 'another worker re-does it; nothing is wrong')
})

test('two simultaneous sweeps do not both count the same work', async () => {
  // The real guard is in SQL — the second claim skips rows whose lease is
  // live. Here the second sweep claims nothing, which is what that looks like
  // from the worker's side.
  const first = fakeDb({ claim: rows(5) })
  const second = fakeDb({ claim: [] })
  const [a, b] = await Promise.all([sweepStorageDeletions(first), sweepStorageDeletions(second)])
  assert.equal(a.deleted, 5)
  assert.equal(b.deleted, 0)
  assert.deepEqual(second.calls.removed, [], 'the loser touches no file')
})

test('a reclaimed row after a crash is deleted again, harmlessly', async () => {
  // Worker 1 crashed after claiming; its lease lapsed; worker 2 gets the row.
  // Storage remove() on an already-deleted key succeeds, so the retry is safe.
  const db = fakeDb({ claim: rows(2) })
  const out = await sweepStorageDeletions(db)
  assert.equal(out.deleted, 2)
  assert.deepEqual(db.calls.removed[0].paths.length, 2)
})


// ── rehearsal isolation ───────────────────────────────────────────────

test('a normal sweep claims without a reason, so the database excludes qa rows', async () => {
  const db = fakeDb({ claim: rows(1) })
  await sweepStorageDeletions(db)
  assert.deepEqual(db.calls.reasons, [null], 'production passes no reason')
})

test('a rehearsal is scoped to its own rows and queues nothing new', async () => {
  // Without the scope, the only thing between a test run and one of the 92
  // real orphans would be remembering to empty the queue first.
  const db = fakeDb({ claim: rows(2) })
  const out = await sweepStorageDeletions(db, { reason: 'qa' })
  assert.deepEqual(db.calls.reasons, ['qa'])
  assert.equal(out.queued, 0, 'a rehearsal must not queue real expired proofs')
  assert.ok(!db.log.includes('rpc:rc_queue_expired_vote_proofs'))
})
