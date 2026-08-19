-- Backup Pass: a consumable Pack item that lets an agent open ONE of their
-- own currently-active track/album goals to exactly one helper. Built as a
-- new, small sibling to rc_reconnect_missions rather than reusing it —
-- reconnect goals are admin-authored ahead of time and frozen at district
-- activation (districts.ts's freezeGoals()); Backup Pass needs the owner to
-- pick any of their ALREADY-frozen normal goals on demand, which reconnect
-- has no mechanism for. See the design discussion this migration follows
-- from for the full reasoning.
--
-- Deliberately does NOT mutate rc_player_districts.goals — districts.ts's
-- own module comment states goals are frozen at activation and never change
-- in-flight. The boosted target is an OVERLAY, computed fresh each poll by
-- lib/backup-pass.ts and passed into districtProgress() as an extra
-- argument, never written back into the frozen goal snapshot.

-- Backup Pass rides the existing Pack/shelf item system (rc_items +
-- rc_player_items) instead of a new counter column, per review — Supply
-- Chest rewards should share one inventory mechanism wherever possible.
-- 'utility' is new: none of the existing kinds (merch categories) fit a
-- game-mechanic item. drop_weight=0 keeps it out of the existing random
-- item-drop roll (rc_roll_item()) — it's only ever granted by name (Supply
-- Chest logic, not built yet, or an admin grant).
alter table rc_items drop constraint if exists rc_items_kind_check;
alter table rc_items add constraint rc_items_kind_check check (kind = any (array[
  'album', 'photocard', 'lightstick', 'poster', 'banner', 'ticket', 'mug', 'cushion',
  'rug', 'lightbox', 'record', 'tray', 'apparel', 'keyring', 'plush', 'figure',
  'blanket', 'magnet', 'utility'
]));

insert into rc_items (id, name, kind, era, rarity, blurb, drop_weight, active, sort_order)
values ('backup-pass', 'Backup Pass', 'utility', null, 'rare',
  'Call in one other agent to help push a track or album goal. Boosts the target a little, but their streams count toward it too.',
  0, true, 900)
on conflict (id) do nothing;

insert into rc_config (key, value) values (
  'backup_pass',
  '{
    "target_multiplier": 1.2,
    "request_ttl_days": 5
  }'::jsonb
) on conflict (key) do update set value = excluded.value;

create table if not exists rc_backup_requests (
  id uuid primary key default gen_random_uuid(),
  owner_agent_no text not null references rc_agents (agent_no),
  district_id text not null references rc_districts (id),
  goal_kind text not null check (goal_kind in ('track', 'album')),
  goal_ref text not null, -- the frozen trackGoals[].id or albumGoals[].id
  original_target integer not null,
  boosted_target integer not null,
  -- 'open': no helper yet. 'joined': helper active, live-pooled against
  -- boosted_target. 'complete': hit boosted_target while still joined.
  -- 'banked': closed early (helper left/expired/goal already done solo)
  -- with banked_credit > 0, now a permanent bonus toward original_target.
  -- 'cancelled': helper left with zero contribution, pass refunded.
  -- 'expired': never got a helper before request_ttl_days ran out, refunded.
  status text not null default 'open' check (status in ('open', 'joined', 'complete', 'banked', 'cancelled', 'expired')),
  helper_agent_no text references rc_agents (agent_no),
  -- The specific rc_player_items row consumed to open this request — refund
  -- (used_at -> null) targets this exact row, so a refund can never affect
  -- any OTHER Backup Pass the agent might separately hold.
  spent_player_item_id uuid not null references rc_player_items (id),
  banked_credit integer not null default 0,
  opened_at timestamptz not null default now(),
  joined_at timestamptz,
  expires_at timestamptz not null,
  completed_at timestamptz,
  closed_at timestamptz
);

create index if not exists rc_backup_requests_owner_idx on rc_backup_requests (owner_agent_no) where status in ('open', 'joined');
create index if not exists rc_backup_requests_helper_idx on rc_backup_requests (helper_agent_no) where status in ('open', 'joined');
create index if not exists rc_backup_requests_open_idx on rc_backup_requests (status, district_id) where status = 'open';
-- The repeat-pair check (rc_backup_join) scans this shape directly.
create index if not exists rc_backup_requests_pair_history_idx
  on rc_backup_requests (owner_agent_no, helper_agent_no, goal_ref);

comment on table rc_backup_requests is
  'Backup Pass co-op requests. Overlay-only — never mutates rc_player_districts.goals. See lib/backup-pass.ts.';

-- Atomic open: claims exactly one unused Backup Pass (SKIP LOCKED so two
-- concurrent opens from the same agent can''t both claim the same row) and
-- inserts the request in the same transaction, so a request can never exist
-- without a genuinely-consumed item backing it.
create or replace function rc_backup_open(
  p_owner text, p_district_id text, p_goal_kind text, p_goal_ref text,
  p_original_target integer, p_boosted_target integer, p_ttl_days integer
) returns jsonb language plpgsql security definer as $$
declare
  v_item_id uuid;
  v_request_id uuid;
