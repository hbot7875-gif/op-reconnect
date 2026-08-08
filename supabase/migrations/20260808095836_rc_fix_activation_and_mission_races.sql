-- Two more races found the same way the Charge Cell one was: a "check,
-- then write" done as separate application-side steps, not one locked
-- server-side unit.

-- 1) Two districts active at once. startDistrict (handlers.ts) reads
-- rc_player_districts, checks no row has status='active', then inserts a
-- new active row for the requested district — as two separate steps. A
-- double-tap on two DIFFERENT districts can pass the check on both before
-- either insert lands, since the insert's own primary key
-- (agent_no, district_id) doesn't collide across different district_ids.
-- A partial unique index makes "at most one active row per agent" a real
-- database invariant instead of an app-level check with a race window —
-- the second insert now fails outright (23505), which handlers.ts's
-- existing insErr handling already turns into a clean error.
create unique index if not exists rc_player_districts_one_active_per_agent
  on rc_player_districts (agent_no)
  where status = 'active';

-- 2) Reconnect Missions overfilling past required_agents. joinReconnectMission
-- and respondReconnectInvite (accept) both counted current 'joined'
-- participants, checked it was under required_agents, then wrote — same
-- two-separate-steps shape. Two agents racing a mission's last open slot
-- (open matchmaking, or two invitees accepting near-simultaneously) could
-- both pass the count check before either write landed, seating more
-- agents than the mission was configured for.
--
-- Locking the mission row itself (FOR UPDATE) serializes every concurrent
-- join/accept attempt against that one mission — a second transaction
-- trying the same lock just waits for the first to finish, so its capacity
-- count is always read fresh, post-write, not stale.

create or replace function public.rc_reconnect_join_open(
  p_mission_id uuid,
  p_agent_no text
) returns table(joined boolean, error text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_required integer;
  v_status text;
  v_joined_count integer;
  v_inserted integer;
begin
  select required_agents, status into v_required, v_status
  from rc_reconnect_missions where id = p_mission_id for update;

  if v_status is null then
    return query select false, 'mission_not_found'; return;
  end if;
  if v_status <> 'open' then
    return query select false, ('mission_' || v_status); return;
  end if;

  select count(*) into v_joined_count from rc_reconnect_participants
  where mission_id = p_mission_id and status = 'joined';

  if v_joined_count >= v_required then
    return query select false, 'mission_full'; return;
  end if;

  insert into rc_reconnect_participants (mission_id, agent_no, status, joined_at)
  values (p_mission_id, p_agent_no, 'joined', now())
  on conflict (mission_id, agent_no) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return query select false, 'already_in_mission'; return;
  end if;

  return query select true, null::text;
end;
$$;

revoke all on function public.rc_reconnect_join_open(uuid, text) from public;
grant execute on function public.rc_reconnect_join_open(uuid, text) to service_role;

create or replace function public.rc_reconnect_accept_invite(
  p_mission_id uuid,
  p_agent_no text
) returns table(joined boolean, error text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_required integer;
  v_status text;
  v_joined_count integer;
  v_invite_status text;
  v_updated integer;
begin
  select required_agents, status into v_required, v_status
  from rc_reconnect_missions where id = p_mission_id for update;

  if v_status is null then
    return query select false, 'mission_not_found'; return;
  end if;
  if v_status <> 'open' then
    return query select false, ('mission_' || v_status); return;
  end if;

  select status into v_invite_status from rc_reconnect_participants
  where mission_id = p_mission_id and agent_no = p_agent_no;

  if v_invite_status is distinct from 'invited' then
    return query select false, 'no_pending_invite'; return;
  end if;

  select count(*) into v_joined_count from rc_reconnect_participants
  where mission_id = p_mission_id and status = 'joined';

  if v_joined_count >= v_required then
    return query select false, 'mission_full'; return;
  end if;

  update rc_reconnect_participants set status = 'joined', joined_at = now()
  where mission_id = p_mission_id and agent_no = p_agent_no and status = 'invited';
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return query select false, 'no_pending_invite'; return;
  end if;

  return query select true, null::text;
end;
$$;

revoke all on function public.rc_reconnect_accept_invite(uuid, text) from public;
grant execute on function public.rc_reconnect_accept_invite(uuid, text) to service_role;
