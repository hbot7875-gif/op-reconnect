-- Angel 613 Bell Tower (mono ward, sequence 13) — the district after Urmi
-- Terrace, with no goals of its own until now.
--
-- Same tier shape as the rest of the ward (Carabonara Diner through Urmi
-- Terrace), before mode scaling:
--   tracks  50 / 40 / 30   high / medium / less
--   albums   5 /  3 /  2   full-album passes
--
-- Labels are the ones that MATCH SCROBBLES: goal progress keys on
-- normKeyFull(title) alone (lib/text.ts), so every spelling below was checked
-- against what rc_scrobbles recorded over the last 90 days.

-- ── Track goals ────────────────────────────────────────────────────────
-- Nine already exist in the ward with aliases that have been matching in
-- production, so they are copied (label, artist, aliases) rather than retyped.
insert into rc_goals (id, kind, label, artist, aliases, target, sort_order, district_id, active)
select v.id, 'track', g.label, g.artist, g.aliases, v.target, v.sort_order, 'mono-angel-613-bell-tower', true
  from (values
    ('angel-swim',          'minimin-swim',            50, 501),
    ('angel-haegeum',       'minimin-haegeum',         50, 502),
    ('angel-wild-flower',   'minimin-wild-flower',     50, 503),
    ('angel-killin-it-girl','minimin-killin-it-girl',  50, 504),
    ('angel-running-wild',  'psov-running-wild',       40, 505),
    ('angel-dna',           'exb-dna',                 40, 506),
    ('angel-normal',        'hopesize-normal',         40, 507),
    ('angel-come-over',     'zeal-come-over',          40, 508),
    ('angel-spring-day',    'psov-spring-day',         40, 509)
  ) as v(id, source_id, target, sort_order)
  join rc_goals g on g.id = v.source_id;

-- New to the ward:
--   "Yours"      Jin's OST (Jirisan). Keys to "yours"; "YOURS" and the
--                "(From "Jirisan" ...)" spelling key the same.
--   "Yes or No"  Jung Kook, from GOLDEN. Keys to "yes or no".
insert into rc_goals (id, kind, label, artist, aliases, target, sort_order, district_id, active) values
  ('angel-yours',     'track', 'Yours',     'Jin',       '[]'::jsonb, 30, 510, 'mono-angel-613-bell-tower', true),
  ('angel-yes-or-no', 'track', 'Yes or No', 'Jung Kook', '[]'::jsonb, 30, 511, 'mono-angel-613-bell-tower', true);

-- ── Album goals ────────────────────────────────────────────────────────
-- All eight already exist with tracklists that have been completing passes in
-- production; copying the stored `tracks` keeps them byte-identical.
insert into rc_goals (id, kind, label, artist, tracks, target, sort_order, district_id, active)
select v.id, 'album', g.label, g.artist, g.tracks, v.target, v.sort_order, 'mono-angel-613-bell-tower', true
  from (values
    ('angel-album-arirang',            'minimin-arirang',                5, 520),
    ('angel-album-keep-swimming',      'minimin-keep-swimming',          5, 521),
    ('angel-album-happy',              'zeal-album-happy',               3, 522),
    ('angel-album-hope-on-the-street', 'hopesize-album-hots',            3, 523),
    ('angel-album-indigo',             'minimin-indigo',                 3, 524),
    ('angel-album-persona',            'psov-album-persona',             2, 525),
    ('angel-album-proof',              'psov-album-proof',               2, 526),
    ('angel-album-love-yourself-tear', 'mos7-album-love-yourself-tear',  2, 527)
  ) as v(id, source_id, target, sort_order)
  join rc_goals g on g.id = v.source_id;

-- ── ReConnect quest: Surprise Songs for Brazil ─────────────────────────
-- A team of three Bell Tower agents streams the six surprise songs BTS played
-- on the ARIRANG tour's three Brazil dates — without being told which.
-- config.sharedTracks (lib/reconnect-shared-tracks.js): plays pool per song
-- across the team, up to 30 each (180 in all), and with `hidden` a song's name
-- stays on the server until any teammate streams it once.
--
-- Keys are post-normalization (normKeyFull). The Hangul spellings go through
-- normalize(.., NFKD) here because normalizeKey's NFKD splits each syllable
-- into jamo, so a key typed composed could never match. Dash-suffixed cuts
-- ("- Live", "- Japanese ver.") key separately and do not count, the same rule
-- every other goal follows.
--   Black Swan            "black swan"
--   Baepsae / Silver Spoon  Spotify titles it "Silver Spoon"; older spellings
--                         "뱁새 Silver Spoon", "뱁새", "Baepsae"
--   Airplane pt.2         "airplane pt2"
--   I NEED U              "i need u"
--   BTS Cypher Pt.3       "bts cypher pt3 killer", and "bts cypher pt 3 killer"
--                         for the "BTS Cypher, Pt. 3: KILLER" spelling
--
-- DDAENG isn't on Spotify (one recorded play in 120 days, by a stray "DDAENG"
-- artist), so it can't be streamed to 30. It's a quiz instead: the row shows
-- a hint, any teammate types a guess, and a right answer solves it for the
-- team (answerReconnectSharedTrack). Its answer keys are post-normalization
-- like every other key, with the common romanizations.

