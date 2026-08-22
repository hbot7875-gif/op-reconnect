-- AGENT030 streamed "So What", "Blue & Grey", and "ON" from PERMISSION TO
-- DANCE ON STAGE - LIVE (confirmed live in MusiCat's own recent-jams feed:
-- "So What (Live)", "Blue & Grey (Live)", "ON (Live)"), but none of the
-- three counted toward the PTD-Live album goal.
--
-- Root cause: Spotify's own canonical titles for this album use a trailing
-- " - Live" suffix uniformly (verified against the album directly) -- which
-- is what mos7-album-permission-to-dance's tracks/keys are built from, and
-- what the other 17 tracks on this goal actually match against. But
-- MusiCat itself reports these 3 specific tracks with a parenthetical
-- "(Live)" suffix instead, and stripVersionSuffix() strips ANY trailing
-- parenthetical as version noise -- so "So What (Live)" normalizes down to
-- bare "so what", which never matches the goal's "so what live" key.
--
-- Fix: accept the bare (post-strip) title as an additional key for exactly
-- these 3 tracks, so a MusiCat-reported "(Live)" play matches the same as
-- the album's own "- Live" formatting does. Scoped to only these 3 rather
-- than all 22, since e.g. "so what" is *also* a distinct, already-required
-- track on this same district's LOVE YOURSELF Tear album goal -- accepting
-- bare titles everywhere would let a studio play satisfy a live-only slot
-- with no live evidence at all, whereas for these 3 there's no other way
-- for MusiCat to have reported the title.
update rc_goals set
  tracks = (
    select jsonb_agg(
      case t->>'label'
        when 'ON - Live' then jsonb_set(t, '{aliases}', (t->'aliases') || '["ON"]'::jsonb)
        when 'Blue & Grey - Live' then jsonb_set(t, '{aliases}', (t->'aliases') || '["Blue & Grey"]'::jsonb)
        when 'So What - Live' then jsonb_set(t, '{aliases}', (t->'aliases') || '["So What"]'::jsonb)
        else t
      end
    )
    from jsonb_array_elements(tracks) as t
  ),
  updated_at = now()
where id = 'mos7-album-permission-to-dance';

-- Backfill every already-frozen activation of this goal too (same shape
-- the 2026-08-20 PTD backfill used) -- template-only leaves anyone who
-- already activated this district still stuck on the old keys.
update rc_player_districts
set goals = jsonb_set(
  goals, '{albumGoals}',
  (
    select jsonb_agg(
      case
        when a->>'id' = 'mos7-album-permission-to-dance' then jsonb_set(
          a, '{tracks}',
          (
            select jsonb_agg(
              case t->>'label'
                when 'ON - Live' then jsonb_set(t, '{keys}', (t->'keys') || '["on"]'::jsonb)
                when 'Blue & Grey - Live' then jsonb_set(t, '{keys}', (t->'keys') || '["blue grey"]'::jsonb)
                when 'So What - Live' then jsonb_set(t, '{keys}', (t->'keys') || '["so what"]'::jsonb)
                else t
              end
            )
            from jsonb_array_elements(a->'tracks') as t
          )
        )
        else a
      end
    )
    from jsonb_array_elements(goals->'albumGoals') as a
  )
)
where district_id = 'mono-map-of-seven-crossing'
  and goals->'albumGoals' @> '[{"id":"mos7-album-permission-to-dance"}]';
