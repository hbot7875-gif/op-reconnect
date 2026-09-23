-- Skip Quest — a paid way out of a ReConnect Quest an agent no longer wants.
-- Never a shortcut to completing one: no restoration credit, no completion
-- rewards, no badge.
--
-- ── Why rc_xp_ledger needs a `kind` column ───────────────────────────────
-- Today an agent's level is derived live from SUM(rc_xp_ledger.amount)
-- (derive.ts totalXp -> leveling.ts levelFor). There is no stored XP total,
-- so subtracting 75–200 XP for a skip would visibly DE-LEVEL the agent and
-- push their XP bar backwards. rc_players.last_level is a high-water mark
-- that only ever moves up, so they would also have to re-earn the XP before
-- the next level reward — losing progression they had already paid for.
--
-- So spending is separated from progression:
--   level XP     = SUM(amount) WHERE kind = 'earn'   (drives levelFor)
--   spendable XP = SUM(amount) over all rows          (earn minus spends)
-- Every existing row defaults to 'earn', so today's level math is bit-for-bit
-- unchanged for every agent. Only skip charges are written as kind='spend',
-- and they lower the spendable wallet while leaving level, rank, unlocked
-- rewards and milestones untouched.
--
-- The existing 1 XP Magic Shop Wings purchase is deliberately left as it is
-- (kind='earn', so it still reduces level XP exactly as it does today) —
-- changing it would alter an unrelated, live mechanic and could retroactively
-- push agents over a level boundary.
--
-- Charge Cells need no such split: rc_players.charge_cells is already a
-- spendable wallet and lifetime_charge_cells is the separate cumulative
-- counter, so deducting cells cannot touch lifetime progression.

alter table public.rc_xp_ledger
  add column if not exists kind text not null default 'earn';
do $$ begin
  alter table public.rc_xp_ledger add constraint rc_xp_ledger_kind_check check (kind in ('earn', 'spend'));
exception when duplicate_object then null; end $$;
create index if not exists rc_xp_ledger_agent_kind_idx on public.rc_xp_ledger (agent_no, kind);

-- ── Participant bookkeeping ──────────────────────────────────────────────
-- joined_mode locks the price to the mode the agent was on when they joined,
-- so switching to a cheaper mode afterwards cannot lower the bill.
-- left_at + contribution_frozen keep a leaver's streams in the team's pooled
-- total (frozen at the moment they left) while freeing their seat.
alter table public.rc_reconnect_participants
  add column if not exists joined_mode text,
  add column if not exists left_at timestamptz,
  add column if not exists contribution_frozen integer not null default 0;

update public.rc_reconnect_participants p
set joined_mode = pl.mode
from public.rc_players pl
where pl.agent_no = p.agent_no and p.joined_mode is null;

alter table public.rc_reconnect_participants drop constraint if exists rc_reconnect_participants_status_check;
alter table public.rc_reconnect_participants
  add constraint rc_reconnect_participants_status_check check (status in ('invited', 'joined', 'left'));

-- ── Skip log: the 7-day cooldown and an audit trail ──────────────────────
create table if not exists public.rc_quest_skips (
  id bigserial primary key,
  agent_no text not null references public.rc_agents(agent_no) on delete cascade,
  mission_id uuid not null,
  district_id text,
  mode text,
  cost_xp integer not null default 0,
  cost_cells integer not null default 0,
  free_reason text,                       -- expired / teammate_rescue / system_stuck
  created_at timestamptz not null default now()
);
create index if not exists rc_quest_skips_agent_idx on public.rc_quest_skips (agent_no, created_at desc);

alter table public.rc_quest_skips enable row level security;
revoke all on public.rc_quest_skips from public, anon, authenticated;
grant select, insert on public.rc_quest_skips to service_role;
grant usage, select on sequence public.rc_quest_skips_id_seq to service_role;

