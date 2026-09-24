-- Backup Pass repair.
--
-- Audit finding: a request's expiry is only ever re-evaluated by
-- getBackupOverlay, which is scoped to the owner's CURRENT active district:
--
--   .eq('owner_agent_no', agentNo).eq('district_id', districtId)
--
-- So once an owner finished or lost that district, their open request was
-- never read again. It stayed 'open' forever, the Backup Pass it consumed was
-- never refunded, and — because rc_backup_open refuses while any request is
-- 'open'/'joined' — the agent could never open another one. Measured on
-- production before this migration: 15 passes destroyed, 19 active agents
-- locked out of the feature entirely, and every one of those 15 belonged to
-- an owner who had moved on (0 belonged to an owner still on that district).
--
-- Two parts:
--   1. rc_backup_sweep_expired(), a cheap global sweep that resolves expired
--      requests with no helper. That case needs no progress numbers at all —
--      rc_backup_close already refunds a helper-less request unconditionally —
--      so it is safely expressible in SQL and can run on a timer.
--   2. One immediate run of it, to give the 19 locked-out agents their passes
--      back right now.
--
-- A request that expired WITH a helper still needs the TypeScript path (the
-- helper's contribution decides refund vs. bank), so those are deliberately
-- left to lib/backup-pass.ts. There are none in production today.

create or replace function public.rc_backup_sweep_expired()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_closed integer := 0;
  v_refunded integer := 0;
begin
  for r in
    select id, spent_player_item_id
      from public.rc_backup_requests
     where status = 'open' and expires_at <= now()
     order by expires_at
     for update skip locked
  loop
    -- Mirrors rc_backup_close's 'open' branch: no helper ever joined, so the
    -- pass is refunded unconditionally and nothing can have been banked.
    update public.rc_player_items set used_at = null
      where id = r.spent_player_item_id and used_at is not null;
    if found then v_refunded := v_refunded + 1; end if;
    update public.rc_backup_requests
       set status = 'expired', closed_at = now()
     where id = r.id and status = 'open';
    v_closed := v_closed + 1;
  end loop;
  return jsonb_build_object('success', true, 'closed', v_closed, 'refunded', v_refunded);
end;
$$;

revoke all on function public.rc_backup_sweep_expired() from public, anon, authenticated;
grant execute on function public.rc_backup_sweep_expired() to service_role;

-- Repair the backlog now.
select public.rc_backup_sweep_expired();
