-- Make the credit RPC hand back the FINAL wallet balance, not just the delta.
--
-- Reported by AGENT047: "it says 4+ cells added, 8+ added, I see them in my
-- bag pack, but when I go to charge my army bomb it says 0, and when I
-- refresh those 10 to 13 cells get vanished."
--
-- Nothing was removing their cells. Three surfaces were computing the balance
-- three different ways inside one buildState:
--
--   handlers.ts:158  getAgentChargeView reads rc_players.charge_cells   -> W
--   handlers.ts:223  creditChargeCells credits the delta, DB becomes    -> W+D
--   handlers.ts:410  earnedNow: D, which renders the "+4 cells" toast
--   handlers.ts:593  chargeCells: player.charge_cells + D               -> W+D
--
-- The ARMY Bomb screen read the wallet BEFORE the credit landed, and the Pack
-- never read the wallet at all -- it reconstructed it from a stale row plus a
-- delta. Same payload, two different numbers, and if W was 0 the Bomb said 0.
--
-- The vanishing is the same defect seen twice: because the Pack's number is
-- arithmetic on a stale read rather than a read, two overlapping polls (two
-- tabs, or a poll landing mid-refresh -- charge-economy.ts's own comment calls
-- this "a real, frequent possibility, not a rare edge case") both read W, one
-- credits D and returns W+D, the other credits nothing and returns W. The Pack
-- flips between them.
--
-- No data repair is needed. The wallet itself was always right; only the
-- numbers drawn from it were wrong.
--
-- ── what changes ─────────────────────────────────────────────────────────
--
-- The function returned the delta alone, which is not enough to render a
-- balance anywhere. It now returns both, so callers never have to reconstruct
-- one by hand:
--
--   delta    cells credited by THIS call, for the "+N earned" toast
--   balance  rc_players.charge_cells as it stands after this call
--
-- Every early return now reports the real balance too, so "nothing credited"
-- and "credited D" are answered in exactly the same shape and a caller cannot
-- accidentally treat 0 as "no information".
--
-- The return type changes from integer to a row, so this has to DROP and
-- recreate rather than CREATE OR REPLACE. The body is otherwise unchanged:
-- same FOR UPDATE lock, same baseline advance, same lifetime increment.
--
-- Deploy order does not matter. The Edge function reads the result
-- defensively and accepts either shape, so whichever ships first, cells are
-- still credited correctly -- only the toast could briefly read 0, and the
-- wallet is never touched twice because the baseline advance is unchanged.

drop function if exists public.rc_credit_charge_cells(text, text, integer);

create function public.rc_credit_charge_cells(
  p_agent_no text,
  p_district_id text,
  p_earned integer
) returns table (delta integer, balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already integer;
  v_status  text;
  v_delta   integer;
  v_balance integer;
begin
  select charge_cells_awarded, status into v_already, v_status
  from rc_player_districts
  where agent_no = p_agent_no and district_id = p_district_id
  for update;

  -- Read the wallet inside the same locked unit, so even the "credited
  -- nothing" answer is a balance nobody else can have moved underneath us.
  select coalesce(charge_cells, 0) into v_balance
  from rc_players where agent_no = p_agent_no;
  v_balance := coalesce(v_balance, 0);

  if v_status is null or v_status <> 'active' then
    return query select 0, v_balance;
    return;
  end if;

  v_already := coalesce(v_already, 0);
  if p_earned <= v_already then
    return query select 0, v_balance;
    return;
  end if;

  v_delta := p_earned - v_already;

  update rc_player_districts set charge_cells_awarded = p_earned
  where agent_no = p_agent_no and district_id = p_district_id;

  update rc_players
  set charge_cells = charge_cells + v_delta,
      lifetime_charge_cells = lifetime_charge_cells + v_delta
  where agent_no = p_agent_no
  returning charge_cells into v_balance;

  return query select v_delta, coalesce(v_balance, 0);
end;
$$;

revoke all on function public.rc_credit_charge_cells(text, text, integer) from public;
grant execute on function public.rc_credit_charge_cells(text, text, integer) to service_role;

do $$
declare
  v_kind text;
begin
  select case when p.proretset then 'set-returning' else 'scalar' end into v_kind
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'rc_credit_charge_cells';
  if v_kind is distinct from 'set-returning' then
    raise exception 'rc_credit_charge_cells did not become set-returning (got %)', coalesce(v_kind,'missing');
  end if;
  raise notice 'rc_credit_charge_cells now returns (delta, balance)';
end $$;
