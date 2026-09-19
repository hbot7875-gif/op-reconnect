-- One-off support change for AGENT103's current district: re-freeze its goal
-- targets at Easy-mode numbers and grant +3 days (72h) of grace. Same
-- approach as 20260826150000_rc_agent000_deadline_bonus.sql: the grace goes in
-- deadline_extension_hours (separate from activated_at, so the stream-counting
-- window isn't moved, and separate from the player's own Extension Charge).
-- Goal targets mirror districts.ts's goalTargetForMode: flatTarget goals keep
-- their base target, everyone else is round(base * modes.easy.multiplier),
-- minimum 1. Reconnect goals and everything else in the frozen blob are left
-- exactly as they were.
do $$
declare
  v_active_count integer;
  v_mult numeric;
  v_goals jsonb;
  v_tracks jsonb;
  v_albums jsonb;
begin
  select count(*) into v_active_count
  from public.rc_player_districts
  where agent_no = 'AGENT103' and status = 'active';

  if v_active_count <> 1 then
    raise exception 'Expected exactly one active district for AGENT103, found %', v_active_count;
  end if;

  select coalesce((value->'easy'->>'multiplier')::numeric, 1) into v_mult
  from public.rc_config where key = 'modes';
  v_mult := coalesce(v_mult, 1);

  select goals into v_goals
  from public.rc_player_districts
  where agent_no = 'AGENT103' and status = 'active';

  select coalesce(jsonb_agg(
    jsonb_set(t.elem, '{target}', to_jsonb(
      case
        when g.id is null then (t.elem->>'target')::int
        when coalesce((g.config->>'flatTarget')::boolean, false) then g.target
        else greatest(1, round(g.target * v_mult))::int
      end)) order by t.ord), '[]'::jsonb)
  into v_tracks
  from jsonb_array_elements(coalesce(v_goals->'trackGoals', '[]'::jsonb)) with ordinality as t(elem, ord)
  left join public.rc_goals g on g.id = t.elem->>'id';

  select coalesce(jsonb_agg(
    jsonb_set(t.elem, '{target}', to_jsonb(
      case
        when g.id is null then (t.elem->>'target')::int
        when coalesce((g.config->>'flatTarget')::boolean, false) then g.target
        else greatest(1, round(g.target * v_mult))::int
      end)) order by t.ord), '[]'::jsonb)
  into v_albums
  from jsonb_array_elements(coalesce(v_goals->'albumGoals', '[]'::jsonb)) with ordinality as t(elem, ord)
  left join public.rc_goals g on g.id = t.elem->>'id';

  update public.rc_player_districts
  set goals = jsonb_set(jsonb_set(jsonb_set(jsonb_set(goals,
        '{trackGoals}', v_tracks),
        '{albumGoals}', v_albums),
        '{meta,mode}', '"easy"'),
        '{meta,multiplier}', to_jsonb(v_mult)),
      deadline_extension_hours = deadline_extension_hours + 72
  where agent_no = 'AGENT103' and status = 'active';
end;
$$;
