-- Read-only preview of the inactivity cleanup, for the admin dashboard.
--
-- The admin panel could tell who was past 14 days, but not who the 18:00 UTC
-- job would actually delete: the warning-email gate lives only inside
-- rc_delete_inactive_agents_scheduled, and rc_inactivity_warnings was never
-- exposed. This function answers that question without deleting anything.
--
-- It changes no rule. The candidates come from rc_inactive_agent_candidates
-- (last charge or verified vote, minus leave — migration 20261101090000), and
-- `eligible` is the scheduled job's own WHERE clause, copied verbatim:
--
--     coalesce(a.email, '') = ''
--  or (w.last_warned_at is not null
--      and w.last_warned_at <= now() - rc_warning_notice_days() days
--      and w.last_warned_at >= now() - rc_warning_valid_days() days)
--
-- applied to the 14-day candidate set. The PGlite test
-- (lib/cleanup-preview-sql.test.mjs) runs the real scheduled job against the
-- same rows and requires the two sets to be identical.
--
-- p_min_days widens the list downward (9 = the reminder band) so the panel can
-- show the leave-adjusted clock for at-risk agents too; `eligible` is only
-- ever true at p_inactive_days and above. STABLE, SELECT-only, service_role only.

create or replace function rc_inactive_agent_deletion_preview(
  p_min_days       integer default 9,
  p_inactive_days  integer default 14
)
returns table (
  agent_no          text,
  codename          text,
  days_inactive     numeric,
  has_email         boolean,
  first_warned_at   timestamptz,
  last_warned_at    timestamptz,
  last_attempt_at   timestamptz,
  warn_count        integer,
  last_delivery_ok  boolean,
  eligible_from     timestamptz,
  eligible          boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with c as (
    select * from rc_inactive_agent_candidates(least(p_min_days, p_inactive_days))
  ),
  full_candidates as (
    select agent_no from rc_inactive_agent_candidates(p_inactive_days)
  )
  select
    c.agent_no,
    c.codename,
    c.days_inactive,
    coalesce(a.email, '') <> '' as has_email,
    w.first_warned_at,
    w.last_warned_at,
    w.last_attempt_at,
    coalesce(w.warn_count, 0) as warn_count,
    w.last_delivery_ok,
    case when coalesce(a.email, '') <> '' and w.last_warned_at is not null
         then w.last_warned_at + make_interval(days => rc_warning_notice_days()) end as eligible_from,
    (c.agent_no in (select agent_no from full_candidates))
      and (
        coalesce(a.email, '') = ''
        or (
          w.last_warned_at is not null
          and w.last_warned_at <= now() - make_interval(days => rc_warning_notice_days())
          and w.last_warned_at >= now() - make_interval(days => rc_warning_valid_days())
        )
      ) as eligible
  from c
  join rc_agents a on a.agent_no = c.agent_no
  left join rc_inactivity_warnings w on w.agent_no = c.agent_no
  order by c.days_inactive desc
$$;

revoke all on function rc_inactive_agent_deletion_preview(integer, integer) from public, anon, authenticated;
grant execute on function rc_inactive_agent_deletion_preview(integer, integer) to service_role;
