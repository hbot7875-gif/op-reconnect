-- Presence privacy. Keep real last_seen_at updates for account safety/admin
-- diagnostics, but let a player opt out of every player-facing "online now"
-- surface. The site owner asked to start hidden immediately; everyone else
-- stays visible unless they choose the same setting themselves.
alter table public.rc_players
  add column if not exists appear_offline boolean not null default false;

update public.rc_players
set appear_offline = true
where agent_no = 'AGENT000';

