-- AGENT000 activated Home Base before its full weekly goal set was seeded,
-- so the account still holds the old tutorial snapshot. Refresh this one test
-- account only and baseline today's existing plays before restarting its week.

create or replace function pg_temp.rc_goal_key(value text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(
    regexp_replace(
      replace(replace(replace(lower(
        regexp_replace(coalesce(value, ''), '\s*[\(\[].*[\)\]]\s*$', '')
      ), '''', ''), '-', ' '), ':', ' '),
      '[^[:alnum:]\s]+', '', 'g'
    ),
    '\s+', ' ', 'g'
  ));
$$;

update rc_player_districts as pd
set
  goals = jsonb_build_object(
    'trackGoals', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', g.id,
          'label', g.label,
          'artist', g.artist,
          'target', g.target * coalesce((pd.goals #>> '{meta,multiplier}')::int, 1),
          'keys', (
            select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
            from (
              select distinct pg_temp.rc_goal_key(raw_value) as key
              from (
                select g.label as raw_value
                union all
                select jsonb_array_elements_text(coalesce(g.aliases, '[]'::jsonb))
              ) values_to_normalize
              where pg_temp.rc_goal_key(raw_value) <> ''
            ) normalized
          )
        ) order by g.sort_order
      )
      from rc_goals g
      where g.active = true and g.kind = 'track'
        and g.district_id = 'relay-zero-hq'
    ), '[]'::jsonb),
    'albumGoals', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', g.id,
          'label', g.label,
          'target', g.target * coalesce((pd.goals #>> '{meta,multiplier}')::int, 1),
          'tracks', (
            select coalesce(jsonb_agg(
              jsonb_build_object(
                'label', track.value ->> 'label',
                'keys', (
                  select coalesce(jsonb_agg(key order by key), '[]'::jsonb)
                  from (
                    select distinct pg_temp.rc_goal_key(raw_value) as key
                    from (
                      select track.value ->> 'label' as raw_value
                      union all
                      select jsonb_array_elements_text(coalesce(track.value -> 'aliases', '[]'::jsonb))
                    ) values_to_normalize
                    where pg_temp.rc_goal_key(raw_value) <> ''
                  ) normalized
                )
              ) order by track.ordinality
            ), '[]'::jsonb)
            from jsonb_array_elements(g.tracks) with ordinality as track(value, ordinality)
          )
        ) order by g.sort_order
      )
      from rc_goals g
      where g.active = true and g.kind = 'album'
        and g.district_id = 'relay-zero-hq'
    ), '[]'::jsonb),
    'reconnect', coalesce(pd.goals -> 'reconnect', 'null'::jsonb),
    'meta', jsonb_build_object(
      'mode', coalesce(pd.goals #>> '{meta,mode}', 'medium'),
      'multiplier', coalesce((pd.goals #>> '{meta,multiplier}')::int, 1),
      'tutorial', true
    )
  ),
  baseline = coalesce((
    select jsonb_object_agg(counts.key, coalesce((counts.value ->> 'n')::int, 0))
    from rc_daily_activity activity
    cross join lateral jsonb_each(coalesce(activity.track_counts, '{}'::jsonb)) counts
    where activity.agent_no = pd.agent_no
      and activity.kst_date = (timezone('Asia/Seoul', now()))::date
  ), '{}'::jsonb),
  activated_at = now()
where pd.agent_no = 'AGENT000'
  and pd.district_id = 'relay-zero-hq'
  and pd.status = 'active'
  and not coalesce(pd.goals -> 'trackGoals', '[]'::jsonb) @>
    '[{"id":"home-base-dsylm"}]'::jsonb;

-- Reset visible XP without deleting historical rewards. The compensating
-- entry keeps old stream rewards from reappearing on the next sync.
with current_xp as (
  select coalesce(sum(amount), 0)::int as amount
  from rc_xp_ledger
  where agent_no = 'AGENT000'
)
insert into rc_xp_ledger (agent_no, amount, source, dedup_key, meta)
select
  'AGENT000', -amount, 'admin_reset',
  'admin-xp-reset:AGENT000:20260807-home-base-repair',
  jsonb_build_object('previousXp', amount, 'reason', 'Home Base goal refresh')
from current_xp
where amount <> 0
on conflict (dedup_key) do nothing;

update rc_players
set last_level = 1,
    boost_multiplier = 1,
    boost_expires_at = null
where agent_no = 'AGENT000';
