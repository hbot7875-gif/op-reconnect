-- Zeal Arcade (mono, sequence 8) — the district after Tae Pier. New
-- activations freeze this set; attempts already in progress keep theirs.
--
-- Track targets use the same three tiers as Tae Pier: 50 for the current
-- focus tracks, 40 for the "little less" tier, 30 for the "less" tier.
-- Aliases are copied from the rows already verified live in this ward
-- (Swim/Haegeum/Wild Flower/KIG/Winter Ahead/BS&T/PTD); Film out and tokyo
-- are plain Spotify titles (matching is case-insensitive via normKeyFull),
-- so they carry none.
--
-- Album goals are verbatim copies of already-live templates (Arirang, Keep
-- Swimming, Happy, GOLDEN, Layover) so no second drifting copy is created.
-- MUSE is new — tracklist taken from the Spotify album page (7 songs).
--
-- Reconnect: a 3-agent team pools every Hooligan + Aliens stream until the
-- team reaches 300 combined (same flat sharedTrack rule as mos7's D-DAY).

-- ── Track goals ──────────────────────────────────────────────────────────
insert into rc_goals (id, kind, label, artist, aliases, target, sort_order, district_id, active) values
  ('zeal-swim',              'track', 'Swim',                 'BTS',     '["SWIM"]'::jsonb, 50, 340, 'mono-zeal-arcade', true),
  ('zeal-wild-flower',       'track', 'Wild Flower',          'RM',      '["Wild Flower (with youjeen)", "Wild Flower (with Youjeen)", "Wild Flower (feat. Youjeen)", "야생화", "야생화 Wild Flower"]'::jsonb, 50, 341, 'mono-zeal-arcade', true),
  ('zeal-haegeum',           'track', 'Haegeum',              'Agust D', '["해금", "해금 Haegeum"]'::jsonb, 50, 342, 'mono-zeal-arcade', true),
  ('zeal-kig',               'track', 'Killin'' It Girl',     'j-hope',  '["Killin It Girl", "Killing It Girl", "Killin'' It Girl (feat. GloRilla)", "Killin'' It Girl (Solo Version)"]'::jsonb, 50, 343, 'mono-zeal-arcade', true),
  ('zeal-winter-ahead',      'track', 'Winter Ahead',         'V',       '["Winter Ahead (with PARK HYO SHIN)", "Winter Ahead (with Park Hyo Shin)", "Winter Ahead (feat. Park Hyo Shin)"]'::jsonb, 50, 344, 'mono-zeal-arcade', true),
  ('zeal-normal',            'track', 'Normal',               'BTS',     '["NORMAL"]'::jsonb, 40, 345, 'mono-zeal-arcade', true),
  ('zeal-come-over',         'track', 'Come Over',            'BTS',     '[]'::jsonb, 40, 346, 'mono-zeal-arcade', true),
  ('zeal-blood-sweat-tears', 'track', 'Blood Sweat & Tears',  'BTS',     '["Blood Sweat and Tears", "Blood, Sweat & Tears", "피 땀 눈물"]'::jsonb, 40, 347, 'mono-zeal-arcade', true),
  ('zeal-film-out',          'track', 'Film out',             'BTS',     '[]'::jsonb, 30, 348, 'mono-zeal-arcade', true),
  ('zeal-permission-to-dance','track','Permission to Dance',  'BTS',     '["PTD", "Permission To Dance"]'::jsonb, 30, 349, 'mono-zeal-arcade', true),
  ('zeal-tokyo',             'track', 'tokyo',                'RM',      '[]'::jsonb, 30, 350, 'mono-zeal-arcade', true)
on conflict (id) do nothing;

-- ── Album goals — verbatim copies of the already-live templates ─────────
insert into rc_goals (id, kind, label, artist, target, sort_order, district_id, active, tracks)
select 'zeal-album-arirang', 'album', 'ARIRANG', 'BTS', 5, 360, 'mono-zeal-arcade', true, tracks
from rc_goals where id = 'taepier-album-arirang'
on conflict (id) do nothing;

insert into rc_goals (id, kind, label, artist, target, sort_order, district_id, active, tracks)
select 'zeal-album-keep-swimming', 'album', 'Keep Swimming', 'BTS', 5, 361, 'mono-zeal-arcade', true, tracks
from rc_goals where id = 'taepier-album-keep-swimming'
on conflict (id) do nothing;

insert into rc_goals (id, kind, label, artist, target, sort_order, district_id, active, tracks)
select 'zeal-album-happy', 'album', 'Happy', 'Jin', 3, 362, 'mono-zeal-arcade', true, tracks
from rc_goals where id = 'taepier-album-happy'
on conflict (id) do nothing;

insert into rc_goals (id, kind, label, artist, aliases, target, sort_order, district_id, active, tracks) values
  ('zeal-album-muse', 'album', 'MUSE', 'Jimin', '[]'::jsonb, 2, 363, 'mono-zeal-arcade', true,
   '[
     {"label":"Rebirth (Intro)","aliases":["Rebirth"]},
     {"label":"Interlude : Showtime","aliases":["Interlude: Showtime","Showtime"]},
     {"label":"Smeraldo Garden Marching Band (feat. Loco)","aliases":["Smeraldo Garden Marching Band"]},
     {"label":"Slow Dance (feat. Sofia Carson)","aliases":["Slow Dance"]},
     {"label":"Be Mine","aliases":[]},
     {"label":"Who","aliases":[]},
     {"label":"Closer Than This","aliases":[]}
   ]'::jsonb)
on conflict (id) do nothing;

insert into rc_goals (id, kind, label, artist, target, sort_order, district_id, active, tracks)
select 'zeal-album-layover', 'album', 'Layover', 'V', 2, 364, 'mono-zeal-arcade', true, tracks
from rc_goals where id = 'hopesize-album-layover'
on conflict (id) do nothing;

insert into rc_goals (id, kind, label, artist, target, sort_order, district_id, active, tracks)
select 'zeal-album-golden', 'album', 'GOLDEN', 'Jung Kook', 2, 365, 'mono-zeal-arcade', true, tracks
from rc_goals where id = 'psov-album-golden'
on conflict (id) do nothing;

-- ── Reconnect goal — 3 agents, Hooligan + Aliens to 300 together ─────────
insert into rc_goals (id, kind, label, artist, variant, target, sort_order, district_id, active, config) values
  ('zeal-reconnect-hooligan-aliens-300', 'reconnect', 'Hooligan + Aliens: 300 Together', 'BTS', 'connect', 1, 370, 'mono-zeal-arcade', true,
   '{"requiredAgents": 3, "sharedTrack": {"label": "Hooligan + Aliens", "keys": ["hooligan", "aliens"], "target": 300}}'::jsonb)
on conflict (id) do nothing;
