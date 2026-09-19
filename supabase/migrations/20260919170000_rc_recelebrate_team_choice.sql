-- ARIRANG RE:CELEBRATE surprise team choice (Hooligans vs Aliens).
--
-- Everything time- or count-sensitive happens inside these functions, on the
-- database's own clock and under row/advisory locks, so the Edge Function
-- never decides a deadline or a balance on its own:
--   start   — stamps team_choice_started_at ONCE (only while it's null), so a
--             refresh / second tab / second device continues the same 30s.
--   choose  — locks the agent's pick only if they have no team yet and are
--             still inside the window (30s + 2s network grace).
--   resolve — after 30s with no team, HT assigns the smaller side (random on
--             a tie). A per-event advisory lock serializes every team write,
--             so agents timing out together are counted one after another
--             and can't all see the same stale counts and pile onto one side.
-- Callable by the service role only (the Edge Function), never by clients.

alter table public.rc_recelebrate_passes
  add column if not exists team_assigned_by text check (team_assigned_by in ('agent', 'ht'));

create or replace function public.rc_recelebrate_state(p_event text, p_agent text)
returns table (
  love_song text, pass_issued_at timestamptz, team_choice_started_at timestamptz,
  team text, team_chosen_at timestamptz, team_assigned_by text, server_now timestamptz
)
language sql stable security definer set search_path = public as $$
  select p.love_song, p.pass_issued_at, p.team_choice_started_at,
         p.team, p.team_chosen_at, p.team_assigned_by, now()
  from rc_recelebrate_passes p
  where p.event_id = p_event and p.agent_no = p_agent
$$;

create or replace function public.rc_recelebrate_resolve_team(p_event text, p_agent text)
returns table (
  love_song text, pass_issued_at timestamptz, team_choice_started_at timestamptz,
  team text, team_chosen_at timestamptz, team_assigned_by text, server_now timestamptz
)
language plpgsql security definer set search_path = public as $$
declare
  v_started timestamptz;
  v_team text;
  v_h integer;
  v_a integer;
  v_pick text;
begin
  select r.team_choice_started_at, r.team into v_started, v_team
  from rc_recelebrate_passes r where r.event_id = p_event and r.agent_no = p_agent;

  if v_team is null and v_started is not null and now() > v_started + interval '30 seconds' then
    perform pg_advisory_xact_lock(hashtext('rc_recelebrate_team:' || p_event));
    select r.team into v_team from rc_recelebrate_passes r
    where r.event_id = p_event and r.agent_no = p_agent for update;
    if v_team is null then
      select count(*) filter (where r.team = 'hooligans'), count(*) filter (where r.team = 'aliens')
        into v_h, v_a
      from rc_recelebrate_passes r where r.event_id = p_event;
      v_pick := case
        when v_h < v_a then 'hooligans'
        when v_a < v_h then 'aliens'
        when random() < 0.5 then 'hooligans'
        else 'aliens'
      end;
      update rc_recelebrate_passes r
      set team = v_pick, team_chosen_at = now(), team_assigned_by = 'ht', updated_at = now()
      where r.event_id = p_event and r.agent_no = p_agent and r.team is null;
    end if;
  end if;

  return query select * from rc_recelebrate_state(p_event, p_agent);
end;
$$;

create or replace function public.rc_recelebrate_start_team_choice(p_event text, p_agent text)
returns table (
  love_song text, pass_issued_at timestamptz, team_choice_started_at timestamptz,
  team text, team_chosen_at timestamptz, team_assigned_by text, server_now timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  update rc_recelebrate_passes r
  set team_choice_started_at = now(), updated_at = now()
  where r.event_id = p_event and r.agent_no = p_agent and r.team_choice_started_at is null;
  -- Reopening after the window already ran out resolves it right here.
  return query select * from rc_recelebrate_resolve_team(p_event, p_agent);
end;
$$;

create or replace function public.rc_recelebrate_choose_team(p_event text, p_agent text, p_team text)
returns table (
  love_song text, pass_issued_at timestamptz, team_choice_started_at timestamptz,
  team text, team_chosen_at timestamptz, team_assigned_by text, server_now timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if p_team not in ('hooligans', 'aliens') then
    raise exception 'team_invalid';
  end if;
  -- Same lock as HT's balancing, so a pick and an auto-assignment are never
  -- counted against each other half-finished.
  perform pg_advisory_xact_lock(hashtext('rc_recelebrate_team:' || p_event));
  update rc_recelebrate_passes r
  set team = p_team, team_chosen_at = now(), team_assigned_by = 'agent', updated_at = now()
  where r.event_id = p_event and r.agent_no = p_agent
    and r.team is null
    and r.team_choice_started_at is not null
    and now() <= r.team_choice_started_at + interval '32 seconds';
  -- Already has a team (another tab/device won) → returned unchanged.
  -- Window already closed → HT assigns now and that's what's returned.
  return query select * from rc_recelebrate_resolve_team(p_event, p_agent);
end;
$$;

revoke all on function public.rc_recelebrate_state(text, text) from public, anon, authenticated;
revoke all on function public.rc_recelebrate_resolve_team(text, text) from public, anon, authenticated;
revoke all on function public.rc_recelebrate_start_team_choice(text, text) from public, anon, authenticated;
revoke all on function public.rc_recelebrate_choose_team(text, text, text) from public, anon, authenticated;
grant execute on function public.rc_recelebrate_state(text, text) to service_role;
grant execute on function public.rc_recelebrate_resolve_team(text, text) to service_role;
grant execute on function public.rc_recelebrate_start_team_choice(text, text) to service_role;
grant execute on function public.rc_recelebrate_choose_team(text, text, text) to service_role;
