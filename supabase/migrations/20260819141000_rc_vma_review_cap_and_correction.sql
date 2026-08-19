-- Two real bugs from review:
--
-- (a) rc_vma_review_vote's own comment claimed the caller passed an
-- "already-clamped ceiling" for the daily cap — it never actually did.
-- Approving a pending row credited the full displayed_total delta with NO
-- cap check at all, so manual approval could push an agent's daily total
-- past daily_cap_per_category (doubled or not). Fixed by actually taking
-- p_daily_cap and clamping against it here, the same way
-- rc_vma_submit_vote already does for the auto-submit path.
--
-- (b) The "Send for review" fallback for an unreadable vote count used a
-- fake displayed_total of 1 client-side, which then became the permanent
-- number credited on approval with no way to correct it. Fixed by letting
-- the admin pass p_corrected_total, applied to the row before computing
-- credit.
create or replace function rc_vma_review_vote(
  p_vote_id bigint, p_decision text, p_admin text, p_note text,
  p_daily_cap integer, p_corrected_total integer default null
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_row rc_vma_votes%rowtype;
  v_lock_key bigint;
  v_baseline integer;
  v_used integer;
  v_credited integer;
  v_displayed integer;
begin
  if p_decision not in ('approve', 'reject') then
    return jsonb_build_object('success', false, 'error', 'bad_decision');
  end if;

  select * into v_row from rc_vma_votes where id = p_vote_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  if v_row.verify_status != 'pending' then
    return jsonb_build_object('success', false, 'error', 'already_reviewed');
  end if;

  if p_decision = 'reject' then
    update rc_vma_votes set verify_status = 'rejected', reviewed_by = p_admin,
      reviewed_at = now(), admin_note = p_note
      where id = p_vote_id;
    return jsonb_build_object('success', true, 'verifyStatus', 'rejected');
  end if;

  v_lock_key := hashtextextended(v_row.agent_no || '|' || v_row.event_id || '|' || v_row.category || '|' || v_row.vote_day::text, 0);
  perform pg_advisory_xact_lock(v_lock_key);

  v_displayed := coalesce(p_corrected_total, v_row.displayed_total);
  if p_corrected_total is not null and p_corrected_total != v_row.displayed_total then
    update rc_vma_votes set displayed_total = p_corrected_total where id = p_vote_id;
  end if;

  select coalesce(max(displayed_total), 0), coalesce(sum(votes_logged), 0)
    into v_baseline, v_used
    from rc_vma_votes
   where agent_no = v_row.agent_no and event_id = v_row.event_id and category = v_row.category
     and vote_day = v_row.vote_day and verify_status = 'verified';

  v_credited := greatest(0, least(v_displayed - v_baseline, p_daily_cap - v_used));

  update rc_vma_votes set verify_status = 'verified', votes_logged = v_credited,
    verified_at = now(), reviewed_by = p_admin, reviewed_at = now(), admin_note = p_note
    where id = p_vote_id;

  return jsonb_build_object('success', true, 'verifyStatus', 'verified', 'creditedVotes', v_credited);
end;
$$;

revoke all on function rc_vma_review_vote(bigint, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function rc_vma_review_vote(bigint, text, text, text, integer, integer) to service_role;
