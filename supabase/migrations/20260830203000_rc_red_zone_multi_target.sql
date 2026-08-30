-- A Red Zone can now name more than one thing to stream, and mix kinds:
-- "the ARIRANG album and Keep Swimming" is one event with one shared goal.
--
-- target_keys already pooled every matching key into one array, so the
-- counting side needed nothing. What was missing was a way to say WHICH
-- things were picked, per entry, so the player copy can compose the phrase
-- ("the X album" vs plain "X") instead of guessing from one flat label.
--
-- target_names is that list: [{"name": "ARIRANG", "kind": "album"}, ...] in
-- the order the admin picked them. Null on every existing row and on any
-- single-target launch from before this — the client falls back to
-- target_label/target_kind there, so nothing in flight changes meaning.
--
-- target_goal_id keeps its old job (provenance for a single-goal launch)
-- and is simply null when several were picked; target_keys stays the only
-- thing matching ever reads.

alter table rc_defuse_events
  add column if not exists target_names jsonb;

comment on column rc_defuse_events.target_names is
  'Frozen [{name, kind}] list of what this event asks players to stream, in pick order. Null means read target_label/target_kind instead (single-target launches).';
comment on column rc_defuse_events.target_kind is
  'track | album | null. With several targets picked this is album only when every one of them is an album, otherwise track. Null means every eligible BTS play counts.';

-- target_names must line up with the rest of the frozen target: names
-- without a kind/label/keys would leave the UI composing a phrase for an
-- event that counts everything.
alter table rc_defuse_events
  add constraint rc_defuse_target_names_shape check (
    target_names is null
    or (target_kind is not null
        and jsonb_typeof(target_names) = 'array'
        and jsonb_array_length(target_names) > 0)
  ) not valid;

-- The launch RPC carries the new list. Dropped and recreated rather than
-- overloaded so only one signature can ever be called.
drop function if exists rc_red_zone_launch(text, text, integer, integer, integer, timestamptz, timestamptz, text, text, text, jsonb);

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
  p_target_keys jsonb default null,
  p_target_names jsonb default null
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
    target_goal_id, target_kind, target_label, target_keys, target_names
  ) values (
    p_title, p_message, p_target, p_reward_xp, p_minimum_streams, '{}'::jsonb,
    0, 0, null, p_active_from, p_active_until,
    p_target_goal_id, p_target_kind, p_target_label, p_target_keys, p_target_names
  ) returning * into v_event;

  return to_jsonb(v_event);
end;
$$;

revoke all on function rc_red_zone_launch(text, text, integer, integer, integer, timestamptz, timestamptz, text, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function rc_red_zone_launch(text, text, integer, integer, integer, timestamptz, timestamptz, text, text, text, jsonb, jsonb)
  to service_role;
