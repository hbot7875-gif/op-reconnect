-- A fixed bridge between Easy (1.3x) and Medium (5x). This remains a
-- player choice: mode-volume checks only recommend reviewing the setting
-- and never rewrite a player's mode or an already-frozen district.
update public.rc_config
set value = jsonb_set(value, '{steady}', '{"label":"Easy+ — around 2 accounts","multiplier":2.5}'::jsonb, true)
  || jsonb_build_object('easy', (value->'easy') || '{"label":"Easy — 1 account"}'::jsonb)
where key = 'modes';

update public.rc_config
set value = value || jsonb_build_object(
  'streamsPerXpByMode',
  coalesce(value->'streamsPerXpByMode', '{}'::jsonb) || '{"steady":15}'::jsonb
)
where key = 'xp_rules';

alter table public.rc_players drop constraint if exists rc_players_mode_check;
alter table public.rc_players add constraint rc_players_mode_check
  check (mode = any (array['easy', 'steady', 'medium', 'hard', 'exam']));
