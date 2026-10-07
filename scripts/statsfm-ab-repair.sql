-- Remove the minute-aligned half of every confirmed Stats.fm A/B precision
-- pair from rc_scrobbles. Measured 2026-10-07: 39,705 rows, 24 agents.
--
-- NOT YET RUN. Review this, then run it once.
--
-- ── what this does and does not move ─────────────────────────────────────
--
-- Counting does not read rc_scrobbles. Streams, XP, district goals, badges,
-- ARIRANG and Road to 1B all read rc_daily_activity.track_counts, and
-- derive.ts only re-derives a day that is missing, unfinalized, or today
-- (derive.ts ~L207). Every other day is frozen.
--
-- Measured against that: of the 408 agent-days this delete touches, 387 are
-- finalized and cannot move, 3 have no rc_daily_activity row at all, and the
-- 18 that will re-derive are ALL 2026-10-07 — today, still in progress. So
-- this removes phantom rows from today's live counts, which is the point, and
-- leaves every historical total exactly as it stands.
--
-- Recomputing the 387 frozen days is a SEPARATE action. That is the one that
-- would lower players' historical streams and move the campaign totals, and
-- it is deliberately not here.
--
-- ── the rule ─────────────────────────────────────────────────────────────
--
-- Identical to statsFmRowsToSkip and canonicalStreamResult: group by agent +
-- wall-clock minute + normalised track, require exactly one minute-aligned
-- row and exactly one second-precision row, require the artists to agree or
-- one of them to be absent. The minute-aligned row is the truncated
-- representation, so the second-precision row is the one kept.
--
-- Anything else is left alone — 1A+2B minutes, same-second title variants,
-- artist disagreements. Those are separate defects with their own causes.

begin;

-- Full snapshot of every row this deletes, so it is reversible by
-- INSERT ... SELECT back into rc_scrobbles.
-- Plain column copy: no defaults, no identity, no constraints, so the
-- explicit id values below insert as-is and the snapshot cannot collide with
-- the live sequence.
create table if not exists public.rc_scrobbles_ab_repair_20261007
  (like public.rc_scrobbles);

create temporary table doomed as
with s as (
  select id, agent_no, listened_at, track_name,
         lower(btrim(track_name))               as t,
         lower(btrim(coalesce(artist_name,''))) as a,
         listened_at - mod(listened_at,60)      as minute_start,
         (mod(listened_at,60) = 0)              as aligned
    from public.rc_scrobbles
   where source = 'statsfm'
),
grp as (
  select agent_no, t, minute_start,
         count(*) filter (where aligned)     as a_side,
         count(*) filter (where not aligned) as b_side,
         min(a) filter (where aligned)       as a_artist,
         min(a) filter (where not aligned)   as b_artist
    from s group by 1,2,3
),
pairs as (
  select * from grp
   where a_side = 1 and b_side = 1
     and (a_artist = b_artist or a_artist = '' or b_artist = '')
)
select s.id
  from s join pairs p
    on p.agent_no = s.agent_no and p.t = s.t and p.minute_start = s.minute_start
 where s.aligned;

-- Refuse to run if the shape is not what was measured. A wildly different
-- count means the rule or the data moved, and this should be re-derived
-- rather than trusted.
do $$
declare n bigint;
begin
  select count(*) into n from doomed;
  raise notice 'rows to delete: %', n;
  if n = 0 then raise exception 'nothing matched: the rule or the data changed'; end if;
  if n > 60000 then raise exception 'refusing: % rows is far beyond the measured 39705', n; end if;
end $$;

insert into public.rc_scrobbles_ab_repair_20261007
select r.* from public.rc_scrobbles r join doomed d on d.id = r.id;

delete from public.rc_scrobbles r using doomed d where d.id = r.id;

-- Every confirmed pair must now be a single row. If any remain, nothing is
-- committed.
do $$
declare remaining bigint;
begin
  with s as (
    select agent_no,
           lower(btrim(track_name))               as t,
           lower(btrim(coalesce(artist_name,''))) as a,
           listened_at - mod(listened_at,60)      as minute_start,
           (mod(listened_at,60) = 0)              as aligned
      from public.rc_scrobbles where source = 'statsfm'
  )
  select count(*) into remaining from (
    select agent_no, t, minute_start
      from s group by 1,2,3
     having count(*) filter (where aligned) = 1
        and count(*) filter (where not aligned) = 1
        and (min(a) filter (where aligned) = min(a) filter (where not aligned)
             or min(a) filter (where aligned) = ''
             or min(a) filter (where not aligned) = '')
  ) x;
  raise notice 'confirmed pairs remaining: %', remaining;
  if remaining > 0 then
    raise exception 'still % confirmed pairs after the delete', remaining;
  end if;
end $$;

commit;
