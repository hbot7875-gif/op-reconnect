-- Samiksha Springs (mono-samiksha-springs): its goals and ReConnect Quest.
--
-- Targets follow the ward (Angel 613 Bell Tower, Bangtan Seven Bridge):
--   tracks  high 50 · medium 40 · less 30 plays
--   albums  high 5 · medium 3 · less 2 passes
-- Songs and albums already used in the ward are COPIED from the rows that
-- have been matching in production (same label, aliases, track list), so the
-- Hangul spellings come across byte for byte. New here: the songs Like
-- Animals and Merry Go Round, and the albums HYYH Pt. 2 and FACE YOURSELF,
-- whose track names are the ones players' scrobbles actually report.
--
-- FACE YOURSELF lists only the "- Japanese ver." spellings: a bracketed
-- "(Japanese Version)" is dropped by title matching ("DNA (Japanese
-- Version)" -> "dna"), so it would let plain DNA / Spring Day plays complete
-- the Japanese album.
--
-- ReConnect Quest: 3 agents complete 21 full rounds of ARIRANG together —
-- every one of the 14 tracks reaches 21 pooled plays (294 track plays). It
-- uses the existing shared-tracks quest (lib/reconnect-shared-tracks.js),
-- shown openly (not hidden): a round only counts when all 14 tracks are in.
--
-- Nobody has started this district (0 attempts), so no frozen goals change.

do $$
declare n int;
begin
  -- Tracks copied from production rows, new id / target / order.
  insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config)
  select v.new_id, g.kind, g.label, g.artist, g.aliases, g.tracks, v.target, true, v.sort_order,
         'mono-samiksha-springs', g.variant, coalesce(g.config, '{}'::jsonb)
  from (values
    ('samiksha-swim',             'bridge-swim',             50, 641),
    ('samiksha-haegeum',          'bridge-haegeum',          50, 642),
    ('samiksha-wild-flower',      'bridge-wild-flower',      50, 643),
    ('samiksha-killin-it-girl',   'bridge-killin-it-girl',   50, 644),
    ('samiksha-dna',              'angel-dna',               40, 645),
    ('samiksha-winter-ahead',     'psov-winter-ahead',       40, 646),
    ('samiksha-the-astronaut',    'urmi-the-astronaut',      40, 647),
    ('samiksha-am-i-wrong',       'taepier-am-i-wrong',      30, 648),
    ('samiksha-run',              'urmi-run',                30, 650),
    ('samiksha-album-arirang',    'bridge-album-arirang',     5, 660),
    ('samiksha-album-keep-swimming','bridge-album-keep-swimming',5, 661),
    ('samiksha-album-indigo',     'angel-album-indigo',       3, 662),
    ('samiksha-album-d-day',      'bridge-album-d-day',       3, 663),
    ('samiksha-album-happy',      'bridge-album-happy',       3, 664)
  ) as v(new_id, src_id, target, sort_order)
  join rc_goals g on g.id = v.src_id
  on conflict (id) do nothing;
  get diagnostics n = row_count;
  if n <> 14 then raise exception 'expected 14 copied goals, got %', n; end if;

  -- New songs (ARIRANG tracks), plain titles.
  insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config) values
    ('samiksha-like-animals',    'track', 'Like Animals',   'BTS', '[]'::jsonb, null, 30, true, 649, 'mono-samiksha-springs', null, '{}'::jsonb),
    ('samiksha-merry-go-round',  'track', 'Merry Go Round', 'BTS', '[]'::jsonb, null, 30, true, 651, 'mono-samiksha-springs', null, '{}'::jsonb)
  on conflict (id) do nothing;

  -- New albums.
  insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config) values
    ('samiksha-album-hyyh-pt2', 'album', 'The Most Beautiful Moment in Life, Pt. 2', 'BTS', '[]'::jsonb,
     '[{"aliases":["INTRO : Never Mind"],"label":"Intro: Never Mind"},
       {"aliases":["Run"],"label":"RUN"},
       {"aliases":[],"label":"Butterfly"},
       {"aliases":[],"label":"Whalien 52"},
       {"aliases":[],"label":"Ma City"},
       {"aliases":["뱁새 Silver Spoon","Baepsae"],"label":"Silver Spoon"},
       {"aliases":["SKIT : One night in a strange city"],"label":"Skit: One Night in a Strange City"},
       {"aliases":[],"label":"Autumn Leaves"},
       {"aliases":["OUTRO : House Of Cards"],"label":"Outro: House of Cards"}]'::jsonb,
     2, true, 665, 'mono-samiksha-springs', null, '{}'::jsonb),
    ('samiksha-album-face-yourself', 'album', 'FACE YOURSELF', 'BTS', '[]'::jsonb,
     '[{"aliases":[],"label":"INTRO : Ringwanderung"},
       {"aliases":[],"label":"Best Of Me - Japanese ver."},
       {"aliases":["Blood Sweat & Tears - Japanese ver."],"label":"血、汗、涙 - Japanese ver."},
       {"aliases":[],"label":"DNA - Japanese ver."},
       {"aliases":[],"label":"Not Today - Japanese ver."},
       {"aliases":[],"label":"Go Go - Japanese ver."},
       {"aliases":[],"label":"MIC Drop - Japanese ver."},
       {"aliases":[],"label":"Don''t Leave Me"},
       {"aliases":[],"label":"Let Go"},
       {"aliases":[],"label":"Spring Day - Japanese ver."},
       {"aliases":[],"label":"Crystal Snow"},
       {"aliases":[],"label":"OUTRO : Crack"}]'::jsonb,
     2, true, 666, 'mono-samiksha-springs', null, '{}'::jsonb)
  on conflict (id) do nothing;

  -- ReConnect Quest: 21 full rounds of ARIRANG, 3 agents.
  insert into rc_goals (id, kind, label, artist, aliases, tracks, target, active, sort_order, district_id, variant, config) values
    ('samiksha-reconnect-arirang-21', 'reconnect', 'ARIRANG: 21 Full Rounds Together', 'BTS', '[]'::jsonb, null, 1, true, 670,
     'mono-samiksha-springs', 'connect',
     '{"requiredAgents": 3,
       "sharedTracks": {"target": 21, "noun": "ARIRANG tracks", "tracks": [
         {"label": "Swim", "keys": ["swim"]},
         {"label": "Body to Body", "keys": ["body to body"]},
         {"label": "Hooligan", "keys": ["hooligan"]},
         {"label": "Aliens", "keys": ["aliens"]},
         {"label": "FYA", "keys": ["fya"]},
         {"label": "Merry Go Round", "keys": ["merry go round"]},
         {"label": "One More Night", "keys": ["one more night"]},
         {"label": "Please", "keys": ["please"]},
         {"label": "Into the Sun", "keys": ["into the sun"]},
         {"label": "No. 29", "keys": ["no 29"]},
         {"label": "Normal", "keys": ["normal"]},
         {"label": "they don''t know ''bout us", "keys": ["they dont know bout us"]},
         {"label": "2.0", "keys": ["20"]},
         {"label": "Like Animals", "keys": ["like animals"]}]}}'::jsonb)
  on conflict (id) do nothing;

  select count(*) into n from rc_goals where district_id = 'mono-samiksha-springs' and active;
  if n <> 19 then raise exception 'expected 19 Samiksha Springs goals, got %', n; end if;
end $$;
