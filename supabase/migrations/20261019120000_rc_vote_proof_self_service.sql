-- MAMA voting: players fix obvious proof problems themselves, so reviewers
-- see only genuinely uncertain proofs.
--
-- 1. rc_campaign_record_trusted_checks: a certificate that repeats one the
--    SAME agent already submitted (not rejected) is now rejected outright —
--    no credit, and the player is asked for a new certificate. A certificate
--    shared with ANOTHER agent still goes to review (who owns it is a human
--    call). Everything else is unchanged.
-- 2. rc_campaign_remove_x_handle: a player can unlink an X account that has
--    no counted or pending vote, freeing a slot. An account with votes can't
--    be removed by the player (no rotating accounts for credit).

create or replace function public.rc_campaign_record_trusted_checks(
  p_proof_id bigint, p_status text, p_checks jsonb, p_note text, p_actor text,
  p_cert_fp text, p_time_fp text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p public.rc_campaign_proofs%rowtype;
  v_claim public.rc_campaign_cert_claims%rowtype;
  v_other bigint;
  v_status text := p_status;
  v_note text := p_note;
begin
  if p_status not in ('verified', 'review') then
    return jsonb_build_object('success', false, 'error', 'bad_status');
  end if;
  select * into v_p from rc_campaign_proofs where id = p_proof_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  if v_p.status <> 'verifying' then
    return jsonb_build_object('success', false, 'error', 'status_changed', 'status', v_p.status);
  end if;

  if p_cert_fp is not null then
    perform pg_advisory_xact_lock(hashtextextended('cert_fp|' || v_p.campaign_id || '|' || p_cert_fp, 0));
    select * into v_claim from rc_campaign_cert_claims where campaign_id = v_p.campaign_id and fingerprint = p_cert_fp;
    if found and v_claim.proof_id <> v_p.id and exists (
      select 1 from rc_campaign_proofs o where o.id = v_claim.proof_id and o.status <> 'rejected'
    ) then
      -- The agent's OWN certificate again: certain, so it's turned down here
      -- (no credit; the player is told to upload a new one). Another agent's
      -- certificate still goes to a reviewer — the number proves a shared
      -- certificate, not which of the two players it belongs to.
      v_status := case when exists (
        select 1 from rc_campaign_proofs o where o.id = v_claim.proof_id and o.agent_no = v_p.agent_no
      ) then 'rejected' else 'review' end;
      v_note := 'duplicate_certificate';
      update rc_campaign_proofs set duplicate_of = v_claim.proof_id, duplicate_kind = 'certificate' where id = v_p.id;
    else
      insert into rc_campaign_cert_claims (campaign_id, fingerprint, proof_id)
      values (v_p.campaign_id, p_cert_fp, v_p.id)
      on conflict (campaign_id, fingerprint) do update set proof_id = excluded.proof_id, claimed_at = now();
    end if;
  end if;

  if p_time_fp is not null and v_note is distinct from 'duplicate_certificate' then
    select o.id into v_other from rc_campaign_proofs o
     where o.campaign_id = v_p.campaign_id and o.cert_time_fingerprint = p_time_fp
       and o.agent_no <> v_p.agent_no and o.status <> 'rejected' and o.id <> v_p.id
     order by o.id limit 1;
    if v_other is not null then
      v_status := 'review';
      v_note := 'possible_duplicate_certificate';
      update rc_campaign_proofs set duplicate_of = v_other, duplicate_kind = 'possible' where id = v_p.id;
    end if;
  end if;

  update rc_campaign_proofs set cert_fingerprint = p_cert_fp, cert_time_fingerprint = p_time_fp where id = v_p.id;
  return rc_campaign_transition(p_proof_id, array['verifying'], v_status, p_checks, 'reviewer_ocr', p_actor, v_note);
end;
$$;

create or replace function public.rc_campaign_remove_x_handle(
  p_campaign_id text, p_agent_no text, p_x_handle text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Same lock as rc_campaign_register_x_handle: add and remove can't race.
  perform pg_advisory_xact_lock(hashtextextended('vote_x_handles|' || p_campaign_id || '|' || p_agent_no, 0));
  if not exists (select 1 from rc_agent_x_handles
                  where campaign_id = p_campaign_id and agent_no = p_agent_no and x_handle = p_x_handle) then
    return jsonb_build_object('success', false, 'error', 'x_handle_not_linked');
  end if;
  if exists (select 1 from rc_campaign_proofs
              where campaign_id = p_campaign_id and agent_no = p_agent_no
                and post_author = p_x_handle and status <> 'rejected') then
    return jsonb_build_object('success', false, 'error', 'x_handle_has_votes');
  end if;
  delete from rc_agent_x_handles
   where campaign_id = p_campaign_id and agent_no = p_agent_no and x_handle = p_x_handle;
  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.rc_campaign_remove_x_handle(text, text, text) from public, anon, authenticated;
grant execute on function public.rc_campaign_remove_x_handle(text, text, text) to service_role;
