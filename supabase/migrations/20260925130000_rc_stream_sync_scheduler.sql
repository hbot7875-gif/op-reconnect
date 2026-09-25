-- Durable provider checkpoints for the lightweight BOTZ/Moon stream
-- collector. Raw plays continue to live in rc_scrobbles; this table records
-- how far an uninterrupted server-side capture is known to cover.
create table if not exists rc_stream_sync_state (
  agent_no text primary key references rc_agents(agent_no) on delete cascade,
  source text not null check (source in ('listenbrainz', 'statsfm', 'musicat', 'direct')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_provider_at timestamptz,
  coverage_from timestamptz,
  last_error text,
  consecutive_failures int not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists rc_stream_sync_state_source_idx
  on rc_stream_sync_state(source, last_success_at);

alter table rc_stream_sync_state enable row level security;

create table if not exists rc_stream_sync_locks (
  source text primary key check (source in ('listenbrainz', 'statsfm', 'musicat')),
  locked_until timestamptz not null default '-infinity'::timestamptz
);

alter table rc_stream_sync_locks enable row level security;

create or replace function rc_stream_sync_try_lock(p_source text, p_lease_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare acquired boolean := false;
begin
  if p_source not in ('statsfm', 'musicat', 'listenbrainz') then
    return false;
  end if;
  insert into rc_stream_sync_locks(source, locked_until)
  values (p_source, now() + make_interval(secs => greatest(30, least(p_lease_seconds, 1800))))
  on conflict (source) do update
    set locked_until = excluded.locked_until
    where rc_stream_sync_locks.locked_until <= now()
  returning true into acquired;
  return coalesce(acquired, false);
end;
$$;

create or replace function rc_stream_sync_release_lock(p_source text)
returns void
language sql
security definer
set search_path = public
as $$
  update rc_stream_sync_locks set locked_until = now() where source = p_source;
$$;

revoke all on function rc_stream_sync_try_lock(text, int) from public;
revoke all on function rc_stream_sync_release_lock(text) from public;
grant execute on function rc_stream_sync_try_lock(text, int) to service_role;
grant execute on function rc_stream_sync_release_lock(text) to service_role;

create or replace function rc_stream_sync_state_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists rc_stream_sync_state_touch_trigger on rc_stream_sync_state;
create trigger rc_stream_sync_state_touch_trigger
before update on rc_stream_sync_state
for each row execute function rc_stream_sync_state_touch();

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;
create extension if not exists pgcrypto with schema extensions;

-- Generate a purpose-built scheduler token on first install. It remains in
-- Vault and is unrelated to the service-role or human admin credentials.
do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'rc_stream_sync_token'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'rc_stream_sync_token',
      'Internal token for server-side stream capture cron'
    );
  end if;
end;
$$;

create or replace function rc_validate_stream_sync_token(p_token text)
returns boolean
language sql
security definer
set search_path = public, vault
stable
as $$
  select coalesce(
    length(p_token) >= 32 and p_token = (
      select decrypted_secret from vault.decrypted_secrets
      where name = 'rc_stream_sync_token'
      order by created_at desc limit 1
    ),
    false
  );
$$;

revoke all on function rc_validate_stream_sync_token(text) from public;
grant execute on function rc_validate_stream_sync_token(text) to service_role;

-- The token is read only while creating the HTTPS request. A missing token
-- fails closed, and no service-role or admin credential crosses the request.
create or replace function rc_invoke_stream_capture(p_source text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  cron_token text;
  request_id bigint;
begin
  if p_source not in ('statsfm', 'musicat', 'listenbrainz') then
    raise exception 'unsupported stream source: %', p_source;
  end if;

  select decrypted_secret into cron_token
  from vault.decrypted_secrets
  where name = 'rc_stream_sync_token'
  order by created_at desc
  limit 1;

  if coalesce(cron_token, '') = '' then
    raise warning 'rc_stream_sync_token is missing from Vault; stream capture skipped';
    return null;
  end if;

  select net.http_post(
    url := 'https://lcvmwlioqpyaprxicdfl.supabase.co/functions/v1/op-reconnect',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-region', 'ap-northeast-2'
    ),
    body := jsonb_build_object(
      'action', 'adminCaptureStreamSources',
      'source', p_source,
      'cronToken', cron_token
    )
  ) into request_id;
  return request_id;
end;
$$;

revoke all on function rc_invoke_stream_capture(text) from public;

do $$
declare existing_job bigint;
begin
  for existing_job in
    select jobid from cron.job where jobname in (
      'rc-capture-statsfm', 'rc-capture-musicat', 'rc-capture-listenbrainz'
    )
  loop
    perform cron.unschedule(existing_job);
  end loop;
end;
$$;

-- Stagger providers so three upstream APIs are never fanned out together.
select cron.schedule(
  'rc-capture-statsfm',
  '*/5 * * * *',
  $$select rc_invoke_stream_capture('statsfm')$$
);

select cron.schedule(
  'rc-capture-musicat',
  '2,17,32,47 * * * *',
  $$select rc_invoke_stream_capture('musicat')$$
);

select cron.schedule(
  'rc-capture-listenbrainz',
  '7,22,37,52 * * * *',
  $$select rc_invoke_stream_capture('listenbrainz')$$
);
