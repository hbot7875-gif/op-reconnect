-- A successful ARMY Bomb feed must be the authoritative definition of
-- activity for the 14-day inactive-agent cleanup. The old implementation
-- inferred this from rc_feed_events(event_type = 'bomb_fed'), but that event
-- was written only after a manual feed and outside the charge transaction.
-- Auto-feed and Lit Era charges never wrote it at all, while a failed event
-- insert was ignored. An agent could therefore charge the Bomb successfully
-- and still be deleted as "inactive".

alter table public.rc_agent_charge
  add column if not exists last_fed_at timestamptz;

-- Preserve the best activity evidence that still exists. updated_at is used
-- only for already-charged rows during this one-time backfill: it covers old
-- auto-feed/Lit Era charges that had no bomb_fed event. Slightly
-- over-protecting a legacy row is safer than deleting another active player.
with legacy_feed as (
  select agent_no, max(created_at) as fed_at
  from public.rc_feed_events
  where event_type = 'bomb_fed'
  group by agent_no
)
update public.rc_agent_charge c
set last_fed_at = greatest(
  coalesce(c.last_fed_at, '-infinity'::timestamptz),
  coalesce(f.fed_at, '-infinity'::timestamptz),
  coalesce(case when c.charged_until is not null then c.updated_at end, '-infinity'::timestamptz)
)
from legacy_feed f
where f.agent_no = c.agent_no
  and (c.last_fed_at is null or f.fed_at > c.last_fed_at);

update public.rc_agent_charge
set last_fed_at = updated_at
where last_fed_at is null
  and charged_until is not null;

