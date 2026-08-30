-- Red Zone can now name WHAT to stream: one existing goal (a track or a
-- whole album) instead of "any eligible BTS play counts".
--
-- The event points at rc_goals for provenance, but it also FREEZES the
-- label, kind and match keys at launch. Same rule districts already follow
-- (freezeGoals in districts.ts): an admin renaming a goal, editing its
-- aliases or deleting it mid-event must never retroactively change what a
-- live event is asking players for, or silently change which plays count
-- halfway through. target_goal_id is therefore ON DELETE SET NULL — losing
-- the provenance link is fine, losing the frozen rules is not.
--
-- All three target columns null = the historical behavior, unchanged: every
-- eligible BTS play counts. That is what every existing row means, and what
-- a launch with no target picked still means.

alter table rc_defuse_events
  add column if not exists target_goal_id text references rc_goals(id) on delete set null;

alter table rc_defuse_events
  add column if not exists target_kind text
    check (target_kind is null or target_kind in ('track', 'album'));

alter table rc_defuse_events
  add column if not exists target_label text;

-- Normalized match keys (normKeyFull of the goal's label + every alias; for
-- an album, every track's keys pooled). jsonb array of text, matching how
-- rc_player_districts.goals already stores frozen keys.
alter table rc_defuse_events
  add column if not exists target_keys jsonb;

comment on column rc_defuse_events.target_goal_id is
  'The rc_goals row this Red Zone was launched from, for provenance only. Matching uses the frozen target_keys, never a live re-read of the goal.';
comment on column rc_defuse_events.target_kind is
  'track | album | null. Null means every eligible BTS play counts (the original behavior).';
comment on column rc_defuse_events.target_label is
  'Frozen display name shown to players ("Haegeum", "ARIRANG"). Frozen at launch so renaming the goal cannot change a live event.';
comment on column rc_defuse_events.target_keys is
  'Frozen jsonb array of normalized track keys that count for this event. Null/empty means everything eligible counts.';

-- A target is all-or-nothing: a kind with no keys would silently count
-- nothing, and keys with no label would leave the UI with no name to show.
alter table rc_defuse_events
  add constraint rc_defuse_target_complete check (
    (target_kind is null and target_label is null and target_keys is null)
    or (target_kind is not null and target_label is not null
        and jsonb_typeof(target_keys) = 'array' and jsonb_array_length(target_keys) > 0)
  ) not valid;

-- The launch RPC gains the frozen target. Dropped and recreated rather than
-- overloaded so only one signature can ever be called.
drop function if exists rc_red_zone_launch(text, text, integer, integer, integer, timestamptz, timestamptz);

create or replace function rc_red_zone_launch(
  p_title text,
  p_message text,
  p_target integer,
  p_reward_xp integer,
  p_minimum_streams integer,
  p_active_from timestamptz,
  p_active_until timestamptz,
  p_target_goal_id text default null,
  p_target_kind text default null,
  p_target_label text default null,
  p_target_keys jsonb default null
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
    progress, qualified_agents, progress_refreshed_at, active_from, active_until,
    target_goal_id, target_kind, target_label, target_keys
  ) values (
    p_title, p_message, p_target, p_reward_xp, p_minimum_streams, '{}'::jsonb,
    0, 0, null, p_active_from, p_active_until,
    p_target_goal_id, p_target_kind, p_target_label, p_target_keys
  ) returning * into v_event;

  return to_jsonb(v_event);
end;
$$;

revoke all on function rc_red_zone_launch(text, text, integer, integer, integer, timestamptz, timestamptz, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function rc_red_zone_launch(text, text, integer, integer, integer, timestamptz, timestamptz, text, text, text, jsonb)
  to service_role;
