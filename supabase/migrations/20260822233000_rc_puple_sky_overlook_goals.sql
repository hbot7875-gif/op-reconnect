-- Goal board for Puple Sky Overlook (mono-puple-sky-overlook), previously
-- unconfigured. Same base-target conventions as this ward's other two
-- districts: 5 lead solo singles at 50 (identical rows to Map of Seven
-- Crossing's own -- these keep recurring across mono-ward districts), a
-- second tier of BTS/solo b-sides at 40 (matching Dazzledew's Come Over/
-- Normal precedent), and album pass targets picked by track-count band
-- against Dazzledew/Map of Seven Crossing's already-established values
-- (Arirang and Keep Swimming reuse their exact verified tracklists
-- outright; GOLDEN and MAP OF THE SOUL: PERSONA verified fresh against
-- Spotify; Proof reuses the 30-track list verified earlier this project
-- for the Anthology era card).
insert into rc_goals
  (id, kind, label, artist, aliases, tracks, target, active, sort_order,
   district_id, variant, config)
values
  -- Lead solo singles -- identical to Map of Seven Crossing's own.
  ('psov-haegeum', 'track', 'Haegeum', 'Agust D',
    '["해금","해금 Haegeum"]'::jsonb, null, 50, true, 300,
    'mono-puple-sky-overlook', null, '{}'::jsonb),
  ('psov-swim', 'track', 'SWIM', 'BTS',
    '["Swim"]'::jsonb, null, 50, true, 301,
    'mono-puple-sky-overlook', null, '{}'::jsonb),
  ('psov-kig', 'track', 'Killin'' It Girl', 'j-hope',
    '["Killin It Girl","Killing It Girl","Killin'' It Girl (feat. GloRilla)","Killin'' It Girl (Solo Version)"]'::jsonb,
    null, 50, true, 302, 'mono-puple-sky-overlook', null, '{}'::jsonb),
  ('psov-wild-flower', 'track', 'Wild Flower', 'RM',
    '["Wild Flower (with youjeen)","Wild Flower (with Youjeen)","Wild Flower (feat. Youjeen)","야생화","야생화 Wild Flower"]'::jsonb,
    null, 50, true, 303, 'mono-puple-sky-overlook', null, '{}'::jsonb),
  ('psov-winter-ahead', 'track', 'Winter Ahead', 'V',
    '["Winter Ahead (with PARK HYO SHIN)","Winter Ahead (with Park Hyo Shin)","Winter Ahead (feat. Park Hyo Shin)"]'::jsonb,
    null, 50, true, 304, 'mono-puple-sky-overlook', null, '{}'::jsonb),

  -- Second tier -- 40, matching Dazzledew's Come Over/Normal precedent.
  ('psov-euphoria', 'track', 'Euphoria', 'Jung Kook',
    '["Euphoria : Theme of LOVE YOURSELF 起 ''Wonder''"]'::jsonb, null, 40, true, 305,
    'mono-puple-sky-overlook', null, '{}'::jsonb),
  ('psov-spring-day', 'track', 'Spring Day', 'BTS',
    '["봄날"]'::jsonb, null, 40, true, 306,
    'mono-puple-sky-overlook', null, '{}'::jsonb),
  ('psov-running-wild', 'track', 'Running Wild', 'Jin',
    '[]'::jsonb, null, 40, true, 307,
    'mono-puple-sky-overlook', null, '{}'::jsonb),
  -- Agust D's D-DAY track, not BTS's own "Life Goes On" from BE -- same
  -- bare title, different release; see the D-DAY reconnect goal on this
  -- same ward's Map of Seven Crossing, which already accepts this exact
  -- key for the same reason.
  ('psov-life-goes-on-agustd', 'track', 'Life Goes On', 'Agust D',
    '[]'::jsonb, null, 40, true, 308,
    'mono-puple-sky-overlook', null, '{}'::jsonb),
  ('psov-normal', 'track', 'Normal', 'BTS',
    '[]'::jsonb, null, 40, true, 309,
    'mono-puple-sky-overlook', null, '{}'::jsonb),
  ('psov-come-over', 'track', 'Come Over', 'BTS',
    '[]'::jsonb, null, 40, true, 310,
    'mono-puple-sky-overlook', null, '{}'::jsonb),

  -- Albums. Arirang/Keep Swimming tracklists copied verbatim from
  -- Map of Seven Crossing's own (already verified against Spotify there).
  ('psov-album-arirang', 'album', 'ARIRANG', 'BTS', '[]'::jsonb,
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
    ]'::jsonb, 5, true, 311, 'mono-puple-sky-overlook', null, '{}'::jsonb),

  ('psov-album-keep-swimming', 'album', 'Keep Swimming', 'BTS', '[]'::jsonb,
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
    ]'::jsonb, 5, true, 312, 'mono-puple-sky-overlook', null, '{}'::jsonb),

  -- Verified fresh against Spotify (see session).
  ('psov-album-golden', 'album', 'GOLDEN', 'Jung Kook', '[]'::jsonb,
    '[
      {"label":"3D (feat. Jack Harlow)","aliases":["3D"]},
      {"label":"Closer to You (feat. Major Lazer)","aliases":["Closer to You"]},
      {"label":"Seven (feat. Latto) (Explicit Ver.)","aliases":["Seven (feat. Latto)","Seven"]},
      {"label":"Standing Next to You","aliases":[]},
      {"label":"Yes or No","aliases":[]},
      {"label":"Please Don''t Change (feat. DJ Snake)","aliases":["Please Don''t Change"]},
      {"label":"Hate You","aliases":[]},
      {"label":"Somebody","aliases":[]},
      {"label":"Too Sad to Dance","aliases":[]},
      {"label":"Shot Glass of Tears","aliases":[]},
      {"label":"Seven (feat. Latto) (Clean Ver.)","aliases":["Seven (Clean Ver.)"]}
    ]'::jsonb, 3, true, 313, 'mono-puple-sky-overlook', null, '{}'::jsonb),

  -- Full 30-track list verified against user-supplied screenshots earlier
  -- this project (the Anthology era card's Proof cross-check).
  ('psov-album-proof', 'album', 'Proof', 'BTS', '[]'::jsonb,
    '[
      {"label":"Born Singer","aliases":[]},
      {"label":"No More Dream","aliases":[]},
      {"label":"N.O","aliases":[]},
      {"label":"Boy In Luv","aliases":[]},
      {"label":"Danger","aliases":[]},
      {"label":"I NEED U","aliases":[]},
      {"label":"RUN","aliases":[]},
      {"label":"Burning Up (FIRE)","aliases":[]},
      {"label":"Blood Sweat & Tears","aliases":[]},
      {"label":"Spring Day","aliases":[]},
      {"label":"DNA","aliases":[]},
      {"label":"FAKE LOVE","aliases":[]},
      {"label":"IDOL","aliases":[]},
      {"label":"Boy With Luv (Feat. Halsey)","aliases":[]},
      {"label":"ON","aliases":[]},
      {"label":"Dynamite","aliases":[]},
      {"label":"Life Goes On","aliases":[]},
      {"label":"Butter","aliases":[]},
      {"label":"Yet To Come","aliases":[]},
      {"label":"Run BTS","aliases":[]},
      {"label":"Intro : Persona","aliases":[]},
      {"label":"Stay","aliases":[]},
      {"label":"Moon","aliases":[]},
      {"label":"Jamais Vu","aliases":[]},
      {"label":"Trivia 轉 : Seesaw","aliases":[]},
      {"label":"BTS Cypher PT.3 : KILLER (Feat. Supreme Boi)","aliases":[]},
      {"label":"Outro : Ego","aliases":[]},
      {"label":"Her","aliases":[]},
      {"label":"Filter","aliases":[]},
      {"label":"Friends","aliases":[]}
    ]'::jsonb, 2, true, 314, 'mono-puple-sky-overlook', null, '{}'::jsonb),

  -- Verified fresh against Spotify (see session).
  ('psov-album-persona', 'album', 'MAP OF THE SOUL : PERSONA', 'BTS', '["Map of the Soul: Persona"]'::jsonb,
    '[
      {"label":"Intro : Persona","aliases":["Intro Persona"]},
      {"label":"Boy With Luv (Feat. Halsey)","aliases":["Boy With Luv"]},
      {"label":"Mikrokosmos","aliases":["소우주"]},
      {"label":"Make It Right","aliases":[]},
      {"label":"HOME","aliases":[]},
      {"label":"Jamais Vu","aliases":[]},
      {"label":"Dionysus","aliases":[]}
    ]'::jsonb, 5, true, 315, 'mono-puple-sky-overlook', null, '{}'::jsonb),

  -- Both "My You" and "Still With You" are Jung Kook's own 2020/2022 Festa
  -- singles (not a Jin song -- checked before writing this), same shared-
  -- pool shape as Map of Seven Crossing's D-DAY reconnect goal.
  ('psov-reconnect-jk-500', 'reconnect', 'My You & Still With You: 500 Together', 'Jung Kook',
    '[]'::jsonb, null, 1, true, 316, 'mono-puple-sky-overlook', 'connect',
    '{
      "requiredAgents": 6,
      "sharedTrack": {
        "label": "My You / Still With You",
        "keys": ["my you", "still with you"],
        "target": 500
      }
    }'::jsonb);
