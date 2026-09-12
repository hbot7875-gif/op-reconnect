-- Legacy audit fields retained for any upgrades written by the early
-- mode-volume experiment. The current check is review-only: provider totals
-- do not prove device count, and the game does not auto-change modes.
alter table public.rc_players add column if not exists mode_upgraded_at timestamptz;
alter table public.rc_players add column if not exists mode_upgraded_from text;
comment on column public.rc_players.mode_upgraded_at is
  'Legacy audit field. Current high-volume checks are review-only and do not write this field.';
comment on column public.rc_players.mode_upgraded_from is
  'Legacy audit field. Current high-volume checks do not change player modes.';
