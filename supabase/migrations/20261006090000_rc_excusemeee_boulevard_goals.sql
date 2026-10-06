-- Excusemeee Boulevard (mono ward, sequence 10) — the district that opens
-- after Namu Grove, and the next one with no goals of its own.
--
-- Tiers copy the ward's existing shape exactly, so this reads as the next
-- district rather than a different game. Verified against every mono district
-- from sequence 6 to 9 (Carabonara Diner, Tae Pier, Zeal Arcade, Namu Grove),
-- all of which use:
--   tracks  50 / 40 / 30   high / moderate / less, BEFORE mode scaling
--   albums   5 /  3 /  2   full-album passes
-- freezeGoals (lib/districts.ts) multiplies track targets by the player's mode
-- multiplier, so 50 lands at 65 on easy — identical to its neighbours.
--
-- Track labels are the ones that actually MATCH SCROBBLES, not the ones that
-- read best. goalKeys (lib/transmission.ts) is normKeyFull of the label plus
-- each alias, and normKeyFull strips apostrophes and trailing parentheticals.
-- Four of these tracks had no goal anywhere in the game, so their labels were
-- checked against the artist strings production has actually recorded:
--   "No. 29"                         BTS        21,508 plays
--   "Set Me Free Pt.2"               Jimin         959 plays
--   "Strange (feat. RM)"             Agust D       by far the messiest: also
--     seen as "Strange (feat. Rm)" and bare "Strange", credited variously to
--     "Agust D", "Agust D, RM", "RM" and "Agust D & RM". All three title
--     spellings normalize to "strange", so one key covers every one of them —
--     and "Strangers" / "STRANGER I KNOW" key separately, so neither is ever
--     mistaken for it.
--   "HANGSANG (feat. Supreme Boi)"   j-hope        both casings seen; the
--     parenthetical is stripped, so "hangsang" covers both.