-- ── Price table (single source of truth) ─────────────────────────────────
create or replace function public.rc_quest_skip_price(p_mode text)
returns table (xp integer, cells integer)
language sql immutable
set search_path = public, pg_temp
as $$
  -- Unknown/absent mode falls back to the cheapest tier rather than blocking.
  select coalesce(t.xp, 75), coalesce(t.cells, 3)
  from (select 1) as one
  left join (values
    ('exam',   75,   2),
    ('easy',   75,   3),
    ('steady', 150, 15),
    ('medium', 150, 25),
    ('hard',   200, 100)
  ) as t(mode, xp, cells) on t.mode = coalesce(nullif(p_mode, ''), 'easy')
$$;

-- ── Quote: eligibility + price + balances, read-only ─────────────────────
-- Shared by the UI and by rc_quest_skip itself, so what an agent is shown and
-- what they are charged can never disagree.
create or replace function public.rc_quest_skip_quote(p_agent text, p_mission uuid)
returns jsonb
language plpgsql stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_m public.rc_reconnect_missions%rowtype;
  v_p public.rc_reconnect_participants%rowtype;
  v_mode text;
  v_xp integer; v_cells integer;
  v_level_xp integer; v_spendable integer; v_bal_cells integer;
  v_last_skip timestamptz;
  v_free_reason text := null;
  v_eligible_at timestamptz;
  v_cooldown_until timestamptz;
begin
  select * into v_m from public.rc_reconnect_missions where id = p_mission;
  if not found then return jsonb_build_object('success', false, 'error', 'mission_not_found'); end if;
  select * into v_p from public.rc_reconnect_participants
    where mission_id = p_mission and agent_no = p_agent and status = 'joined';
  if not found then return jsonb_build_object('success', false, 'error', 'not_in_mission'); end if;

  v_mode := coalesce(v_p.joined_mode, (select mode from public.rc_players where agent_no = p_agent), 'easy');
  select xp, cells into v_xp, v_cells from public.rc_quest_skip_price(v_mode);

  select coalesce(sum(amount) filter (where kind = 'earn'), 0), coalesce(sum(amount), 0)
    into v_level_xp, v_spendable
    from public.rc_xp_ledger where agent_no = p_agent;
  select coalesce(charge_cells, 0) into v_bal_cells from public.rc_players where agent_no = p_agent;

  -- Free paths, in priority order. None of these consume the cooldown.
  if v_m.status <> 'open' then
    v_free_reason := 'system_stuck';
  elsif v_m.expires_at <= now() then
    v_free_reason := 'expired';
  elsif exists (
    select 1 from public.rc_reconnect_participants o
    where o.mission_id = p_mission and o.agent_no <> p_agent
      and ((o.status = 'invited' and o.joined_at <= now() - interval '48 hours')
        or (o.status = 'joined' and o.streamed_at is null and o.joined_at <= now() - interval '48 hours'))
  ) then
    v_free_reason := 'teammate_rescue';
  end if;

  v_eligible_at := v_p.joined_at + interval '24 hours';
  select max(created_at) into v_last_skip from public.rc_quest_skips
    where agent_no = p_agent and free_reason is null;
  v_cooldown_until := case when v_last_skip is null then null else v_last_skip + interval '7 days' end;

  return jsonb_build_object(
    'success', true,
    'missionId', p_mission,
    'mode', v_mode,
    'free', v_free_reason is not null,
    'freeReason', v_free_reason,
    'costXp', case when v_free_reason is not null then 0 else v_xp end,
    'costCells', case when v_free_reason is not null then 0 else v_cells end,
    'balanceXp', v_spendable,
    'balanceCells', v_bal_cells,
    'levelXp', v_level_xp,
    'joinedAt', v_p.joined_at,
    'eligibleAt', case when v_free_reason is not null then null else v_eligible_at end,
    'waitingPeriod', v_free_reason is null and now() < v_eligible_at,
    'cooldownUntil', case when v_free_reason is not null then null else v_cooldown_until end,
    'onCooldown', v_free_reason is null and v_cooldown_until is not null and now() < v_cooldown_until,
    'canAfford', v_free_reason is not null or (v_spendable >= v_xp and v_bal_cells >= v_cells),
    'shortXp', case when v_free_reason is not null then 0 else greatest(0, v_xp - v_spendable) end,
    'shortCells', case when v_free_reason is not null then 0 else greatest(0, v_cells - v_bal_cells) end
  );
