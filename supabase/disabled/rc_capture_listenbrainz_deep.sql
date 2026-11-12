-- NOT A MIGRATION. Kept out of supabase/migrations on purpose so `db push`
-- can never schedule it. Decision 2026-11-12: the daily 7-day ListenBrainz
-- re-read stays OFF; the regular capture re-reads 48 h. To turn it on later,
-- move this into a new migration (with post-conditions) and get approval.
--
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

-- 19:14 UTC = 04:14 KST, between the :07 and :22 regular LB runs.
select cron.schedule('rc-capture-listenbrainz-deep', '14 19 * * *', $$select rc_invoke_stream_capture_deep()$$);
