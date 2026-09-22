-- Leave / pause, tightened after review of how it could be gamed:
--
-- 1. Streak: a leave day now BRIDGES the streak instead of adding to it.
--    Leave rows in rc_streak_freeze_log are tagged kind='leave'; computeStreak
--    (derive.ts) continues the chain through them without incrementing, while
--    charge-spent freezes (kind='charge') keep counting as they always have.
--    Without this a free 14-day leave grew the streak by 14 with zero streams.
--
-- 2. District: streams on leave days no longer count toward the paused
--    district (districts.ts districtProgress skips those KST dates — the
--    exclusion itself is computed in lib/leave.ts, no schema needed). They
--    still count for XP, the Bomb, ReConnect and everything else. Without
--    this, "activate, take a 14-day leave, keep streaming" turned the 7-day
--    deadline into 21 days for free.

alter table public.rc_streak_freeze_log
  add column if not exists kind text not null default 'charge'
  check (kind in ('charge', 'leave'));

-- Rows written by rc_leave_start before this migration: any frozen date on
-- or after today that falls inside a leave window is a leave row.
update public.rc_streak_freeze_log f
set kind = 'leave'
where f.kind = 'charge'
  and f.freeze_date >= (now() at time zone 'Asia/Seoul')::date
  and exists (
    select 1 from public.rc_player_leaves l
    where l.agent_no = f.agent_no
      and f.freeze_date between (l.starts_at at time zone 'Asia/Seoul')::date
                            and (coalesce(l.ended_at, l.ends_at) at time zone 'Asia/Seoul')::date
  );

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

  select district_id into v_pd_district from public.rc_player_districts
    where agent_no = p_agent and status = 'active' limit 1;
  if v_pd_district is not null then
    update public.rc_player_districts
      set deadline_extension_hours = deadline_extension_hours + v_hours
      where agent_no = p_agent and status = 'active';
  end if;

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

  -- Streak: bridge every KST day of the leave (kind='leave' — continues the
  -- chain, never adds to it; see derive.ts computeStreak).
  v_day := (now() at time zone 'Asia/Seoul')::date;
  v_last_day := (v_ends at time zone 'Asia/Seoul')::date;
  while v_day <= v_last_day loop
    insert into public.rc_streak_freeze_log (agent_no, freeze_date, kind)
      values (p_agent, v_day, 'leave') on conflict do nothing;
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

  if v_active.district_id is not null and v_unused_hours > 0 then
    update public.rc_player_districts
      set deadline_extension_hours = greatest(0, deadline_extension_hours - least(v_unused_hours, v_active.district_hours_granted))
      where agent_no = p_agent and status = 'active' and district_id = v_active.district_id;
  end if;

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

  -- Only this leave's own future bridge days go; charge-spent freezes stay.
  v_today := (now() at time zone 'Asia/Seoul')::date;
  delete from public.rc_streak_freeze_log
    where agent_no = p_agent and kind = 'leave' and freeze_date > v_today
      and freeze_date <= (v_active.ends_at at time zone 'Asia/Seoul')::date;

  update public.rc_player_leaves set ended_at = now() where id = v_active.id;
  return jsonb_build_object('success', true, 'endedAt', now(), 'unusedHours', v_unused_hours);
end;
$$;
