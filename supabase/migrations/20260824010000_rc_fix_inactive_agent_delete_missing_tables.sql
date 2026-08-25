-- The daily inactive-agent cleanup (rc-delete-inactive-agents, 18:00 UTC)
-- has failed 3 nights running: "violates foreign key constraint
-- rc_vma_votes_agent_no_fkey" — deleting rc_agents while a candidate still
-- has a VMA vote row. Since the whole loop runs as one function call, one
-- blocked agent fails the ENTIRE run, so nobody has actually been deleted
-- since this started (confirmed via cron.job_run_details): 0 real deletes
-- since the job began, even on nights it reported "succeeded" (0 rows
-- because rc_inactive_agent_candidates happened to be empty those nights).
--
-- Root cause is bigger than just rc_vma_votes: cross-checked every real FK
-- pointing at rc_agents against BOTH delete paths (this function and
-- admin-agent.ts's adminDeleteAgent, which the migration for this job
-- already warned would drift by hand) and found SEVEN tables neither path
-- knew about -- every one of them a feature added after the original
-- delete list was written: rc_backup_requests (both owner and helper
-- columns), rc_playlist_reports, rc_playlist_saves, rc_supply_chest_opens,
-- rc_supply_chest_progress, rc_vma_community_chest_claims, rc_vma_votes.
--
-- rc_backup_requests.helper_agent_no is nulled rather than deleting the
-- row outright -- same reasoning as generated_playlists.agent_no and
-- rc_reconnect_participants.invited_by elsewhere in this function: the
-- ROW belongs to a different agent (the request's owner), so removing the
-- helper reference must not destroy the owner's own request.
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
    -- Newly added — see comment above.
    delete from rc_backup_requests where owner_agent_no = r.agent_no;
    update rc_backup_requests set helper_agent_no = null where helper_agent_no = r.agent_no;
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
