-- The scheduled path for automatic inactive-agent deletion. 053/054 tried
-- routing this through the edge function's adminDeleteInactiveAgents (to
-- reuse admin-agent.ts's adminDeleteAgent as the single delete
-- implementation), but a pg_cron job has no way to hold the real
-- SYNC_ADMIN_KEY — it's an edge function secret, not something stored in
-- the database (checked vault.secrets: empty), and typing it into a
-- migration file would commit a live secret to source control. So the
-- scheduled path gets its OWN complete delete function instead, entirely
-- inside Postgres — no HTTP call, no secret, no edge-function cold start
-- to depend on.
--
-- This intentionally duplicates admin-agent.ts's adminDeleteAgent table
-- list. Keep them in sync by hand if either changes — search both files
-- for "rc_reconnect_puzzle_attempts" to find the other one. The manual,
-- admin-key-gated path (adminDeleteInactiveAgents, dry-run by default)
-- still calls adminDeleteAgent itself and is unaffected by this.

create or replace function rc_delete_inactive_agents_scheduled(p_inactive_days int default 14)
returns table (deleted_agent_no text)
language plpgsql
as $$
declare
  r record;
begin
  for r in select c.agent_no from rc_inactive_agent_candidates(p_inactive_days) c loop
    delete from rc_reconnect_puzzle_attempts where agent_no = r.agent_no;
    delete from rc_reconnect_participants where agent_no = r.agent_no;
    update rc_reconnect_participants set invited_by = null where invited_by = r.agent_no;
    delete from rc_reconnect_missions where created_by = r.agent_no;
    delete from rc_defuse_contrib where agent_no = r.agent_no;
    delete from rc_player_items where agent_no = r.agent_no;
    delete from rc_streak_freeze_log where agent_no = r.agent_no;
    delete from rc_badges where agent_no = r.agent_no;
    delete from rc_xp_ledger where agent_no = r.agent_no;
    delete from rc_daily_activity where agent_no = r.agent_no;
    delete from rc_player_districts where agent_no = r.agent_no;
    delete from rc_agent_lit_eras where agent_no = r.agent_no;
    delete from rc_agent_charge where agent_no = r.agent_no;
    delete from rc_feed_events where agent_no = r.agent_no;
    delete from rc_reconnect_messages where agent_no = r.agent_no;
    delete from rc_suggestions where agent_no = r.agent_no;
    update generated_playlists set agent_no = null where agent_no = r.agent_no;
    delete from rc_scrobbles where agent_no = r.agent_no;
    delete from rc_password_resets where agent_no = r.agent_no;
    delete from rc_players where agent_no = r.agent_no;
    delete from rc_agents where agent_no = r.agent_no;
    deleted_agent_no := r.agent_no;
    return next;
  end loop;
end;
$$;

create extension if not exists pg_cron;

-- 18:00 UTC = 03:00 KST the next day — same off-peak reasoning as every
-- other daily-boundary job in this codebase (kst.ts). Unschedule with
-- select cron.unschedule('rc-delete-inactive-agents') if this needs to
-- pause; re-run this file's schedule() call to resume.
select cron.schedule(
  'rc-delete-inactive-agents',
  '0 18 * * *',
  $$select rc_delete_inactive_agents_scheduled(14)$$
);
