-- Trusted district playlist makers.
-- Shared picks must be attached to a real district so the Vault can place
-- them above automatically matched Candy Star playlists without asking
-- players to understand how the playlist was made.

alter table generated_playlists
  add column if not exists district_id text references rc_districts (id) on delete set null;

create index if not exists generated_playlists_district_vault_idx
  on generated_playlists (district_id, status, source, created_at desc);

insert into rc_config (key, value)
select 'playlist_makers', coalesce(
  (select value from rc_config where key = 'badge_editors'),
  '[]'::jsonb
)
on conflict (key) do nothing;

comment on column generated_playlists.district_id is
  'District selected by a trusted playlist maker. Generated rows may remain null and are matched from their saved focus/album recipe.';

