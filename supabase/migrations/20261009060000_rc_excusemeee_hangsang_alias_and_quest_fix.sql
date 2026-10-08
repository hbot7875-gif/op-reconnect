-- Two defects in Excusemeee Boulevard's goals (20261006090000), both mine, and
-- both the same root cause: the goals were written from the Spotify playlist's
-- DISPLAY names without checking them against the titles the provider actually
-- reports.
--
-- ── 1. Hangsang counted 28% of its plays ──────────────────────────────────
--
-- normKeyFull strips trailing parentheticals. For this track the parenthetical
-- holds the ENGLISH TITLE, not a version suffix, so the English name is thrown
-- away and the Korean one becomes the key:
--
--   HANGSANG (feat. Supreme Boi)    324 plays  -> "hangsang"   counted
--   Hangsang (Feat. Supreme Boi)     28 plays  -> "hangsang"   counted
--   항상 (HANGSANG)                 918 plays  -> "항상"       counted for nobody
--   항상                              1 play   -> "항상"       counted for nobody
--
-- 919 of 1,271 plays in production, 72%, matched no goal. The original
-- migration's own comment says "both casings seen; the parenthetical is
-- stripped, so hangsang covers both" — it checked the two Latin spellings and
-- never considered the Korean title, directly below a Wild Flower goal that
-- carries 야생화 for exactly this reason.
--
-- Fixed the same way Wild Flower already was: aliases, because these are
-- genuinely different keys rather than suffixes the normalizer removes.
--
-- Measured first: all 16 agents holding this district have ZERO pre-activation
-- 항상 plays on their activation day and a stored baseline of 0, so adding the
-- key gives nobody a head start. windowedPlays (lib/districts.ts) subtracts
-- the baseline only on the activation date, so that was the one thing that
-- could have made this unfair, and it does not apply.
--
-- ── 2. The ReConnect quest could never be completed ───────────────────────
--
-- Checklist entry 3 was {"label":"Be Mine - English Version",
-- "keys":["be mine english version"]}. The provider reports that track as
-- "Be Mine (English Version)", which normalizes to "be mine" — identical to
-- entry 9, the plain "Be Mine".
--
-- So no scrobble could ever produce "be mine english version", and
-- reconnect-missions.ts requires done >= checklist.tracks.length for EVERY
-- joined member. The quest was unwinnable for all 16 agents.
--
-- The entry is removed rather than re-keyed, because there is no key that can
-- separate the two versions: normalization exists precisely to discard that
-- distinction, so this is not tunable. 27 entries remain, all reachable —
-- verified against every distinct title in rc_scrobbles.
--
-- The five spoken-word entries are NOT affected and stay: 112 plays of them
-- exist in production, so they are real, streamable and matchable.

-- ── the goal templates, so future activations are right ──────────────────

update public.rc_goals
   set aliases = '["Hangsang", "항상", "항상 (HANGSANG)", "항상 HANGSANG"]'::jsonb
 where id = 'exb-hangsang';

update public.rc_goals
   set config = jsonb_set(
         config, '{checklist,tracks}',
         (select coalesce(jsonb_agg(t order by ord), '[]'::jsonb)
            from jsonb_array_elements(config->'checklist'->'tracks')
                 with ordinality as x(t, ord)
           where not ((t->'keys') @> '["be mine english version"]'::jsonb)))
 where id = 'exb-reconnect-jimin-checklist';

-- ── the frozen copies, so the 16 agents holding it now get the fix ───────
--
-- Goals are frozen onto rc_player_districts at activation, so the templates
-- above do nothing for a district already in progress. Hangsang progress is
-- recomputed live from rc_daily_activity against these keys, so the 919 plays
-- start counting the moment this lands — there is nothing to backfill.
--
-- Written as the canonical final value rather than an append, so running it
-- twice cannot duplicate a key.
--
-- normalize(..., NFD) is not decoration. normalizeKey runs NFD to strip
-- diacritics, and NFD also decomposes Hangul syllables into Jamo — so the key
-- normKeyFull actually emits for 항상 is U+1112 U+1161 U+11BC U+1109 U+1161
-- U+11BC, not the precomposed U+D56D U+C0C1 that typing it here produces. A
-- precomposed literal would have been stored, matched nothing, and looked
-- exactly like a correct fix. Verified against production: the frozen Wild
-- Flower keys are already NFD, they equal normalize('야생화', NFD) byte for
-- byte, and a rc_daily_activity bucket already holds normalize('항상', NFD)
-- — which is where the 919 uncounted plays are sitting.
--
-- rc_goals.aliases above needs no such care: goalKeys (lib/transmission.ts)
-- runs normKeyFull over every alias at read time, so either spelling arrives
-- at the same key. Only these frozen, post-normalization keys are literal.

