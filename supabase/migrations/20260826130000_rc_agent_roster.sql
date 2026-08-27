-- Full agent roster for the admin panel's new "All Agents" tab -- same
-- days_inactive computation rc_inactive_agent_candidates already uses, but
-- with no threshold and no exclusions (AGENT001 and retired agents included
-- here; this is a browse/audit view, not a deletion candidate list).
create or replace function rc_agent_roster()
returns table (
  agent_no text, handle text, email text, codename text, mode text,
  joined_at timestamptz, last_fed_at timestamptz, days_inactive numeric,
  retired_at timestamptz
)
language sql
stable
as $$
  select
    a.agent_no, a.handle, a.email, p.codename, p.mode,
    a.created_at as joined_at, f.last_fed_at,
    round(extract(epoch from (now() - coalesce(f.last_fed_at, a.created_at))) / 86400.0, 1) as days_inactive,
    a.retired_at
  from rc_agents a
  left join rc_players p on p.agent_no = a.agent_no
  left join (
    select agent_no, max(created_at) as last_fed_at
    from rc_feed_events
    where event_type = 'bomb_fed'
    group by agent_no
  ) f on f.agent_no = a.agent_no
  order by days_inactive desc
$$;
