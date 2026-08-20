-- Candy Star Playlist Vault
--
-- Every successful Candy Star generation already lands in
-- generated_playlists.  This migration turns that write-only log into a
-- reusable community library and adds two small, agent-scoped interaction
-- tables: bookmarks and broken-link reports.  Manual Spotify shares use the
-- same library table with source='shared', so generated and shared playlists
-- have one consistent browse surface.

alter table generated_playlists
  add column if not exists source text not null default 'generated',
  add column if not exists status text not null default 'active',
  add column if not exists report_count integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

do $$ begin
  alter table generated_playlists
    add constraint generated_playlists_source_check
    check (source in ('generated', 'shared'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table generated_playlists
    add constraint generated_playlists_status_check
    check (status in ('active', 'broken', 'hidden'));
exception when duplicate_object then null;
end $$;

create index if not exists generated_playlists_vault_idx
  on generated_playlists (status, created_at desc);
create index if not exists generated_playlists_agent_vault_idx
  on generated_playlists (agent_no, created_at desc);
create index if not exists generated_playlists_spotify_id_idx
  on generated_playlists (playlist_id);

create table if not exists rc_playlist_saves (
  agent_no text not null references rc_agents (agent_no) on delete cascade,
  playlist_id text not null,
  created_at timestamptz not null default now(),
  primary key (agent_no, playlist_id)
);

create index if not exists rc_playlist_saves_playlist_idx
  on rc_playlist_saves (playlist_id);

create table if not exists rc_playlist_reports (
  agent_no text not null references rc_agents (agent_no) on delete cascade,
  playlist_id text not null,
  reason text not null default 'broken_link',
  created_at timestamptz not null default now(),
  primary key (agent_no, playlist_id)
);

create index if not exists rc_playlist_reports_playlist_idx
  on rc_playlist_reports (playlist_id);

-- These tables are only reached through the session-checked edge function.
-- Keep direct anon/authenticated PostgREST access closed.
alter table rc_playlist_saves enable row level security;
alter table rc_playlist_reports enable row level security;
alter table generated_playlists enable row level security;
revoke all on table rc_playlist_saves from anon, authenticated;
revoke all on table rc_playlist_reports from anon, authenticated;
revoke all on table generated_playlists from anon, authenticated;

comment on table rc_playlist_saves is
  'Agent bookmarks for the Candy Star Playlist Vault. Playlists remain shared; saving never claims ownership.';
comment on table rc_playlist_reports is
  'One broken-link report per agent and Spotify playlist. Three unique reports hide a playlist from the Vault.';
