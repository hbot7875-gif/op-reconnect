-- 20260824010000 added rc_backup_requests to this function but placed it
-- AFTER rc_player_items -- wrong order. rc_backup_requests.spent_player_item_id
-- is a second-order FK onto rc_player_items (not onto rc_agents directly,
-- so the original audit that found the other 6 missing tables didn't catch
-- this one), and it broke the very next scheduled run (2026-08-24 18:00 UTC):
-- "violates foreign key constraint rc_backup_requests_spent_player_item_id_fkey."
-- That night's run happened to succeed the following day only because
-- whatever had been blocking it cleared on its own -- the ordering bug
-- itself was still live and could recur for any future agent with an
-- active backup-request-linked player item at deletion time.
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
    -- Must precede rc_player_items — see comment above.
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
