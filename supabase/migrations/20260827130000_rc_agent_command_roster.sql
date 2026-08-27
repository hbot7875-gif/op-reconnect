-- Turn the admin roster into a useful support view. "Days inactive" was
-- really only days since the personal ARMY Bomb was fed; exposing the
-- underlying signals separately prevents an active streamer/app user from
-- being misread as generally inactive.
drop function if exists public.rc_agent_roster();

create function public.rc_agent_roster()
returns table (
  agent_no text,
  handle text,
  email text,
  codename text,
  mode text,
  joined_at timestamptz,
  last_fed_at timestamptz,
  days_since_feed numeric,
  retired_at timestamptz,
  last_seen_at timestamptz,
  appear_offline boolean,
  last_stream_at timestamptz,
  current_district_id text,
  current_district_name text,
  district_activated_at timestamptz,
  deadline_extended boolean,
  deadline_extension_hours integer
)
language sql
stable
as $$
  select
    a.agent_no,
    a.handle,
    a.email,
    p.codename,
    p.mode,
    a.created_at as joined_at,
    coalesce(c.last_fed_at, f.last_fed_at) as last_fed_at,
    round(extract(epoch from (
      now() - coalesce(c.last_fed_at, f.last_fed_at, a.created_at)
    )) / 86400.0, 1) as days_since_feed,
    a.retired_at,
    p.last_seen_at,
    coalesce(p.appear_offline, false) as appear_offline,
    to_timestamp(s.last_stream_ts::double precision) as last_stream_at,
    pd.district_id as current_district_id,
    d.name as current_district_name,
    pd.activated_at as district_activated_at,
    coalesce(pd.deadline_extended, false) as deadline_extended,
    coalesce(pd.deadline_extension_hours, 0) as deadline_extension_hours
  from public.rc_agents a
  left join public.rc_players p on p.agent_no = a.agent_no
  left join public.rc_agent_charge c on c.agent_no = a.agent_no
  left join lateral (
    select max(created_at) as last_fed_at
    from public.rc_feed_events
    where agent_no = a.agent_no and event_type = 'bomb_fed'
  ) f on true
  left join lateral (
    select max(listened_at) as last_stream_ts
    from public.rc_scrobbles
    where agent_no = a.agent_no
  ) s on true
  left join lateral (
    select active.district_id, active.activated_at,
      active.deadline_extended, active.deadline_extension_hours
    from public.rc_player_districts active
    where active.agent_no = a.agent_no and active.status = 'active'
    order by active.activated_at desc nulls last
    limit 1
  ) pd on true
  left join public.rc_districts d on d.id = pd.district_id
  order by days_since_feed desc;
$$;

revoke all on function public.rc_agent_roster() from public;
grant execute on function public.rc_agent_roster() to service_role;

