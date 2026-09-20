-- Keep a durable record that an agent attended a Watch Party.
--
-- rc_recelebrate_presence holds ONE row per agent, overwritten on every
-- check-in, so `watching` only says what they're on right now: an agent who
-- watches and then switches to Battle leaves no trace. The RE:CELEBRATE '26
-- badge needs "joined a Watch Party at some point today", so record the first
-- such check-in and never clear it.
--
-- Additive: new nullable column, same function signature and same returned
-- shape, so the deployed pingRecelebratePresence keeps working unchanged.
alter table public.rc_recelebrate_presence
  add column if not exists watched_at timestamptz;

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
  insert into rc_recelebrate_presence (event_id, agent_no, last_seen, watching, watched_at)
  values (
    p_event, p_agent, now(), nullif(p_watching, ''),
    case when nullif(p_watching, '') is not null then now() end
  )
  on conflict (event_id, agent_no)
  do update set
    last_seen = excluded.last_seen,
    watching = excluded.watching,
    -- First Watch Party check-in wins; later Battle pings never clear it.
    watched_at = coalesce(rc_recelebrate_presence.watched_at, excluded.watched_at);

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

revoke all on function public.rc_recelebrate_presence_ping(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.rc_recelebrate_presence_ping(text, text, text, integer) to service_role;
