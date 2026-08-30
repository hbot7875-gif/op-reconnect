-- Trusted district playlist makers.
-- Shared picks must be attached to a real district so the Vault can place
-- them above automatically matched Candy Star playlists without asking
-- players to understand how the playlist was made.

alter table generated_playlists
  add column if not exists district_id text references rc_districts (id) on delete set null;

create index if not exists generated_playlists_district_vault_idx
  on generated_playlists (district_id, status, source, created_at desc);

-- Seeded EMPTY on purpose. An earlier draft copied badge_editors, which
-- would have handed playlist-adding rights to everyone trusted with badge
-- art — a different job and a different set of people. AGENT000 is allowed
-- unconditionally in code (ALWAYS_PLAYLIST_MAKER in playlist-vault.ts), so
-- the site owner can add playlists immediately and grant others by adding
-- their agent numbers to this array.
insert into rc_config (key, value)
values ('playlist_makers', '[]'::jsonb)
on conflict (key) do nothing;

comment on column generated_playlists.district_id is
  'District selected by a trusted playlist maker. Generated rows may remain null and are matched from their saved focus/album recipe.';

