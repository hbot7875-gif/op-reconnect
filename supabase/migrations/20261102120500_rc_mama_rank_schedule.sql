-- MAMA rank tracker: check every 15 minutes while a tracked vote is open.
--
-- The job fires every 15 minutes but only calls the Edge Function while a
-- campaign with an active rc_mama_rank_source row is open for voting (from
-- opens_at to an hour past closes_at, to catch the final standings), so it
-- stops by itself when the round ends.
--
-- Same invoker shape and Vault token as rc_invoke_rapline_refresh
-- (20261027200500). Not idempotent as a whole (cron.schedule), so it lives
-- apart from the schema migration, same as that one.

drop table if exists pg_temp.mama_rank_other_jobs;
create temp table mama_rank_other_jobs as
  select jobname, schedule, command, active from cron.job where jobname <> 'rc-mama-rank-check';

create or replace function public.rc_invoke_mama_rank_check()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  cron_token text;
  request_id bigint;
begin
  if not exists (
    select 1 from rc_mama_rank_source s
      join rc_vote_campaigns c on c.id = s.campaign_id
     where s.active and c.opens_at <= now() and now() <= c.closes_at + interval '1 hour'
  ) then
    return null;
  end if;

  select decrypted_secret into cron_token
    from vault.decrypted_secrets
   where name = 'rc_stream_sync_token'
   order by created_at desc
   limit 1;
  if coalesce(cron_token, '') = '' then
    raise warning 'rc_stream_sync_token is missing from Vault; MAMA rank check skipped';
    return null;
  end if;
  select net.http_post(
    url := 'https://lcvmwlioqpyaprxicdfl.supabase.co/functions/v1/op-reconnect',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-region', 'ap-northeast-2'),
    body := jsonb_build_object('action', 'cronMamaRankCheck', 'cronToken', cron_token),
    timeout_milliseconds := 30000
  ) into request_id;
  return request_id;
end $$;

comment on function public.rc_invoke_mama_rank_check() is
  'Every 15 min while a tracked MAMA vote is open: asks the Edge Function to read BTS''s ranks from Mnet Plus.';

revoke all on function public.rc_invoke_mama_rank_check() from public, anon, authenticated;
grant execute on function public.rc_invoke_mama_rank_check() to service_role;

do $$
begin
  perform cron.unschedule('rc-mama-rank-check');
exception when others then
  null;  -- not scheduled yet, which is the normal case
end $$;

select cron.schedule('rc-mama-rank-check', '*/15 * * * *', $$select rc_invoke_mama_rank_check()$$);

-- ── Post-conditions ───────────────────────────────────────────────────
do $$
declare n integer;
begin
  select count(*) into n from cron.job where jobname = 'rc-mama-rank-check' and active;
  if n <> 1 then
    raise exception 'expected exactly 1 active rc-mama-rank-check job, found %', n;
  end if;

  -- Nothing else added, removed or changed.
  select count(*) into n from (
    (select jobname, schedule, command, active from cron.job where jobname <> 'rc-mama-rank-check'
     except all select * from mama_rank_other_jobs)
    union all
    (select * from mama_rank_other_jobs
     except all select jobname, schedule, command, active from cron.job where jobname <> 'rc-mama-rank-check')
  ) d;
  if n <> 0 then
    raise exception 'other cron jobs changed during this migration (% rows differ)', n;
  end if;
end $$;

drop table if exists pg_temp.mama_rank_other_jobs;
