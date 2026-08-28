-- ReConnect Health: opt-in partner-availability alerts plus one atomic admin
-- operation for completing a full roster. The RPC preserves an existing
-- partial team's mission and contribution clock, folds only harmless solo
-- missions, and refuses to steal anyone from another real team.

create table if not exists public.rc_reconnect_match_alerts (
  agent_no text not null references public.rc_agents(agent_no) on delete cascade,
  district_id text not null references public.rc_districts(id) on delete cascade,
  goal_id text not null references public.rc_goals(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (agent_no, district_id, goal_id)
);

create index if not exists rc_reconnect_match_alerts_active_idx
  on public.rc_reconnect_match_alerts (agent_no, active)
  where active = true;

revoke all on table public.rc_reconnect_match_alerts from public;

create or replace function public.rc_admin_fill_reconnect_team(
  p_district_id text,
  p_goal_id text,
  p_target_mission_id uuid,
  p_agent_nos text[]
) returns table(success boolean, mission_id uuid, error text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agents text[];
  v_agent text;
  v_required integer;
  v_eligible integer;
  v_target uuid := p_target_mission_id;
  v_target_status text;
  v_variant text;
  v_existing_joined integer;
  v_joined_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'reconnect-health|' || coalesce(p_district_id, '') || '|' || coalesce(p_goal_id, ''), 0
  ));

  select array_agg(distinct upper(trim(a)) order by upper(trim(a)))
  into v_agents
  from unnest(coalesce(p_agent_nos, array[]::text[])) a
  where trim(a) <> '';

  if p_district_id is null or p_goal_id is null or coalesce(array_length(v_agents, 1), 0) < 2 then
    return query select false, null::uuid, 'missing_params'; return;
  end if;

  select nullif(pd.goals->'reconnect'->'config'->>'requiredAgents', '')::integer
  into v_required
  from public.rc_player_districts pd
  where pd.agent_no = v_agents[1]
    and pd.district_id = p_district_id
    and pd.status = 'active'
    and pd.goals->'reconnect'->>'id' = p_goal_id;

  if v_required is null or v_required < 2 then
    return query select false, null::uuid, 'goal_not_available'; return;
  end if;
  if array_length(v_agents, 1) <> v_required then
    return query select false, null::uuid, 'full_roster_required'; return;
  end if;

  select count(*) into v_eligible
  from public.rc_player_districts pd
  where pd.agent_no = any(v_agents)
    and pd.district_id = p_district_id
    and pd.status = 'active'
    and pd.goals->'reconnect'->>'id' = p_goal_id
    and nullif(pd.goals->'reconnect'->'config'->>'requiredAgents', '')::integer = v_required;
  if v_eligible <> v_required then
    return query select false, null::uuid, 'agent_not_eligible'; return;
  end if;

  if exists (
    select 1
    from public.rc_reconnect_missions m
    join public.rc_reconnect_participants p on p.mission_id = m.id and p.status = 'joined'
    where m.status = 'complete' and m.district_id = p_district_id and m.goal_id = p_goal_id
      and p.agent_no = any(v_agents)
  ) then
    return query select false, null::uuid, 'agent_already_completed'; return;
  end if;

  if v_target is not null then
    select status into v_target_status
    from public.rc_reconnect_missions
    where id = v_target and district_id = p_district_id and goal_id = p_goal_id
    for update;
    if v_target_status is distinct from 'open' then
      return query select false, null::uuid, 'target_not_open'; return;
    end if;
  else
    select m.id into v_target
    from public.rc_reconnect_missions m
    where m.status = 'open' and m.district_id = p_district_id and m.goal_id = p_goal_id
      and exists (
        select 1 from public.rc_reconnect_participants p
        where p.mission_id = m.id and p.status = 'joined' and p.agent_no = any(v_agents)
      )
      and not exists (
        select 1 from public.rc_reconnect_participants p
        where p.mission_id = m.id and p.status = 'joined' and not (p.agent_no = any(v_agents))
      )
    order by m.created_at
    limit 1
    for update;
  end if;

  -- Never displace a member of the target team.
  if v_target is not null and exists (
    select 1 from public.rc_reconnect_participants p
    where p.mission_id = v_target and p.status = 'joined' and not (p.agent_no = any(v_agents))
  ) then
    return query select false, null::uuid, 'target_has_other_agents'; return;
  end if;

  -- A selected agent may own a harmless solo mission, but cannot be taken
  -- out of another mission that already has a real multi-person roster.
  if exists (
    select 1
    from public.rc_reconnect_missions m
    join public.rc_reconnect_participants mine
      on mine.mission_id = m.id and mine.status = 'joined' and mine.agent_no = any(v_agents)
    where m.status = 'open' and m.district_id = p_district_id and m.goal_id = p_goal_id
      and m.id is distinct from v_target
      and (select count(*) from public.rc_reconnect_participants p
           where p.mission_id = m.id and p.status = 'joined') > 1
  ) then
    return query select false, null::uuid, 'agent_busy_in_team'; return;
  end if;

  if v_target is null then
    select variant into v_variant from public.rc_goals where id = p_goal_id;
    insert into public.rc_reconnect_missions (
      district_id, goal_id, required_agents, track_label, track_artist,
      track_aliases, created_by
    ) values (
      p_district_id, p_goal_id, v_required, 'reconnect:' || coalesce(v_variant, 'connect'),
      null, '[]'::jsonb, '__admin__'
    ) returning id into v_target;
  end if;

  select count(*) into v_existing_joined
  from public.rc_reconnect_participants
  where mission_id = v_target and status = 'joined';
  if v_existing_joined > v_required then
    return query select false, null::uuid, 'target_overfilled'; return;
  end if;

  -- A health-panel rescue only runs after pending invites are overdue or
  -- absent. Once the admin supplies a complete roster, old pending seats no
  -- longer represent a real invitation and must not linger in the invitee HUD.
  delete from public.rc_reconnect_participants
  where mission_id = v_target and status = 'invited';

  foreach v_agent in array v_agents loop
    select min(p.joined_at) into v_joined_at
    from public.rc_reconnect_participants p
    join public.rc_reconnect_missions m on m.id = p.mission_id
    where p.agent_no = v_agent and p.status = 'joined'
      and m.district_id = p_district_id and m.goal_id = p_goal_id
      and m.status = 'open';

    insert into public.rc_reconnect_participants (
      mission_id, agent_no, status, invited_by, joined_at
    ) values (
      v_target, v_agent, 'joined', null, coalesce(v_joined_at, now())
    ) on conflict (mission_id, agent_no) do update
      set status = 'joined', invited_by = null,
          joined_at = least(rc_reconnect_participants.joined_at, excluded.joined_at);
  end loop;

  -- Fold away only solo missions represented by this newly-complete team.
  update public.rc_reconnect_missions m
  set status = 'cancelled'
  where m.id <> v_target and m.status = 'open'
    and m.district_id = p_district_id and m.goal_id = p_goal_id
    and exists (
      select 1 from public.rc_reconnect_participants p
      where p.mission_id = m.id and p.agent_no = any(v_agents)
    )
    and (select count(*) from public.rc_reconnect_participants p
         where p.mission_id = m.id and p.status = 'joined') <= 1;

  return query select true, v_target, null::text;
end;
$$;

revoke all on function public.rc_admin_fill_reconnect_team(text, text, uuid, text[]) from public;
grant execute on function public.rc_admin_fill_reconnect_team(text, text, uuid, text[]) to service_role;

