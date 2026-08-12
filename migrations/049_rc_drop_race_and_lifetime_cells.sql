-- Two fixes found by a network-wide data audit.
--
-- 1. THE DISTRICT ITEM DROP WAS A RACE.
-- handlers.ts guarded the once-per-district drop with a select-then-insert:
-- read rc_player_items for an existing row, and insert one if none was found.
-- Its own comment explains the shape ("guarded on an existing row rather than
-- a ledger dedup_key since rc_player_items has no unique constraint to upsert
-- against") — but with no lock between the read and the write, two polls
-- landing together both saw "no drop yet" and both inserted. Two agents got a
-- second free item this way, 455ms and 171ms apart respectively.
--
-- Fixed here rather than with a unique index on (agent_no, district_id): an
-- index cannot be created while those duplicates exist, and deleting an item
-- a player already has in their Pack is a worse outcome than the duplicate
-- itself. A row-locked function serializes the whole check-roll-insert unit
-- instead, the same shape rc_credit_charge_cells and rc_reconnect_accept_invite
-- already use, and it works with the duplicate rows still in place.
create or replace function public.rc_drop_district_item(
  p_agent_no text,
  p_district_id text
) returns text  -- the item_id actually dropped, or null if there already was one
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_item text;
begin
  -- Serialize concurrent polls for this agent. Locking the player row (rather
  -- than rc_player_items, where the row we care about does not exist yet) is
  -- what makes the "is there already a drop" read below trustworthy.
  perform 1 from rc_players where agent_no = p_agent_no for update;

  select id into v_existing
  from rc_player_items
  where agent_no = p_agent_no and district_id = p_district_id
  limit 1;
  if v_existing is not null then
    return null;
  end if;

  select rc_roll_item() into v_item;
  if v_item is null then
    return null;
  end if;

  insert into rc_player_items (agent_no, item_id, district_id)
  values (p_agent_no, v_item, p_district_id);

  return v_item;
end;
$$;

revoke all on function public.rc_drop_district_item(text, text) from public;
grant execute on function public.rc_drop_district_item(text, text) to service_role;


-- 2. "CHARGE CELLS EARNED ALL-TIME" UNDERCOUNTED THE WALLET.
-- agent-charge.ts derived lifetime earnings by summing
-- rc_player_districts.charge_cells_awarded across the agent's district rows.
-- Four agents hold more cells than that sum reports, which rendered as a
-- self-contradicting sheet: "18 earned all-time · 0 fed so far" while holding
-- 19. Exactly the confusion the earned/spent display was added to remove.
--
-- Two independent causes, one of which is still ahead of us:
--   * Historical: before rc_credit_charge_cells became atomic, two overlapping
--     polls could both grant the same delta while the baseline advanced once —
--     the double-credit that migration's own comment describes. Already fixed;
--     the surplus cells remain in those four wallets.
--   * Structural and still live: a district attempt that runs past its 7-day
--     deadline has its rc_player_districts row DELETED (handlers.ts). That is
--     deliberate — it lets the agent start the district over with a clean
--     insert — but charge_cells_awarded lives on that row, so the earning
--     record is destroyed while the granted cells stay in the wallet. Nobody
--     has lapsed yet, so this has not bitten; it would on the first one.
--
-- A counter on rc_players that only ever grows is immune to both: it does not
-- depend on rows that can be deleted, and it cannot drift from the wallet.
alter table rc_players
  add column if not exists lifetime_charge_cells int not null default 0;

-- Backfill: the larger of what the surviving district rows account for and
-- what the agent is actually holding. greatest() (not the sum alone) is what
-- absorbs the historical over-credit, so nobody's displayed lifetime total
-- goes DOWN as a result of this migration, and no one is asked to give back
-- cells they were already granted.
update rc_players p
set lifetime_charge_cells = greatest(
  coalesce((select sum(d.charge_cells_awarded) from rc_player_districts d where d.agent_no = p.agent_no), 0),
  coalesce(p.charge_cells, 0)
);

-- Keep the new counter in lockstep with every future grant, inside the same
-- locked unit that already keeps the wallet and the per-district baseline
-- consistent. Body is unchanged apart from the added increment.
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

  update rc_players
  set charge_cells = charge_cells + v_delta,
      lifetime_charge_cells = lifetime_charge_cells + v_delta
  where agent_no = p_agent_no;

  return v_delta;
end;
$$;

revoke all on function public.rc_credit_charge_cells(text, text, integer) from public;
grant execute on function public.rc_credit_charge_cells(text, text, integer) to service_role;