-- Manual Charge Cell feed: charge and last-fed evidence commit together.
create or replace function public.rc_feed_charge(
  p_agent_no text,
  p_cells_to_spend integer,
  p_hours_per_cell integer default 2
) returns table(charged_until timestamptz, cells_spent integer, cells_remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cells_available integer;
  v_charged_until timestamptz;
begin
  if p_cells_to_spend is null or p_cells_to_spend <= 0 then return; end if;

  select p.charge_cells into v_cells_available
  from public.rc_players p where p.agent_no = p_agent_no for update;
  if v_cells_available is null or v_cells_available < p_cells_to_spend then return; end if;

  update public.rc_players set charge_cells = charge_cells - p_cells_to_spend
  where agent_no = p_agent_no;

  insert into public.rc_agent_charge (
    agent_no, charged_until, auto_feed, blackout_started_at,
    soft_reset_at, full_reset_at, last_fed_at, updated_at
  ) values (
    p_agent_no, now() + make_interval(hours => p_cells_to_spend * p_hours_per_cell), false,
    null, null, null, now(), now()
  )
  on conflict (agent_no) do update set
    charged_until = greatest(coalesce(rc_agent_charge.charged_until, now()), now())
      + make_interval(hours => p_cells_to_spend * p_hours_per_cell),
    blackout_started_at = null,
    soft_reset_at = null,
    full_reset_at = null,
    last_fed_at = now(),
    updated_at = now()
  returning rc_agent_charge.charged_until into v_charged_until;

  return query select v_charged_until, p_cells_to_spend, (v_cells_available - p_cells_to_spend);
end;
$$;

revoke all on function public.rc_feed_charge(text, integer, integer) from public;
grant execute on function public.rc_feed_charge(text, integer, integer) to service_role;

-- Auto-feed: only a real spend (did_feed = true) advances last_fed_at.
create or replace function public.rc_auto_feed_charge(
  p_agent_no text,
  p_hours_per_cell integer default 2
) returns table(charged_until timestamptz, cells_spent integer, cells_remaining integer, did_feed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cells_available integer;
  v_auto_feed boolean;
  v_prior_charged_until timestamptz;
  v_gap_hours numeric;
  v_cells_needed integer;
  v_use integer;
  v_new_charged_until timestamptz;
begin
  select p.charge_cells into v_cells_available
  from public.rc_players p where p.agent_no = p_agent_no for update;

  select c.charged_until, c.auto_feed into v_prior_charged_until, v_auto_feed
  from public.rc_agent_charge c where c.agent_no = p_agent_no for update;

  if v_cells_available is null or v_auto_feed is not true or v_cells_available <= 0
     or v_prior_charged_until is null or v_prior_charged_until > now() then
    return query select v_prior_charged_until, 0, coalesce(v_cells_available, 0), false;
    return;
  end if;

  v_gap_hours := extract(epoch from (now() - v_prior_charged_until)) / 3600.0;
  v_cells_needed := greatest(1, ceil(v_gap_hours / p_hours_per_cell)::integer);
  v_use := least(v_cells_needed, v_cells_available);

  if v_use <= 0 then
    return query select v_prior_charged_until, 0, v_cells_available, false;
    return;
  end if;

  update public.rc_players set charge_cells = charge_cells - v_use
  where agent_no = p_agent_no;

  update public.rc_agent_charge
  set charged_until = v_prior_charged_until + make_interval(hours => v_use * p_hours_per_cell),
      last_fed_at = now(),
      updated_at = now()
  where agent_no = p_agent_no
  returning rc_agent_charge.charged_until into v_new_charged_until;

  return query select v_new_charged_until, v_use, (v_cells_available - v_use), true;
end;
$$;

revoke all on function public.rc_auto_feed_charge(text, integer) from public;
grant execute on function public.rc_auto_feed_charge(text, integer) to service_role;

-- Lit Era emergency charge: consuming the card and recording activity remain
-- in the same transaction.
create or replace function public.rc_use_lit_era(
  p_agent_no text,
  p_era_id text,
  p_week_key text,
  p_hours integer default 10
) returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_until timestamptz;
begin
  update public.rc_agent_lit_eras
  set used_at = now()
  where agent_no = p_agent_no
    and era_id = p_era_id
    and week_key = p_week_key
    and used_at is null;
  if not found then return null; end if;

  insert into public.rc_agent_charge (
    agent_no, charged_until, auto_feed, blackout_started_at,
    soft_reset_at, full_reset_at, last_fed_at, updated_at
  ) values (
    p_agent_no, now() + make_interval(hours => p_hours), false,
    null, null, null, now(), now()
  )
  on conflict (agent_no) do update set
    charged_until = greatest(coalesce(rc_agent_charge.charged_until, now()), now())
      + make_interval(hours => p_hours),
    blackout_started_at = null,
    soft_reset_at = null,
    full_reset_at = null,
    last_fed_at = now(),
    updated_at = now()
  returning charged_until into v_until;

  return v_until;
end;
$$;

revoke all on function public.rc_use_lit_era(text, text, text, integer) from public;
grant execute on function public.rc_use_lit_era(text, text, text, integer) to service_role;

-- The deletion shortlist now reads the atomic timestamp. The legacy event is
-- only a fallback for an old agent with no charge row/timestamp.
create or replace function public.rc_inactive_agent_candidates(p_inactive_days int default 14)
returns table (agent_no text, codename text, last_fed_at timestamptz, joined_at timestamptz, days_inactive numeric)
language sql
stable
as $$
  select
    a.agent_no, p.codename,
    coalesce(c.last_fed_at, f.last_fed_at) as last_fed_at,
    a.created_at as joined_at,
    round(extract(epoch from (
      now() - coalesce(c.last_fed_at, f.last_fed_at, a.created_at)
    )) / 86400.0, 1) as days_inactive
  from public.rc_agents a
  left join public.rc_players p on p.agent_no = a.agent_no
  left join public.rc_agent_charge c on c.agent_no = a.agent_no
  left join (
    select agent_no, max(created_at) as last_fed_at
    from public.rc_feed_events
    where event_type = 'bomb_fed'
    group by agent_no
  ) f on f.agent_no = a.agent_no
  where a.agent_no <> 'AGENT001'
    and a.retired_at is null
    and coalesce(c.last_fed_at, f.last_fed_at, a.created_at)
      < now() - (p_inactive_days || ' days')::interval
  order by days_inactive desc
$$;

-- Keep the admin roster's "Last fed" and warning state on the same source.
create or replace function public.rc_agent_roster()
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
    a.created_at as joined_at,
    coalesce(c.last_fed_at, f.last_fed_at) as last_fed_at,
    round(extract(epoch from (
      now() - coalesce(c.last_fed_at, f.last_fed_at, a.created_at)
    )) / 86400.0, 1) as days_inactive,
    a.retired_at
  from public.rc_agents a
  left join public.rc_players p on p.agent_no = a.agent_no
  left join public.rc_agent_charge c on c.agent_no = a.agent_no
  left join (
    select agent_no, max(created_at) as last_fed_at
    from public.rc_feed_events
    where event_type = 'bomb_fed'
    group by agent_no
  ) f on f.agent_no = a.agent_no
  order by days_inactive desc
$$;
