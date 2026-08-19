-- Goal board for Map of Seven Crossing. New activations freeze this set;
-- attempts already in progress keep the goals they started with.
--
-- Base targets follow the current admin defaults: 20 streams per track and
-- 3 complete passes per album. The ReConnect target is deliberately flat:
-- five joined agents pool streams from every D-DAY track until they reach
-- 500 combined streams.

insert into rc_goals
  (id, kind, label, artist, aliases, tracks, target, active, sort_order,
   district_id, variant, config)
values
  ('mos7-track-haegeum', 'track', 'Haegeum', 'Agust D',
    '["해금","해금 Haegeum"]'::jsonb, null, 20, true, 200,
    'mono-map-of-seven-crossing', null, '{}'::jsonb),
  ('mos7-track-wild-flower', 'track', 'Wild Flower', 'RM',
    '["Wild Flower (with youjeen)","Wild Flower (with Youjeen)","Wild Flower (feat. Youjeen)","야생화","야생화 Wild Flower"]'::jsonb,
    null, 20, true, 201, 'mono-map-of-seven-crossing', null, '{}'::jsonb),
  ('mos7-track-killin-it-girl', 'track', 'Killin'' It Girl', 'j-hope',
    '["Killin It Girl","Killing It Girl","Killin'' It Girl (feat. GloRilla)","Killin'' It Girl (Solo Version)"]'::jsonb,
    null, 20, true, 202, 'mono-map-of-seven-crossing', null, '{}'::jsonb),
  ('mos7-track-winter-ahead', 'track', 'Winter Ahead', 'V',
    '["Winter Ahead (with PARK HYO SHIN)","Winter Ahead (with Park Hyo Shin)","Winter Ahead (feat. Park Hyo Shin)"]'::jsonb,
    null, 20, true, 203, 'mono-map-of-seven-crossing', null, '{}'::jsonb),
  ('mos7-track-blood-sweat-tears', 'track', 'Blood Sweat & Tears', 'BTS',
    '["Blood Sweat and Tears","Blood, Sweat & Tears","피 땀 눈물"]'::jsonb,
    null, 20, true, 204, 'mono-map-of-seven-crossing', null, '{}'::jsonb),
  ('mos7-track-the-astronaut', 'track', 'The Astronaut', 'Jin',
    '[]'::jsonb, null, 20, true, 205,
    'mono-map-of-seven-crossing', null, '{}'::jsonb),
  ('mos7-track-home', 'track', 'HOME', 'BTS',
    '["Home"]'::jsonb, null, 20, true, 206,
    'mono-map-of-seven-crossing', null, '{}'::jsonb),
  ('mos7-track-normal', 'track', 'Normal', 'BTS',
    '["NORMAL"]'::jsonb, null, 20, true, 207,
    'mono-map-of-seven-crossing', null, '{}'::jsonb)
on conflict (id) do update set
  kind = excluded.kind, label = excluded.label, artist = excluded.artist,
  aliases = excluded.aliases, tracks = excluded.tracks, target = excluded.target,
  active = excluded.active, sort_order = excluded.sort_order,
  district_id = excluded.district_id, variant = excluded.variant,
  config = excluded.config, updated_at = now();

insert into rc_goals
  (id, kind, label, artist, aliases, tracks, target, active, sort_order,
   district_id, variant, config)
values
  ('mos7-album-arirang', 'album', 'ARIRANG', 'BTS', '[]'::jsonb,
    '[
      {"label":"SWIM","aliases":["Swim"]},
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
    ]'::jsonb, 3, true, 220, 'mono-map-of-seven-crossing', null, '{}'::jsonb),

  ('mos7-album-keep-swimming', 'album', 'Keep Swimming', 'BTS', '[]'::jsonb,
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
    ]'::jsonb, 3, true, 221, 'mono-map-of-seven-crossing', null, '{}'::jsonb),

  ('mos7-album-love-yourself-tear', 'album', 'LOVE YOURSELF 轉 ''Tear''', 'BTS',
    '["Love Yourself: Tear","LOVE YOURSELF Tear"]'::jsonb,
    '[
      {"label":"Intro : Singularity","aliases":["Singularity"]},
      {"label":"FAKE LOVE","aliases":["Fake Love"]},
      {"label":"The Truth Untold (Feat. Steve Aoki)","aliases":["The Truth Untold"]},
      {"label":"134340","aliases":[]},
      {"label":"Paradise","aliases":[]},
      {"label":"Love Maze","aliases":[]},
      {"label":"Magic Shop","aliases":[]},
      {"label":"Airplane pt.2","aliases":["Airplane Pt. 2","Airplane pt 2"]},
      {"label":"Anpanman","aliases":[]},
      {"label":"So What","aliases":[]},
      {"label":"Outro : Tear","aliases":["Outro: Tear","Tear"]}
    ]'::jsonb, 3, true, 222, 'mono-map-of-seven-crossing', null, '{}'::jsonb),

  ('mos7-album-happy', 'album', 'Happy', 'Jin', '[]'::jsonb,
    '[
      {"label":"Running Wild","aliases":[]},
      {"label":"I''ll Be There","aliases":["I’ll Be There"]},
      {"label":"Another Level","aliases":[]},
      {"label":"Falling","aliases":[]},
      {"label":"Heart on the Window (with WENDY)","aliases":["Heart on the Window"]},
      {"label":"I will come to you","aliases":["I Will Come To You"]}
    ]'::jsonb, 3, true, 223, 'mono-map-of-seven-crossing', null, '{}'::jsonb),

  ('mos7-album-permission-to-dance', 'album', 'Permission to Dance', 'BTS',
    '[]'::jsonb,
    '[
      {"label":"Permission to Dance","aliases":["PTD"]},
      {"label":"Permission to Dance (R&B Remix)","aliases":["Permission to Dance R&B Remix"]},
      {"label":"Permission to Dance (Instrumental)","aliases":["Permission to Dance Instrumental"]}
    ]'::jsonb, 3, true, 224, 'mono-map-of-seven-crossing', null, '{}'::jsonb)
on conflict (id) do update set
  kind = excluded.kind, label = excluded.label, artist = excluded.artist,
  aliases = excluded.aliases, tracks = excluded.tracks, target = excluded.target,
  active = excluded.active, sort_order = excluded.sort_order,
  district_id = excluded.district_id, variant = excluded.variant,
  config = excluded.config, updated_at = now();

insert into rc_goals
  (id, kind, label, artist, aliases, tracks, target, active, sort_order,
   district_id, variant, config)
values
  ('mos7-reconnect-dday-500', 'reconnect', 'D-DAY: 500 Together', 'Agust D',
    '[]'::jsonb, null, 1, true, 240, 'mono-map-of-seven-crossing', 'connect',
    '{
      "requiredAgents": 5,
      "sharedTrack": {
        "label": "D-DAY album",
        "keys": [
          "d day", "haegeum", "huh", "amygdala", "sdl", "people pt2",
          "polar night", "interlude dawn", "snooze", "life goes on"
        ],
        "target": 500
      }
    }'::jsonb)
on conflict (id) do update set
  kind = excluded.kind, label = excluded.label, artist = excluded.artist,
  aliases = excluded.aliases, tracks = excluded.tracks, target = excluded.target,
  active = excluded.active, sort_order = excluded.sort_order,
  district_id = excluded.district_id, variant = excluded.variant,
  config = excluded.config, updated_at = now();
