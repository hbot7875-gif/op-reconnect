-- Leave / pause. An agent can step away for 3–14 days without the game
-- punishing them for it. A leave doesn't move any stream-counting window
-- or hand out resources; it only stops the clocks that would otherwise
-- run out while they're gone:
--
--   district deadline   +N days of grace on the active attempt, via the
--                       same deadline_extension_hours support column the
--                       AGENT000/AGENT103 one-offs used (never activated_at)
--   ARMY Bomb           charged_until and any blackout clock are pushed
--                       forward by the leave length, so nothing goes dark
--                       or resets while they're away
--   streak              every leave day is written to rc_streak_freeze_log
--                       up front, so computeStreak counts them as covered
--                       without spending a single Streak Freeze charge
--   inactivity delete   leave time is excluded from the 14-day rule below
--
-- Ending early reverses only the unused part of each of those. Team
-- ReConnect missions are deliberately NOT paused — those clocks belong to
-- other agents too. One leave at a time, and the next can't start until 14
-- days after the previous one ended, so this can't become a permanent pause.

create table if not exists public.rc_player_leaves (
  id bigserial primary key,
  agent_no text not null references public.rc_agents(agent_no) on delete cascade,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  ended_at timestamptz,                        -- set when ended early
  district_id text,                            -- active attempt at start, if any
  district_hours_granted integer not null default 0,
  bomb_shift_hours integer not null default 0, -- charged_until pushed by this much
  blackout_shift_hours integer not null default 0,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists rc_player_leaves_agent_idx on public.rc_player_leaves (agent_no, ends_at desc);

alter table public.rc_player_leaves enable row level security;
revoke all on public.rc_player_leaves from public, anon, authenticated;
grant select, insert, update on public.rc_player_leaves to service_role;
grant usage, select on sequence public.rc_player_leaves_id_seq to service_role;

-- The leave in force right now, if any (ended_at wins over ends_at).
create or replace function public.rc_active_leave(p_agent text)
returns public.rc_player_leaves
language sql stable
set search_path = public, pg_temp
as $$
  select l.* from public.rc_player_leaves l
  where l.agent_no = p_agent and l.starts_at <= now()
    and coalesce(l.ended_at, l.ends_at) > now()
  order by l.starts_at desc limit 1
$$;

create or replace function public.rc_leave_start(p_agent text, p_days integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_len interval;
  v_hours integer;
  v_active public.rc_player_leaves;
  v_last_end timestamptz;
  v_pd_district text;
  v_charge public.rc_agent_charge;
  v_bomb_shift integer := 0;
  v_blackout_shift integer := 0;
  v_ends timestamptz;
  v_day date;
  v_last_day date;
  v_id bigint;
begin
  if p_days is null or p_days < 3 or p_days > 14 then
    return jsonb_build_object('success', false, 'error', 'leave_days_out_of_range');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rc_leave|' || p_agent, 0));

  v_active := public.rc_active_leave(p_agent);
  if v_active.id is not null then
    return jsonb_build_object('success', false, 'error', 'already_on_leave');
  end if;
  select max(coalesce(ended_at, ends_at)) into v_last_end
    from public.rc_player_leaves where agent_no = p_agent;
  if v_last_end is not null and v_last_end > now() - interval '14 days' then
    return jsonb_build_object('success', false, 'error', 'leave_cooldown',
      'availableAt', v_last_end + interval '14 days');
  end if;

  v_len := make_interval(days => p_days);
  v_hours := p_days * 24;
  v_ends := now() + v_len;

  -- District: grace on the one active attempt, if there is one.
  select district_id into v_pd_district from public.rc_player_districts
    where agent_no = p_agent and status = 'active' limit 1;
  if v_pd_district is not null then
    update public.rc_player_districts
      set deadline_extension_hours = deadline_extension_hours + v_hours
      where agent_no = p_agent and status = 'active';
  end if;

  -- Bomb: push whichever clock is running. A Bomb that is already dark has
  -- its blackout clock pushed instead (and started, if the poll hasn't yet).
  select * into v_charge from public.rc_agent_charge where agent_no = p_agent;
  if found then
    if v_charge.charged_until is not null and v_charge.charged_until > now() then
      update public.rc_agent_charge set charged_until = charged_until + v_len where agent_no = p_agent;
      v_bomb_shift := v_hours;
    elsif v_charge.charged_until is not null then
      update public.rc_agent_charge
        set blackout_started_at = coalesce(blackout_started_at, charged_until) + v_len
        where agent_no = p_agent;
      v_blackout_shift := v_hours;
    end if;
  end if;

  -- Streak: cover every KST day of the leave now, charge-free.
  v_day := (now() at time zone 'Asia/Seoul')::date;
  v_last_day := (v_ends at time zone 'Asia/Seoul')::date;
  while v_day <= v_last_day loop
    insert into public.rc_streak_freeze_log (agent_no, freeze_date)
      values (p_agent, v_day) on conflict do nothing;
    v_day := v_day + 1;
  end loop;

  insert into public.rc_player_leaves
    (agent_no, starts_at, ends_at, district_id, district_hours_granted, bomb_shift_hours, blackout_shift_hours)
  values (p_agent, now(), v_ends, v_pd_district, case when v_pd_district is null then 0 else v_hours end, v_bomb_shift, v_blackout_shift)
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id, 'startsAt', now(), 'endsAt', v_ends, 'days', p_days,
    'districtPaused', v_pd_district is not null);
end;
$$;

create or replace function public.rc_leave_end(p_agent text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_active public.rc_player_leaves;
  v_unused interval;
  v_unused_hours integer;
  v_today date;
begin
  perform pg_advisory_xact_lock(hashtextextended('rc_leave|' || p_agent, 0));
  v_active := public.rc_active_leave(p_agent);
  if v_active.id is null then
    return jsonb_build_object('success', false, 'error', 'not_on_leave');
  end if;

  v_unused := v_active.ends_at - now();
  v_unused_hours := greatest(0, floor(extract(epoch from v_unused) / 3600))::integer;

  -- District: take back only the unused grace, only if it's the same attempt.
  if v_active.district_id is not null and v_unused_hours > 0 then
    update public.rc_player_districts
      set deadline_extension_hours = greatest(0, deadline_extension_hours - least(v_unused_hours, v_active.district_hours_granted))
      where agent_no = p_agent and status = 'active' and district_id = v_active.district_id;
  end if;

  -- Bomb: unwind the unused push. charged_until never lands in the past
  -- here — ending a leave should not itself plunge someone into blackout.
  if v_active.bomb_shift_hours > 0 then
    update public.rc_agent_charge
      set charged_until = greatest(now(), charged_until - make_interval(hours => least(v_unused_hours, v_active.bomb_shift_hours)))
      where agent_no = p_agent;
  end if;
  if v_active.blackout_shift_hours > 0 then
    update public.rc_agent_charge
      set blackout_started_at = blackout_started_at - make_interval(hours => least(v_unused_hours, v_active.blackout_shift_hours))
      where agent_no = p_agent and blackout_started_at is not null;
  end if;

  -- Streak: future leave days are no longer covered. Only dates strictly
  -- after today are removed — the log's past entries can also come from
  -- real freeze charges, and those stay.
  v_today := (now() at time zone 'Asia/Seoul')::date;
  delete from public.rc_streak_freeze_log
    where agent_no = p_agent and freeze_date > v_today
      and freeze_date <= (v_active.ends_at at time zone 'Asia/Seoul')::date;

  update public.rc_player_leaves set ended_at = now() where id = v_active.id;
  return jsonb_build_object('success', true, 'endedAt', now(), 'unusedHours', v_unused_hours);
end;
$$;

revoke all on function public.rc_active_leave(text) from public, anon, authenticated;
revoke all on function public.rc_leave_start(text, integer) from public, anon, authenticated;
revoke all on function public.rc_leave_end(text) from public, anon, authenticated;
grant execute on function public.rc_active_leave(text) to service_role;
grant execute on function public.rc_leave_start(text, integer) to service_role;
grant execute on function public.rc_leave_end(text) to service_role;

-- Inactivity: time on leave since the last feed doesn't count toward the
-- 14 days. Same rule as before otherwise (atomic last_fed_at, legacy event
-- fallback, then join date).
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
      coalesce(c.last_fed_at, f.last_fed_at, a.created_at) as since
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
