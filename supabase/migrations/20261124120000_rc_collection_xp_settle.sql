-- Weekly Collection XP: pay every eligible player after the weekly reset,
-- not only the ones who happen to open the app before it.
--
-- Until now Collection XP was paid only inside getGameState (the app's poll),
-- for the current KST week. Someone who qualified and didn't reopen HT before
-- Monday 00:00 KST (Sunday 8:30 PM IST) lost that week. The edge function's
-- new cronSettleCollectionXp action settles the week that just ended, with the
-- same values, cap and activity rules, and this migration gives it what it
-- needs:
--
--   1. rc_xp_ledger.earned_week — the week a row was EARNED in, separate from
--      created_at (when it was credited). A catch-up credited on Monday still
--      belongs to the week before.
--   2. rc_item_placement_log — every change to where a collectible sits (or
--      whether it's used), with the value it had BEFORE the change, so the
--      settle can read placements exactly as they were at the reset, however
--      late it runs. Moves after the reset don't change the week that ended.
--   3. rc_award_collectible_xp() — the one way Collection XP is written, by
--      the app's poll and by the settle alike. A per-player-per-week lock
--      makes concurrent calls take turns; inside it the cap is checked
--      against what that week already paid, and the dedup key
--      (collectible:AGENT:WEEK:ITEM) is unique, so nothing pays twice and no
--      week passes 50 XP.
--   4. pg_cron: the settle runs Sunday 16:05 UTC (Sun 9:35 PM IST, after the
--      15:40–15:50 fleet sync has finished reading Sunday), then again 24 h
--      and 48 h later for plays that arrive late (ListenBrainz is re-read 48 h
--      back, Musicat 24 h).
--
-- Nothing existing is changed or backfilled: there are no collectible rows yet
-- (rewards start with the week of 2026-11-30), and no collectible is moved.

-- ── 1. Earning week ──────────────────────────────────────────────────────
alter table public.rc_xp_ledger add column if not exists earned_week date;
comment on column public.rc_xp_ledger.earned_week is
  'KST week (Monday) the XP was earned in, when that differs in meaning from created_at (credit time). Set for source=collectible.';
create index if not exists rc_xp_ledger_earned_week_idx
  on public.rc_xp_ledger (agent_no, earned_week) where earned_week is not null;

-- ── 2. Placement history ─────────────────────────────────────────────────
create table if not exists public.rc_item_placement_log (
  id              bigint generated always as identity primary key,
  player_item_id  uuid        not null,
  agent_no        text        not null,
  item_id         text        not null,
  obtained_at     timestamptz not null,
  op              text        not null check (op in ('update', 'delete')),
  old_district_id text,
  old_used_at     timestamptz,
  new_district_id text,
  new_used_at     timestamptz,
  changed_at      timestamptz not null default now()
);
create index if not exists rc_item_placement_log_changed_idx on public.rc_item_placement_log (changed_at);
create index if not exists rc_item_placement_log_agent_idx on public.rc_item_placement_log (agent_no, changed_at);
alter table public.rc_item_placement_log enable row level security;
-- No policies: service role only (the edge function).
revoke all on public.rc_item_placement_log from anon, authenticated;

create or replace function public.rc_log_item_placement()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    insert into rc_item_placement_log (player_item_id, agent_no, item_id, obtained_at, op, old_district_id, old_used_at)
    values (old.id, old.agent_no, old.item_id, old.obtained_at, 'delete', old.district_id, old.used_at);
    return old;
  end if;
  if old.district_id is distinct from new.district_id or old.used_at is distinct from new.used_at then
    insert into rc_item_placement_log (player_item_id, agent_no, item_id, obtained_at, op,
                                       old_district_id, old_used_at, new_district_id, new_used_at)
    values (new.id, new.agent_no, new.item_id, new.obtained_at, 'update',
            old.district_id, old.used_at, new.district_id, new.used_at);
  end if;
  return new;
end $$;
revoke all on function public.rc_log_item_placement() from public, anon, authenticated;

drop trigger if exists rc_player_items_placement_log on public.rc_player_items;
create trigger rc_player_items_placement_log
  after update of district_id, used_at or delete on public.rc_player_items
  for each row execute function public.rc_log_item_placement();

-- ── 3. The one writer ────────────────────────────────────────────────────
-- p_awards: [{ "itemId": "...", "xp": 15 }, ...] best first (the order the
-- caller's planAwards uses, so the cap keeps the most valuable ones).
create or replace function public.rc_award_collectible_xp(
  p_agent_no text, p_week date, p_cap integer, p_awards jsonb, p_via text default 'app'
) returns table (item_id text, amount integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prefix text;
  v_paid   integer;
  v_xp     integer;
  v_key    text;
  a        jsonb;
begin
  if coalesce(p_agent_no, '') = '' or p_week is null then raise exception 'agent and week required'; end if;
  if extract(isodow from p_week) <> 1 then raise exception 'week must be a Monday: %', p_week; end if;
  if p_cap is null or p_cap < 0 then raise exception 'cap required'; end if;
  v_prefix := 'collectible:' || p_agent_no || ':' || p_week::text || ':';

  -- One payer at a time per player per week: the poll and the settle, or two
  -- polls, can't both read "0 paid" and together pass the cap.
  perform pg_advisory_xact_lock(hashtextextended(v_prefix, 0));

  select coalesce(sum(l.amount), 0) into v_paid
    from rc_xp_ledger l
   where l.agent_no = p_agent_no and l.source = 'collectible'
     and left(l.dedup_key, length(v_prefix)) = v_prefix;

  for a in select value from jsonb_array_elements(coalesce(p_awards, '[]'::jsonb))
  loop
    exit when v_paid >= p_cap;
    if coalesce(a->>'itemId', '') = '' then continue; end if;
    v_key := v_prefix || (a->>'itemId');
    if exists (select 1 from rc_xp_ledger where dedup_key = v_key) then continue; end if;
    v_xp := least(greatest(coalesce((a->>'xp')::integer, 0), 0), p_cap - v_paid);
    if v_xp <= 0 then continue; end if;
    insert into rc_xp_ledger (agent_no, amount, source, dedup_key, meta, earned_week)
    values (p_agent_no, v_xp, 'collectible', v_key,
            jsonb_build_object('weekKey', p_week::text, 'itemId', a->>'itemId', 'via', coalesce(p_via, 'app')),
            p_week)
    on conflict (dedup_key) do nothing;
    if found then
      v_paid := v_paid + v_xp;
      item_id := a->>'itemId'; amount := v_xp;
      return next;
    end if;
  end loop;
end $$;
revoke all on function public.rc_award_collectible_xp(text, date, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.rc_award_collectible_xp(text, date, integer, jsonb, text) to service_role;

-- ── 4. Schedule ──────────────────────────────────────────────────────────
create or replace function public.rc_invoke_collection_settle()
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cron_token text;
  request_id bigint;
begin
  select decrypted_secret into cron_token
    from vault.decrypted_secrets where name = 'rc_stream_sync_token'
   order by created_at desc limit 1;
  if coalesce(cron_token, '') = '' then
    raise warning 'rc_stream_sync_token is missing from Vault; collection settle skipped';
    return null;
  end if;
  select net.http_post(
    url := 'https://lcvmwlioqpyaprxicdfl.supabase.co/functions/v1/op-reconnect',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-region', 'ap-northeast-2'),
    body := jsonb_build_object('action', 'cronSettleCollectionXp', 'cronToken', cron_token),
    timeout_milliseconds := 120000
  ) into request_id;
  return request_id;
end $$;
revoke all on function public.rc_invoke_collection_settle() from public, anon, authenticated;

create temp table collection_settle_other_jobs on commit drop as
  select jobname, schedule, command, active from cron.job where jobname <> 'rc-collection-settle';

do $$
begin
  perform cron.unschedule('rc-collection-settle');
exception when others then
  null;  -- not scheduled yet, which is the normal case
end $$;

-- Sun/Mon/Tue 16:05 UTC = Mon/Tue/Wed 01:05 KST = Sun/Mon/Tue 9:35 PM IST.
select cron.schedule('rc-collection-settle', '5 16 * * 0,1,2', $$select rc_invoke_collection_settle()$$);

-- ── Post-conditions ──────────────────────────────────────────────────────
do $$
declare n integer;
begin
  select count(*) into n from cron.job where jobname = 'rc-collection-settle' and active;
  if n <> 1 then raise exception 'expected exactly 1 active rc-collection-settle job, found %', n; end if;

  select count(*) into n from (
    (select jobname, schedule, command, active from cron.job where jobname <> 'rc-collection-settle'
     except all select * from collection_settle_other_jobs)
    union all
    (select * from collection_settle_other_jobs
     except all select jobname, schedule, command, active from cron.job where jobname <> 'rc-collection-settle')
  ) d;
  if n <> 0 then raise exception 'other cron jobs changed during this migration (% rows differ)', n; end if;

  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'rc_xp_ledger' and column_name = 'earned_week';
  if n <> 1 then raise exception 'rc_xp_ledger.earned_week missing'; end if;
end $$;
