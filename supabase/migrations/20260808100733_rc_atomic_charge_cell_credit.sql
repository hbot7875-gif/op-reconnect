-- creditChargeCells (charge-economy.ts) runs on every buildState call —
-- every HUD poll, every district screen open, not just an occasional user
-- action — making it the highest-frequency instance yet of the same
-- "check, then write, as separate non-transactional steps" shape the
-- earlier Charge Cell / mission-race fixes closed elsewhere.
--
-- It read rc_player_districts.charge_cells_awarded (the "already granted up
-- to here" baseline), computed a delta against newly-earned cells, wrote the
-- new baseline, then separately called rc_add_charge_cells to grant the
-- delta — two writes, no lock between the read and either of them. Two
-- overlapping polls (the same agent open in two tabs, or a poll landing
-- mid-refresh) reading the same stale baseline would both compute the same
-- delta and both grant it — a real double-credit, not just a lost update.
-- Worse, the baseline write happened before the grant with no error check
-- on the grant call: a failed rc_add_charge_cells left the baseline marked
-- "already awarded" for cells the agent never actually received.
--
-- rc_credit_charge_cells folds both into one FOR UPDATE-locked unit: a
-- concurrent call is either serialized behind the first (and then correctly
-- computes a zero delta once it sees the updated baseline) or the whole
-- thing fails together, never partially.
create or replace function public.rc_credit_charge_cells(
  p_agent_no text,
  p_district_id text,
  p_earned integer
) returns integer  -- delta actually credited (0 if nothing new)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already integer;
  v_status text;
  v_delta integer;
begin
  select charge_cells_awarded, status into v_already, v_status
  from rc_player_districts
  where agent_no = p_agent_no and district_id = p_district_id
  for update;

  if v_status is null or v_status <> 'active' then
    return 0;
  end if;

  v_already := coalesce(v_already, 0);
  if p_earned <= v_already then
    return 0;
  end if;

  v_delta := p_earned - v_already;

  update rc_player_districts set charge_cells_awarded = p_earned
  where agent_no = p_agent_no and district_id = p_district_id;

  update rc_players set charge_cells = charge_cells + v_delta
  where agent_no = p_agent_no;

  return v_delta;
end;
$$;

revoke all on function public.rc_credit_charge_cells(text, text, integer) from public;
grant execute on function public.rc_credit_charge_cells(text, text, integer) to service_role;
