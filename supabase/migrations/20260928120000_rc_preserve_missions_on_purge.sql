-- Retiring one agent must not delete another agent's ReConnect history.
--
-- rc_purge_agent_data deleted every mission its subject had created. Nothing
-- in the schema links participants or messages to rc_agents -- they hang off
-- rc_reconnect_missions(id) with ON DELETE CASCADE -- so deleting the mission
-- silently destroyed the participation and the authored messages of everyone
-- else on it. Measured on 2026-09-28: 85 distinct active agents exposed, worst
-- single case 24 participant rows across 20 other agents.
--
-- This changes ONE statement inside the function, from DELETE to an
-- anonymising UPDATE. Everything else in the body is byte-identical to
-- 20260928060000_rc_privacy_retention.sql. No schema change is needed:
-- created_by is a plain NOT NULL text column with no foreign key.
--
-- Both purge paths are fixed by this one change, because both call this
-- function: voluntary retirement (settings.ts retireAccount) and the daily
-- inactivity cron (rc_delete_inactive_agents_scheduled, 18:00 UTC).
--
-- NOT fixed here: adminDeleteAgent in lib/admin-agent.ts keeps its own
-- 23-table deletion list with the same DELETE. See the separate proposal.

create or replace function rc_purge_agent_data(p_agent_no text, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  select a.agent_no, a.handle, a.email, a.lb_username, a.created_at as joined_at, p.codename
    into r
    from rc_agents a
    left join rc_players p on p.agent_no = a.agent_no
   where a.agent_no = p_agent_no
   for update of a;                -- no concurrent purge of the same account

  if not found then
    return false;
  end if;

  -- BEFORE the vote rows go: once they are deleted the paths are gone.
  perform rc_queue_agent_proof_files(r.agent_no);

  insert into rc_deleted_agent_log (agent_no, handle, email, codename, lb_username, joined_at, reason)
  values (r.agent_no, r.handle, r.email, r.codename, r.lb_username, r.joined_at, p_reason);

  -- Unchanged from the original job, in the original order.
  delete from rc_reconnect_puzzle_attempts where agent_no = r.agent_no;
  delete from rc_reconnect_participants where agent_no = r.agent_no;
  update rc_reconnect_participants set invited_by = null where invited_by = r.agent_no;
  -- PRESERVED, not deleted. This line used to be a DELETE, and deleting the
  -- mission took rc_reconnect_participants and rc_reconnect_messages with it
  -- via their ON DELETE CASCADE on mission_id -- including the rows of agents
  -- who are still playing. On 2026-09-28 a 13-account backfill removed ~35
  -- participant rows that way; 398 of 575 participant rows and 363 of 497
  -- message rows currently belong to someone other than the mission creator,
  -- so the next ordinary retirement would have done it again.
  --
  -- A mission is shared history that happens to have an owner. The owner's own
  -- participant row and messages are still deleted (above, and below) -- what
  -- survives is other people's. '__deleted__' follows the existing '__admin__'
  -- convention in this column; it can never be a real agent number, which
  -- rc_next_agent_no() always mints as 'AGENT' || lpad(nextval(...), 3, '0').
  update rc_reconnect_missions set created_by = '__deleted__' where created_by = r.agent_no;
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

  -- Seven tables that neither cascaded from rc_agents nor appeared in the
  -- original list, so an agent's rows in them survived deletion.
  delete from rc_defuse_messages where agent_no = r.agent_no;
  delete from rc_engagement_events where agent_no = r.agent_no;
  delete from rc_share_snapshots where created_by = r.agent_no;
  delete from rc_recelebrate_presence where agent_no = r.agent_no;
  delete from rc_recelebrate_passes where agent_no = r.agent_no;
  delete from rc_recelebrate_battle_streams where agent_no = r.agent_no;
  delete from rc_recelebrate_after_party_claims where agent_no = r.agent_no;

  -- Badge artwork is SHARED: other agents wear badges awarded from this
  -- person's uploads. The photo stays so those badges keep their picture;
  -- only the link to the uploader goes.
  update rc_badge_art set uploaded_by = null where uploaded_by = r.agent_no;

  delete from rc_players where agent_no = r.agent_no;
  delete from rc_agents where agent_no = r.agent_no;
  return true;
end;
$$;
