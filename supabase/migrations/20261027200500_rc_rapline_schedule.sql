-- Rap Line to 1B: once-a-day check, refresh every 3 days.
--
-- The job runs daily at 12:20 UTC but only calls the Edge Function when no
-- successful refresh happened in the last 69 hours, so a normal cycle is one
-- fetch every 3 days, and a failed day is retried the next day instead of
-- waiting another three. The Edge Function re-checks the request budget
-- (rc_rapline_requests) before every API call; this is just the cheap gate.
--
-- Same invoker shape and Vault token as rc_invoke_run_ami_sweep
-- (20261018120500). Not idempotent as a whole (cron.schedule), so it lives
-- apart from the schema migration, same as that one.

drop table if exists pg_temp.rapline_other_jobs;
create temp table rapline_other_jobs as
  select jobname, schedule, command, active from cron.job where jobname <> 'rc-rapline-refresh';

create or replace function public.rc_invoke_rapline_refresh()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  cron_token text;
  request_id bigint;
begin
  if exists (select 1 from rc_rapline_requests
              where ok and requested_at > now() - interval '69 hours') then
    return null;
  end if;

  select decrypted_secret into cron_token
    from vault.decrypted_secrets
   where name = 'rc_stream_sync_token'
   order by created_at desc
   limit 1;
  if coalesce(cron_token, '') = '' then
    raise warning 'rc_stream_sync_token is missing from Vault; Rap Line refresh skipped';
    return null;
  end if;
  select net.http_post(
    url := 'https://lcvmwlioqpyaprxicdfl.supabase.co/functions/v1/op-reconnect',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-region', 'ap-northeast-2'),
    body := jsonb_build_object('action', 'cronRaplineRefresh', 'cronToken', cron_token),
    timeout_milliseconds := 60000
  ) into request_id;
  return request_id;
end $$;

comment on function public.rc_invoke_rapline_refresh() is
  'Daily: asks the Edge Function to refresh Rap Line to 1B totals when the last success is 69h+ old.';

revoke all on function public.rc_invoke_rapline_refresh() from public, anon, authenticated;
grant execute on function public.rc_invoke_rapline_refresh() to service_role;

do $$
begin
  perform cron.unschedule('rc-rapline-refresh');
exception when others then
  null;  -- not scheduled yet, which is the normal case
end $$;

select cron.schedule('rc-rapline-refresh', '20 12 * * *', $$select rc_invoke_rapline_refresh()$$);

-- ── Post-conditions ───────────────────────────────────────────────────
do $$
declare n integer;
begin
  select count(*) into n from cron.job where jobname = 'rc-rapline-refresh' and active;
  if n <> 1 then
    raise exception 'expected exactly 1 active rc-rapline-refresh job, found %', n;
  end if;

  -- Nothing else added, removed or changed.
  select count(*) into n from (
    (select jobname, schedule, command, active from cron.job where jobname <> 'rc-rapline-refresh'
     except all select * from rapline_other_jobs)
    union all
    (select * from rapline_other_jobs
     except all select jobname, schedule, command, active from cron.job where jobname <> 'rc-rapline-refresh')
  ) d;
  if n <> 0 then
    raise exception 'other cron jobs changed during this migration (% rows differ)', n;
  end if;
end $$;

drop table if exists pg_temp.rapline_other_jobs;
