-- Home Base: retire the "Don't Say You Love Me" track goal.
--
-- Jin's Don't Say You Love Me has passed 1B on Spotify, the milestone this
-- goal was pushing for, so it comes off Home Base for everyone — new runs and
-- runs already under way (decided 2026-10-28).
--
-- Two places carry it, as with the Tae Pier fix (20261006210000):
--
--   1. rc_goals 'home-base-dsylm' — set inactive rather than deleted, so
--      config.ts's active-only goal list (and with it freezeGoals) stops
--      handing it to new Home Base activations, while the row stays for
--      history and the admin Goals tab.
--   2. rc_player_districts.goals->'trackGoals' — the FROZEN copy on every
--      ACTIVE Home Base run. Without this the agents already on Home Base
--      would keep needing it. Removing a requirement only ever makes a run
--      easier: anyone whose other goals are all done restores on their next
--      poll, as the game already does.
--
-- Deliberately NOT touched:
--   * 'restored' Home Base rows: finished runs keep the goals they ran under.
--   * baseline: an object of per-key starting counts; an unused key is inert.
--   * the Echo album goal (home-base-album-echo), which lists DSYLM as one of
--     Echo's seven tracks. That goal is about the album, not this song.
--   * rc_backup_requests: the one joined request on this goal is closed by
--     backup-pass.ts on its next refresh ("the goal itself vanished"), which
--     credits the helper's contribution. Doing it here would skip that credit.
--   * the Signal Sweep / Road to 1B mission (side-missions.ts), which already
--     dropped this song.

do $$
declare
  v_expected integer;
  v_n integer;
begin
  if not exists (select 1 from public.rc_goals where id = 'home-base-dsylm') then
    raise exception 'home-base-dsylm not found';
  end if;

  -- 1. the goal, for every future activation
  update public.rc_goals
     set active = false, updated_at = now()
   where id = 'home-base-dsylm' and active;
  get diagnostics v_n = row_count;
  raise notice 'goal rows deactivated: %', v_n;

  -- 2. the frozen copy on every active Home Base run
  select count(*) into v_expected
    from public.rc_player_districts
   where status = 'active' and district_id = 'relay-zero-hq'
     and goals->'trackGoals' @> '[{"id":"home-base-dsylm"}]'::jsonb;

  update public.rc_player_districts
     set goals = jsonb_set(goals, '{trackGoals}', coalesce((
           select jsonb_agg(g order by ord)
             from jsonb_array_elements(goals->'trackGoals') with ordinality as t(g, ord)
            where g->>'id' is distinct from 'home-base-dsylm'
         ), '[]'::jsonb))
   where status = 'active' and district_id = 'relay-zero-hq'
     and goals->'trackGoals' @> '[{"id":"home-base-dsylm"}]'::jsonb;
  get diagnostics v_n = row_count;
  if v_n <> v_expected then
    raise exception 'expected to update % active Home Base runs, updated %', v_expected, v_n;
  end if;
  raise notice 'active Home Base runs updated: %', v_n;

  -- ── Post-conditions ──
  if exists (select 1 from public.rc_goals where id = 'home-base-dsylm' and active) then
    raise exception 'home-base-dsylm is still active';
  end if;
  if exists (select 1 from public.rc_player_districts
              where status = 'active' and district_id = 'relay-zero-hq'
                and goals->'trackGoals' @> '[{"id":"home-base-dsylm"}]'::jsonb) then
    raise exception 'an active Home Base run still carries home-base-dsylm';
  end if;
end $$;
