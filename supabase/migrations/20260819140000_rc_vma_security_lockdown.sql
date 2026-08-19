-- Security lockdown for everything added this cycle (VMA voting, Supply
-- Chest, Backup Pass). Every one of these SECURITY DEFINER functions
-- previously kept Postgres's default EXECUTE-granted-to-PUBLIC, meaning
-- anyone holding the anon/authenticated key could call them directly via
-- PostgREST's /rest/v1/rpc/<fn> endpoint, completely bypassing the edge
-- function and every check it makes — for rc_supply_chest_open specifically,
-- a caller could pass any p_reward_kind/p_reward_detail and grant themselves
-- an arbitrary reward outright, no vote or fill required. This app's whole
-- model is "every action goes through the service-role edge function" —
-- this migration makes that actually enforced at the database level for
-- these objects, not just assumed. Uses a dynamic loop (by name, not
-- hand-typed signatures) so it can't silently miss a function or typo an
-- argument list.
--
-- Also sets a fixed search_path on each function — a SECURITY DEFINER
-- function without one is vulnerable to search_path hijacking (a caller-
-- controlled search_path could redirect an unqualified table reference like
-- "rc_vma_votes" to an attacker-created object of the same name in a
-- schema earlier in that path). Every function here already only ever
-- references public.* tables, so pinning search_path costs nothing.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'rc_vma_submit_vote', 'rc_vma_review_vote',
      'rc_backup_open', 'rc_backup_join', 'rc_backup_close', 'rc_backup_complete',
      'rc_supply_chest_add_fill', 'rc_supply_chest_open'
    )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;

-- New tables from this cycle: the edge function's service-role client
-- doesn't need a table GRANT to work (service_role isn't subject to these
-- ACLs the way PostgREST-facing anon/authenticated are), so revoking these
-- two roles' access can't break anything real — it only closes the direct-
-- REST-API path (e.g. POST /rest/v1/rc_supply_chest_progress with the anon
-- key) that PostgREST would otherwise honor.
revoke all on table
  rc_vma_votes, rc_supply_chest_progress, rc_supply_chest_opens,
  rc_backup_requests, rc_badge_catalog, rc_badge_art
from anon, authenticated;