-- ── Track goals ────────────────────────────────────────────────────────
-- Artists are the ones the identical goals already carry elsewhere in the
-- ward (Haegeum is Agust D, Killin' It Girl is j-hope, Winter Ahead is V), so
-- the artist allowlist behaves the same here as it does there.
insert into rc_goals (id, kind, label, artist, aliases, target, sort_order, district_id, active) values
  ('exb-swim',              'track', 'Swim',                        'BTS',     '[]'::jsonb, 50, 421, 'mono-excusemeee-boulevard', true),
  ('exb-haegeum',           'track', 'Haegeum',                     'Agust D', '[]'::jsonb, 50, 422, 'mono-excusemeee-boulevard', true),
  -- The only track carrying aliases: the Korean title and the featured-artist
  -- spellings are genuinely different keys, not suffixes the normalizer
  -- strips. Copied verbatim from the existing Wild Flower goals.
  ('exb-wild-flower',       'track', 'Wild Flower',                 'RM',
     '["Wild Flower (with youjeen)", "Wild Flower (with Youjeen)", "Wild Flower (feat. Youjeen)", "야생화", "야생화 Wild Flower"]'::jsonb,
     50, 423, 'mono-excusemeee-boulevard', true),
  ('exb-killin-it-girl',    'track', 'Killin'' It Girl',            'j-hope',  '[]'::jsonb, 50, 424, 'mono-excusemeee-boulevard', true),
  ('exb-dna',               'track', 'DNA',                         'BTS',     '[]'::jsonb, 40, 425, 'mono-excusemeee-boulevard', true),
  ('exb-winter-ahead',      'track', 'Winter Ahead',                'V',       '[]'::jsonb, 40, 426, 'mono-excusemeee-boulevard', true),
  -- ARIRANG's tenth track. The alias is NOT redundant here: "No. 29" keys to
  -- "no 29" and so does "No 29", but the spelling with the period is the one
  -- Spotify reports, and the ARIRANG album goal already stores both.
  ('exb-no-29',             'track', 'No. 29',                      'BTS',     '["No 29"]'::jsonb, 40, 427, 'mono-excusemeee-boulevard', true),
  ('exb-set-me-free-pt2',   'track', 'Set Me Free Pt.2',            'Jimin',   '["Set Me Free Pt. 2"]'::jsonb, 40, 428, 'mono-excusemeee-boulevard', true),
  -- Lower-case label to match the way RM's own album lists it, exactly as
  -- Zeal Arcade's identical goal does. Keys are case-insensitive regardless.
  ('exb-tokyo',             'track', 'tokyo',                       'RM',      '[]'::jsonb, 30, 429, 'mono-excusemeee-boulevard', true),
  ('exb-strange',           'track', 'Strange (feat. RM)',          'Agust D', '["Strange"]'::jsonb, 30, 430, 'mono-excusemeee-boulevard', true),
  ('exb-hangsang',          'track', 'Hangsang (feat. Supreme Boi)','j-hope',  '["Hangsang"]'::jsonb, 30, 431, 'mono-excusemeee-boulevard', true);

-- ── Album goals ────────────────────────────────────────────────────────
-- All six already exist elsewhere with tracklists that have been completing
-- passes in production for weeks. Copying the stored `tracks` rather than
-- retyping it keeps them byte-identical — a retyped tracklist that differs by
-- one character silently makes the album unpassable.
insert into rc_goals (id, kind, label, artist, tracks, target, sort_order, district_id, active)
select 'exb-album-arirang', 'album', label, artist, tracks, 5, 440, 'mono-excusemeee-boulevard', true
  from rc_goals where id = 'namu-album-arirang';
insert into rc_goals (id, kind, label, artist, tracks, target, sort_order, district_id, active)
select 'exb-album-keep-swimming', 'album', label, artist, tracks, 5, 441, 'mono-excusemeee-boulevard', true
  from rc_goals where id = 'namu-album-keep-swimming';
insert into rc_goals (id, kind, label, artist, tracks, target, sort_order, district_id, active)
select 'exb-album-happy', 'album', label, artist, tracks, 3, 442, 'mono-excusemeee-boulevard', true
  from rc_goals where id = 'taepier-album-happy';
insert into rc_goals (id, kind, label, artist, tracks, target, sort_order, district_id, active)
select 'exb-album-dday', 'album', label, artist, tracks, 3, 443, 'mono-excusemeee-boulevard', true
  from rc_goals where id = 'lka-album-dday';
insert into rc_goals (id, kind, label, artist, tracks, target, sort_order, district_id, active)
select 'exb-album-proof', 'album', label, artist, tracks, 2, 444, 'mono-excusemeee-boulevard', true
  from rc_goals where id = 'mcd-album-proof';
insert into rc_goals (id, kind, label, artist, tracks, target, sort_order, district_id, active)
select 'exb-album-love-yourself-tear', 'album', label, artist, tracks, 2, 445, 'mono-excusemeee-boulevard', true
  from rc_goals where id = 'mos7-album-love-yourself-tear';

-- ── ReConnect quest ────────────────────────────────────────────────────
-- A team of three, each of whom must play every track on Spotify's "This Is
-- Jimin". Same 'connect' + checklist shape as Carabonara Diner's "This Is RM"
-- quest, which is the only other playlist-checklist quest in the game.
--
-- Completion is per-agent and per-track: refreshMission requires
-- done >= checklist.tracks.length for EVERY joined member (lib/
-- reconnect-missions.ts), so this is 3 members x 28 distinct tracks, one play
-- each. Lighter than the RM quest's 8 x 48.
--
-- The 28 entries are the playlist's 34 items with same-key variants folded
-- together. Five "Like Crazy" cuts (original, English, Deep House, UK Garage,
-- Instrumental) all normalize to "like crazy", as do the duplicated Smeraldo
-- Garden Marching Band and Closer Than This entries. Leaving them in as
-- separate rows would have demanded the same single play two or five times
-- over and made the quest impossible to finish.
--
-- Keys are post-normalization, which is why the spoken-word tracks are stored
-- without their apostrophes ("jimins message to army face"). Dollar-quoted so
-- the apostrophes in the labels need no escaping.
insert into rc_goals (id, kind, label, artist, target, sort_order, district_id, variant, config, active) values
  ('exb-reconnect-jimin-checklist', 'reconnect', 'This Is Jimin: Full Playlist', 'Jimin',
   1, 450, 'mono-excusemeee-boulevard', 'connect',
   $jimin${
   "requiredAgents": 3,
   "checklist": {
     "playlistUrl": "https://open.spotify.com/playlist/37i9dQZF1DX7H4XpyC9TgJ",
     "tracks": [
       {"label":"Intro to 'This is Jimin'","keys":["intro to this is jimin"]},
       {"label":"SWIM with Jimin (Slow Jam R&B Remix)","keys":["swim with jimin"]},
       {"label":"Who","keys":["who"]},
       {"label":"Be Mine - English Version","keys":["be mine english version"]},
       {"label":"Closer Than This","keys":["closer than this"]},
       {"label":"Rebirth (Intro)","keys":["rebirth"]},
       {"label":"Interlude : Showtime","keys":["interlude showtime"]},
       {"label":"Smeraldo Garden Marching Band (feat. Loco)","keys":["smeraldo garden marching band"]},
       {"label":"Slow Dance (feat. Sofia Carson)","keys":["slow dance"]},
       {"label":"Be Mine","keys":["be mine"]},
       {"label":"Angel Pt. 2 (feat. Jimin of BTS, Charlie Puth and Muni Long / FAST X Soundtrack)","keys":["angel pt 2"]},
       {"label":"Angel Pt. 1 (feat. Jimin of BTS, JVKE & Muni Long)","keys":["angel pt 1"]},
       {"label":"Jimin's Message to ARMY - FACE","keys":["jimins message to army face"]},
       {"label":"Jimin's Message to ARMY - Like Crazy","keys":["jimins message to army like crazy"]},
       {"label":"Like Crazy","keys":["like crazy"]},
       {"label":"Jimin's Message to ARMY - Set Me Free Pt.2","keys":["jimins message to army set me free pt2"]},
       {"label":"Set Me Free Pt.2","keys":["set me free pt2"]},
       {"label":"Face-off","keys":["face off"]},
       {"label":"Interlude : Dive","keys":["interlude dive"]},
       {"label":"Alone","keys":["alone"]},
       {"label":"Promise","keys":["promise"]},
       {"label":"Christmas Love","keys":["christmas love"]},
       {"label":"VIBE (feat. Jimin of BTS)","keys":["vibe"]},
       {"label":"Serendipity (Full Length Edition)","keys":["serendipity"]},
       {"label":"Lie","keys":["lie"]},
       {"label":"Filter","keys":["filter"]},
       {"label":"With you","keys":["with you"]},
       {"label":"Outro Message from Jimin","keys":["outro message from jimin"]}
     ]
   }
 }$jimin$::jsonb,
   true);

-- ── Proof the copied albums actually landed ────────────────────────────
-- Each album above is an INSERT ... SELECT, which inserts nothing at all if
-- its source id is missing. Silent partial content is worse than a failed
-- migration, so refuse to commit unless all 18 goals exist.
do $$
declare
  v_tracks integer;
  v_albums integer;
  v_quest  integer;
  v_empty  integer;
begin
  select count(*) filter (where kind = 'track'),
         count(*) filter (where kind = 'album'),
         count(*) filter (where kind = 'reconnect')
    into v_tracks, v_albums, v_quest
    from rc_goals where district_id = 'mono-excusemeee-boulevard';

  if v_tracks <> 11 then raise exception 'expected 11 track goals, found %', v_tracks; end if;
  if v_albums <> 6  then raise exception 'expected 6 album goals, found %', v_albums; end if;
  if v_quest  <> 1  then raise exception 'expected 1 reconnect goal, found %', v_quest; end if;

  select count(*) into v_empty from rc_goals
   where district_id = 'mono-excusemeee-boulevard' and kind = 'album'
     and coalesce(jsonb_array_length(tracks), 0) = 0;
  if v_empty > 0 then raise exception '% album goal(s) copied an empty tracklist', v_empty; end if;
end $$;
