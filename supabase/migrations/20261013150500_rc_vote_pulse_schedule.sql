-- BTS X Vote Pulse schedule (display only — see vote-pulse-service.js).
--
-- NOT APPLIED. Staged with the MAMA 2026 release; apply after
-- 20261013150000 and after the APIFY_TOKEN Edge Function secret is set.
--
-- Four times a day, on the KST quarter-days 00:00 / 06:00 / 12:00 / 18:00
-- (15:00, 21:00, 03:00, 09:00 UTC). The invoker checks the window itself, so
-- outside a voting window (plus the final collection grace period) the job
-- makes no HTTP call at all — nothing is spent once the event is over.
-- Same Vault token and Edge entry pattern as rc_invoke_storage_sweep.

create or replace function public.rc_invoke_vote_pulse()
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
    select 1 from rc_vote_campaigns
     where active
       and coalesce((pulse ->> 'enabled')::boolean, false)
       and now() >= opens_at
       and now() <= closes_at + make_interval(hours => coalesce((pulse ->> 'collect_until_hours_after_close')::integer, 12))
  ) then
    return null;
  end if;

  select decrypted_secret into cron_token
    from vault.decrypted_secrets
   where name = 'rc_stream_sync_token'
   order by created_at desc
   limit 1;

  if coalesce(cron_token, '') = '' then
    raise warning 'rc_stream_sync_token is missing from Vault; vote pulse skipped';
    return null;
  end if;

  select net.http_post(
    url := 'https://lcvmwlioqpyaprxicdfl.supabase.co/functions/v1/op-reconnect',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-region', 'ap-northeast-2'),
    body := jsonb_build_object('action', 'cronVotePulse', 'cronToken', cron_token)
  ) into request_id;
  return request_id;
end $$;

comment on function public.rc_invoke_vote_pulse() is
  'About 4x a day during a voting window: asks the Edge Function to refresh the BTS X Vote Pulse snapshot. No-op outside the window.';

revoke all on function public.rc_invoke_vote_pulse() from public, anon, authenticated;
grant execute on function public.rc_invoke_vote_pulse() to service_role;

do $$
begin
  perform cron.unschedule('rc-vote-pulse');
exception when others then
  null;  -- not scheduled yet, which is the normal case
end $$;

select cron.schedule('rc-vote-pulse', '0 3,9,15,21 * * *', $$select rc_invoke_vote_pulse()$$);

do $$
declare n integer;
begin
  select count(*) into n from cron.job where jobname = 'rc-vote-pulse' and active;
  if n <> 1 then
    raise exception 'expected exactly 1 active rc-vote-pulse job, found %', n;
  end if;
end $$;
