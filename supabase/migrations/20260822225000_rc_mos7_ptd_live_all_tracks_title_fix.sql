-- Follow-up to 20260822223000 (ON / Blue & Grey / So What): AGENT030 also
-- streamed "IDOL (Live)" and it hit the exact same wall. Checked rc_scrobbles
-- broadly and this isn't 3-4 unlucky tracks -- MusiCat mislabels essentially
-- any track on this album, and not even consistently: alongside "(Live)" it
-- also produces bracket and reordered forms like "Burning Up (FIRE) [Live]"
-- and "Boy With Luv (Live) [feat. Halsey]". stripVersionSuffix() repeatedly
-- strips trailing paren/bracket groups, so ANY of these collapses down to
-- the song's bare base title, never to the album's "- Live" key.
--
-- Rather than chase this one track at a time, accept the bare base title
-- (own parenthetical content removed, matching what stripVersionSuffix
-- would produce) as an extra key for every remaining track on this goal.
-- Three of these (FAKE LOVE, So What, Airplane pt.2) already share a bare
-- key with a track on this same district's LOVE YOURSELF Tear album goal,
-- so a studio play of those will now also satisfy this live-album slot --
-- accepted, matching the precedent used throughout this project of letting
-- one play count toward every goal whose key it legitimately matches.
update rc_goals set
  tracks = (
    select jsonb_agg(
      case t->>'label'
        when 'Burning Up (FIRE) - Live' then jsonb_set(t, '{aliases}', (t->'aliases') || '["Burning Up"]'::jsonb)
        when 'Dope - Live' then jsonb_set(t, '{aliases}', (t->'aliases') || '["Dope"]'::jsonb)
        when 'DNA - Live' then jsonb_set(t, '{aliases}', (t->'aliases') || '["DNA"]'::jsonb)
        when 'Black Swan - Live' then jsonb_set(t, '{aliases}', (t->'aliases') || '["Black Swan"]'::jsonb)
        when 'Blood Sweat & Tears - Live' then jsonb_set(t, '{aliases}', (t->'aliases') || '["Blood Sweat & Tears"]'::jsonb)
        when 'FAKE LOVE - Live' then jsonb_set(t, '{aliases}', (t->'aliases') || '["FAKE LOVE"]'::jsonb)
        when 'Life Goes On - Live' then jsonb_set(t, '{aliases}', (t->'aliases') || '["Life Goes On"]'::jsonb)
        when 'Boy With Luv (Feat. Halsey) - Live' then jsonb_set(t, '{aliases}', (t->'aliases') || '["Boy With Luv"]'::jsonb)
        when 'Dynamite - Live' then jsonb_set(t, '{aliases}', (t->'aliases') || '["Dynamite"]'::jsonb)
        when 'Butter - Live' then jsonb_set(t, '{aliases}', (t->'aliases') || '["Butter"]'::jsonb)
        when 'Telepathy - Live' then jsonb_set(t, '{aliases}', (t->'aliases') || '["Telepathy"]'::jsonb)
        when 'Outro : Wings - Live' then jsonb_set(t, '{aliases}', (t->'aliases') || '["Outro : Wings"]'::jsonb)
        when 'Stay - Live' then jsonb_set(t, '{aliases}', (t->'aliases') || '["Stay"]'::jsonb)
        when 'IDOL - Live' then jsonb_set(t, '{aliases}', (t->'aliases') || '["IDOL"]'::jsonb)
        when 'Airplane pt.2 - Live' then jsonb_set(t, '{aliases}', (t->'aliases') || '["Airplane pt.2"]'::jsonb)
        when 'Silver Spoon - Live' then jsonb_set(t, '{aliases}', (t->'aliases') || '["Silver Spoon"]'::jsonb)
        when 'Dis-ease - Live' then jsonb_set(t, '{aliases}', (t->'aliases') || '["Dis-ease"]'::jsonb)
        when 'Spring Day - Live' then jsonb_set(t, '{aliases}', (t->'aliases') || '["Spring Day"]'::jsonb)
        when 'Permission to Dance - Live' then jsonb_set(t, '{aliases}', (t->'aliases') || '["Permission to Dance"]'::jsonb)
        else t
      end
    )
    from jsonb_array_elements(tracks) as t
  ),
  updated_at = now()
where id = 'mos7-album-permission-to-dance';

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
                when 'Burning Up (FIRE) - Live' then jsonb_set(t, '{keys}', (t->'keys') || '["burning up"]'::jsonb)
                when 'Dope - Live' then jsonb_set(t, '{keys}', (t->'keys') || '["dope"]'::jsonb)
                when 'DNA - Live' then jsonb_set(t, '{keys}', (t->'keys') || '["dna"]'::jsonb)
                when 'Black Swan - Live' then jsonb_set(t, '{keys}', (t->'keys') || '["black swan"]'::jsonb)
                when 'Blood Sweat & Tears - Live' then jsonb_set(t, '{keys}', (t->'keys') || '["blood sweat tears"]'::jsonb)
                when 'FAKE LOVE - Live' then jsonb_set(t, '{keys}', (t->'keys') || '["fake love"]'::jsonb)
                when 'Life Goes On - Live' then jsonb_set(t, '{keys}', (t->'keys') || '["life goes on"]'::jsonb)
                when 'Boy With Luv (Feat. Halsey) - Live' then jsonb_set(t, '{keys}', (t->'keys') || '["boy with luv"]'::jsonb)
                when 'Dynamite - Live' then jsonb_set(t, '{keys}', (t->'keys') || '["dynamite"]'::jsonb)
                when 'Butter - Live' then jsonb_set(t, '{keys}', (t->'keys') || '["butter"]'::jsonb)
                when 'Telepathy - Live' then jsonb_set(t, '{keys}', (t->'keys') || '["telepathy"]'::jsonb)
                when 'Outro : Wings - Live' then jsonb_set(t, '{keys}', (t->'keys') || '["outro wings"]'::jsonb)
                when 'Stay - Live' then jsonb_set(t, '{keys}', (t->'keys') || '["stay"]'::jsonb)
                when 'IDOL - Live' then jsonb_set(t, '{keys}', (t->'keys') || '["idol"]'::jsonb)
                when 'Airplane pt.2 - Live' then jsonb_set(t, '{keys}', (t->'keys') || '["airplane pt2"]'::jsonb)
                when 'Silver Spoon - Live' then jsonb_set(t, '{keys}', (t->'keys') || '["silver spoon"]'::jsonb)
                when 'Dis-ease - Live' then jsonb_set(t, '{keys}', (t->'keys') || '["dis ease"]'::jsonb)
                when 'Spring Day - Live' then jsonb_set(t, '{keys}', (t->'keys') || '["spring day"]'::jsonb)
                when 'Permission to Dance - Live' then jsonb_set(t, '{keys}', (t->'keys') || '["permission to dance"]'::jsonb)
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