-- Which quiz tracks a mission's team has guessed: [{n, by, at}], n 1-based,
-- `by` a codename (never an agent number — this reaches the panel).
alter table public.rc_reconnect_missions
  add column if not exists solved_tracks jsonb not null default '[]'::jsonb;

insert into rc_goals (id, kind, label, artist, target, sort_order, district_id, variant, config, active) values
  ('angel-reconnect-surprise-songs-brazil', 'reconnect', 'Surprise Songs for Brazil', 'BTS',
   1, 530, 'mono-angel-613-bell-tower', 'connect',
   jsonb_build_object(
     'requiredAgents', 3,
     'sharedTracks', jsonb_build_object(
       'target', 30,
       'hidden', true,
       -- What the panel calls the list and what it is: "Find out the 6
       -- surprise songs BTS sang in Brazil on the ARIRANG tour and stream
       -- each one 30 times as a team."
       'noun', 'surprise songs',
       'clue', 'BTS sang in Brazil on the ARIRANG tour',
       'tracks', jsonb_build_array(
         jsonb_build_object('group', 'Day One',   'label', 'Black Swan',             'keys', jsonb_build_array('black swan')),
         jsonb_build_object('group', 'Day One',   'label', 'Baepsae / Silver Spoon', 'keys', jsonb_build_array('silver spoon', 'baepsae', normalize('뱁새 silver spoon', NFKD), normalize('뱁새', NFKD))),
         jsonb_build_object('group', 'Day Two',   'label', 'Airplane pt.2',          'keys', jsonb_build_array('airplane pt2')),
         jsonb_build_object('group', 'Day Two',   'label', 'I NEED U',               'keys', jsonb_build_array('i need u')),
         jsonb_build_object('group', 'Day Three', 'label', 'DDAENG',
           'quiz', jsonb_build_object(
             'hint', 'This one isn''t on Spotify, so guess it instead. Hint: a FESTA 2018 gift from the rap line.',
             'answerKeys', jsonb_build_array('ddaeng', 'ttaeng', 'daeng', 'ddang', normalize('땡', NFKD)))),
         jsonb_build_object('group', 'Day Three', 'label', 'BTS Cypher Pt.3: Killer', 'keys', jsonb_build_array('bts cypher pt3 killer', 'bts cypher pt 3 killer'))
       )
     )
   ),
   true);

-- ── Proof everything landed ────────────────────────────────────────────
-- The copied goals are INSERT ... SELECT ... JOIN, which inserts nothing for a
-- missing source id. Refuse to commit partial content.
do $$
declare
  v_tracks integer;
  v_albums integer;
  v_quest  integer;
  v_empty  integer;
  v_songs  integer;
begin
  select count(*) filter (where kind = 'track'),
         count(*) filter (where kind = 'album'),
         count(*) filter (where kind = 'reconnect')
    into v_tracks, v_albums, v_quest
    from rc_goals where district_id = 'mono-angel-613-bell-tower';

  if v_tracks <> 11 then raise exception 'expected 11 track goals, found %', v_tracks; end if;
  if v_albums <> 8  then raise exception 'expected 8 album goals, found %', v_albums; end if;
  if v_quest  <> 1  then raise exception 'expected 1 reconnect goal, found %', v_quest; end if;

  select count(*) into v_empty from rc_goals
   where district_id = 'mono-angel-613-bell-tower' and kind = 'album'
     and coalesce(jsonb_array_length(tracks), 0) = 0;
  if v_empty > 0 then raise exception '% album goal(s) have an empty tracklist', v_empty; end if;

  select jsonb_array_length(config -> 'sharedTracks' -> 'tracks') into v_songs
    from rc_goals where id = 'angel-reconnect-surprise-songs-brazil';
  if v_songs is distinct from 6 then raise exception 'expected 6 surprise songs, found %', v_songs; end if;
end $$;
