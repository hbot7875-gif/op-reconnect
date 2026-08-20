-- The "Permission to Dance" album goal for Map of Seven Crossing was
-- pointed at the wrong release: verified live tracklists against Spotify
-- (see session), and the intended album is PERMISSION TO DANCE ON STAGE -
-- LIVE (2025, 22 tracks), not the 3-track "Permission to Dance" single
-- that was there before. Still 0 activations of this district, so it's
-- safe to swap outright.
--
-- Base target dropped from 6 passes (tuned for a 3-track single) to 1 pass
-- for the full 22-track live album, to land in the same total-song-plays
-- band the other four album goals in this district use:
--   easy:   22 tracks x 1 pass  x1  = 22 song-plays  (band is 22-28)
--   medium: 22 tracks x 1 pass  x5  = 110 song-plays (band is ~110-140)
--   hard:   22 tracks x 1 pass  x10 = 220 song-plays (band is ~220-280)
update rc_goals set
  label = 'PERMISSION TO DANCE ON STAGE - LIVE',
  target = 1,
  tracks = '[
    {"label":"ON - Live","aliases":["ON Live"]},
    {"label":"Burning Up (FIRE) - Live","aliases":["Burning Up Live","FIRE Live"]},
    {"label":"Dope - Live","aliases":["Dope Live"]},
    {"label":"DNA - Live","aliases":["DNA Live"]},
    {"label":"Blue & Grey - Live","aliases":["Blue and Grey Live"]},
    {"label":"Black Swan - Live","aliases":["Black Swan Live"]},
    {"label":"Blood Sweat & Tears - Live","aliases":["Blood Sweat and Tears Live"]},
    {"label":"FAKE LOVE - Live","aliases":["Fake Love Live"]},
    {"label":"Life Goes On - Live","aliases":["Life Goes On Live"]},
    {"label":"Boy With Luv (Feat. Halsey) - Live","aliases":["Boy With Luv Live"]},
    {"label":"Dynamite - Live","aliases":["Dynamite Live"]},
    {"label":"Butter - Live","aliases":["Butter Live"]},
    {"label":"Telepathy - Live","aliases":["Telepathy Live"]},
    {"label":"Outro : Wings - Live","aliases":["Outro Wings Live"]},
    {"label":"Stay - Live","aliases":["Stay Live"]},
    {"label":"So What - Live","aliases":["So What Live"]},
    {"label":"IDOL - Live","aliases":["IDOL Live"]},
    {"label":"Airplane pt.2 - Live","aliases":["Airplane pt 2 Live","Airplane Pt. 2 Live"]},
    {"label":"Silver Spoon - Live","aliases":["Silver Spoon Live"]},
    {"label":"Dis-ease - Live","aliases":["Disease Live","Dis ease Live"]},
    {"label":"Spring Day - Live","aliases":["Spring Day Live"]},
    {"label":"Permission to Dance - Live","aliases":["Permission to Dance Live"]}
  ]'::jsonb,
  updated_at = now()
where id = 'mos7-album-permission-to-dance';
