-- Supply Chest: a personal reward meter filled by credited VMA votes.
-- event_id-scoped like the voting mission itself (migration 20260819100000)
-- so a future event gets its own fresh chest track. Approved spec: 50 votes
-- per chest, overflow preserved (never reset to 0, only decremented by the
-- threshold), 2 opens/day, weighted rewards with duplicate-badge protection,
-- fully atomic open (one Postgres function does check+subtract+log+grant as
-- a single transaction — see rc_supply_chest_open below for why the reward
-- grant itself lives in SQL rather than a follow-up JS step).
insert into rc_config (key, value) values (
  'supply_chest',
  '{
    "threshold": 50,
    "daily_open_cap": 2,
    "rewards": [
      { "kind": "charge_cell", "weight": 30 },
      { "kind": "xp", "weight": 20, "amount": 10 },
      { "kind": "streak_freeze", "weight": 15 },
      { "kind": "extension", "weight": 10 },
      { "kind": "badge", "weight": 15, "templateId": "event_vma_supply_chest" },
      { "kind": "backup_pass", "weight": 10 }
    ]
  }'::jsonb
) on conflict (key) do update set value = excluded.value;

insert into rc_badge_catalog (id, section, rarity, name, unlock_hint, sort_order) values
  ('event_vma_supply_chest', 'event', 'rare', 'Rare Badge', 'Open a Supply Chest during the MTV VMAs 2026 voting mission.', 110)
on conflict (id) do nothing;

create table if not exists rc_supply_chest_progress (
  agent_no text not null references rc_agents (agent_no),
  event_id text not null,
  fill_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (agent_no, event_id)
);

create table if not exists rc_supply_chest_opens (
  id bigint generated always as identity primary key,
  agent_no text not null references rc_agents (agent_no),
  event_id text not null,
  reward_kind text not null,
  reward_detail jsonb not null default '{}',
  opened_at timestamptz not null default now()
);

create index if not exists rc_supply_chest_opens_daily_idx on rc_supply_chest_opens (agent_no, event_id, opened_at);

comment on table rc_supply_chest_progress is
  'Cumulative VMA-credited-vote fill per agent/event. Never resets — an open only subtracts the threshold, so overflow rolls into the next chest. See lib/supply-chest.ts.';
comment on table rc_supply_chest_opens is
  'One row per chest actually opened — the daily-cap check and audit trail. reward_detail holds whatever the reward needs (e.g. {"badgeId":"..."} or {"amount":10}).';

-- Called from lib/vma-voting.ts right after a vote is credited (verified at
-- submit time, or approved later by admin review) — a plain atomic
-- increment, no locking subtlety needed since it only ever adds.
create or replace function rc_supply_chest_add_fill(p_agent_no text, p_event_id text, p_amount integer)
returns void language plpgsql security definer as $$
begin
  if p_amount <= 0 then return; end if;
  insert into rc_supply_chest_progress (agent_no, event_id, fill_count, updated_at)
    values (p_agent_no, p_event_id, p_amount, now())
  on conflict (agent_no, event_id) do update
    set fill_count = rc_supply_chest_progress.fill_count + p_amount, updated_at = now();
end;
$$;

-- Atomic open: the reward is already DECIDED by the caller (lib/
-- supply-chest.ts rolls the weighted pick, excluding any badge the agent
-- already owns, before calling this) — this function's job is making
-- "spend 50 fill, check the daily cap, log it, and actually grant that
-- reward" indivisible. The grant lives here (not a JS step after) so a
-- crash between "chest consumed" and "reward applied" can never happen —
-- either the whole thing commits or none of it does. Duplicates a few
-- lines of badge-profile.ts's awardBadge() art-pick for the 'badge' case;
-- accepted for that atomicity guarantee (documented so it isn't mistaken
-- for accidental drift between the two).
create or replace function rc_supply_chest_open(
  p_agent_no text, p_event_id text, p_threshold integer, p_daily_cap integer,
  p_reward_kind text, p_reward_detail jsonb
) returns jsonb language plpgsql security definer as $$
declare
  v_fill integer;
  v_opens_today integer;
  v_open_id bigint;
  v_artwork_id bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('supply_chest|' || p_agent_no || '|' || p_event_id, 0));

  select fill_count into v_fill from rc_supply_chest_progress where agent_no = p_agent_no and event_id = p_event_id for update;
  if v_fill is null or v_fill < p_threshold then
    return jsonb_build_object('success', false, 'error', 'not_ready');
  end if;

  select count(*) into v_opens_today from rc_supply_chest_opens
   where agent_no = p_agent_no and event_id = p_event_id and opened_at::date = (now() at time zone 'utc')::date;
  if v_opens_today >= p_daily_cap then
    return jsonb_build_object('success', false, 'error', 'daily_open_cap_reached');
  end if;

  update rc_supply_chest_progress set fill_count = fill_count - p_threshold, updated_at = now()
    where agent_no = p_agent_no and event_id = p_event_id;

  insert into rc_supply_chest_opens (agent_no, event_id, reward_kind, reward_detail)
    values (p_agent_no, p_event_id, p_reward_kind, p_reward_detail)
    returning id into v_open_id;

  if p_reward_kind = 'charge_cell' then
    update rc_players set charge_cells = coalesce(charge_cells, 0) + 1 where agent_no = p_agent_no;
  elsif p_reward_kind = 'streak_freeze' then
    update rc_players set streak_freeze_charges = coalesce(streak_freeze_charges, 0) + 1 where agent_no = p_agent_no;
  elsif p_reward_kind = 'extension' then
    update rc_players set deadline_extension_charges = coalesce(deadline_extension_charges, 0) + 1 where agent_no = p_agent_no;
  elsif p_reward_kind = 'xp' then
    insert into rc_xp_ledger (agent_no, amount, source, dedup_key, meta)
      values (p_agent_no, coalesce((p_reward_detail->>'amount')::integer, 10), 'supply_chest', 'chest:' || v_open_id, '{}'::jsonb)
    on conflict (dedup_key) do nothing;
  elsif p_reward_kind = 'backup_pass' then
    insert into rc_player_items (agent_no, item_id) values (p_agent_no, 'backup-pass');
  elsif p_reward_kind = 'badge' then
    select art.id into v_artwork_id from rc_badge_art art
     where art.template_id = p_reward_detail->>'templateId' and art.active = true
     order by random() limit 1;
    insert into rc_badges (agent_no, badge_id, artwork_id)
      values (p_agent_no, p_reward_detail->>'templateId', v_artwork_id)
    on conflict (agent_no, badge_id) do nothing;
  end if;

  return jsonb_build_object('success', true, 'openId', v_open_id, 'fillRemaining', v_fill - p_threshold);
end;
$$;
