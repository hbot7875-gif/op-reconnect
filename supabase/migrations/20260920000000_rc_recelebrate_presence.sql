-- ARIRANG RE:CELEBRATE — live presence for the Party page.
--
-- Every open Party page checks in about once a minute (pingRecelebratePresence
-- in lib/recelebrate-presence.ts, auth: 'agent', so the agent is verified
-- before this runs). One row per agent per event, overwritten on each check-
-- in: last_seen is the database's own clock, and `watching` is the Watch
-- schedule event on that agent's stage while the Watch view is actually on
-- screen (null on Battle, or when the page is hidden).
--
-- "Here" and "watching" are agents seen inside the window (150s — a little
-- over two missed check-ins), so a closed tab drops out on its own and nothing
-- is ever faked or estimated.

create table if not exists public.rc_recelebrate_presence (
  event_id text not null,
  agent_no text not null,
  last_seen timestamptz not null default now(),
  watching text,
  primary key (event_id, agent_no)
);
create index if not exists rc_recelebrate_presence_seen
  on public.rc_recelebrate_presence (event_id, last_seen);
alter table public.rc_recelebrate_presence enable row level security;

-- Check in, then count. One call so each ping is a single round trip.
create or replace function public.rc_recelebrate_presence_ping(
  p_event text, p_agent text, p_watching text, p_window_seconds integer default 150
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_since timestamptz := now() - make_interval(secs => greatest(30, least(p_window_seconds, 600)));
  v_here integer;
  v_by jsonb;
begin
  insert into rc_recelebrate_presence (event_id, agent_no, last_seen, watching)
  values (p_event, p_agent, now(), nullif(p_watching, ''))
  on conflict (event_id, agent_no)
  do update set last_seen = excluded.last_seen, watching = excluded.watching;

  select count(*) into v_here
  from rc_recelebrate_presence
  where event_id = p_event and last_seen >= v_since;

  select coalesce(jsonb_object_agg(watching, n), '{}'::jsonb) into v_by
  from (
    select watching, count(*) as n
    from rc_recelebrate_presence
    where event_id = p_event and last_seen >= v_since and watching is not null
    group by watching
  ) w;

  return jsonb_build_object('here', v_here, 'watching', v_by, 'serverNow', now());
end;
$$;

revoke all on table public.rc_recelebrate_presence from public, anon, authenticated;
revoke all on function public.rc_recelebrate_presence_ping(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.rc_recelebrate_presence_ping(text, text, text, integer) to service_role;
grant select, insert, update on table public.rc_recelebrate_presence to service_role;
