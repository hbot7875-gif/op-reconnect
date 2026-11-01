-- Verified votes count as activity for the 14-day cleanup.
--
-- Until now only charging the ARMY Bomb reset the clock, so agents who voted
-- every day in the MAMA battle but never charged were warned and deleted
-- (AGENT185 had 5 verified Round 2 votes and was due for deletion). The
-- clock now runs from whichever is later: the last charge (or the join date
-- if never charged) or the last verified vote proof. Once voting closes no
-- new votes arrive, so it goes back to charging only — a vote on the last
-- day buys the usual 14 days from that day. Time on leave still doesn't count.
--
-- rc_inactive_agent_candidates keeps its exact signature (last_fed_at is
-- still the real charge time), so the delete job, the reminder emails and
-- the admin dry run pick the new rule up unchanged. rc_agent_roster gains
-- last_vote_at and days_inactive for the admin All Agents tab.

create or replace function public.rc_inactive_agent_candidates(p_inactive_days int default 14)
returns table (agent_no text, codename text, last_fed_at timestamptz, joined_at timestamptz, days_inactive numeric)
language sql
stable
as $$
  with base as (
    select
      a.agent_no, p.codename,
      coalesce(c.last_fed_at, f.last_fed_at) as last_fed_at,
      a.created_at as joined_at,
      greatest(coalesce(c.last_fed_at, f.last_fed_at, a.created_at), coalesce(v.last_vote_at, '-infinity')) as since
    from public.rc_agents a
    left join public.rc_players p on p.agent_no = a.agent_no
    left join public.rc_agent_charge c on c.agent_no = a.agent_no
    left join (
      select agent_no, max(created_at) as last_fed_at
      from public.rc_feed_events
      where event_type = 'bomb_fed'
      group by agent_no
    ) f on f.agent_no = a.agent_no
    left join (
      select agent_no, max(coalesce(verified_at, submitted_at)) as last_vote_at
      from public.rc_campaign_proofs
      where status = 'verified'
      group by agent_no
    ) v on v.agent_no = a.agent_no
    where a.agent_no <> 'AGENT001'
      and a.retired_at is null
  ),
  with_leave as (
    select b.*,
      coalesce((
        select sum(greatest(interval '0', least(coalesce(l.ended_at, l.ends_at), now()) - greatest(l.starts_at, b.since)))
        from public.rc_player_leaves l where l.agent_no = b.agent_no
      ), interval '0') as on_leave
    from base b
  )
  select
    agent_no, codename, last_fed_at, joined_at,
    round(extract(epoch from (now() - since - on_leave)) / 86400.0, 1) as days_inactive
  from with_leave
  where since + on_leave < now() - (p_inactive_days || ' days')::interval
  order by days_inactive desc
$$;

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
  last_vote_at timestamptz,
  days_inactive numeric,
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
    v.last_vote_at,
    round(extract(epoch from (
      now() - greatest(coalesce(c.last_fed_at, f.last_fed_at, a.created_at), coalesce(v.last_vote_at, '-infinity'))
    )) / 86400.0, 1) as days_inactive,
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
    select max(coalesce(pr.verified_at, pr.submitted_at)) as last_vote_at
    from public.rc_campaign_proofs pr
    where pr.agent_no = a.agent_no and pr.status = 'verified'
  ) v on true
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
  order by days_inactive desc;
$$;

revoke all on function public.rc_agent_roster() from public;
grant execute on function public.rc_agent_roster() to service_role;
