-- Make the Storage deletion queue actually drain.
--
-- rc_storage_deletion_queue has been filled since Stage 2A and emptied by
-- nothing. sweepStorageDeletions is reachable from exactly one place in the
-- Edge Function -- adminSyncAllStreams -- and no cron job has called that since
-- the fleet sync stopped running hourly (commit 3e9f7fb). The three rc-capture-*
-- jobs call rc_invoke_stream_capture, which reaches adminCaptureStreamSources,
-- a different function entirely.
--
-- The consequence: rc-queue-expired-vote-proofs has been queueing expired VMA
-- proof screenshots at 03:40 every day and nothing has ever deleted them. The
-- 30-day deletion promise in the Privacy Policy was nominal. As of
-- 2026-09-28 11:04 the queue holds 50 rows (reason 'agent_purged', from the
-- previously-retired backfill) and every one of them is still pending.
--
-- This adds the missing half: an invoker function in the shape of
-- rc_invoke_inactive_reminders, and one hourly schedule.
--
-- What it deliberately does NOT change:
--   * rc_next_storage_deletions, rc_mark_storage_deleted, rc_mark_storage_failed
--     -- the lease, ownership and attempt-limit protections are untouched.
--   * the 'qa' exclusion. The cron passes no reason, so p_reason is null, so
--     the claim predicate stays `q.reason <> 'qa'` and rehearsal rows remain
--     unreachable to it.
--   * the parked 92-orphan reconciliation. It stays in supabase/pending/ and
--     has queued nothing. Note for whoever reviews it: its rows would use
--     reason 'orphan_reconciliation', which a normal sweep DOES claim, so once
--     this schedule exists, applying that migration means its files are deleted
--     within the hour. That decision is explicitly deferred to that review.

-- ── The invoker ───────────────────────────────────────────────────────
-- Identical in shape to rc_invoke_inactive_reminders, including the Vault
-- lookup and the missing-token warning. pg_cron cannot reach Storage; only the
-- Edge Function can, which is why this is an http_post and not a plain call.
create or replace function public.rc_invoke_storage_sweep()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  cron_token text;
  request_id bigint;
begin
  select decrypted_secret into cron_token
    from vault.decrypted_secrets
   where name = 'rc_stream_sync_token'
   order by created_at desc
   limit 1;

  if coalesce(cron_token, '') = '' then
    raise warning 'rc_stream_sync_token is missing from Vault; storage sweep skipped';
    return null;
  end if;

  select net.http_post(
    url := 'https://lcvmwlioqpyaprxicdfl.supabase.co/functions/v1/op-reconnect',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-region', 'ap-northeast-2'),
    body := jsonb_build_object('action', 'cronStorageSweep', 'cronToken', cron_token)
  ) into request_id;
  return request_id;
end $$;

comment on function public.rc_invoke_storage_sweep() is
  'Hourly: asks the Edge Function to drain rc_storage_deletion_queue. pg_cron cannot reach Storage.';

-- Same lockdown as rc_invoke_inactive_reminders. It is SECURITY DEFINER and
-- reads a Vault secret, so it must not be callable by a browser-side role.
revoke all on function public.rc_invoke_storage_sweep() from public, anon, authenticated;
grant execute on function public.rc_invoke_storage_sweep() to service_role;

-- ── The schedule ──────────────────────────────────────────────────────
-- :25 past the hour, which is after rc-queue-expired-vote-proofs at 03:40 has
-- had a full run to queue the day's expiries, and clear of the capture jobs at
-- :02/:07/:17/:22/:32/:37/:47/:52 and every fifth minute.
--
-- Hourly rather than daily because the queue is also filled by account purges,
-- which happen whenever somebody retires -- an hour is the longest a deleted
-- person's proof screenshot should sit in Storage after their data is gone.
-- The sweep is idempotent and costs one indexed query against an empty queue.
do $$
begin
  perform cron.unschedule('rc-storage-sweep');
exception when others then
  null;  -- not scheduled yet, which is the normal case
end $$;

select cron.schedule('rc-storage-sweep', '25 * * * *', $$select rc_invoke_storage_sweep()$$);

-- ── Post-conditions ───────────────────────────────────────────────────
do $$
declare n integer;
begin
  select count(*) into n from cron.job where jobname = 'rc-storage-sweep' and active;
  if n <> 1 then
    raise exception 'expected exactly 1 active rc-storage-sweep job, found %', n;
  end if;

  select count(*) into n from cron.job;
  if n <> 8 then
    raise exception 'expected 8 cron jobs after this migration, found % -- check what else changed', n;
  end if;
end $$;
