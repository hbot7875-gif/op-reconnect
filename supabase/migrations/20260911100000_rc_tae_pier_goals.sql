-- Tae Pier (mono, sequence 7) — the district right after Carabonara Diner,
-- which is what the 4 agents who've cleared every configured district
-- (AGENT030/038/046/094) are waiting on.
--
-- Track goals reuse the exact keys/aliases already verified elsewhere in
-- this ward (Haegeum/Wild Flower/Swim all match an existing template's
-- alias set) rather than retyping them and risking the class of key-
-- mismatch bug already patched twice this week (Champion, Old Town Road).
-- Killin' It Girl's aliases come from side-missions.ts's own TRACKS list
-- (same track, same known scrobble variants). Body to Body / Little Less /
-- First Love / Winter Flower have no prior rc_goals row to copy from —
-- plain-title, best-effort; flag if a real source reports any of them
-- under a different title.
--
-- Album goals are exact copies of already-live templates (Arirang, Keep
-- Swimming, Indigo, Happy, Love Yourself: Answer), reused verbatim from
-- Dazzledew/Hopesize/Lowkey/Map of Seven Crossing so this district can't
-- introduce a second, drifting copy of any of them. One real bug found
-- while copying Love Yourself: Answer is fixed in both places: "Trivia 承
-- : Love" had "Trivia 起 : Just Dance"'s own romanized alias mistakenly
-- duplicated onto it — era-timeline.ts's own verified finding is that 承
-- needs no such alias (only 起→"ki" and 轉→"ten" get romanized by the
-- affected source), so it should carry none.
--
-- Reconnect goal is a new mechanic — Team Boost: build a 9-agent team (a
-- plain 'connect' mission with no sharedTrack/checklist, so it completes
-- on the existing default rule — 9 joined, everyone streamed at least once
-- toward their own goals here). Once complete, each of the 9 can spend one
-- pick — up to 3 of Tae Pier's own track/album goals — for a flat +15%-of-
-- target progress bonus on each, personal only, never pooled. See
-- reconnect-missions.ts's getTeamBoostOverlay/pickTeamBoostGoals and
-- districts.ts's freezeGoals (teamBoost config field).

alter table public.rc_reconnect_participants add column if not exists boost_picks jsonb;
comment on column public.rc_reconnect_participants.boost_picks is
  'Team Boost (teamBoost reconnect config): up to maxPicks {kind,ref,label,bonus} entries this agent spent their one-shot pick on, set once mission status is complete. Null = not picked yet.';

-- Fix the mis-copied Trivia alias at its one existing live location before
-- reusing the (corrected) tracklist below.
update rc_goals
set tracks = jsonb_set(tracks, '{5,aliases}', '[]'::jsonb)
where id = 'dazzledew-album-love-yourself-answer'
  and tracks->5->>'label' = 'Trivia 承 : Love';

-- ── Track goals ──────────────────────────────────────────────────────────
insert into rc_goals (id, kind, label, artist, aliases, target, sort_order, district_id, active) values
  ('taepier-swim',          'track', 'Swim',              'BTS',       '["SWIM"]'::jsonb, 50, 320, 'mono-tae-pier', true),
  ('taepier-body-to-body',  'track', 'Body to Body',      'BTS',       '[]'::jsonb,        40, 321, 'mono-tae-pier', true),
  ('taepier-normal',        'track', 'Normal',            'BTS',       '[]'::jsonb,        40, 322, 'mono-tae-pier', true),
  ('taepier-come-over',     'track', 'Come Over',         'BTS',       '[]'::jsonb,        40, 323, 'mono-tae-pier', true),
  ('taepier-haegeum',       'track', 'Haegeum',           'Agust D',   '["해금", "해금 Haegeum"]'::jsonb, 50, 324, 'mono-tae-pier', true),
  ('taepier-wild-flower',   'track', 'Wild Flower',       'RM',        '["Wild Flower (with youjeen)", "Wild Flower (with Youjeen)", "Wild Flower (feat. Youjeen)", "야생화", "야생화 Wild Flower"]'::jsonb, 50, 325, 'mono-tae-pier', true),
  ('taepier-kig',           'track', 'Killin'' It Girl',  'j-hope',    '["Killin It Girl", "Killing It Girl", "Killin'' It Girl (feat. GloRilla)", "Killin'' It Girl (Solo Version)"]'::jsonb, 50, 326, 'mono-tae-pier', true),
  ('taepier-little-less',   'track', 'Little Less',       'BTS',       '[]'::jsonb,        40, 327, 'mono-tae-pier', true),
  ('taepier-am-i-wrong',    'track', 'Am I Wrong',        'BTS',       '[]'::jsonb,        40, 328, 'mono-tae-pier', true),
  ('taepier-let-me-know',   'track', 'Let Me Know',       'Jung Kook', '[]'::jsonb,        30, 329, 'mono-tae-pier', true),
  ('taepier-first-love',    'track', 'First Love',        'Agust D',   '[]'::jsonb,        40, 330, 'mono-tae-pier', true),
  ('taepier-winter-flower', 'track', 'Winter Flower',     'RM',        '[]'::jsonb,        40, 331, 'mono-tae-pier', true)
on conflict (id) do nothing;

-- ── Album goals — verbatim copies of the already-live templates ─────────
insert into rc_goals (id, kind, label, target, sort_order, district_id, active, tracks)
select 'taepier-album-arirang', 'album', label, 5, 332, 'mono-tae-pier', true, tracks
from rc_goals where id = 'album-arirang'
on conflict (id) do nothing;

insert into rc_goals (id, kind, label, target, sort_order, district_id, active, tracks)
select 'taepier-album-keep-swimming', 'album', label, 5, 333, 'mono-tae-pier', true, tracks
from rc_goals where id = 'mcd-album-keep-swimming'
on conflict (id) do nothing;

insert into rc_goals (id, kind, label, target, sort_order, district_id, active, tracks)
select 'taepier-album-indigo', 'album', label, 3, 334, 'mono-tae-pier', true, tracks
from rc_goals where id = 'dazzledew-album-indigo'
on conflict (id) do nothing;

insert into rc_goals (id, kind, label, target, sort_order, district_id, active, tracks)
select 'taepier-album-happy', 'album', label, 5, 335, 'mono-tae-pier', true, tracks
from rc_goals where id = 'mos7-album-happy'
on conflict (id) do nothing;

insert into rc_goals (id, kind, label, target, sort_order, district_id, active, tracks)
select 'taepier-album-love-yourself-answer', 'album', label, 2, 336, 'mono-tae-pier', true, tracks
from rc_goals where id = 'dazzledew-album-love-yourself-answer'
on conflict (id) do nothing;

-- ── Reconnect goal — Team Boost ──────────────────────────────────────────
insert into rc_goals (id, kind, label, variant, target, sort_order, district_id, active, config) values
  ('taepier-team-boost-9', 'reconnect', 'Tae Pier ReConnect', 'connect', 1, 337, 'mono-tae-pier', true,
   '{"requiredAgents": 9, "teamBoost": {"maxPicks": 3, "bonusPercent": 15}}'::jsonb)
on conflict (id) do nothing;
