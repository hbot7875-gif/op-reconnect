-- Tae Pier's ReConnect quest asks for a team of nine, and the district cannot
-- supply one.
--
-- Measured 2026-10-06: exactly 9 agents have Tae Pier active, and one of them
-- (AGENT043) already completed this goal in an earlier mission, which makes
-- them ineligible to join another -- eligiblePoolForGoal excludes them and
-- rc_admin_fill_reconnect_team returns agent_not_eligible for them. So the
-- largest roster the district can assemble is 8, and a 9-agent quest can never
-- finish. Mission c30571a5 sat at 7/9 for a week and was 23 hours from expiry
-- with two members (AGENT060 at 11/11 track goals, AGENT087 one play short)
-- blocked behind it. The goal's crossDistrictEligible is null, so no helper
-- from another district can make up the difference either.
--
-- Lowering the requirement to 8 is the smallest change that makes the quest
-- completable. It is NOT a difficulty cut dressed up as a fix: eight of nine
-- agents still have to join and each still has to stream.
--
-- Two places carry the number, and changing only one would leave the bug in
-- place for the people already here:
--
--   1. rc_goals.config.requiredAgents -- read by freezeGoals when a district
--      is ACTIVATED, so this alone would only help agents who arrive later.
--   2. rc_player_districts.goals.reconnect.config.requiredAgents -- the FROZEN
--      copy, and the one openReconnectMission actually reads
--      (myReconnectGoal(pd) -> reconnect.config.requiredAgents, lib/
--      reconnect-missions.ts). Without this, every agent currently on Tae Pier
--      would open their next mission at 9 and hit the same wall.
--
-- Deliberately NOT touched:
--   * mission rows. required_agents is copied onto a mission at creation and
--     the open mission was already corrected operationally; the five finished
--     ones keep the number they ran under, because rewriting them would be
--     falsifying history.
--   * 'restored' district rows. Those are finished and spawn no new missions,
--     and a later re-activation re-freezes from rc_goals, which is now 8.
--   * every other district's reconnect goal.

do $$
declare
  v_goal_before integer;
  v_frozen_nine integer;
  v_n integer;
begin
  select (config->>'requiredAgents')::integer into v_goal_before
    from public.rc_goals where id = 'taepier-team-boost-9';
  if v_goal_before is null then
    raise exception 'taepier-team-boost-9 not found';
  end if;
  if v_goal_before <> 9 then
    raise notice 'goal already reads %, leaving it alone', v_goal_before;
  end if;

  -- 1. the goal, for every future activation
  update public.rc_goals
     set config = jsonb_set(config, '{requiredAgents}', '8'::jsonb),
         updated_at = now()
   where id = 'taepier-team-boost-9'
     and (config->>'requiredAgents')::integer = 9;
  get diagnostics v_n = row_count;
  raise notice 'goal rows updated: %', v_n;

  -- 2. the frozen copy on every agent still ON Tae Pier
  select count(*) into v_frozen_nine
    from public.rc_player_districts
   where status = 'active' and district_id = 'mono-tae-pier'
     and goals->'reconnect'->>'id' = 'taepier-team-boost-9'
     and goals->'reconnect'->'config'->>'requiredAgents' = '9';

  update public.rc_player_districts
     set goals = jsonb_set(goals, '{reconnect,config,requiredAgents}', '8'::jsonb)
   where status = 'active' and district_id = 'mono-tae-pier'
     and goals->'reconnect'->>'id' = 'taepier-team-boost-9'
     and goals->'reconnect'->'config'->>'requiredAgents' = '9';
  get diagnostics v_n = row_count;
  if v_n <> v_frozen_nine then
    raise exception 'expected to update % frozen districts, updated %', v_frozen_nine, v_n;
  end if;
  raise notice 'frozen districts updated: %', v_n;

  -- Nothing may be left at 9 on an active Tae Pier district, and the goal
  -- itself must now read 8.
  if exists (
    select 1 from public.rc_player_districts
     where status = 'active' and district_id = 'mono-tae-pier'
       and goals->'reconnect'->>'id' = 'taepier-team-boost-9'
       and goals->'reconnect'->'config'->>'requiredAgents' <> '8'
  ) then
    raise exception 'an active Tae Pier district still does not read 8';
  end if;
  if (select (config->>'requiredAgents')::integer
        from public.rc_goals where id = 'taepier-team-boost-9') <> 8 then
    raise exception 'goal does not read 8 after update';
  end if;

  -- The rest of the frozen reconnect config must be untouched: only the one
  -- key changes, so teamBoost, crossDistrictEligible and variant survive.
  if exists (
    select 1 from public.rc_player_districts
     where status = 'active' and district_id = 'mono-tae-pier'
       and goals->'reconnect'->>'id' = 'taepier-team-boost-9'
       and (goals->'reconnect'->'config'->'teamBoost'->>'maxPicks' is null
            or goals->'reconnect'->>'variant' <> 'connect')
  ) then
    raise exception 'frozen reconnect config lost a field during the update';
  end if;
end $$;
