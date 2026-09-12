-- Mode integrity — audit trail for automatic mode upgrades (mode-guard.ts).
-- Confirmed live 2026-09-12: several Easy-mode agents were sustaining daily
-- stream volume that physically cannot fit in 24 hours for one device
-- (raw_streams * ~180s/track > 86,400s) on many separate days each,
-- exploiting Easy mode's small targets and fast XP rate at several
-- devices' worth of real throughput. Nothing before this capped daily
-- volume by mode at all.
alter table public.rc_players add column if not exists mode_upgraded_at timestamptz;
alter table public.rc_players add column if not exists mode_upgraded_from text;
comment on column public.rc_players.mode_upgraded_at is
  'Set when checkModeAbuse (mode-guard.ts) auto-upgraded this agent''s mode after 3+ days over their declared mode''s physical daily ceiling in a trailing 7-day window. Null = never auto-upgraded.';
comment on column public.rc_players.mode_upgraded_from is
  'The mode this agent was auto-upgraded FROM, alongside mode_upgraded_at — current mode lives in rc_players.mode as always.';
