-- RUN AMI: settle matches nobody is polling.
--
-- Turn timeouts and disconnect forfeits are applied lazily by any request
-- that touches a match (run-ami-service.js settle()). When every player has
-- gone, nothing requests anything, so this once-a-minute job asks the Edge
-- Function's cronRunAmiSweep route to settle what the clock owes and to
-- close waiting rooms idle past rc_config.run_ami.roomIdleMinutes.
--
-- Same invoker shape and Vault token as rc_invoke_storage_sweep
-- (20260928130000). Not idempotent as a whole (cron.schedule), so it lives
-- apart from the schema migration, same as that one.

-- Every other job, as it stands before this migration: the post-condition
-- below checks they are all still there, unchanged, whatever other
-- schedules exist by the time this runs.
drop table if exists pg_temp.run_ami_other_jobs;
create temp table run_ami_other_jobs as
  select jobname, schedule, command, active from cron.job where jobname <> 'rc-run-ami-sweep';

create or replace function public.rc_invoke_run_ami_sweep()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  cron_token text;
  request_id bigint;
begin
  -- Nothing to settle → no HTTP call at all. Keeps an idle game costing one
  -- indexed query a minute rather than one Edge Function invocation.
  if not exists (select 1 from rc_run_ami_matches where status = 'active')
     and not exists (select 1 from rc_run_ami_rooms where status = 'waiting') then
    return null;
  end if;

  select decrypted_secret into cron_token
    from vault.decrypted_secrets
   where name = 'rc_stream_sync_token'
   order by created_at desc
   limit 1;
  if coalesce(cron_token, '') = '' then
    raise warning 'rc_stream_sync_token is missing from Vault; RUN AMI sweep skipped';
    return null;
  end if;
  select net.http_post(
    url := 'https://lcvmwlioqpyaprxicdfl.supabase.co/functions/v1/op-reconnect',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-region', 'ap-northeast-2'),
    body := jsonb_build_object('action', 'cronRunAmiSweep', 'cronToken', cron_token)
  ) into request_id;
  return request_id;
end $$;

comment on function public.rc_invoke_run_ami_sweep() is
  'Every minute: asks the Edge Function to settle idle RUN AMI matches and close idle rooms.';

revoke all on function public.rc_invoke_run_ami_sweep() from public, anon, authenticated;
grant execute on function public.rc_invoke_run_ami_sweep() to service_role;

do $$
begin
  perform cron.unschedule('rc-run-ami-sweep');
exception when others then
  null;  -- not scheduled yet, which is the normal case
end $$;

select cron.schedule('rc-run-ami-sweep', '* * * * *', $$select rc_invoke_run_ami_sweep()$$);

-- ── Post-conditions ───────────────────────────────────────────────────
do $$
declare n integer;
begin
  select count(*) into n from cron.job where jobname = 'rc-run-ami-sweep' and active;
  if n <> 1 then
    raise exception 'expected exactly 1 active rc-run-ami-sweep job, found %', n;
  end if;

  -- Nothing else added, removed or changed. (A fixed total would break as
  -- soon as any other feature schedules a job; production had 11 others
  -- when this shipped.)
  select count(*) into n from (
    (select jobname, schedule, command, active from cron.job where jobname <> 'rc-run-ami-sweep'
     except all select * from run_ami_other_jobs)
    union all
    (select * from run_ami_other_jobs
     except all select jobname, schedule, command, active from cron.job where jobname <> 'rc-run-ami-sweep')
  ) d;
  if n <> 0 then
    raise exception 'other cron jobs changed during this migration (% rows differ)', n;
  end if;
end $$;

drop table if exists pg_temp.run_ami_other_jobs;
