-- Urmi Terrace (mono ward, sequence 12) — the district after Minimin Court,
-- and the first one in the ward with no goals of its own.
--
-- Tiers copy the ward's shape exactly, so it reads as the next district rather
-- than a different game (Carabonara Diner through Minimin Court all use it):
--   tracks  50 / 40 / 30   high / medium / less, BEFORE mode scaling
--   albums   5 /  3 /  2   full-album passes
-- freezeGoals (lib/districts.ts) multiplies track targets by the player's mode
-- multiplier, so 50 lands at 65 on easy — identical to its neighbours.
--
-- Labels are the ones that MATCH SCROBBLES. goalKeys (lib/transmission.ts) is
-- normKeyFull of the label plus each alias; normKeyFull strips apostrophes and
-- trailing parentheticals. Every key below was run through normKeyFull and the
-- spellings checked against what rc_scrobbles recorded over the last 60 days.

-- ── Track goals ────────────────────────────────────────────────────────
-- Seven of these already exist in the ward with aliases that have been matching
-- in production for weeks, so they are copied (label, artist, aliases) rather
-- than retyped: a retyped alias list that drops one spelling silently stops
-- counting those plays. Sources: Minimin Court (Swim, Haegeum, Wild Flower,
-- Killin' It Girl, RUN), Zeal Arcade (Winter Ahead, Permission to Dance),
-- Carabonara Diner (The Astronaut). "RUN" is the HYYH track, key "run" — not
-- Minimin's separate "Run BTS".
insert into rc_goals (id, kind, label, artist, aliases, target, sort_order, district_id, active)
select v.id, 'track', g.label, g.artist, g.aliases, v.target, v.sort_order, 'mono-urmi-terrace', true
  from (values
    ('urmi-swim',                'minimin-swim',              50, 471),
    ('urmi-haegeum',             'minimin-haegeum',           50, 472),
    ('urmi-wild-flower',         'minimin-wild-flower',       50, 473),
    ('urmi-killin-it-girl',      'minimin-killin-it-girl',    50, 474),
    ('urmi-winter-ahead',        'zeal-winter-ahead',         40, 475),
    ('urmi-the-astronaut',       'mcd-astronaut',             40, 476),
    ('urmi-permission-to-dance', 'zeal-permission-to-dance',  40, 477),
    ('urmi-run',                 'minimin-run',               30, 481)
  ) as v(id, source_id, target, sort_order)
  join rc_goals g on g.id = v.source_id;

-- New to the game, or only present as an old unassigned row:
--   "2.0"  ARIRANG's eleventh track. Keys to "20", the same key the ARIRANG
--          album goal stores for it.
--   "SPAGHETTI (feat. j-hope of BTS)"  LE SSERAFIM's song featuring j-hope.
--          Keys to "spaghetti", which also covers the bare "SPAGHETTI" and
--          "SPAGHETTI (English ver.)" spellings. The dash-suffixed remix cuts
--          ("SPAGHETTI - Creamy Cheese ver.") key separately and do not count,
--          the same rule every other goal follows.
--   "Make It Right"  keys to "make it right", which also covers
--          "Make It Right (feat. Lauv)". The Japanese version keys separately.
insert into rc_goals (id, kind, label, artist, aliases, target, sort_order, district_id, active) values
  ('urmi-2-0',           'track', '2.0',                             'BTS',    '[]'::jsonb, 40, 478, 'mono-urmi-terrace', true),
  ('urmi-spaghetti',     'track', 'SPAGHETTI (feat. j-hope of BTS)', 'j-hope', '[]'::jsonb, 30, 479, 'mono-urmi-terrace', true),
  ('urmi-make-it-right', 'track', 'Make It Right',                   'BTS',    '[]'::jsonb, 30, 480, 'mono-urmi-terrace', true);

-- SPAGHETTI is credited to "LE SSERAFIM" alone on about a fifth of its
-- recorded plays (101 of 412+ in the last 60 days), and that string is not on
-- the BTS artist allowlist, so those plays would earn no stream XP. A key-scoped
-- override — the same mechanism as Wild Flower/youjeen and Winter Ahead/Park
-- Hyo Shin — lets LE SSERAFIM count toward this one song only, never toward
-- their own unrelated catalog.
--
-- Goal progress itself matches on the title key alone, so these plays already
-- move the goals; the allowlist decides stream XP and streaks. stats.fm records
-- only the first credited artist, so two more of this district's songs were
-- moving goals while earning no XP (last 90 days):
--   "Heart on the Window (with WENDY)" credited to "WENDY" — 627 plays (the
--          same key also sits in Zeal's Happy album goal).
--   "Make It Right (feat. Lauv)" and its remixes credited to "Lauv" — 171.
update public.rc_config
   set value = value || jsonb_build_object(
         'spaghetti', jsonb_build_array('le sserafim'),
         'heart on the window', jsonb_build_array('wendy'),
         'make it right', jsonb_build_array('lauv')),
       updated_at = now()
 where key = 'track_artist_overrides';

-- ── Album goals ────────────────────────────────────────────────────────
-- Four already exist with tracklists that have been completing passes in
-- production; copying the stored `tracks` keeps them byte-identical.
insert into rc_goals (id, kind, label, artist, tracks, target, sort_order, district_id, active)
select v.id, 'album', g.label, g.artist, g.tracks, v.target, v.sort_order, 'mono-urmi-terrace', true
  from (values
    ('urmi-album-arirang',       'minimin-arirang',       5, 490),
    ('urmi-album-keep-swimming', 'minimin-keep-swimming', 5, 491),
    ('urmi-album-happy',         'zeal-album-happy',      3, 493),
    ('urmi-album-golden',        'zeal-album-golden',     2, 494)
  ) as v(id, source_id, target, sort_order)
  join rc_goals g on g.id = v.source_id;

-- Two albums new to the game. Tracklists read off Spotify on 2026-10-24.
--
-- mono. — RM, 2018, 7 tracks (open.spotify.com/album/1vsTrL1h2bRHP1kUPvlIyb).
-- The "(prod. HONNE)", "(with eAeon)" and "(with Nell)" suffixes are stripped
-- by the normalizer, so the Spotify titles key to seoul / badbye /
-- everythingoes, matching every recorded spelling. badbye's co-credit eAeon is
-- already a key-scoped override, and RM is on the allowlist regardless.
insert into rc_goals (id, kind, label, artist, tracks, target, sort_order, district_id, active) values
  ('urmi-album-mono', 'album', 'mono.', 'RM',
   '[{"label":"tokyo","aliases":[]},
     {"label":"seoul (prod. HONNE)","aliases":[]},
     {"label":"moonchild","aliases":[]},
     {"label":"badbye (with eAeon)","aliases":[]},
     {"label":"uhgood","aliases":[]},
     {"label":"everythingoes (with Nell)","aliases":[]},
     {"label":"forever rain","aliases":[]}]'::jsonb,
   3, 492, 'mono-urmi-terrace', true);

-- Dark & Wild — BTS, 2014, 14 tracks (open.spotify.com/album/35voVqYGkotyJ945O9egDY).
-- Spotify's titles, not the commonly remembered ones: track 4 is "Hip Hop Phile",
-- track 13 "So 4 more", track 14 "Outro: Do You Think It Makes Sense?".
-- The Cypher carries one alias: "BTS Cypher, Pt. 3: KILLER (feat. Supreme Boi)"
-- (155 recorded plays) keys to "bts cypher pt 3 killer", with a space the main
-- spelling's "bts cypher pt3 killer" does not have. Dollar-quoted for "24/7=Heaven".
insert into rc_goals (id, kind, label, artist, tracks, target, sort_order, district_id, active) values
  ('urmi-album-dark-and-wild', 'album', 'Dark & Wild', 'BTS',
   $dw$[{"label":"Intro: What Am I to You","aliases":[]},
     {"label":"Danger","aliases":[]},
     {"label":"War of Hormone","aliases":[]},
     {"label":"Hip Hop Phile","aliases":[]},
     {"label":"Let Me Know","aliases":[]},
     {"label":"Rain","aliases":[]},
     {"label":"BTS Cypher Pt.3: Killer","aliases":["BTS Cypher, Pt. 3: KILLER (feat. Supreme Boi)"]},
     {"label":"Interlude: What Are You Doing Now","aliases":[]},
     {"label":"Could You Turn off Your Cell Phone","aliases":[]},
     {"label":"Embarrassed","aliases":[]},
     {"label":"24/7=Heaven","aliases":[]},
     {"label":"Look Here","aliases":[]},
     {"label":"So 4 more","aliases":[]},
     {"label":"Outro: Do You Think It Makes Sense?","aliases":[]}]$dw$::jsonb,
   2, 495, 'mono-urmi-terrace', true);

-- ── ReConnect quest ────────────────────────────────────────────────────
-- A team of three: two Urmi Terrace agents, plus exactly one agent "kidnapped"
-- from Home Base (Relay Zero, relay-zero-hq). Together they stream Jin's
-- "I'll Be There" 50 times.
--   requiredAgents 3            the whole team
--   crossDistrictEligible       who may be recruited from outside: Home Base
--   crossDistrictSeats 1        exactly one seat is a Home Base recruit, so the
--                               other two must be restoring Urmi Terrace. New
--                               rule, enforced on invite, accept and admin
--                               auto-assign (lib/reconnect-seats.ts).
--
-- sharedTrack is pooled: every member's own plays of the track, from when they
-- joined, add toward one total of 50. "ill be there" is the post-normalization
-- key; both apostrophes production records (' and ’) normalize to it.
insert into rc_goals (id, kind, label, artist, target, sort_order, district_id, variant, config, active) values
  ('urmi-reconnect-ill-be-there-50', 'reconnect', 'I''ll Be There: 50 Together', 'Jin',
   1, 500, 'mono-urmi-terrace', 'connect',
   '{"sharedTrack": {"keys": ["ill be there"], "label": "I''ll Be There", "target": 50}, "requiredAgents": 3, "crossDistrictSeats": 1, "crossDistrictEligible": ["relay-zero-hq"]}'::jsonb,
   true);

-- ── Proof everything landed ────────────────────────────────────────────
-- The copied goals are INSERT ... SELECT ... JOIN, which inserts nothing for a
-- missing source id. Silent partial content is worse than a failed migration,
-- so refuse to commit unless every goal and the override exist.
do $$
declare
  v_tracks integer;
  v_albums integer;
  v_quest  integer;
  v_empty  integer;
  v_override jsonb;
begin
  select count(*) filter (where kind = 'track'),
         count(*) filter (where kind = 'album'),
         count(*) filter (where kind = 'reconnect')
    into v_tracks, v_albums, v_quest
    from rc_goals where district_id = 'mono-urmi-terrace';

  if v_tracks <> 11 then raise exception 'expected 11 track goals, found %', v_tracks; end if;
  if v_albums <> 6  then raise exception 'expected 6 album goals, found %', v_albums; end if;
  if v_quest  <> 1  then raise exception 'expected 1 reconnect goal, found %', v_quest; end if;

  select count(*) into v_empty from rc_goals
   where district_id = 'mono-urmi-terrace' and kind = 'album'
     and coalesce(jsonb_array_length(tracks), 0) = 0;
  if v_empty > 0 then raise exception '% album goal(s) have an empty tracklist', v_empty; end if;

  select jsonb_build_array(value -> 'spaghetti', value -> 'heart on the window', value -> 'make it right')
    into v_override from rc_config where key = 'track_artist_overrides';
  if v_override is distinct from '[["le sserafim"], ["wendy"], ["lauv"]]'::jsonb then
    raise exception 'artist overrides missing (got %)', v_override;
  end if;
end $$;
