-- A ReConnect recruit leaves the team they joined (lib/reconnect-missions.ts
-- leaveRecruitTeam).
--
-- A recruit is joined to a mission on a district they are NOT restoring —
-- Urmi Terrace's Home Base seat (config.crossDistrictSeats). Quest Exit
-- (rc_quest_skip_v2) cannot serve them: it is a priced skip that waives the
-- quest on the leaver's own district attempt, and a recruit has none here. So
-- a recruit had no way out at all short of the mission's 7-day expiry.
--
-- Free, and shaped like rc_reconnect_remove_participant's joined branch:
--   * the row becomes 'left' with contribution_frozen, so the team keeps every
--     play the recruit pooled (deleting it is what used to cost teams their
--     streams);
--   * p_scrobble_high_water refuses the exit if a scrobble landed after the
--     contribution snapshot, so the frozen number is never short (the caller
--     retries with a fresh snapshot);
--   * the mission is cancelled if nobody joined is left.
-- It refuses anyone actively restoring the mission's district: that agent is
-- a local member, and their way out is the priced Quest Exit, which this must
-- never bypass.
create or replace function public.rc_reconnect_recruit_leave(
  p_agent text,
  p_mission uuid,
  p_contribution integer default 0,
  p_scrobble_high_water bigint default 0
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_m public.rc_reconnect_missions%rowtype;
  v_rows integer;
begin
  select * into v_m from public.rc_reconnect_missions where id = p_mission for update;
  if not found then return jsonb_build_object('success', false, 'error', 'mission_not_found'); end if;
  if v_m.status <> 'open' then return jsonb_build_object('success', false, 'error', 'mission_' || v_m.status); end if;

  if exists (
    select 1 from public.rc_player_districts
     where agent_no = p_agent and district_id = v_m.district_id and status = 'active'
  ) then
    return jsonb_build_object('success', false, 'error', 'use_quest_exit');
  end if;

  if exists (
    select 1 from public.rc_scrobbles
     where agent_no = p_agent and id > p_scrobble_high_water
  ) then
    return jsonb_build_object('success', false, 'error', 'contribution_changed');
  end if;

  update public.rc_reconnect_participants
     set status = 'left', left_at = now(), contribution_frozen = greatest(0, coalesce(p_contribution, 0))
   where mission_id = p_mission and agent_no = p_agent and status = 'joined';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then return jsonb_build_object('success', false, 'error', 'not_in_mission'); end if;

  if not exists (
    select 1 from public.rc_reconnect_participants
     where mission_id = p_mission and status = 'joined'
  ) then
    update public.rc_reconnect_missions set status = 'cancelled'
     where id = p_mission and status = 'open';
  end if;
  return jsonb_build_object('success', true, 'contributionKept', greatest(0, coalesce(p_contribution, 0)));
end;
$$;

revoke all on function public.rc_reconnect_recruit_leave(text, uuid, integer, bigint) from public, anon, authenticated;
grant execute on function public.rc_reconnect_recruit_leave(text, uuid, integer, bigint) to service_role;