end;
$$;

-- ── The skip itself: one atomic, replay-safe unit ────────────────────────
-- p_contribution is the leaver's pooled stream count, computed by the Edge
-- Function (it needs the scrobble-matching rules) and frozen here so the
-- team keeps it after the seat is released.
create or replace function public.rc_quest_skip(p_agent text, p_mission uuid, p_contribution integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  q jsonb;
  v_xp integer; v_cells integer; v_free text; v_mode text;
  v_district text;
begin
  -- One skip at a time per agent: a double tap or two devices racing each
  -- other both land here, and the second sees the first one's writes.
  perform pg_advisory_xact_lock(hashtextextended('rc_quest_skip|' || p_agent, 0));

  q := public.rc_quest_skip_quote(p_agent, p_mission);
  if not (q->>'success')::boolean then return q; end if;
  if (q->>'waitingPeriod')::boolean then
    return jsonb_build_object('success', false, 'error', 'too_soon', 'eligibleAt', q->>'eligibleAt');
  end if;
  if (q->>'onCooldown')::boolean then
    return jsonb_build_object('success', false, 'error', 'on_cooldown', 'cooldownUntil', q->>'cooldownUntil');
  end if;
  if not (q->>'canAfford')::boolean then
    return jsonb_build_object('success', false, 'error', 'insufficient',
      'shortXp', q->>'shortXp', 'shortCells', q->>'shortCells');
  end if;

  v_xp := (q->>'costXp')::integer;
  v_cells := (q->>'costCells')::integer;
  v_free := q->>'freeReason';
  v_mode := q->>'mode';
  select district_id into v_district from public.rc_reconnect_missions where id = p_mission;

  -- Both resources move together or neither does (one transaction).
  if v_cells > 0 then
    update public.rc_players set charge_cells = charge_cells - v_cells
      where agent_no = p_agent and charge_cells >= v_cells;
    if not found then return jsonb_build_object('success', false, 'error', 'insufficient'); end if;
  end if;
  if v_xp > 0 then
    -- kind='spend' => spendable wallet drops, level XP untouched.
    insert into public.rc_xp_ledger (agent_no, amount, source, kind, dedup_key, meta)
    values (p_agent, -v_xp, 'quest_skip', 'spend', 'quest_skip:' || p_mission::text,
            jsonb_build_object('missionId', p_mission, 'mode', v_mode));
  end if;

  -- Seat released; their streams stay in the pool, frozen at this moment.
  update public.rc_reconnect_participants
    set status = 'left', left_at = now(), contribution_frozen = greatest(0, coalesce(p_contribution, 0))
    where mission_id = p_mission and agent_no = p_agent and status = 'joined';
  if not found then return jsonb_build_object('success', false, 'error', 'not_in_mission'); end if;

  insert into public.rc_quest_skips (agent_no, mission_id, district_id, mode, cost_xp, cost_cells, free_reason)
  values (p_agent, p_mission, v_district, v_mode, v_xp, v_cells, v_free);

  return jsonb_build_object('success', true, 'free', v_free is not null, 'freeReason', v_free,
    'costXp', v_xp, 'costCells', v_cells, 'districtId', v_district);
exception when unique_violation then
  -- Replayed request: the ledger dedup_key already exists for this mission.
  return jsonb_build_object('success', false, 'error', 'already_skipped');
end;
$$;

revoke all on function public.rc_quest_skip_price(text) from public, anon, authenticated;
revoke all on function public.rc_quest_skip_quote(text, uuid) from public, anon, authenticated;
revoke all on function public.rc_quest_skip(text, uuid, integer) from public, anon, authenticated;
grant execute on function public.rc_quest_skip_price(text) to service_role;
grant execute on function public.rc_quest_skip_quote(text, uuid) to service_role;
grant execute on function public.rc_quest_skip(text, uuid, integer) to service_role;
