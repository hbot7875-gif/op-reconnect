-- Adds the source playlist to the already-live Carabonara checklist config.
-- The original snapshot remains frozen; this only gives players a direct way
-- to open the same playlist while completing their individual tick-list.
update rc_goals
set config = jsonb_set(
  coalesce(config, '{}'::jsonb),
  '{checklist,playlistUrl}',
  to_jsonb('https://open.spotify.com/playlist/37i9dQZF1DXa3GFRsPDpwq'::text),
  true
)
where id = 'mcd-reconnect-rm-checklist'
  and district_id = 'mono-carabonara-diner';
