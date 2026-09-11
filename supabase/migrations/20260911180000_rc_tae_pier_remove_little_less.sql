-- "Little Less" was never meant to be a track — in the original request it
-- was a target-size qualifier on a neighboring track ("kig - little less"),
-- same shorthand pattern already seen (and correctly dropped, not turned
-- into a goal) when building Carabonara Diner's checklist. Misread as a
-- 12th track goal here. Removed entirely, template and both agents who'd
-- already frozen it in (AGENT046, AGENT038 — neither has a single counted
-- play against it, confirmed against rc_daily_activity before writing this).
update rc_goals set active = false where id = 'taepier-little-less';

update rc_player_districts
set goals = jsonb_set(
  goals, '{trackGoals}',
  (select jsonb_agg(g) from jsonb_array_elements(goals->'trackGoals') g where g->>'id' != 'taepier-little-less')
)
where district_id = 'mono-tae-pier' and status = 'active'
  and goals->'trackGoals' @> '[{"id": "taepier-little-less"}]'::jsonb;
