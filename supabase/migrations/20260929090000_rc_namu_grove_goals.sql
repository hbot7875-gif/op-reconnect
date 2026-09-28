-- Namu Grove (mono ward, sequence 9) — the district that opens after Zeal
-- Arcade, and the first one with no goals of its own.
--
-- Tiers copy the ward's existing shape exactly, so this reads as the next
-- district rather than a different game:
--   tracks  50 / 40 / 30   high / moderate / less, BEFORE mode scaling
--   albums   5 /  3 /  2   full-album passes
-- freezeGoals (lib/districts.ts) multiplies track targets by the player's
-- mode multiplier, so 50 lands at 65 on easy — identical to Zeal Arcade.
--
-- Track names here are the ones that actually MATCH SCROBBLES, not the ones
-- that read naturally. normalizeKey (lib/text.ts) strips apostrophes and
-- trailing parentheticals, so:
--   "they don't know 'bout us"          -> they dont know bout us
--   "NEURON (with Gaeko & YOON MIRAE)"  -> neuron
--   "Killin' It Girl (feat. GloRilla)"  -> killin it girl
-- Spelling ARIRANG's twelfth track "they don't know ABOUT us" would key to
-- "they dont know about us" and match nothing ever. The spelling used below
-- is the one already proven in production by the ARIRANG album goal.

-- ── Track goals ────────────────────────────────────────────────────────
-- Artists are the ones the identical goals already carry elsewhere in the
-- ward (Haegeum is Agust D, not BTS; Killin' It Girl is j-hope), so the
-- artist allowlist behaves the same here as it does there.
insert into rc_goals (id, kind, label, artist, aliases, target, sort_order, district_id, active) values
  ('namu-swim',                  'track', 'Swim',                     'BTS',      '[]'::jsonb, 50, 381, 'mono-namu-grove', true),
  ('namu-haegeum',               'track', 'Haegeum',                  'Agust D',  '[]'::jsonb, 50, 382, 'mono-namu-grove', true),
  -- The only track carrying aliases: the Korean title and the featured-artist
  -- spellings are genuinely different keys, not suffixes the normalizer
  -- strips. Copied verbatim from the existing Wild Flower goals.
  ('namu-wild-flower',           'track', 'Wild Flower',              'RM',
     '["Wild Flower (with youjeen)", "Wild Flower (with Youjeen)", "Wild Flower (feat. Youjeen)", "야생화", "야생화 Wild Flower"]'::jsonb,
     50, 383, 'mono-namu-grove', true),
  ('namu-killin-it-girl',        'track', 'Killin'' It Girl',         'j-hope',   '[]'::jsonb, 50, 384, 'mono-namu-grove', true),
  ('namu-winter-ahead',          'track', 'Winter Ahead',             'V',        '[]'::jsonb, 40, 385, 'mono-namu-grove', true),
  ('namu-into-the-sun',          'track', 'Into the Sun',             'BTS',      '[]'::jsonb, 40, 386, 'mono-namu-grove', true),
  ('namu-they-dont-know-bout-us','track', 'they don''t know ''bout us','BTS',     '[]'::jsonb, 40, 387, 'mono-namu-grove', true),
  -- Spotify lists this as "NEURON (with Gaeko & YOON MIRAE)" by j-hope; the
  -- suffix is stripped before matching, so the bare title is the right label
  -- and an alias for the full string would be the same key twice.
  ('namu-neuron',                'track', 'NEURON',                   'j-hope',   '[]'::jsonb, 40, 388, 'mono-namu-grove', true),
  ('namu-winter-bear',           'track', 'Winter Bear',              'V',        '[]'::jsonb, 30, 389, 'mono-namu-grove', true),
  ('namu-black-swan',            'track', 'Black Swan',               'BTS',      '[]'::jsonb, 30, 390, 'mono-namu-grove', true);

-- ── Album goals ────────────────────────────────────────────────────────
-- Four of the five already exist elsewhere with tracklists that have been
-- completing passes in production for weeks. Copying the stored `tracks`
-- rather than retyping it keeps them byte-identical — a retyped tracklist
-- that differs by one character silently makes the album unpassable.
insert into rc_goals (id, kind, label, artist, tracks, target, sort_order, district_id, active)
select 'namu-album-arirang', 'album', label, artist, tracks, 5, 400, 'mono-namu-grove', true
  from rc_goals where id = 'zeal-album-arirang';
insert into rc_goals (id, kind, label, artist, tracks, target, sort_order, district_id, active)
select 'namu-album-keep-swimming', 'album', label, artist, tracks, 5, 401, 'mono-namu-grove', true
  from rc_goals where id = 'zeal-album-keep-swimming';
insert into rc_goals (id, kind, label, artist, tracks, target, sort_order, district_id, active)
select 'namu-album-indigo', 'album', label, artist, tracks, 3, 402, 'mono-namu-grove', true
  from rc_goals where id = 'dazzledew-album-indigo';
insert into rc_goals (id, kind, label, artist, tracks, target, sort_order, district_id, active)
select 'namu-album-wings', 'album', label, artist, tracks, 3, 403, 'mono-namu-grove', true
  from rc_goals where id = 'dazzledew-album-wings';

-- The one album new to the game. Tracklist read off Spotify
-- (open.spotify.com/album/1nScVw87kRJiT2bg2Kswhp): 13 tracks, 2020, BTS.
-- Every reissued track is the Japanese version and keys separately from its
-- Korean original — "Black Swan - Japanese ver." normalizes to
-- "black swan japanese ver", so it does NOT collide with the Black Swan
-- track goal above. That is deliberate: the album pass needs the Japanese
-- cut specifically.
insert into rc_goals (id, kind, label, artist, tracks, target, sort_order, district_id, active) values
  ('namu-album-mots7-journey', 'album', 'MAP OF THE SOUL : 7 ~ THE JOURNEY ~', 'BTS',
   '[{"label":"INTRO : Calling","aliases":[]},
     {"label":"Stay Gold","aliases":[]},
     {"label":"Boy With Luv - Japanese ver.","aliases":[]},
     {"label":"Make It Right - Japanese ver.","aliases":[]},
     {"label":"Dionysus - Japanese ver.","aliases":[]},
     {"label":"IDOL - Japanese ver.","aliases":[]},
     {"label":"Airplane pt.2 - Japanese ver.","aliases":[]},
     {"label":"FAKE LOVE - Japanese ver.","aliases":[]},
     {"label":"Black Swan - Japanese ver.","aliases":[]},
     {"label":"ON - Japanese ver.","aliases":[]},
     {"label":"Lights","aliases":[]},
     {"label":"Your eyes tell","aliases":[]},
     {"label":"OUTRO : The Journey","aliases":[]}]'::jsonb,
   2, 404, 'mono-namu-grove', true);

-- ── ReConnect quest ────────────────────────────────────────────────────
-- Same 'connect' variant Zeal Arcade uses, with a bigger team (4 vs 3) and a
-- bigger shared pool (350 vs 300). `keys` are post-normalization, which is
-- why "I'm Fine" is stored as "im fine" — the apostrophe is stripped before
-- any comparison happens.
insert into rc_goals (id, kind, label, artist, target, sort_order, district_id, variant, config, active) values
  ('namu-reconnect-im-fine-come-over-350', 'reconnect', 'I''m Fine + Come Over: 350 Together', 'BTS',
   1, 410, 'mono-namu-grove', 'connect',
   '{"sharedTrack": {"keys": ["im fine", "come over"], "label": "I''m Fine + Come Over", "target": 350}, "requiredAgents": 4}'::jsonb,
   true);
