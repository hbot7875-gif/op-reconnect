-- Home Base's own reconnect goal (connect-2-agents) now recruits from
-- anyone active anywhere, not just a named list of other districts.
--
-- Site owner's call: Home Base is exactly where a brand-new agent has the
-- fewest teammates of their own — it already has the largest active
-- population in the game, but that doesn't help a newcomer standing IN
-- Home Base with nobody free there right now. Widening it to the whole
-- active population (the new ANY_DISTRICT '*' wildcard in
-- reconnect-missions.ts) is what actually makes a new user's very first
-- team-up step easy, not just less-hard.
--
-- Applied live already (see the same note on the Hopesize migration for
-- why this isn't run through db push yet — two unrelated pending
-- migrations from the in-progress quest-share feature would come along).
update rc_goals
set config = jsonb_set(config, '{crossDistrictEligible}', '["*"]'::jsonb)
where id = 'connect-2-agents';

update rc_player_districts
set goals = jsonb_set(goals, '{reconnect,config,crossDistrictEligible}', '["*"]'::jsonb)
where district_id = 'relay-zero-hq' and status = 'active'
  and goals->'reconnect'->>'id' = 'connect-2-agents';
