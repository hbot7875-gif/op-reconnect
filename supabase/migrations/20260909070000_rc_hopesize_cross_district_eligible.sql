-- Let the Hopesize Station 3-agent reconnect goal recruit help from Home
-- Base (relay-zero-hq) too, not just Hopesize's own dwindling pool.
--
-- AGENT080 + AGENT118 have been stuck at 2/3: the district's only
-- non-retired, not-already-done candidates were exhausted, while both
-- their own restoration deadlines kept ticking (AGENT118 with under a day
-- left and no extension charge left to spend on this attempt). Home Base
-- is nearly every agent's starting point, making it the obvious recruiting
-- pool — see reconnect-missions.ts's new crossDistrictEligible support.
--
-- Two places carry this config, same lesson as the earlier Champion-key
-- fix: rc_goals (what new activations freeze from) and the two already-
-- active agents' own already-frozen rc_player_districts.goals.reconnect
-- .config, since freezeGoals() copies it once at activation and a rc_goals
-- edit alone never reaches someone already mid-district.
update rc_goals
set config = jsonb_set(config, '{crossDistrictEligible}', '["relay-zero-hq"]'::jsonb)
where id = 'hopesize-connect-3-agents';

update rc_player_districts
set goals = jsonb_set(goals, '{reconnect,config,crossDistrictEligible}', '["relay-zero-hq"]'::jsonb)
where district_id = 'mono-hopesize-station' and status = 'active'
  and goals->'reconnect'->>'id' = 'hopesize-connect-3-agents';
