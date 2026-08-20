-- Rebalance for Map of Seven Crossing (see 20260819200000): nobody has
-- activated this district yet (0 rows in rc_player_districts), so it's
-- safe to adjust targets directly rather than leave the original flat
-- 20/track, 3-passes/album spread in place — compared against Dazzledew
-- Fountain (a real, already-played district in the same ward and
-- difficulty family, whose per-track base ran 20-50 and per-album base
-- ran 2-5), the original spread sat at the easy end everywhere instead of
-- varying like Dazzledew's did.
--
-- Track bump: Haegeum, Wild Flower, Killin' It Girl, and Winter Ahead are
-- title/lead tracks — bumped from base 20 to base 30 streams (so 150 at
-- medium, 300 at hard). The other four tracks (Blood Sweat & Tears, The
-- Astronaut, HOME, Normal) stay at base 20 — b-sides/older catalog,
-- lighter by design.
update rc_goals set target = 30, updated_at = now()
 where id in ('mos7-track-haegeum', 'mos7-track-wild-flower',
              'mos7-track-killin-it-girl', 'mos7-track-winter-ahead');

-- Missing track goal: SWIM was never added despite being central to this
-- event (also the VMA voting mission's song) — added at the same base 30
-- as the other lead tracks above, same sort-order band as the rest of
-- this district's track goals.
insert into rc_goals
  (id, kind, label, artist, aliases, tracks, target, active, sort_order,
   district_id, variant, config)
values
  ('mos7-track-swim', 'track', 'SWIM', 'BTS', '["Swim"]'::jsonb,
    null, 30, true, 208, 'mono-map-of-seven-crossing', null, '{}'::jsonb)
on conflict (id) do update set
  kind = excluded.kind, label = excluded.label, artist = excluded.artist,
  aliases = excluded.aliases, tracks = excluded.tracks, target = excluded.target,
  active = excluded.active, sort_order = excluded.sort_order,
  district_id = excluded.district_id, variant = excluded.variant,
  config = excluded.config, updated_at = now();

-- Album targets varied by album length instead of a flat 3 passes for all
-- five, roughly balancing total song-plays per album (track count x
-- passes) into the same band Dazzledew's spread implied:
--   ARIRANG (14 tracks)              3 -> 2 passes  (28 song-plays)
--   Keep Swimming (9 tracks)         3 -> 3 passes  (27 song-plays)
--   LY 轉 'Tear' (11 tracks)          3 -> 2 passes  (22 song-plays)
--   Happy (6 tracks)                 3 -> 4 passes  (24 song-plays)
--   Permission to Dance (3 tracks)   3 -> 6 passes  (18 song-plays)
update rc_goals set target = 2, updated_at = now() where id = 'mos7-album-arirang';
update rc_goals set target = 3, updated_at = now() where id = 'mos7-album-keep-swimming';
update rc_goals set target = 2, updated_at = now() where id = 'mos7-album-love-yourself-tear';
update rc_goals set target = 4, updated_at = now() where id = 'mos7-album-happy';
update rc_goals set target = 6, updated_at = now() where id = 'mos7-album-permission-to-dance';