update public.rc_player_districts pd
   set goals = jsonb_set(
         jsonb_set(
           pd.goals, '{trackGoals}',
           (select coalesce(jsonb_agg(
                     case when g->>'label' = 'Hangsang (feat. Supreme Boi)'
                          then jsonb_set(g, '{keys}', jsonb_build_array(
                                 'hangsang',
                                 normalize('항상', NFD),
                                 normalize('항상', NFD) || ' hangsang'))
                          else g end
                     order by ord), '[]'::jsonb)
              from jsonb_array_elements(pd.goals->'trackGoals')
                   with ordinality as t(g, ord))),
         '{reconnect,config,checklist,tracks}',
         (select coalesce(jsonb_agg(t order by ord), '[]'::jsonb)
            from jsonb_array_elements(pd.goals->'reconnect'->'config'->'checklist'->'tracks')
                 with ordinality as x(t, ord)
           where not ((t->'keys') @> '["be mine english version"]'::jsonb)))
 where pd.district_id = 'mono-excusemeee-boulevard';

-- ── refuse to land unless every part of it is true ───────────────────────

do $$
declare
  v_alias_ok   boolean;
  v_tmpl_len   int;
  v_rows       int;
  v_fixed      int;
  v_checklist  int;
  v_dead       int;
  v_tracks     int;
  v_required   int;
begin
  select (aliases @> '["항상"]'::jsonb) into v_alias_ok
    from public.rc_goals where id = 'exb-hangsang';
  if not coalesce(v_alias_ok, false) then
    raise exception 'exb-hangsang did not get the Korean alias';
  end if;

  select jsonb_array_length(config->'checklist'->'tracks') into v_tmpl_len
    from public.rc_goals where id = 'exb-reconnect-jimin-checklist';
  if v_tmpl_len <> 27 then
    raise exception 'template checklist should hold 27 entries, holds %', v_tmpl_len;
  end if;

  select count(*) into v_rows
    from public.rc_player_districts where district_id = 'mono-excusemeee-boulevard';
  if v_rows <> 16 then
    raise exception 'expected 16 frozen Excusemeee districts, found % — check whether any were missed', v_rows;
  end if;

  -- Every frozen copy carries the Korean key, in the NFD form the normalizer
  -- actually emits. Comparing against a precomposed literal here would pass
  -- while the fix did nothing, so this asserts the decomposed form.
  select count(*) into v_fixed
    from public.rc_player_districts pd,
         jsonb_array_elements(pd.goals->'trackGoals') g
   where pd.district_id = 'mono-excusemeee-boulevard'
     and g->>'label' = 'Hangsang (feat. Supreme Boi)'
     and (g->'keys') @> jsonb_build_array(normalize('항상', NFD));
  if v_fixed <> v_rows then
    raise exception 'only % of % frozen districts carry the NFD Korean key', v_fixed, v_rows;
  end if;

  -- And that key is one real plays are actually filed under, so this cannot
  -- ship a key that is well-formed but matches nothing.
  if not exists (select 1 from public.rc_daily_activity da
                  where da.track_counts ? normalize('항상', NFD)) then
    raise exception 'no daily bucket holds the NFD 항상 key — it would match nothing';
  end if;

  -- Every frozen checklist is 27 entries and none is the dead one.
  select count(*) into v_checklist
    from public.rc_player_districts pd
   where pd.district_id = 'mono-excusemeee-boulevard'
     and jsonb_array_length(pd.goals->'reconnect'->'config'->'checklist'->'tracks') = 27;
  if v_checklist <> v_rows then
    raise exception 'only % of % frozen checklists hold 27 entries', v_checklist, v_rows;
  end if;

  select count(*) into v_dead
    from public.rc_player_districts pd,
         jsonb_array_elements(pd.goals->'reconnect'->'config'->'checklist'->'tracks') t
   where pd.district_id = 'mono-excusemeee-boulevard'
     and (t->'keys') @> '["be mine english version"]'::jsonb;
  if v_dead <> 0 then
    raise exception 'the unreachable checklist entry survives in % places', v_dead;
  end if;

  -- Nothing else moved: still 11 track goals each, still 3 required agents.
  select count(*) into v_tracks
    from public.rc_player_districts pd
   where pd.district_id = 'mono-excusemeee-boulevard'
     and jsonb_array_length(pd.goals->'trackGoals') = 11;
  if v_tracks <> v_rows then
    raise exception 'track goal count changed on % districts', v_rows - v_tracks;
  end if;

  select count(*) into v_required
    from public.rc_player_districts pd
   where pd.district_id = 'mono-excusemeee-boulevard'
     and (pd.goals->'reconnect'->'config'->>'requiredAgents') = '3';
  if v_required <> v_rows then
    raise exception 'requiredAgents no longer reads 3 on % districts', v_rows - v_required;
  end if;

  raise notice 'Excusemeee fix applied: % districts, Korean key present, checklist 27, requiredAgents 3', v_rows;
end $$;
