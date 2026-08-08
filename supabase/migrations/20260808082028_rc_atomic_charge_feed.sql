-- Charge Cells never got the same transactional treatment
-- 20260807150000_rc_lit_era_cards.sql gave Era Cards: rc_use_lit_era locks
-- and updates in one statement specifically "to prevent double spends from
-- two taps or devices." feedCharge (the manual button) and the auto-feed
-- check inside getAgentChargeView both did a plain JS read-then-write
-- across two separate .update() calls instead — a manual feed landing at
-- the same instant as the 90s background poll's auto-feed check could lose
-- one of the two deductions. These two functions close that gap the same
-- way the era-card one already does: FOR UPDATE row locks plus the whole
-- read-compute-write happening inside one server-side transaction.

-- Spend an exact, known number of Charge Cells — the manual "Feed 1 Charge
-- Cell" button. Returns no rows when there aren't enough cells to spend;
-- the caller (agent-charge.ts) treats an empty result as
-- 'not_enough_charge_cells', same error shape as before.
create or replace function public.rc_feed_charge(
  p_agent_no text,
  p_cells_to_spend integer,
  p_hours_per_cell integer default 2
) returns table(charged_until timestamptz, cells_spent integer, cells_remaining integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cells_available integer;
  v_charged_until timestamptz;
begin
  if p_cells_to_spend is null or p_cells_to_spend <= 0 then
    return;
  end if;

  select p.charge_cells into v_cells_available
  from rc_players p where p.agent_no = p_agent_no for update;

  if v_cells_available is null or v_cells_available < p_cells_to_spend then
    return;
  end if;

  update rc_players set charge_cells = charge_cells - p_cells_to_spend
  where agent_no = p_agent_no;

  insert into rc_agent_charge (
    agent_no, charged_until, auto_feed, blackout_started_at,
    soft_reset_at, full_reset_at, updated_at
  ) values (
    p_agent_no, now() + make_interval(hours => p_cells_to_spend * p_hours_per_cell), false,
    null, null, null, now()
  )
  on conflict (agent_no) do update set
    charged_until = greatest(coalesce(rc_agent_charge.charged_until, now()), now())
      + make_interval(hours => p_cells_to_spend * p_hours_per_cell),
    blackout_started_at = null,
    soft_reset_at = null,
    full_reset_at = null,
    updated_at = now()
  returning rc_agent_charge.charged_until into v_charged_until;

  return query select v_charged_until, p_cells_to_spend, (v_cells_available - p_cells_to_spend);
end;
$$;

revoke all on function public.rc_feed_charge(text, integer, integer) from public;
grant execute on function public.rc_feed_charge(text, integer, integer) to service_role;

-- Auto-feed's own "bridge the gap since it last ran dark" computation,
-- moved server-side so the read (how many cells does this gap need, how
-- many are available) and the write happen as one locked unit. Mirrors
-- agent-charge.ts's fixed version exactly, including the bug fix that
-- requires charged_until to be non-null (never-fed is not the same as
-- expired) before this spends anything. did_feed:false with no charge
-- means "nothing to do" — not on auto-feed, already charged, or no cells —
-- the caller doesn't need to distinguish which.
create or replace function public.rc_auto_feed_charge(
  p_agent_no text,
  p_hours_per_cell integer default 2
) returns table(charged_until timestamptz, cells_spent integer, cells_remaining integer, did_feed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cells_available integer;
  v_auto_feed boolean;
  v_prior_charged_until timestamptz;
  v_gap_hours numeric;
  v_cells_needed integer;
  v_use integer;
  v_new_charged_until timestamptz;
begin
  select p.charge_cells into v_cells_available
  from rc_players p where p.agent_no = p_agent_no for update;

  select c.charged_until, c.auto_feed into v_prior_charged_until, v_auto_feed
  from rc_agent_charge c where c.agent_no = p_agent_no for update;

  if v_cells_available is null or v_auto_feed is not true or v_cells_available <= 0
     or v_prior_charged_until is null or v_prior_charged_until > now() then
    return query select v_prior_charged_until, 0, coalesce(v_cells_available, 0), false;
    return;
  end if;

  v_gap_hours := extract(epoch from (now() - v_prior_charged_until)) / 3600.0;
  v_cells_needed := greatest(1, ceil(v_gap_hours / p_hours_per_cell)::integer);
  v_use := least(v_cells_needed, v_cells_available);

  if v_use <= 0 then
    return query select v_prior_charged_until, 0, v_cells_available, false;
    return;
  end if;

  update rc_players set charge_cells = charge_cells - v_use
  where agent_no = p_agent_no;

  update rc_agent_charge
  set charged_until = v_prior_charged_until + make_interval(hours => v_use * p_hours_per_cell),
      updated_at = now()
  where agent_no = p_agent_no
  returning rc_agent_charge.charged_until into v_new_charged_until;

  return query select v_new_charged_until, v_use, (v_cells_available - v_use), true;
end;
$$;

revoke all on function public.rc_auto_feed_charge(text, integer) from public;
grant execute on function public.rc_auto_feed_charge(text, integer) to service_role;