begin
  if exists (select 1 from rc_backup_requests where owner_agent_no = p_owner and status in ('open', 'joined')) then
    return jsonb_build_object('success', false, 'error', 'already_has_active_backup');
  end if;

  update rc_player_items set used_at = now()
    where id = (
      select id from rc_player_items
       where agent_no = p_owner and item_id = 'backup-pass' and used_at is null
       limit 1 for update skip locked
    )
    returning id into v_item_id;

  if v_item_id is null then
    return jsonb_build_object('success', false, 'error', 'no_backup_pass');
  end if;

  insert into rc_backup_requests (
    owner_agent_no, district_id, goal_kind, goal_ref,
    original_target, boosted_target, spent_player_item_id, expires_at
  ) values (
    p_owner, p_district_id, p_goal_kind, p_goal_ref,
    p_original_target, p_boosted_target, v_item_id, now() + make_interval(days => p_ttl_days)
  ) returning id into v_request_id;

  return jsonb_build_object('success', true, 'id', v_request_id);
end;
$$;

-- Atomic join: row-locked so two candidates tapping Join within milliseconds
-- of each other can't both land as helper. Also closes off self-help and
-- the permanent same-pair-same-goal restriction here, at the one place a
-- helper is actually assigned.
create or replace function rc_backup_join(p_request_id uuid, p_helper text) returns jsonb language plpgsql security definer as $$
declare
  v_row rc_backup_requests%rowtype;
begin
  select * into v_row from rc_backup_requests where id = p_request_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'not_found'); end if;
  if v_row.status != 'open' then return jsonb_build_object('success', false, 'error', 'not_open'); end if;
  if v_row.owner_agent_no = p_helper then return jsonb_build_object('success', false, 'error', 'cannot_help_self'); end if;
  if v_row.expires_at <= now() then return jsonb_build_object('success', false, 'error', 'expired'); end if;

  if exists (select 1 from rc_backup_requests where helper_agent_no = p_helper and status = 'joined') then
    return jsonb_build_object('success', false, 'error', 'already_helping_elsewhere');
  end if;

  -- Same owner+helper pair may never redo the exact same goal — but only
  -- once something real happened (a completed or banked-with-credit prior
  -- attempt). A prior pairing that refunded with zero contribution never
  -- meaningfully "used" the goal, so it doesn't block a retry.
  if exists (
    select 1 from rc_backup_requests
     where owner_agent_no = v_row.owner_agent_no and helper_agent_no = p_helper and goal_ref = v_row.goal_ref
       and (status = 'complete' or banked_credit > 0)
  ) then
    return jsonb_build_object('success', false, 'error', 'already_paired_this_goal');
  end if;

  update rc_backup_requests set status = 'joined', helper_agent_no = p_helper, joined_at = now()
    where id = p_request_id;
  return jsonb_build_object('success', true);
end;
$$;

-- Atomic close, covering every end path (helper leaves, expiry, the goal
-- already being done): the caller (lib/backup-pass.ts) computes the live
-- owner/helper progress numbers beforehand — this function's only job is
-- the state transition + item refund, done as one locked unit so a
-- duplicate/concurrent close call can never refund or bank twice. Returns
-- alreadyClosed:true (not an error) on a request that's already resolved,
-- so callers can call this defensively without checking status first.
create or replace function rc_backup_close(
  p_request_id uuid, p_reason text, p_owner_progress integer, p_helper_contribution integer
) returns jsonb language plpgsql security definer as $$
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
  return jsonb_build_object('success', true, 'status', 'banked', 'bankedCredit', p_helper_contribution, 'completed', v_completed_at is not null);
end;
$$;

-- Reached boosted_target while still 'joined' — the clean full-success path
-- (both still counted, no banking needed since nothing early-closed).
-- Separate from rc_backup_close because it doesn't touch the item (already
-- consumed, correctly, and stays that way) or need progress numbers passed
-- in beyond a completion flag.
create or replace function rc_backup_complete(p_request_id uuid) returns jsonb language plpgsql security definer as $$
declare
  v_row rc_backup_requests%rowtype;
begin
  select * into v_row from rc_backup_requests where id = p_request_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'not_found'); end if;
  if v_row.status != 'joined' then
    return jsonb_build_object('success', true, 'alreadyClosed', v_row.status != 'joined', 'status', v_row.status);
  end if;
  update rc_backup_requests set status = 'complete', completed_at = now(), closed_at = now() where id = p_request_id;
  return jsonb_build_object('success', true, 'status', 'complete');
end;
$$;
