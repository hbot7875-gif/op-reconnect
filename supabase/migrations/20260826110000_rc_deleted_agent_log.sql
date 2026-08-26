-- The user asked for the Instagram handles of the 21 agents the 14-day
-- auto-delete cron removed on 2026-08-25 -- unanswerable, since deleting
-- rc_agents destroys that identity along with everything else, and nothing
-- captured it first. This closes that gap: a permanent, append-only log of
-- who got deleted and how to reach them, written BEFORE either delete path
-- (adminDeleteAgent's one-off manual delete, and the scheduled 14-day
-- cleanup) removes the real row. Never updated or deleted itself, so it
-- can't be lost the same way.
create table if not exists rc_deleted_agent_log (
  id bigint generated always as identity primary key,
  agent_no text not null,
  handle text,
  email text,
  codename text,
  lb_username text,
  joined_at timestamptz,
  deleted_at timestamptz not null default now(),
  reason text not null
);

comment on table rc_deleted_agent_log is
  'Append-only. One row per agent ever deleted (manual or the 14-day inactive cron), written before the real rc_agents/rc_players rows are removed -- the only way to answer "who was X" after a delete.';

alter table rc_deleted_agent_log enable row level security;
revoke all on rc_deleted_agent_log from public, anon, authenticated;
grant select, insert on rc_deleted_agent_log to service_role;

create index if not exists rc_deleted_agent_log_agent_no_idx on rc_deleted_agent_log (agent_no);

-- Scheduled cleanup now logs each agent right before removing them.
create or replace function rc_delete_inactive_agents_scheduled(p_inactive_days int default 14)
returns table (deleted_agent_no text)
language plpgsql
as $$
declare
  r record;
begin
  for r in
    select c.agent_no, a.handle, a.email, a.lb_username, a.created_at as joined_at, p.codename
    from rc_inactive_agent_candidates(p_inactive_days) c
    join rc_agents a on a.agent_no = c.agent_no
    left join rc_players p on p.agent_no = c.agent_no
  loop
    insert into rc_deleted_agent_log (agent_no, handle, email, codename, lb_username, joined_at, reason)
    values (r.agent_no, r.handle, r.email, r.codename, r.lb_username, r.joined_at, 'inactive_14d');

    delete from rc_reconnect_puzzle_attempts where agent_no = r.agent_no;
    delete from rc_reconnect_participants where agent_no = r.agent_no;
    update rc_reconnect_participants set invited_by = null where invited_by = r.agent_no;
    delete from rc_reconnect_missions where created_by = r.agent_no;
    delete from rc_defuse_contrib where agent_no = r.agent_no;
    delete from rc_backup_requests where owner_agent_no = r.agent_no;
    update rc_backup_requests set helper_agent_no = null where helper_agent_no = r.agent_no;
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
    delete from rc_playlist_reports where agent_no = r.agent_no;
    delete from rc_playlist_saves where agent_no = r.agent_no;
    delete from rc_supply_chest_opens where agent_no = r.agent_no;
    delete from rc_supply_chest_progress where agent_no = r.agent_no;
    delete from rc_vma_community_chest_claims where agent_no = r.agent_no;
    delete from rc_vma_votes where agent_no = r.agent_no;
    delete from rc_players where agent_no = r.agent_no;
    delete from rc_agents where agent_no = r.agent_no;
    deleted_agent_no := r.agent_no;
    return next;
  end loop;
end;
$$;
