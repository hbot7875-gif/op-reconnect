-- Fleet stream sync from pg_cron, in six slices.
--
-- adminSyncAllStreams (rollups + stream XP for every agent) was triggered by
-- a GitHub Actions schedule, '0 * * * *'. GitHub fired it only every 4-8
-- hours (scheduled workflows are best-effort), and 9 of the 30 runs from
-- Nov 2-10 died with WORKER_RESOURCE_LIMIT (HTTP 546): one invocation for all
-- 142 agents is more than one Edge Function worker can do. A reopened day
-- (late plays) waited for that sync or for its player to open the app.
--
-- Now each slice of agents (a stable hash of agent_no, see sliceOf) is its own invocation,
-- every hour, two minutes apart, clear of the capture jobs (:02/:07 etc.).
-- The GitHub workflow stays for manual runs only.
--
-- Same invoker shape and Vault token as rc_invoke_stream_capture
-- (20260925130000). Not idempotent as a whole (cron.schedule), so it lives
-- apart from any schema change.

drop table if exists pg_temp.fleet_other_jobs;
create temp table fleet_other_jobs as
  select jobname, schedule, command, active from cron.job
   where jobname not like 'rc-fleet-sync-%' and jobname <> 'rc-capture-listenbrainz-deep';

create or replace function public.rc_invoke_fleet_sync(p_slice int, p_slices int)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $$
declare
  cron_token text;
  request_id bigint;
begin
  if p_slices < 1 or p_slices > 24 or p_slice < 0 or p_slice >= p_slices then
    raise exception 'bad fleet sync slice %/%', p_slice, p_slices;
  end if;
  select decrypted_secret into cron_token
    from vault.decrypted_secrets
   where name = 'rc_stream_sync_token'
   order by created_at desc
   limit 1;
  if coalesce(cron_token, '') = '' then
    raise warning 'rc_stream_sync_token is missing from Vault; fleet sync skipped';
    return null;
  end if;
  select net.http_post(
    url := 'https://lcvmwlioqpyaprxicdfl.supabase.co/functions/v1/op-reconnect',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-region', 'ap-northeast-2'),
    body := jsonb_build_object('action', 'cronSyncAllStreams', 'cronToken', cron_token,
                               'slice', p_slice, 'slices', p_slices),
    timeout_milliseconds := 150000
  ) into request_id;
  return request_id;
end $$;

revoke all on function public.rc_invoke_fleet_sync(int, int) from public, anon, authenticated;
grant execute on function public.rc_invoke_fleet_sync(int, int) to service_role;

-- Once a day, ListenBrainz capture re-reads a week instead of two days, for
-- the few Last.fm-importer batches that arrive more than 48 h late.
create or replace function public.rc_invoke_stream_capture_deep()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
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
    raise warning 'rc_stream_sync_token is missing from Vault; deep capture skipped';
    return null;
  end if;
  select net.http_post(
    url := 'https://lcvmwlioqpyaprxicdfl.supabase.co/functions/v1/op-reconnect',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-region', 'ap-northeast-2'),
    body := jsonb_build_object('action', 'adminCaptureStreamSources', 'source', 'listenbrainz',
                               'deep', true, 'cronToken', cron_token),
    timeout_milliseconds := 150000
  ) into request_id;
  return request_id;
end $$;

revoke all on function public.rc_invoke_stream_capture_deep() from public, anon, authenticated;
grant execute on function public.rc_invoke_stream_capture_deep() to service_role;

do $$
declare j record;
begin
  for j in select jobid from cron.job
            where jobname like 'rc-fleet-sync-%' or jobname = 'rc-capture-listenbrainz-deep' loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

select cron.schedule('rc-fleet-sync-0', '40 * * * *', $$select rc_invoke_fleet_sync(0, 6)$$);
select cron.schedule('rc-fleet-sync-1', '42 * * * *', $$select rc_invoke_fleet_sync(1, 6)$$);
select cron.schedule('rc-fleet-sync-2', '44 * * * *', $$select rc_invoke_fleet_sync(2, 6)$$);
select cron.schedule('rc-fleet-sync-3', '46 * * * *', $$select rc_invoke_fleet_sync(3, 6)$$);
select cron.schedule('rc-fleet-sync-4', '48 * * * *', $$select rc_invoke_fleet_sync(4, 6)$$);
select cron.schedule('rc-fleet-sync-5', '50 * * * *', $$select rc_invoke_fleet_sync(5, 6)$$);
-- 19:14 UTC = 04:14 KST, between the :07 and :22 regular LB runs.
select cron.schedule('rc-capture-listenbrainz-deep', '14 19 * * *', $$select rc_invoke_stream_capture_deep()$$);

-- ── Post-conditions ───────────────────────────────────────────────────
do $$
declare n integer;
begin
  select count(*) into n from cron.job where jobname like 'rc-fleet-sync-%' and active;
  if n <> 6 then raise exception 'expected 6 active rc-fleet-sync jobs, found %', n; end if;
  select count(*) into n from cron.job where jobname = 'rc-capture-listenbrainz-deep' and active;
  if n <> 1 then raise exception 'expected 1 active rc-capture-listenbrainz-deep job, found %', n; end if;
  select count(*) into n from (
    (select jobname, schedule, command, active from cron.job
      where jobname not like 'rc-fleet-sync-%' and jobname <> 'rc-capture-listenbrainz-deep'
     except all select * from fleet_other_jobs)
    union all
    (select * from fleet_other_jobs
     except all select jobname, schedule, command, active from cron.job
      where jobname not like 'rc-fleet-sync-%' and jobname <> 'rc-capture-listenbrainz-deep')
  ) d;
  if n <> 0 then raise exception 'other cron jobs changed during this migration (% rows differ)', n; end if;
end $$;

drop table if exists pg_temp.fleet_other_jobs;
