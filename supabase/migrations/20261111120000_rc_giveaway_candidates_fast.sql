-- PC Giveaway: make the review list fast enough for the API.
--
-- "Prepare / refresh list" failed with giveaway_error: rc_giveaway_candidates
-- took ~55 s, and API calls are cut off by the authenticator role's 8 s
-- statement_timeout. Two parts were slow:
--   * the play window was compared as numeric for every row, so all of
--     rc_scrobbles (2.3M rows) was read instead of each member's index range;
--   * the duplicate check compared every pair of plays of the same song.
--
-- Same rules, same output (checked member-for-member on production data
-- before release): a play is still a copy when another source reported the
-- same song up to dup_window_s seconds before it. It is now found in one
-- sorted pass: the newest earlier report from a different source is always
-- the row just before the current same-source stretch began. Days still
-- count in KST (UTC+9, no daylight saving), now computed arithmetically.
-- Runs in ~1.5 s.

create or replace function public.rc_giveaway_candidates(
  p_campaign_id text, p_team text, p_rules jsonb
) returns jsonb language sql stable
set search_path = public, pg_temp
set work_mem = '32MB'
as $$
  with r as (
    select coalesce(p_rules->>'vote_mission', 'mnet') as mission,
           (p_rules->>'vote_num')::int as vn, (p_rules->>'vote_den')::int as vd,
           (p_rules->>'stream_num')::int as sn_, (p_rules->>'stream_den')::int as sd_,
           coalesce((p_rules->>'dup_window_s')::int, 600) as dup_s,
           coalesce(array(select jsonb_array_elements_text(p_rules->'exclude_agents')), '{}'::text[]) as excluded
  ), c as (
    select rc_kst_day(opens_at) as d0, rc_kst_day(closes_at) as d1
    from rc_vote_campaigns where id = p_campaign_id
  ), m as (
    select t.agent_no, t.assigned_via, a.handle, a.retired_at, t.show_ig, t.show_ig_at, c.d1,
           least(c.d1, greatest(c.d0, case when t.assigned_via = 'carried' then c.d0
                                     else rc_kst_day(coalesce(t.assigned_at, t.started_at)) end)) as d_start
    from rc_campaign_teams t join rc_agents a using (agent_no) cross join c
    where t.campaign_id = p_campaign_id and t.team = p_team
  ), v as (
    select p.agent_no, count(distinct p.vote_day) as n
    from rc_campaign_proofs p join m using (agent_no) cross join r
    where p.campaign_id = p_campaign_id and p.status = 'verified' and p.mission_id = r.mission
      and p.vote_day between m.d_start and m.d1
    group by p.agent_no
  ), s as (
    -- Per-player index range scans: the window bounds are whole-second
    -- bigints, so (agent_no, listened_at) is used instead of reading the
    -- whole table.
    select sc.id, sc.agent_no, sc.source, lower(sc.track_name) as tr, sc.listened_at
    from (
      select m.agent_no,
             extract(epoch from (m.d_start::timestamp at time zone 'Asia/Seoul'))::bigint - r.dup_s as lo,
             extract(epoch from ((m.d1 + 1)::timestamp at time zone 'Asia/Seoul'))::bigint + r.dup_s as hi
      from m cross join r
    ) w
    cross join lateral (
      select x.id, x.agent_no, x.source, x.track_name, x.listened_at from rc_scrobbles x
      where x.agent_no = w.agent_no and x.listened_at >= w.lo and x.listened_at < w.hi
      offset 0  -- keep this a per-player index lookup
    ) sc
  ), s1 as (
    select s.*, lag(source) over w as prev_source, lag(listened_at) over w as prev_at
    from s window w as (partition by agent_no, tr order by listened_at, id)
  ), s2 as (
    -- Latest earlier report of this song from a DIFFERENT source. Reports
    -- run in same-source stretches; the row before each stretch starts is
    -- the newest report from another source, so carrying that time forward
    -- in one sorted pass gives the same answer as comparing every pair.
    select s1.*, max(case when prev_source is distinct from source then prev_at end)
             over (partition by agent_no, tr order by listened_at, id rows unbounded preceding) as prev_other_at
    from s1
  ), u as (
    -- unchanged rule: a report is a copy when another source reported the
    -- same song up to dup_s seconds before it (or at the same second, first)
    select distinct s2.agent_no, date '1970-01-01' + ((s2.listened_at + 32400) / 86400)::int as d
    from s2 cross join r
    where s2.prev_other_at is null or s2.prev_other_at < s2.listened_at - r.dup_s
  ), sd as (
    select agent_no, d from u
    union
    select a.agent_no, a.kst_date from rc_daily_activity a join m using (agent_no)
    where a.raw_streams > 0 and a.kst_date between m.d_start and m.d1
      and not exists (select 1 from u where u.agent_no = a.agent_no and u.d = a.kst_date)
  ), sn as (
    select sd.agent_no, count(distinct sd.d) as n
    from sd join m using (agent_no) where sd.d between m.d_start and m.d1
    group by sd.agent_no
  ), x as (
    select m.agent_no,
           case when (m.show_ig or m.show_ig_at is null) and m.handle ~ '^@?[A-Za-z0-9._]{1,30}$'
                then '@' || ltrim(m.handle, '@') else m.agent_no end as display,
           m.d_start, (m.d1 - m.d_start + 1) as days,
           coalesce(v.n, 0) as vote_days, coalesce(sn.n, 0) as stream_days,
           -- ceil(days × num / den) in whole numbers, so 12 × 8/12 is exactly 8
           ((m.d1 - m.d_start + 1) * r.vn + r.vd - 1) / r.vd as vote_need,
           ((m.d1 - m.d_start + 1) * r.sn_ + r.sd_ - 1) / r.sd_ as stream_need,
           m.retired_at is not null as retired,
           m.agent_no = any (r.excluded) as admin
    from m cross join r left join v using (agent_no) left join sn using (agent_no)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'agent_no', agent_no, 'display', display, 'joined', d_start, 'days', days,
           'vote_days', vote_days, 'vote_need', vote_need,
           'stream_days', stream_days, 'stream_need', stream_need,
           'eligible', not retired and not admin and vote_days >= vote_need and stream_days >= stream_need,
           'reason', case
             when admin then 'Admin account'
             when retired then 'Account retired'
             when vote_days >= vote_need and stream_days >= stream_need then 'Meets both requirements'
             else concat_ws('; ',
               case when vote_days < vote_need then format('Voting %s of %s days (needs %s)', vote_days, days, vote_need) end,
               case when stream_days < stream_need then format('Streaming %s of %s days (needs %s)', stream_days, days, stream_need) end)
           end) order by agent_no), '[]'::jsonb)
  from x
$$;
