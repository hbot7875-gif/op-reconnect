# Testing the storage deletion queue before it touches a real screenshot

The delete-then-mark path has never run against live Storage. Everything proven
so far is either a pure unit test with a mocked Supabase client, or a read-only
query. That leaves the one thing that actually matters untested: whether
`storage.remove()` behaves the way the queue assumes it does.

This is the plan for finding that out with files nobody cares about, before any
of the 92 real orphans are queued.

**Nothing here has been run.** It needs the retention migration applied first,
and it needs approval.

---

## What is actually being tested

Four assumptions the design rests on, none of them verified against the real
Storage API:

1. `remove()` on a key that is already gone **succeeds** rather than erroring.
   The whole retry story depends on this — if it errors, every re-delivery
   after a crash burns an attempt and eventually parks the row at
   `attempts >= 8`.
2. `remove()` reports a **partial** failure in a way the worker notices. It
   takes an array; if it can fail for one key and succeed for others while
   returning no error, the worker will mark rows deleted whose files remain.
3. A lease genuinely prevents a second worker from claiming the same rows,
   over PostgREST, with real timing.
4. Reference clearing only ever touches paths the queue has confirmed.

Assumption 2 is the one worth worrying about. If it turns out `remove()`
silently partially-succeeds, the fix is to verify each key afterwards rather
than trusting the absence of an error — and it is much better to learn that on
a throwaway file.

---

## Setup — disposable files only

Use a prefix that no application code can ever produce. Vote proofs are written
as `AGENT<nnn>/<epoch-ms>.jpg`, so anything under `_qa/` is unreachable by the
game and obvious to a human reading the bucket.

```
_qa/deletion-test/a.txt
_qa/deletion-test/b.txt
_qa/deletion-test/c.txt
_qa/deletion-test/missing.txt   ← upload, then delete by hand before the run
```

Upload four small text files to `vma-vote-proofs` under that prefix. They are
not images and no `rc_vma_votes` row will ever reference them, which is the
point: if the reference-clearing step touches anything at all, it is a bug.

Queue them with `reason = 'qa'`. That word is load-bearing: the claim function
excludes `'qa'` rows from any normal sweep and restricts a `'qa'`-scoped sweep
to nothing else, so the hourly job cannot wander into a rehearsal and a
rehearsal cannot reach one of the 92 real orphans. Reference clearing skips
them too, so `rc_vma_votes` is never touched by a test.

```sql
insert into rc_storage_deletion_queue (bucket, path, reason)
values ('vma-vote-proofs', '_qa/deletion-test/a.txt', 'qa'),
       ('vma-vote-proofs', '_qa/deletion-test/b.txt', 'qa'),
       ('vma-vote-proofs', '_qa/deletion-test/c.txt', 'qa'),
       ('vma-vote-proofs', '_qa/deletion-test/missing.txt', 'qa');
```

---

## The cases

### 1. Ordinary deletion

Run one sweep **scoped to the rehearsal** — never an unscoped one:

```sql
-- what the worker will do, via the Edge Function; scoped by reason
-- sweepStorageDeletions(supabase, { reason: 'qa' })
```

Expect `claimed: 4`, `deleted: 4`, `lost: 0`, `refsCleared: 0`, `queued: 0`.

Then confirm, which is the part that cannot be skipped:

```sql
select path, deleted_at is not null as marked from rc_storage_deletion_queue where reason = 'qa';
select name from storage.objects where bucket_id = 'vma-vote-proofs' and name like '_qa/%';
```

Every row marked, **and** no object left. A row marked whose file is still
there is assumption 2 failing, and the run stops here.

### 2. Already-missing file

`missing.txt` was deleted by hand before the run. It is in the same batch as
the other three. If the whole batch came back deleted, assumption 1 holds. If
the batch errored because of one absent key, the worker is wrong to batch and
needs per-key handling — note it and stop.

### 3. Storage failure and retry

Re-queue three fresh files, then make the sweep fail. Easiest without touching
code: revoke the service role's access to the bucket for the duration, or point
the worker at a bucket name that does not exist by queueing
`('no-such-bucket', '_qa/x.txt', 'qa')`.

Expect: `failed` counted, `deleted: 0`, `attempts` incremented, `last_error`
populated, `deleted_at` still null, and **no reference cleared**. Restore
access, sweep again, expect it to succeed and `attempts` to stay where it was.

Then queue one file nine times over (or set `attempts = 8` directly) and
confirm the claim skips it — a permanently broken row must park, visibly,
rather than being retried for ever.

### 4. Concurrency

Queue 200 disposable files. Fire two sweeps at once:

```bash
curl -s -X POST "$API" -d '{"action":"adminSyncAllStreams","cronToken":"..."}' &
curl -s -X POST "$API" -d '{"action":"adminSyncAllStreams","cronToken":"..."}' &
wait
```

Expect the two `proofSweep.claimed` counts to **sum to 200 with no overlap**,
and every row to carry exactly one `lease_owner`. If both report 200, the lease
is not holding and nothing else in this plan matters.

### 5. Lease expiry and crash recovery

Claim rows, then do not complete them — kill the sweep, or simply claim through
SQL with a short lease:

```sql
select * from rc_next_storage_deletions(5, gen_random_uuid());
update rc_storage_deletion_queue set lease_expires_at = now() - interval '1 minute'
 where reason = 'qa' and deleted_at is null;
```

A sweep run now must reclaim them. Before the expiry, a sweep must **not**.

Then test the stale worker directly: hold an owner id, let its lease lapse, and
call completion with it.

```sql
select rc_mark_storage_deleted(array[<id>], '<the lapsed owner>'::uuid);
```

Must return `0`. A non-zero answer means a worker that fell behind can mark
work it no longer owns.

### 6. Reference clearing stays away

Throughout all of the above, `rc_vma_votes` must be untouched:

```sql
select count(*) from rc_vma_votes where proof_path is not null;   -- 1852, unchanged
```

---

## Cleanup

```sql
delete from rc_storage_deletion_queue where reason = 'qa';
```

and remove anything left under `_qa/`.

---

## Only then

If every case passes, the orphan reconciliation can be approved — and even then
it is worth queueing a handful first rather than all 92. The 32 whose agents no
longer exist are the safest starting set: nobody can be affected by their loss,
because the accounts they belonged to are already gone.

The 58 under active agents should go last, and only after someone has opened
two or three of them and confirmed they are what the classification says they
are: retry leftovers, not something the game still needs.
