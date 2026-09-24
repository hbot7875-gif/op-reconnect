-- A badge for actually backing someone up.
--
-- Awarded for real help, not for answering the call: joining a Backup Pass
-- costs nothing and needs no streams, so a join-triggered badge could be
-- farmed by joining and doing nothing. The badge lands when the pass CLOSES
-- with the helper having streamed something toward the goal — which is
-- exactly the two places the schema already distinguishes:
--
--   rc_backup_close, 'banked' branch  — helper contributed, pass closed early
--   rc_backup_complete                — helper carried it to the boosted target
--
-- Put in SQL rather than in lib/backup-pass.ts on purpose: a pass can close
-- from the helper leaving, from expiry, from the owner losing the district
-- or from the goal being met, and those paths call these two functions from
-- several places. Awarding inside them means every path is covered and no
-- future caller can forget.

insert into public.rc_badge_catalog (id, section, rarity, name, unlock_hint, sort_order, active)
values ('backup_helper', 'achievement', 'rare', 'Backup',
        'Back up another agent''s goal and stream toward it.', 61, true)
on conflict (id) do update
  set section = excluded.section, rarity = excluded.rarity, name = excluded.name,
      unlock_hint = excluded.unlock_hint, sort_order = excluded.sort_order, active = excluded.active;

create or replace function public.rc_backup_close(
  p_request_id uuid, p_reason text, p_owner_progress integer, p_helper_contribution integer
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row rc_backup_requests%rowtype;
  v_status text;
  v_completed_at timestamptz;
begin
  select * into v_row from rc_backup_requests where id = p_request_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'not_found'); end if;
  if v_row.status not in ('open', 'joined') then
    return jsonb_build_object('success', true, 'alreadyClosed', true, 'status', v_row.status);
  end if;

  if v_row.status = 'open' then
    -- Never got a helper — refund unconditionally, no banking possible.
    update rc_player_items set used_at = null where id = v_row.spent_player_item_id;
    update rc_backup_requests set status = 'expired', closed_at = now() where id = p_request_id;
    return jsonb_build_object('success', true, 'status', 'expired');
  end if;

  -- status = 'joined'
  if coalesce(p_helper_contribution, 0) <= 0 then
    update rc_player_items set used_at = null where id = v_row.spent_player_item_id;
    v_status := case when p_reason = 'expired' then 'expired' else 'cancelled' end;
    update rc_backup_requests set status = v_status, closed_at = now() where id = p_request_id;
    return jsonb_build_object('success', true, 'status', v_status);
  end if;

  -- Real contribution happened — bank it permanently, pass stays consumed.
  v_completed_at := case when (coalesce(p_owner_progress, 0) + p_helper_contribution) >= v_row.original_target then now() else null end;
  update rc_backup_requests
     set status = 'banked', banked_credit = p_helper_contribution, closed_at = now(), completed_at = v_completed_at
   where id = p_request_id;
  -- They streamed toward someone else's goal. That is the badge.
  perform rc_award_badge(v_row.helper_agent_no, 'backup_helper', null);
  return jsonb_build_object('success', true, 'status', 'banked', 'bankedCredit', p_helper_contribution, 'completed', v_completed_at is not null);
end;
$$;

create or replace function public.rc_backup_complete(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row rc_backup_requests%rowtype;
begin
  select * into v_row from rc_backup_requests where id = p_request_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'not_found'); end if;
  if v_row.status != 'joined' then
    return jsonb_build_object('success', true, 'alreadyClosed', v_row.status != 'joined', 'status', v_row.status);
  end if;
  update rc_backup_requests set status = 'complete', completed_at = now(), closed_at = now() where id = p_request_id;
  -- Carried the goal to its boosted target. Same badge, bigger story.
  perform rc_award_badge(v_row.helper_agent_no, 'backup_helper', null);
  return jsonb_build_object('success', true, 'status', 'complete');
end;
$$;

-- Both were locked down by 20260819140000; CREATE OR REPLACE keeps the ACL,
-- but re-asserting it costs nothing and survives a future plain re-create.
revoke all on function public.rc_backup_close(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.rc_backup_close(uuid, text, integer, integer) to service_role;
revoke all on function public.rc_backup_complete(uuid) from public, anon, authenticated;
grant execute on function public.rc_backup_complete(uuid) to service_role;

-- Anyone who already helped before this shipped. Nothing qualifies today
-- (every closed request so far expired or cancelled with no contribution),
-- but this makes the rule true retroactively rather than only going forward.
do $$
declare r record;
begin
  for r in
    select distinct helper_agent_no from rc_backup_requests
     where helper_agent_no is not null
       and (status = 'complete' or coalesce(banked_credit, 0) > 0)
  loop
    perform rc_award_badge(r.helper_agent_no, 'backup_helper', null);
  end loop;
end $$;
