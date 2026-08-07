-- An earned badge can be worn as the agent's public icon. The badge id is
-- validated by the Edge Function before it is saved.
alter table public.rc_players
  add column if not exists equipped_badge_id text;
