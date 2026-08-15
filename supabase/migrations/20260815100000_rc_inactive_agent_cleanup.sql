-- Automatic account deletion for agents who haven't fed the ARMY Bomb in
-- 2 weeks straight. Two functions, deliberately kept separate:
--
--   rc_inactive_agent_candidates(days) — read-only. Who WOULD be deleted
--   right now. "Not charged" is measured specifically by rc_feed_events'
--   bomb_fed rows (an explicit feedCharge() call), not general streaming or
--   app activity — an agent who streams daily but never personally feeds
--   the Bomb still counts as inactive here, per the site owner. An agent
--   who has never fed it at all is measured from rc_agents.created_at
--   (their join date) instead of treated as "never inactive."
--
--   rc_delete_inactive_agents(days) — the real, permanent delete. Loops the
--   candidate list and removes the agent from every table that references
--   agent_no. Most of those tables carry no FK to rc_agents at all (this
--   codebase mostly joins on agent_no as plain text, not a real FK), so
--   deleting rc_agents alone would leave 12+ tables of orphaned rows behind
--   — this explicitly cleans each one, in a single plpgsql function so a
--   failure partway through rolls the whole agent's deletion back instead
--   of leaving them half-erased. The four tables that DO have a real
--   ON DELETE CASCADE (rc_players, rc_scrobbles, rc_password_resets,
--   rc_agent_charge, rc_agent_lit_eras) are left to that cascade rather
--   than deleted twice.
--
-- AGENT001 (the test account used to verify fixes against real endpoints —
-- see docs/test-account-and-session-tokens.md) is hard-excluded: it never
-- has real streaming/charge activity by design and would otherwise always
-- qualify as "inactive." A retired agent (retired_at set) is also excluded
-- — they're already locked out; this is for agents still nominally active
-- but silently gone dark.
--
-- Deliberately NOT scheduled via pg_cron in this migration — see the
-- follow-up admin review before this runs unattended for the first time.

create or replace function rc_inactive_agent_candidates(p_inactive_days int default 14)
returns table (agent_no text, codename text, last_fed_at timestamptz, joined_at timestamptz, days_inactive numeric)
language sql
stable
as $$
  select
    a.agent_no, p.codename, f.last_fed_at, a.created_at as joined_at,
    round(extract(epoch from (now() - coalesce(f.last_fed_at, a.created_at))) / 86400.0, 1) as days_inactive
  from rc_agents a
  left join rc_players p on p.agent_no = a.agent_no
  left join (
    select agent_no, max(created_at) as last_fed_at
    from rc_feed_events
    where event_type = 'bomb_fed'
    group by agent_no
  ) f on f.agent_no = a.agent_no
  where a.agent_no <> 'AGENT001'
    and a.retired_at is null
    and coalesce(f.last_fed_at, a.created_at) < now() - (p_inactive_days || ' days')::interval
  order by days_inactive desc
$$;

create or replace function rc_delete_inactive_agents(p_inactive_days int default 14)
returns table (deleted_agent_no text)
language plpgsql
as $$
declare
  r record;
begin
  for r in select c.agent_no from rc_inactive_agent_candidates(p_inactive_days) c loop
    delete from rc_badges where agent_no = r.agent_no;
    delete from rc_daily_activity where agent_no = r.agent_no;
    delete from rc_defuse_contrib where agent_no = r.agent_no;
    delete from rc_feed_events where agent_no = r.agent_no;
    delete from rc_player_districts where agent_no = r.agent_no;
    delete from rc_player_items where agent_no = r.agent_no;
    delete from rc_reconnect_messages where agent_no = r.agent_no;
    delete from rc_reconnect_participants where agent_no = r.agent_no;
    delete from rc_reconnect_puzzle_attempts where agent_no = r.agent_no;
    delete from rc_streak_freeze_log where agent_no = r.agent_no;
    delete from rc_suggestions where agent_no = r.agent_no;
    delete from rc_xp_ledger where agent_no = r.agent_no;
    -- Cascades to rc_players, rc_scrobbles, rc_password_resets,
    -- rc_agent_charge, rc_agent_lit_eras; sets generated_playlists.agent_no
    -- to null (its own FK rule) — see this file's header comment.
    delete from rc_agents where agent_no = r.agent_no;
    deleted_agent_no := r.agent_no;
    return next;
  end loop;
end;
$$;
