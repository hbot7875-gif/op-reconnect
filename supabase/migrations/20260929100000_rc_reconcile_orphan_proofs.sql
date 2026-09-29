-- One-time reconciliation: 92 vote-proof screenshots nothing points at.
--
-- APPLIED IN PRODUCTION. Recorded in supabase_migrations.schema_migrations;
-- verified read-only on 2026-09-29. Do not re-run it: this file is committed as
-- applied history so a clean checkout matches production, not as pending work.
--
-- Kept separate from both the retention migration and the retired-account
-- backfill, because each deletes a different thing and each deserved its own
-- decision. All three were taken. 20260928060000 was applied first; this file
-- queues into the table that one creates.
--
--
-- WHERE THEY CAME FROM
--
-- rc_purge_agent_data deletes rc_vma_votes rows but cannot reach Storage, so
-- every agent ever purged left their screenshots behind. Rejected and
-- duplicate uploads that never produced a vote row account for the rest.
--
-- Reconciled read-only on 27 Sep 2026:
--
--   objects in bucket              1,944
--   referenced by a live vote      1,852
--   unreferenced                      92   (24 MB)
--   references with no file            0
--
-- The 92, by whose folder they sit in:
--
--   agent no longer exists (purged)    32   19 Aug – 2 Sep
--   agent retired, not yet purged       2   2 Sep
--   agent still active                 58   19 Aug – 25 Sep   (26 agents, max 21)
--
-- The 58 under active agents are the ones worth pausing on. They are consistent
-- with upload retries after a duplicate-screenshot rejection: no vote row was
-- ever written, so nothing points at the file. Verified: rc_vma_votes.proof_path
-- is the ONLY column in the entire schema that stores a proof path, so an
-- unreferenced object is unreachable from the application by any route.
--
-- The 2 under retired agents will NOT be caught by the backfill purge:
-- rc_queue_agent_proof_files reads rc_vma_votes, and these have no vote row.
-- They need this migration specifically.
--
--
-- WHAT THIS DELETES WHEN APPLIED: nothing.
-- It queues paths. The Edge Function sweep is what talks to Storage, on its
-- next hourly run. Until then every file is still there.

begin;

do $$
begin
  if to_regclass('public.rc_storage_deletion_queue') is null then
    raise exception 'rc_storage_deletion_queue is missing — apply 20260928060000_rc_privacy_retention.sql first';
  end if;
end $$;


-- Recomputed at run time rather than baked in as a list of 92 paths. A file
-- that has gained a reference since this was written is skipped; a new orphan
-- created since is caught. The read-only figures above are the review; this is
-- the truth at the moment it runs.
create or replace function rc_queue_orphan_vote_proofs(
  p_min_age_hours integer default 48,
  p_limit         integer default 500
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  insert into rc_storage_deletion_queue (bucket, path, reason)
  select 'vma-vote-proofs', o.name, 'orphan_reconciliation'
    from storage.objects o
   where o.bucket_id = 'vma-vote-proofs'
     -- An upload in flight has no vote row yet either. Anything younger than
     -- the floor is left alone so this can never race a live submission.
     and o.created_at < now() - make_interval(hours => p_min_age_hours)
     and not exists (
       select 1 from rc_vma_votes v where v.proof_path = o.name
     )
   order by o.created_at
   limit p_limit
  on conflict (bucket, path) do nothing;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function rc_queue_orphan_vote_proofs(integer, integer) from public, anon, authenticated;
grant execute on function rc_queue_orphan_vote_proofs(integer, integer) to service_role;


-- Refuse to run if the bucket no longer looks like the one that was reviewed.
-- 92 is what the owner approved; 900 is not, and would mean something else has
-- gone wrong that queueing files would only make worse.
do $$
declare n integer;
begin
  select count(*) into n
    from storage.objects o
   where o.bucket_id = 'vma-vote-proofs'
     and o.created_at < now() - interval '48 hours'
     and not exists (select 1 from rc_vma_votes v where v.proof_path = o.name);

  if n > 150 then
    raise exception 'found % unreferenced proofs, expected about 92 — re-run the reconciliation and have this re-approved', n;
  end if;
  raise notice 'queueing % unreferenced vote proofs', n;
end $$;

select rc_queue_orphan_vote_proofs(48, 500);

commit;

-- ROLLBACK
--
-- Before the Edge Function sweep next runs, this is fully reversible — the
-- files are untouched and the queue rows can simply be removed:
--
--   delete from rc_storage_deletion_queue
--    where reason = 'orphan_reconciliation' and deleted_at is null;
--
-- After the sweep has run, the files are gone and there is no rollback. If
-- that matters, take a Storage backup of the bucket first, or run the sweep
-- with the queue emptied of everything except a handful of the 32 whose agents
-- are already deleted, and confirm the result before queueing the rest.
