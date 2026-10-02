-- The question migration 20261002090000 exists to answer, and nothing else.
--
-- READ-ONLY. No write, no DDL, no temp table. Safe to run at any time.
--
--     npx supabase db query --linked --file scripts/statsfm-streamid-observation.sql
--
-- WHY THIS IS THE DECIDING MEASUREMENT
--
-- rc_scrobbles dedupes on UNIQUE (agent_no, listened_at, track_name), so the
-- provider's timestamp IS the row identity. Stats.fm reports one physical
-- play twice -- once with a second-level endTime, once truncated to the
-- minute -- so the two land as two rows.
--
-- The real fix is to key on Stats.fm's own `streamId` instead of the
-- timestamp. That only works if the id SURVIVES the timestamp changing. If it
-- is a hash over (user, track, time) it will differ between the two rows and
-- be useless for exactly the case it is needed for. We had no history to
-- check because the id was never stored, so the migration started storing it
-- and changed nothing else.
--
-- Run this once a few days of pairs have accumulated. Read `verdict`:
--
--   SAME id on both rows  -> streamId is stable across the precision change.
--                            Dedup on (agent_no, source, source_event_id) is
--                            then a measured fact, and the historical repair
--                            can be driven off it.
--   DIFFERENT ids         -> streamId is timestamp-derived and CANNOT be the
--                            dedup identity. Do not add a unique index. The
--                            minute-truncation approach would then be the
--                            remaining option, and it needs its own decision
--                            because it is lossy.
--   not enough data yet   -> wait. `pairs_with_both_ids` says how close it is.
--
-- Until this reads SAME on a meaningful sample, nothing dedupes on the
-- column: it stays observational, exactly as the migration's comment says.

with s as (
  select agent_no,
         listened_at,
         source_event_id,
         lower(btrim(track_name)) as t,
         lower(btrim(coalesce(artist_name, ''))) as a,
         listened_at - mod(listened_at, 60) as minute_start
    from public.rc_scrobbles
   where source = 'statsfm'
),
-- The same confirmed-artifact definition stream-canonical.ts uses: exactly
-- one minute-aligned row and one second-precision row in a bucket, with no
-- two different non-empty artists.
grp as (
  select agent_no, t, minute_start,
         count(*) filter (where mod(listened_at, 60) = 0)  as aligned,
         count(*) filter (where mod(listened_at, 60) <> 0) as precise,
         count(distinct a) filter (where a <> '')          as artists
    from s
   group by 1, 2, 3
),
pair as (
  select g.agent_no, g.t, g.minute_start,
         max(s.source_event_id) filter (where mod(s.listened_at, 60) = 0)  as aligned_id,
         max(s.source_event_id) filter (where mod(s.listened_at, 60) <> 0) as precise_id
    from grp g
    join s
      on s.agent_no = g.agent_no and s.t = g.t and s.minute_start = g.minute_start
   where g.aligned = 1 and g.precise = 1 and g.artists <= 1
   group by 1, 2, 3
),
tally as (
  select count(*)                                                      as pairs_total,
         count(*) filter (where aligned_id is not null
                            and precise_id is not null)                as pairs_with_both_ids,
         count(*) filter (where aligned_id is not null
                            and precise_id is not null
                            and aligned_id = precise_id)               as ids_match,
         count(*) filter (where aligned_id is not null
                            and precise_id is not null
                            and aligned_id <> precise_id)              as ids_differ
    from pair
)
select pairs_total,
       pairs_with_both_ids,
       ids_match,
       ids_differ,
       round(100.0 * ids_match / nullif(pairs_with_both_ids, 0), 1) as pct_match,
       case
         when pairs_with_both_ids < 50 then
           'not enough data yet - need 50+ pairs carrying an id on both rows'
         when ids_differ = 0 then
           'SAME - streamId survives the precision change; it can become the dedup identity'
         when ids_match = 0 then
           'DIFFERENT - streamId is timestamp-derived; it CANNOT be the dedup identity'
         else
           'MIXED - investigate before relying on it either way'
       end as verdict
  from tally;

-- Coverage, so a low pair count can be told apart from a sync that is not
-- writing the column at all. Rows predating the deploy keep a NULL here and
-- are expected to.
select count(*)                                              as statsfm_rows,
       count(source_event_id)                                as with_id,
       round(100.0 * count(source_event_id) / nullif(count(*), 0), 1) as pct_with_id,
       min(to_timestamp(listened_at)) filter (where source_event_id is not null) as first_id_at
  from public.rc_scrobbles
 where source = 'statsfm';
