-- Drop the five spoken-word entries from Excusemeee Boulevard's "This Is
-- Jimin" quest, leaving 22 songs.
--
--   Intro to 'This is Jimin'
--   Jimin's Message to ARMY - FACE
--   Jimin's Message to ARMY - Like Crazy
--   Jimin's Message to ARMY - Set Me Free Pt.2
--   Outro Message from Jimin
--
-- ── why ──────────────────────────────────────────────────────────────────
--
-- Not a matching defect. These five are real, streamable and keyed correctly:
-- 113 plays exist in production across all four sources, and three agents
-- have cleared all five. Measured per participant, every agent missing one
-- has NO play of it under any title, ever -- the scrobbles do not exist.
--
-- They are, however, the only thing the quest is stuck on. Of 17 participants:
--
--   13-14 of 17 are blocked by these five and nothing else
--   9 agents are missing EXACTLY these five, having played all 22 songs
--   3 of 17 can finish the quest today; 11 of 17 can without them
--
-- And whether a short spoken interlude scrobbles at all depends on the
-- player's scrobbler settings rather than on their listening. Web Scrobbler
-- and Pano both refuse to submit a track below a configured length or
-- playback percentage, which is a per-user client setting: 8 of the 10 agents
-- on the 'direct' source have never produced one of these, while two have.
-- Gating a three-person team quest on a client preference nobody chose is not
-- what "everyone should stream this playlist" was asking for.
--
-- The 22 songs are untouched, so the quest still means what it meant.
--
-- Verified before removing: no other rc_goals row and no other district's
-- frozen goals reference any of these five keys, so nothing else loses a
-- target.
--
-- ── scope ────────────────────────────────────────────────────────────────
--
-- Template and all 16 frozen rc_player_districts.goals, because goals freeze
-- at activation. Filtered by key rather than by label, and idempotent: a
-- second run removes nothing further.

update public.rc_goals
   set config = jsonb_set(
         config, '{checklist,tracks}',
         (select coalesce(jsonb_agg(t order by ord), '[]'::jsonb)
            from jsonb_array_elements(config->'checklist'->'tracks')
                 with ordinality as x(t, ord)
           where not ((t->'keys') ?| array[
                   'intro to this is jimin',
                   'jimins message to army face',
                   'jimins message to army like crazy',
                   'jimins message to army set me free pt2',
                   'outro message from jimin',
                   -- Removed in 20261009060000. Repeated here so a district
                   -- frozen from the pre-fix template converges to 22 too,
                   -- instead of landing at 23 and failing the assertion.
                   'be mine english version'])))
 where id = 'exb-reconnect-jimin-checklist';

update public.rc_player_districts pd
   set goals = jsonb_set(
         pd.goals, '{reconnect,config,checklist,tracks}',
         (select coalesce(jsonb_agg(t order by ord), '[]'::jsonb)
            from jsonb_array_elements(pd.goals->'reconnect'->'config'->'checklist'->'tracks')
                 with ordinality as x(t, ord)
           where not ((t->'keys') ?| array[
                   'intro to this is jimin',
                   'jimins message to army face',
                   'jimins message to army like crazy',
                   'jimins message to army set me free pt2',
                   'outro message from jimin',
                   -- Removed in 20261009060000. Repeated here so a district
                   -- frozen from the pre-fix template converges to 22 too,
                   -- instead of landing at 23 and failing the assertion.
                   'be mine english version'])))
 where pd.district_id = 'mono-excusemeee-boulevard';

do $$
declare
  v_tmpl    int;
  v_rows    int;
  v_ok      int;
  v_spoken  int;
  v_tracks  int;
  v_req     int;
  v_hang    int;
begin
  select jsonb_array_length(config->'checklist'->'tracks') into v_tmpl
    from public.rc_goals where id = 'exb-reconnect-jimin-checklist';
  if v_tmpl <> 22 then
    raise exception 'template checklist should hold 22 entries, holds %', v_tmpl;
  end if;

  select count(*) into v_rows
    from public.rc_player_districts where district_id = 'mono-excusemeee-boulevard';
  -- NOT a fixed number. The district is live and agents keep activating it:
  -- this migration was written against 16 and refused at 18 an hour later.
  -- What must hold is that EVERY frozen copy is correct, whatever the count,
  -- so the floor is only a sanity check that we are looking at the right
  -- district at all. Every assertion below compares against v_rows.
  if v_rows < 16 then
    raise exception 'only % frozen Excusemeee districts, fewer than the 16 measured', v_rows;
  end if;

  select count(*) into v_ok
    from public.rc_player_districts pd
   where pd.district_id = 'mono-excusemeee-boulevard'
     and jsonb_array_length(pd.goals->'reconnect'->'config'->'checklist'->'tracks') = 22;
  if v_ok <> v_rows then
    raise exception 'only % of % frozen checklists hold 22 entries', v_ok, v_rows;
  end if;

  select count(*) into v_spoken
    from public.rc_player_districts pd,
         jsonb_array_elements(pd.goals->'reconnect'->'config'->'checklist'->'tracks') t
   where pd.district_id = 'mono-excusemeee-boulevard'
     and (t->'keys') ?| array['intro to this is jimin','jimins message to army face',
                              'jimins message to army like crazy',
                              'jimins message to army set me free pt2',
                              'outro message from jimin'];
  if v_spoken <> 0 then
    raise exception 'a spoken-word entry survives in % places', v_spoken;
  end if;

  -- Nothing else moved, including the Hangsang fix from 20261009060000.
  select count(*) into v_tracks
    from public.rc_player_districts pd
   where pd.district_id = 'mono-excusemeee-boulevard'
     and jsonb_array_length(pd.goals->'trackGoals') = 11;
  if v_tracks <> v_rows then
    raise exception 'track goal count changed on % districts', v_rows - v_tracks;
  end if;

  select count(*) into v_req
    from public.rc_player_districts pd
   where pd.district_id = 'mono-excusemeee-boulevard'
     and (pd.goals->'reconnect'->'config'->>'requiredAgents') = '3';
  if v_req <> v_rows then
    raise exception 'requiredAgents no longer reads 3 on % districts', v_rows - v_req;
  end if;

  select count(*) into v_hang
    from public.rc_player_districts pd,
         jsonb_array_elements(pd.goals->'trackGoals') g
   where pd.district_id = 'mono-excusemeee-boulevard'
     and g->>'label' = 'Hangsang (feat. Supreme Boi)'
     and (g->'keys') @> jsonb_build_array(normalize('항상', NFD));
  if v_hang <> v_rows then
    raise exception 'the Hangsang NFD key was lost on % districts', v_rows - v_hang;
  end if;

  raise notice 'quest trimmed to 22 songs across % districts', v_rows;
end $$;
