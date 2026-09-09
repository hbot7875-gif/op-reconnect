-- Fix: "Old Town Road" never checking off on the This Is RM reconnect
-- checklist (mcd-reconnect-rm-checklist). Reported live.
--
-- Same class of bug as the earlier Champion-key fix. The checklist was
-- built from the Spotify playlist listing's title, "Old Town Road (feat.
-- RM of BTS) - Seoul Town Road Remix" (dash-separated suffix, not
-- parenthetical, so stripVersionSuffix leaves it whole -> normalizes to
-- "old town road feat rm of bts seoul town road remix"). Real scrobbles
-- report at least three different formats for the exact same song
-- (confirmed against live rc_scrobbles rows):
--   - "...- Seoul Town Road Remix"          -> matches the original key
--   - "...(Seoul Town Road Remix)"          -> collapses to "old town road"
--   - "...[Seoul Town Road Remix]"          -> collapses to "old town road"
-- The last two both have real repeated (...) / [...] groups, which
-- stripVersionSuffix strips trailing groups from repeatedly — two groups
-- in a row strip down to bare "Old Town Road", same key as the plain solo
-- Lil Nas X original (also real, unrelated scrobbles exist under that
-- bare title). Adding it as an extra key follows the same accepted
-- tradeoff the Champion fix already made: broader matching over perfect
-- fidelity, consistent with how this checklist has no artist-allowlist
-- filtering to begin with.
--
-- Both places patched: rc_goals (the template new activations freeze
-- from) and every currently-active Carabonara Diner agent's already-
-- frozen rc_player_districts.goals.reconnect.config.
update rc_goals
set config = jsonb_set(config, '{checklist,tracks,34,keys}', '["old town road feat rm of bts seoul town road remix","old town road"]'::jsonb)
where id = 'mcd-reconnect-rm-checklist'
  and config->'checklist'->'tracks'->34->>'label' = 'Old Town Road (feat. RM of BTS) - Seoul Town Road Remix';

update rc_player_districts
set goals = jsonb_set(goals, '{reconnect,config,checklist,tracks,34,keys}', '["old town road feat rm of bts seoul town road remix","old town road"]'::jsonb)
where district_id = 'mono-carabonara-diner' and status = 'active'
  and goals->'reconnect'->>'id' = 'mcd-reconnect-rm-checklist'
  and goals->'reconnect'->'config'->'checklist'->'tracks'->34->>'label' = 'Old Town Road (feat. RM of BTS) - Seoul Town Road Remix';
