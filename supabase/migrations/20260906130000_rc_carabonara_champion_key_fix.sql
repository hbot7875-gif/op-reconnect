-- Fix: "Champion - Remix" never checking off on the This Is RM reconnect
-- checklist (mcd-reconnect-rm-checklist). Reported live by AGENT030 —
-- BOTZ showed 3 real jams of it that never counted.
--
-- Root cause: the checklist was built from the Spotify playlist listing's
-- title, "Champion - Remix" (normalizes to "champion remix"). Musicat
-- reports the same song with fully bracketed/parenthetical formatting
-- instead — "Champion (Remix) [feat. RM]" — and stripVersionSuffix strips
-- trailing (...)/[...] groups repeatedly, collapsing THAT title all the
-- way down to bare "champion". Confirmed against AGENT030's real
-- rc_scrobbles rows (source: musicat, exactly that title, 3x). Neither key
-- is wrong on its own; the checklist just needed both.
--
-- Two places carry this config: rc_goals (the live template new
-- activations freeze from) and every CURRENTLY ACTIVE agent's own already-
-- frozen rc_player_districts.goals.reconnect.config (freezeGoals() copies
-- it once at activation — a later rc_goals edit alone never reaches
-- someone already mid-district). Both patched so nobody has to leave and
-- restart Carabonara Diner to pick up the fix.
update rc_goals
set config = jsonb_set(config, '{checklist,tracks,39,keys}', '["champion remix","champion"]'::jsonb)
where id = 'mcd-reconnect-rm-checklist'
  and config->'checklist'->'tracks'->39->>'label' = 'Champion - Remix';

update rc_player_districts
set goals = jsonb_set(goals, '{reconnect,config,checklist,tracks,39,keys}', '["champion remix","champion"]'::jsonb)
where district_id = 'mono-carabonara-diner' and status = 'active'
  and goals->'reconnect'->>'id' = 'mcd-reconnect-rm-checklist'
  and goals->'reconnect'->'config'->'checklist'->'tracks'->39->>'label' = 'Champion - Remix';
