-- Rap Line to 1B: informational Spotify totals for three solo tracks.
--
-- Entirely separate from the Road to 1B scrobble mission (side-missions.ts):
-- nothing here is read by gameplay, XP or rewards. The Edge Function's
-- cronRaplineRefresh fetches each track's daily history from the stream-count
-- API every 3 days and stores one row per track per reported day. Players
-- read it back through the public getRaplineTracker route (service role);
-- neither table is granted to anon or authenticated.

create table if not exists public.rc_rapline_daily (
  spotify_id text not null check (spotify_id ~ '^[A-Za-z0-9]{22}$'),
  -- The source's own reporting date: "the total displayed that day on Spotify".
  day date not null,
  streams bigint not null check (streams >= 0),
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (spotify_id, day)
);

comment on table public.rc_rapline_daily is
  'Rap Line to 1B: Spotify total per track per source reporting date. Informational only.';

-- One row per HTTP request to the stream-count API, successful or not. The
-- free plan is 50 requests per ~31-day window with a hard limit, so the
-- Edge Function budgets against this log before every fetch.
create table if not exists public.rc_rapline_requests (
  id bigint generated always as identity primary key,
  requested_at timestamptz not null default now(),
  spotify_id text not null,
  http_status integer,
  ok boolean not null default false,
  -- X-RateLimit-Requests-Remaining as the provider reported it, if it did.
  quota_remaining integer,
  error text
);

create index if not exists rc_rapline_requests_recent on public.rc_rapline_requests (requested_at desc);

alter table public.rc_rapline_daily enable row level security;
alter table public.rc_rapline_requests enable row level security;
revoke all on public.rc_rapline_daily, public.rc_rapline_requests from public, anon, authenticated;
grant select, insert, update, delete on public.rc_rapline_daily, public.rc_rapline_requests to service_role;

-- Store a fetched history. Inserts days not seen before and updates a day
-- only when the source's figure for it changed, so an unchanged re-fetch
-- writes nothing. Returns how many rows were inserted or changed.
create or replace function public.rc_rapline_store(p_spotify_id text, p_points jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  n integer;
begin
  if p_spotify_id !~ '^[A-Za-z0-9]{22}$' then
    raise exception 'bad spotify id';
  end if;
  if jsonb_typeof(p_points) <> 'array' then
    raise exception 'points must be an array';
  end if;

  with incoming as (
    select (p->>'day')::date as day, (p->>'streams')::bigint as streams
      from jsonb_array_elements(p_points) p
  ), written as (
    insert into rc_rapline_daily as d (spotify_id, day, streams)
    select p_spotify_id, day, streams from incoming
    on conflict (spotify_id, day) do update
      set streams = excluded.streams, updated_at = now()
      where d.streams is distinct from excluded.streams
    returning 1
  )
  select count(*) into n from written;
  return n;
end $$;

revoke all on function public.rc_rapline_store(text, jsonb) from public, anon, authenticated;
grant execute on function public.rc_rapline_store(text, jsonb) to service_role;
