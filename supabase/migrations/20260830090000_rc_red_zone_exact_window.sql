-- Red Zone now counts timestamped scrobbles inside one exact event window.
-- Cache the last exact refresh so 100 player polls do not each rescan the
-- same event. Launches use an advisory-locked RPC so the check + insert is
-- atomic without rewriting or deleting any event already in progress.

alter table rc_defuse_events
  add column if not exists qualified_agents integer not null default 0
    check (qualified_agents >= 0);

alter table rc_defuse_events
  add column if not exists progress_refreshed_at timestamptz;

create or replace function rc_red_zone_launch(
  p_title text,
  p_message text,
  p_target integer,
  p_reward_xp integer,
  p_minimum_streams integer,
  p_active_from timestamptz,
  p_active_until timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event rc_defuse_events%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('rc_red_zone_launch'));
  if exists (select 1 from rc_defuse_events where status = 'active') then
    raise exception 'red_zone_already_active' using errcode = 'P0001';
  end if;

  insert into rc_defuse_events (
    title, message, target, reward_xp, minimum_streams, stream_baseline,
    progress, qualified_agents, progress_refreshed_at, active_from, active_until
  ) values (
    p_title, p_message, p_target, p_reward_xp, p_minimum_streams, '{}'::jsonb,
    0, 0, null, p_active_from, p_active_until
  ) returning * into v_event;

  return to_jsonb(v_event);
end;
$$;

revoke all on function rc_red_zone_launch(text, text, integer, integer, integer, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function rc_red_zone_launch(text, text, integer, integer, integer, timestamptz, timestamptz)
  to service_role;

-- NOT VALID avoids blocking deployment on a malformed historical row while
-- still enforcing these rules for every launch from now on.
alter table rc_defuse_events
  add constraint rc_defuse_target_positive check (target > 0) not valid;

alter table rc_defuse_events
  add constraint rc_defuse_reward_positive check (reward_xp > 0) not valid;

alter table rc_defuse_events
  add constraint rc_defuse_window_order check (active_until > active_from) not valid;
