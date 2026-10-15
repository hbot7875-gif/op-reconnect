-- MAMA Mnet auto-verify: a dependable nudge.
--
-- An upload already asks GitHub to start the trusted checker
-- (.github/workflows/mnet-auto-verify.yml). If that request is lost — or the
-- dispatch token is missing — the only other trigger was GitHub's own
-- "every 5 minutes" schedule, which in practice ran every 2–5 hours.
--
-- Every 2 minutes this asks the Edge Function to send the start request
-- again, but ONLY while a certificate has been waiting at least a minute
-- (and at most 6 hours: the worker itself hands anything unreadable to
-- review after 30 minutes). No waiting certificate → no HTTP call at all.
-- The workflow runs one at a time, so repeated nudges collapse into one run,
-- and the database only ever credits a proof once.
-- Same Vault token and Edge entry pattern as rc_invoke_vote_pulse.

create or replace function public.rc_invoke_mnet_verify_kick()
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
    select 1 from rc_campaign_proofs p
      join rc_vote_campaigns c on c.id = p.campaign_id and c.active
     where p.status = 'verifying'
       and p.submitted_at <= now() - interval '60 seconds'
       and p.submitted_at >= now() - interval '6 hours'
       and p.proof_path is not null
  ) then
    return null;
  end if;

  select decrypted_secret into cron_token
    from vault.decrypted_secrets
   where name = 'rc_stream_sync_token'
   order by created_at desc
   limit 1;

  if coalesce(cron_token, '') = '' then
    raise warning 'rc_stream_sync_token is missing from Vault; mnet verify kick skipped';
    return null;
  end if;

  select net.http_post(
    url := 'https://lcvmwlioqpyaprxicdfl.supabase.co/functions/v1/op-reconnect',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-region', 'ap-northeast-2'),
    body := jsonb_build_object('action', 'cronMnetVerifyKick', 'cronToken', cron_token)
  ) into request_id;
  return request_id;
end $$;

comment on function public.rc_invoke_mnet_verify_kick() is
  'Every 2 minutes: if a Mnet certificate has waited 1 min–6 h, asks the Edge Function to start the auto-verify workflow. No-op otherwise.';

revoke all on function public.rc_invoke_mnet_verify_kick() from public, anon, authenticated;
grant execute on function public.rc_invoke_mnet_verify_kick() to service_role;

do $$
begin
  perform cron.unschedule('rc-mnet-verify-kick');
exception when others then
  null;  -- not scheduled yet, which is the normal case
end $$;

select cron.schedule('rc-mnet-verify-kick', '*/2 * * * *', $$select rc_invoke_mnet_verify_kick()$$);

do $$
declare n integer;
begin
  select count(*) into n from cron.job where jobname = 'rc-mnet-verify-kick' and active;
  if n <> 1 then
    raise exception 'expected exactly 1 active rc-mnet-verify-kick job, found %', n;
  end if;
end $$;
