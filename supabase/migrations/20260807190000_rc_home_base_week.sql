-- Additive Home Base goal set. These IDs are Home Base-specific so this
-- migration never moves or rewrites a goal already used by another district.
-- Existing active attempts remain frozen exactly as they started.

insert into rc_config (key, value) values ('restoration_days', '7'::jsonb)
on conflict (key) do nothing;

insert into rc_goals
  (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id)
values
  ('home-base-dsylm', 'track', 'Don''t Say You Love Me', 'Jin',
    '["Dont Say You Love Me","DSYLM"]'::jsonb, null, 20, true, 1, 'relay-zero-hq'),
  ('home-base-haegeum', 'track', 'Haegeum', 'Agust D',
    '["해금","해금 Haegeum"]'::jsonb, null, 20, true, 2, 'relay-zero-hq'),
  ('home-base-dna', 'track', 'DNA', 'BTS',
    '[]'::jsonb, null, 20, true, 3, 'relay-zero-hq'),
  ('home-base-permission-to-dance', 'track', 'Permission to Dance', 'BTS',
    '["PTD","Permission To Dance"]'::jsonb, null, 20, true, 4, 'relay-zero-hq'),
  ('home-base-swim', 'track', 'Swim', 'BTS',
    '["SWIM"]'::jsonb, null, 20, true, 5, 'relay-zero-hq'),
  ('home-base-normal', 'track', 'Normal', 'BTS',
    '["NORMAL"]'::jsonb, null, 20, true, 6, 'relay-zero-hq'),
  ('home-base-come-over', 'track', 'Come Over', 'BTS',
    '["COME OVER"]'::jsonb, null, 20, true, 7, 'relay-zero-hq')
on conflict (id) do nothing;

insert into rc_goals
  (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id)
values
  ('home-base-album-arirang', 'album', 'Arirang', 'BTS', '[]'::jsonb,
    '[
      {"label":"Swim","aliases":["SWIM"]},
      {"label":"Body to Body","aliases":[]},
      {"label":"Hooligan","aliases":[]},
      {"label":"Aliens","aliases":[]},
      {"label":"FYA","aliases":[]},
      {"label":"Merry Go Round","aliases":[]},
      {"label":"One More Night","aliases":[]},
      {"label":"Please","aliases":[]},
      {"label":"Into the Sun","aliases":[]},
      {"label":"No. 29","aliases":["No 29"]},
      {"label":"Normal","aliases":["NORMAL"]},
      {"label":"they don''t know ''bout us","aliases":["They Don''t Know ''Bout Us"]},
      {"label":"2.0","aliases":[]},
      {"label":"Like Animals","aliases":[]}
    ]'::jsonb, 2, true, 20, 'relay-zero-hq'),

  ('home-base-album-keep-swimming', 'album', 'Keep Swimming', 'BTS', '[]'::jsonb,
    '[
      {"label":"SWIM","aliases":["Swim"]},
      {"label":"SWIM with RM (Chill Hip Hop Remix)","aliases":["SWIM with RM"]},
      {"label":"SWIM with Jin (Alternative Rock Remix)","aliases":["SWIM with Jin"]},
      {"label":"SWIM with SUGA (Melodic Techno Remix)","aliases":["SWIM with SUGA"]},
      {"label":"SWIM with j-hope (Afrobeat Remix)","aliases":["SWIM with jhope","SWIM with J-Hope"]},
      {"label":"SWIM with Jimin (Slow Jam R&B Remix)","aliases":["SWIM with Jimin"]},
      {"label":"SWIM with V (Electronic Remix)","aliases":["SWIM with V"]},
      {"label":"SWIM with Jung Kook (Acoustic Lofi Remix)","aliases":["SWIM with Jungkook","SWIM with Jung Kook"]},
      {"label":"SWIM (Instrumental)","aliases":["SWIM Instrumental"]}
    ]'::jsonb, 2, true, 21, 'relay-zero-hq'),

  ('home-base-album-echo', 'album', 'Echo', 'Jin', '[]'::jsonb,
    '[
      {"label":"Don''t Say You Love Me","aliases":["Dont Say You Love Me","DSYLM"]},
      {"label":"Nothing Without Your Love","aliases":[]},
      {"label":"Loser (feat. YENA)","aliases":["Loser"]},
      {"label":"Rope It","aliases":[]},
      {"label":"With the Clouds","aliases":[]},
      {"label":"Background","aliases":[]},
      {"label":"To Me, Today","aliases":[]}
    ]'::jsonb, 2, true, 22, 'relay-zero-hq'),

  ('home-base-album-indigo', 'album', 'Indigo', 'RM', '[]'::jsonb,
    '[
      {"label":"Yun (with Erykah Badu)","aliases":["Yun"]},
      {"label":"Still Life (with Anderson .Paak)","aliases":["Still Life"]},
      {"label":"All Day (with Tablo)","aliases":["All Day"]},
      {"label":"Forg_tful (with Kim Sawol)","aliases":["Forg_tful"]},
      {"label":"Closer (with Paul Blanco, Mahalia)","aliases":["Closer"]},
      {"label":"Change pt.2","aliases":["Change pt 2"]},
      {"label":"Lonely","aliases":[]},
      {"label":"Hectic (with Colde)","aliases":["Hectic"]},
      {"label":"Wild Flower (with youjeen)","aliases":["Wild Flower","Wild Flower (with Youjeen)"]},
      {"label":"No.2 (with parkjiyoon)","aliases":["No.2","No 2"]}
    ]'::jsonb, 2, true, 23, 'relay-zero-hq')
on conflict (id) do nothing;
