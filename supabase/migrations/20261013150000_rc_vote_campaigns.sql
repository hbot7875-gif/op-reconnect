-- Voting campaigns: a small reusable framework, MAMA 2026 first.
--
-- NOT APPLIED. Staged for review with the MAMA 2026 release.
--
-- What this adds, and what it deliberately leaves alone:
--
--   * rc_vote_campaigns    one row per voting event: dates, missions, rewards,
--                          and the event's own Voting Gift config.
--   * rc_campaign_proofs   one row per submitted proof. One live proof per
--                          mission per agent per KST day; a rejected proof
--                          frees the day again.
--   * rc_agent_x_handles   the X handle an agent links so a vote post can be
--                          matched to them. Private: never returned to anyone
--                          but its owner and the admin review queue.
--   * rc_vote_gift_*       the Voting Gift: fill from verified proofs only,
--                          opened under a lock, idempotent per request.
--
--   * rc_vma_votes, rc_supply_chest_*, rc_config.vma_2026 and
--     rc_config.supply_chest are NOT touched. VMA history stays exactly as it
--     is; nothing here reads or migrates it.
--
-- Fixes carried over from the VMA review, so they are not repeated here:
--   * browser OCR never decides anything — proofs arrive as 'verifying' and
--     only a trusted check (rc_campaign_transition) can verify them;
--   * no raw OCR text column exists; checks are structured booleans;
--   * no handwritten watermark;
--   * every "today" is a KST day (rc_kst_day), including the gift's daily
--     open cap — the VMA chest counted UTC days;
--   * reward config is per event, read inside the database, never passed in;
--   * no VMA template, event id or default anywhere below.

begin;

-- ── KST day ─────────────────────────────────────────────────────────────
create or replace function public.rc_kst_day(p_at timestamptz default now())
returns date language sql stable
set search_path = public, pg_temp
as $$ select (p_at at time zone 'Asia/Seoul')::date $$;


-- ── Campaigns ──────────────────────────────────────────────────────────
create table if not exists public.rc_vote_campaigns (
  id          text primary key check (id ~ '^[a-z0-9_]{3,40}$'),
  title       text not null,
  round_label text,
  opens_at    timestamptz not null,
  closes_at   timestamptz not null,
  -- [{ id, kind: 'mnet_certificate' | 'x_post', label, ... }]
  missions    jsonb not null default '[]'::jsonb,
  -- { badge_template_id, badge_verified_days } — the event badge rule
  rewards     jsonb not null default '{}'::jsonb,
  -- Voting Gift: { name, fill_per_verified, threshold, daily_open_cap,
  --   rolls, pool: [{ kind, weight, amount }] }
  gift        jsonb not null default '{}'::jsonb,
  -- Team battle: { enabled, teams: [{ id, label }], choose_seconds, freeze_at,
  --   milestones: [absolute totals], gift: { rolls_min, rolls_max, pool },
  --   winner_reward: [{ kind, amount }] }
  battle      jsonb not null default '{}'::jsonb,
  -- BTS X Vote Pulse collector settings (provider, actor, budget). Internal.
  pulse       jsonb not null default '{}'::jsonb,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint rc_vote_campaigns_window check (closes_at > opens_at)
);

comment on table public.rc_vote_campaigns is
  'Voting events (MAMA 2026 first). Config only; proofs live in rc_campaign_proofs. Independent of the VMA tables.';


-- ── Proofs ─────────────────────────────────────────────────────────────
create table if not exists public.rc_campaign_proofs (
  id             bigint generated always as identity primary key,
  campaign_id    text not null references public.rc_vote_campaigns (id),
  mission_id     text not null check (mission_id ~ '^[a-z0-9_]{1,24}$'),
  agent_no       text not null references public.rc_agents (agent_no) on delete cascade,
  vote_day       date not null,                    -- KST day the vote counts for
  status         text not null check (status in ('verifying', 'review', 'verified', 'rejected')),
  -- Trusted, structured results only (e.g. {"artist":true,"category":true,"date":true}).
  checks         jsonb not null default '{}'::jsonb,
  -- The player's browser pre-check, booleans only. A hint for triage; it is
  -- never read by any decision below.
  client_checks  jsonb not null default '{}'::jsonb,
  verify_method  text,                             -- 'reviewer_ocr' | 'x_oembed' | 'admin'
  verify_note    text,
  proof_path     text,                             -- object key in campaign-proofs; null once deleted
  image_hash     text check (image_hash ~ '^[0-9a-f]{64}$'),    -- sha-256 of the stored bytes
  original_hash  text check (original_hash ~ '^[0-9a-f]{64}$'), -- sha-256 of the file before re-encoding
  post_id        text check (post_id ~ '^[0-9]{5,25}$'),
  post_url       text,
  post_author    text,                             -- lower-case X handle read back from X
  submitted_at   timestamptz not null default now(),
  verified_at    timestamptz,
  reviewed_by    text,
  reviewed_at    timestamptz,
  review_note    text,
  rewarded_at    timestamptz,                      -- set once, when verified credit was applied
  -- The team this proof scored for. Stamped by the server, once, at the
  -- moment it was verified — only if the agent already had a team and the
  -- battle had not frozen. Null = no battle point (but still gift fill and
  -- badge days). Never written from anything a client sends.
  battle_team    text,
  -- Duplicate-certificate fingerprints: HMAC-SHA256 (server-side key, never
  -- in the database) of the certificate number and of its participation
  -- minute. The number and the time themselves are never stored, and
  -- without the key a fingerprint can't be reversed or even checked against
  -- a guess.
  cert_fingerprint      text check (cert_fingerprint ~ '^[0-9a-f]{64}$'),
  cert_time_fingerprint text check (cert_time_fingerprint ~ '^[0-9a-f]{64}$'),
  duplicate_of   bigint,                           -- the earlier proof it collided with
  duplicate_kind text check (duplicate_kind in ('certificate', 'possible'))
);

-- A mission's config controls its per-agent KST-day cap. MAMA uses three
-- Mnet certificates and three X posts. The submit function enforces the cap
-- under an advisory lock; rejected rows do not consume a slot.
create index if not exists rc_campaign_proofs_daily_cap_idx
  on public.rc_campaign_proofs (campaign_id, mission_id, agent_no, vote_day)
  where status <> 'rejected';

-- One registered X account can earn at most one live credit per KST day.
create unique index if not exists rc_campaign_proofs_x_handle_day_key
  on public.rc_campaign_proofs (campaign_id, mission_id, agent_no, vote_day, post_author)
  where status <> 'rejected' and post_author is not null;

-- The same screenshot or post can never be used twice — by anyone, in any
-- campaign. Kept after the file itself is deleted (see retention below).
create unique index if not exists rc_campaign_proofs_image_hash_key
  on public.rc_campaign_proofs (image_hash) where image_hash is not null;
create unique index if not exists rc_campaign_proofs_original_hash_key
  on public.rc_campaign_proofs (original_hash) where original_hash is not null;
create unique index if not exists rc_campaign_proofs_post_id_key
  on public.rc_campaign_proofs (post_id) where post_id is not null;

create index if not exists rc_campaign_proofs_time_fp_idx
  on public.rc_campaign_proofs (campaign_id, cert_time_fingerprint) where cert_time_fingerprint is not null;

-- One certificate (by number fingerprint) can back one live proof per event.
-- The claim moves on only if its proof is rejected.
create table if not exists public.rc_campaign_cert_claims (
  campaign_id text not null references public.rc_vote_campaigns (id),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  proof_id    bigint not null references public.rc_campaign_proofs (id) on delete cascade,
  claimed_at  timestamptz not null default now(),
  primary key (campaign_id, fingerprint)
);

create index if not exists rc_campaign_proofs_queue_idx
  on public.rc_campaign_proofs (campaign_id, status, submitted_at);
create index if not exists rc_campaign_proofs_agent_idx
  on public.rc_campaign_proofs (agent_no, campaign_id, vote_day desc);

comment on table public.rc_campaign_proofs is
  'Voting proofs. Arrive as verifying (Mnet) or verified/review (X, checked server-side). Only rc_campaign_transition moves a proof to verified. No raw OCR text is stored.';


-- ── X handles ──────────────────────────────────────────────────────────
create table if not exists public.rc_agent_x_handles (
  campaign_id text not null references public.rc_vote_campaigns (id),
  agent_no   text not null references public.rc_agents (agent_no) on delete cascade,
  x_handle   text not null check (x_handle ~ '^[a-z0-9_]{1,15}$'),
  created_at timestamptz not null default now(),
  primary key (campaign_id, x_handle)
);
create index if not exists rc_agent_x_handles_agent_idx
  on public.rc_agent_x_handles (campaign_id, agent_no, created_at);

comment on table public.rc_agent_x_handles is
  'Up to the campaign-configured maximum X accounts per agent. Event-scoped and append-only during voting so account rotation cannot bypass daily limits. Never shown publicly.';

-- Register, never replace. The advisory lock makes the three-account limit
-- authoritative under concurrent requests; the primary key makes one X
-- account belong to only one ReConnect agent in this event.
create or replace function public.rc_campaign_register_x_handle(
  p_campaign_id text, p_agent_no text, p_x_handle text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c public.rc_vote_campaigns%rowtype;
  v_max integer;
  v_owner text;
begin
  select * into v_c from rc_vote_campaigns where id = p_campaign_id and active;
  if not found then return jsonb_build_object('success', false, 'error', 'campaign_not_found'); end if;
  if p_x_handle !~ '^[a-z0-9_]{1,15}$' then return jsonb_build_object('success', false, 'error', 'bad_handle'); end if;
  select coalesce((m ->> 'max_handles')::integer, 1) into v_max
    from jsonb_array_elements(v_c.missions) m where m ->> 'kind' = 'x_post' limit 1;

  perform pg_advisory_xact_lock(hashtextextended('vote_x_handles|' || p_campaign_id || '|' || p_agent_no, 0));
  select agent_no into v_owner from rc_agent_x_handles
   where campaign_id = p_campaign_id and x_handle = p_x_handle;
  if found then
    if v_owner = p_agent_no then
      return jsonb_build_object('success', true, 'xHandle', p_x_handle, 'replay', true);
    end if;
    return jsonb_build_object('success', false, 'error', 'x_handle_taken');
  end if;
  if (select count(*) from rc_agent_x_handles where campaign_id = p_campaign_id and agent_no = p_agent_no) >= v_max then
    return jsonb_build_object('success', false, 'error', 'x_handle_limit');
  end if;
  insert into rc_agent_x_handles (campaign_id, agent_no, x_handle) values (p_campaign_id, p_agent_no, p_x_handle);
  return jsonb_build_object('success', true, 'xHandle', p_x_handle);
exception when unique_violation then
  return jsonb_build_object('success', false, 'error', 'x_handle_taken');
end;
$$;


-- ── Voting Gift ────────────────────────────────────────────────────────
-- The VMA Supply Chest model (fill from verified votes, threshold, a daily
-- open cap, several weighted rolls per open), scoped to one event, on KST
-- days, with retry-safe opens.
create table if not exists public.rc_vote_gift_progress (
  campaign_id text not null references public.rc_vote_campaigns (id),
  agent_no    text not null references public.rc_agents (agent_no) on delete cascade,
  fill        integer not null default 0 check (fill >= 0),
  updated_at  timestamptz not null default now(),
  primary key (campaign_id, agent_no)
);

-- One fill per verified proof, ever. The primary key is what makes fill
-- idempotent: re-applying the same proof inserts nothing and adds nothing.
create table if not exists public.rc_vote_gift_fills (
  proof_id    bigint primary key references public.rc_campaign_proofs (id) on delete cascade,
  campaign_id text not null,
  agent_no    text not null,
  mission_id  text not null,
  vote_day    date not null,
  amount      integer not null check (amount > 0),
  created_at  timestamptz not null default now()
);
create index if not exists rc_vote_gift_fills_agent_idx
  on public.rc_vote_gift_fills (campaign_id, agent_no, created_at desc);

create table if not exists public.rc_vote_gift_opens (
  id          bigint generated always as identity primary key,
  campaign_id text not null references public.rc_vote_campaigns (id),
  agent_no    text not null references public.rc_agents (agent_no) on delete cascade,
  request_id  uuid not null unique,       -- client retry of the same tap returns the same result
  kst_day     date not null,
  spent       integer not null check (spent > 0),
  rewards     jsonb not null default '[]'::jsonb,
  opened_at   timestamptz not null default now()
);
create index if not exists rc_vote_gift_opens_day_idx
  on public.rc_vote_gift_opens (campaign_id, agent_no, kst_day);


-- ── Private proof bucket ───────────────────────────────────────────────
-- Same reasoning as vma-vote-proofs: a screenshot can show a status bar and
-- account details, so only the service-role edge function touches it and
-- reviewers get 10-minute signed links.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('campaign-proofs', 'campaign-proofs', false, 5242880, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;


-- ── Applying verified credit ───────────────────────────────────────────
-- Internal. Called only from the two functions below, inside their
-- transaction, after a proof has become 'verified'. Idempotent twice over:
-- rewarded_at is set once, and the gift fill row is keyed by the proof.
--
-- A verified proof is worth exactly: +1 Voting Gift fill (config) and one
-- battle point for the agent's team. Battle points are not stored here —
-- they ARE the verified proof rows (rc_campaign_battle_state counts them),
-- so a retried submit, which never creates a second row, can't add a second
-- point. There is no per-mission XP: like VMA, rewards come from gifts.
create or replace function public.rc_campaign_apply_verified(p_proof_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p public.rc_campaign_proofs%rowtype;
  v_c public.rc_vote_campaigns%rowtype;
  v_fill integer;
  v_badge text;
  v_days integer;
  v_filled integer := 0;
  v_team text;
begin
  select * into v_p from rc_campaign_proofs where id = p_proof_id for update;
  if not found or v_p.status <> 'verified' then
    return jsonb_build_object('applied', false, 'reason', 'not_verified');
  end if;
  if v_p.rewarded_at is not null then
    return jsonb_build_object('applied', false, 'reason', 'already_applied');
  end if;
  select * into v_c from rc_vote_campaigns where id = v_p.campaign_id;

  -- Voting Gift fill.
  v_fill := coalesce((v_c.gift ->> 'fill_per_verified')::integer, 0);
  if v_fill > 0 then
    insert into rc_vote_gift_fills (proof_id, campaign_id, agent_no, mission_id, vote_day, amount)
    values (v_p.id, v_p.campaign_id, v_p.agent_no, v_p.mission_id, v_p.vote_day, v_fill)
    on conflict (proof_id) do nothing;
    if found then
      insert into rc_vote_gift_progress (campaign_id, agent_no, fill, updated_at)
      values (v_p.campaign_id, v_p.agent_no, v_fill, now())
      on conflict (campaign_id, agent_no) do update
        set fill = rc_vote_gift_progress.fill + excluded.fill, updated_at = now();
      v_filled := v_fill;
    end if;
  end if;

  -- Event badge after N different verified voting days (not a streak).
  -- rc_award_badge is idempotent per (agent, badge), so it awards once.
  v_badge := nullif(v_c.rewards ->> 'badge_template_id', '');
  v_days := coalesce((v_c.rewards ->> 'badge_verified_days')::integer, 0);
  if v_badge is not null and v_days > 0 and (
    select count(distinct vote_day) from rc_campaign_proofs
     where campaign_id = v_p.campaign_id and agent_no = v_p.agent_no and status = 'verified'
  ) >= v_days then
    perform rc_award_badge(v_p.agent_no, v_badge, null);
  end if;

  -- Battle point: only for an agent already on a team, and only before the
  -- battle freezes. A proof verified later still filled the gift above and
  -- counts toward badge days, but can't move a frozen score.
  if coalesce((v_c.battle ->> 'enabled')::boolean, false)
     and now() <= coalesce((v_c.battle ->> 'freeze_at')::timestamptz, v_c.closes_at) then
    select team into v_team from rc_campaign_teams
     where campaign_id = v_p.campaign_id and agent_no = v_p.agent_no and team is not null;
  end if;

  update rc_campaign_proofs set rewarded_at = now(), battle_team = v_team where id = v_p.id;
  return jsonb_build_object('applied', true, 'giftFill', v_filled, 'battleTeam', v_team);
end;
$$;


-- ── Submit ─────────────────────────────────────────────────────────────
-- The VMA submit pattern: lock this agent/mission/day, re-check duplicates
-- and the configured daily cap, insert — all in one transaction.
--
-- The edge function decides p_status, and only from evidence it gathered
-- itself: an Mnet upload is always 'verifying'; an X post is 'verified' only
-- when the server's own fetch confirmed it. Browser OCR is stored as
-- client_checks and is never an input to the status.
create or replace function public.rc_campaign_submit_proof(
  p_campaign_id text, p_mission_id text, p_agent_no text, p_vote_day date,
  p_status text, p_checks jsonb, p_client_checks jsonb, p_method text, p_note text,
  p_proof_path text, p_image_hash text, p_original_hash text,
  p_post_id text, p_post_url text, p_post_author text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c public.rc_vote_campaigns%rowtype;
  v_mission jsonb;
  v_live public.rc_campaign_proofs%rowtype;
  v_daily_cap integer;
  v_id bigint;
begin
  if p_status not in ('verifying', 'review', 'verified') then
    return jsonb_build_object('success', false, 'error', 'bad_status');
  end if;

  select * into v_c from rc_vote_campaigns where id = p_campaign_id and active;
  if not found then
    return jsonb_build_object('success', false, 'error', 'campaign_not_found');
  end if;
  select m into v_mission from jsonb_array_elements(v_c.missions) m where m ->> 'id' = p_mission_id;
  if v_mission is null then
    return jsonb_build_object('success', false, 'error', 'bad_mission');
  end if;
  if p_vote_day < rc_kst_day(v_c.opens_at) or p_vote_day > rc_kst_day(v_c.closes_at) then
    return jsonb_build_object('success', false, 'error', 'voting_closed');
  end if;
  -- While the battle runs, a proof is only accepted from an agent who is
  -- already on a MAMA team. That way every proof that later becomes
  -- verified can be stamped with its team — no battle point is ever lost
  -- to "verified before choosing a side". The client resolves the team
  -- (the 7-second choice) first and retries.
  if coalesce((v_c.battle ->> 'enabled')::boolean, false) and not exists (
    select 1 from rc_campaign_teams
     where campaign_id = p_campaign_id and agent_no = p_agent_no and team is not null
  ) then
    return jsonb_build_object('success', false, 'error', 'team_required');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'vote_proof|' || p_campaign_id || '|' || p_mission_id || '|' || p_agent_no || '|' || p_vote_day::text, 0));

  -- A retry of the same submission (same agent, same proof material) gets
  -- the row it already created, not a duplicate error.
  select * into v_live from rc_campaign_proofs
   where agent_no = p_agent_no and campaign_id = p_campaign_id and mission_id = p_mission_id
     and ((p_image_hash is not null and image_hash = p_image_hash)
       or (p_original_hash is not null and original_hash = p_original_hash)
       or (p_post_id is not null and post_id = p_post_id))
   order by id desc limit 1;
  if found then
    return jsonb_build_object('success', true, 'id', v_live.id, 'status', v_live.status, 'retry', true);
  end if;

  select coalesce((m ->> 'max_daily')::integer, 1) into v_daily_cap
    from jsonb_array_elements(v_c.missions) m where m ->> 'id' = p_mission_id;
  if p_post_author is not null and exists (
    select 1 from rc_campaign_proofs
     where campaign_id = p_campaign_id and mission_id = p_mission_id
       and agent_no = p_agent_no and vote_day = p_vote_day
       and post_author = p_post_author and status <> 'rejected'
  ) then
    return jsonb_build_object('success', false, 'error', 'x_handle_daily_limit');
  end if;
  if p_status = 'verified' and v_mission ->> 'kind' = 'x_post' then
    if p_post_author is null or not exists (
      select 1 from rc_agent_x_handles
       where campaign_id = p_campaign_id and agent_no = p_agent_no and x_handle = p_post_author
    ) then
      return jsonb_build_object('success', false, 'error', 'x_handle_unregistered');
    end if;
  end if;
  if (select count(*) from rc_campaign_proofs
       where campaign_id = p_campaign_id and mission_id = p_mission_id
         and agent_no = p_agent_no and vote_day = p_vote_day and status <> 'rejected') >= v_daily_cap then
    return jsonb_build_object('success', false, 'error', 'daily_mission_limit', 'limit', v_daily_cap);
  end if;

  if exists (
    select 1 from rc_campaign_proofs
     where (p_image_hash is not null and image_hash = p_image_hash)
        or (p_original_hash is not null and original_hash = p_original_hash)
        or (p_post_id is not null and post_id = p_post_id)
  ) then
    return jsonb_build_object('success', false, 'error', 'duplicate_proof');
  end if;

  insert into rc_campaign_proofs (
    campaign_id, mission_id, agent_no, vote_day, status, checks, client_checks,
    verify_method, verify_note, proof_path, image_hash, original_hash,
    post_id, post_url, post_author, verified_at
  ) values (
    p_campaign_id, p_mission_id, p_agent_no, p_vote_day, p_status,
    coalesce(p_checks, '{}'::jsonb), coalesce(p_client_checks, '{}'::jsonb),
    p_method, p_note, p_proof_path, p_image_hash, p_original_hash,
    p_post_id, p_post_url, p_post_author,
    case when p_status = 'verified' then now() end
  ) returning id into v_id;

  if p_status = 'verified' then
    perform rc_campaign_apply_verified(v_id);
  end if;

  return jsonb_build_object('success', true, 'id', v_id, 'status', p_status);
exception when unique_violation then
  return jsonb_build_object('success', false, 'error', 'duplicate_proof');
end;
$$;


-- ── Status changes ─────────────────────────────────────────────────────
-- The only way a stored proof changes status: a trusted reviewer OCR run
-- (verifying → verified | review) or an admin decision. p_from lists the
-- statuses this caller may move the proof out of; 'verified' is never one of
-- them, so credit is never taken back implicitly.
create or replace function public.rc_campaign_transition(
  p_proof_id bigint, p_from text[], p_to text,
  p_checks jsonb, p_method text, p_actor text, p_note text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p public.rc_campaign_proofs%rowtype;
  v_c public.rc_vote_campaigns%rowtype;
  v_daily_cap integer;
begin
  if p_to not in ('review', 'verified', 'rejected') or 'verified' = any(p_from) then
    return jsonb_build_object('success', false, 'error', 'bad_transition');
  end if;

  select * into v_p from rc_campaign_proofs where id = p_proof_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  if not (v_p.status = any(p_from)) then
    return jsonb_build_object('success', false, 'error', 'status_changed', 'status', v_p.status);
  end if;
  -- The same certificate number already backs another live proof: never
  -- credited twice, not even by a reviewer. (A 'possible' duplicate — same
  -- participation minute only — is a reviewer's call.)
  if p_to = 'verified' and v_p.duplicate_kind = 'certificate' and exists (
    select 1 from rc_campaign_proofs o where o.id = v_p.duplicate_of and o.status <> 'rejected'
  ) then
    return jsonb_build_object('success', false, 'error', 'duplicate_certificate', 'duplicateOf', v_p.duplicate_of);
  end if;
  if p_to = 'verified' and v_p.status = 'rejected' then
    select * into v_c from rc_vote_campaigns where id = v_p.campaign_id;
    select coalesce((m ->> 'max_daily')::integer, 1) into v_daily_cap
      from jsonb_array_elements(v_c.missions) m where m ->> 'id' = v_p.mission_id;
    if (select count(*) from rc_campaign_proofs
         where campaign_id = v_p.campaign_id and mission_id = v_p.mission_id
           and agent_no = v_p.agent_no and vote_day = v_p.vote_day and status <> 'rejected') >= v_daily_cap then
      return jsonb_build_object('success', false, 'error', 'daily_mission_limit', 'limit', v_daily_cap);
    end if;
  end if;
  if p_to = 'verified' and v_p.post_author is not null then
    if not exists (select 1 from rc_agent_x_handles
      where campaign_id = v_p.campaign_id and agent_no = v_p.agent_no and x_handle = v_p.post_author) then
      return jsonb_build_object('success', false, 'error', 'x_handle_unregistered');
    end if;
    if exists (select 1 from rc_campaign_proofs
      where campaign_id = v_p.campaign_id and mission_id = v_p.mission_id
        and agent_no = v_p.agent_no and vote_day = v_p.vote_day
        and post_author = v_p.post_author and status <> 'rejected' and id <> v_p.id) then
      return jsonb_build_object('success', false, 'error', 'x_handle_daily_limit');
    end if;
  end if;

  update rc_campaign_proofs set
    status        = p_to,
    checks        = coalesce(p_checks, checks),
    verify_method = coalesce(p_method, verify_method),
    verify_note   = coalesce(p_note, verify_note),
    verified_at   = case when p_to = 'verified' then now() else verified_at end,
    reviewed_by   = case when p_method = 'admin' then p_actor else reviewed_by end,
    reviewed_at   = case when p_method = 'admin' then now() else reviewed_at end,
    review_note   = case when p_method = 'admin' then p_note else review_note end
  where id = p_proof_id;

  if p_to = 'verified' then
    perform rc_campaign_apply_verified(p_proof_id);
  end if;

  return jsonb_build_object('success', true, 'id', p_proof_id, 'status', p_to);
exception when unique_violation then
  return jsonb_build_object('success', false, 'error', 'duplicate_proof');
end;
$$;


-- ── Shared reward helpers ──────────────────────────────────────────────
-- One weighted pick from a pool [{ kind, weight, amount }], the VMA chest's
-- roll. Only kinds this release can grant are eligible; anything else in a
-- pool is ignored rather than guessed at.
create or replace function public.rc_vote_pick_reward(p_pool jsonb)
returns jsonb
language sql
volatile
set search_path = public, pg_temp
as $$
  with eligible as (
    select r, ord, greatest(0, coalesce((r ->> 'weight')::numeric, 0)) as w
      -- A missing pool, or a JSON null / non-array one, is simply empty.
      from jsonb_array_elements(case when jsonb_typeof(p_pool) = 'array' then p_pool else '[]'::jsonb end) with ordinality as x(r, ord)
     where r ->> 'kind' in ('charge_cell', 'xp', 'streak_freeze', 'extension', 'wings', 'backup_pass')
  ), weighted as (
    select r, ord, sum(w) over (order by ord) as cum, sum(w) over () as total
      from eligible where w > 0
  ), roll as (select random() * max(total) as v from weighted)
  select r from weighted, roll where cum >= roll.v order by ord limit 1
$$;

-- Grants one reward. The same mechanics as rc_supply_chest_open for every
-- kind (columns on rc_players, an rc_xp_ledger row, an rc_player_items
-- row), with the amount from server config and capped at 20 as a backstop.
create or replace function public.rc_vote_grant_reward(
  p_agent_no text, p_kind text, p_amount integer, p_dedup_key text, p_source text, p_meta jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_amount integer := least(greatest(coalesce(p_amount, 1), 1), 20);
begin
  if p_kind = 'charge_cell' then
    update rc_players set charge_cells = coalesce(charge_cells, 0) + v_amount where agent_no = p_agent_no;
  elsif p_kind = 'streak_freeze' then
    update rc_players set streak_freeze_charges = coalesce(streak_freeze_charges, 0) + v_amount where agent_no = p_agent_no;
  elsif p_kind = 'extension' then
    update rc_players set deadline_extension_charges = coalesce(deadline_extension_charges, 0) + v_amount where agent_no = p_agent_no;
  elsif p_kind = 'wings' then
    update rc_players set wings = coalesce(wings, 0) + v_amount where agent_no = p_agent_no;
  elsif p_kind = 'xp' then
    insert into rc_xp_ledger (agent_no, amount, source, dedup_key, meta)
    values (p_agent_no, v_amount, p_source, p_dedup_key, coalesce(p_meta, '{}'::jsonb))
    on conflict (dedup_key) do nothing;
  elsif p_kind = 'backup_pass' then
    insert into rc_player_items (agent_no, item_id)
    select p_agent_no, 'backup-pass' from generate_series(1, v_amount);
  else
    return null;
  end if;
  return jsonb_build_object('kind', p_kind, 'amount', v_amount);
end;
$$;



-- ── Trusted check results, with duplicate-certificate detection ───────
-- Called with the reviewer-run OCR + image result. p_status is the
-- server's own decision from the checks; this function may only make it
-- stricter: a number fingerprint already backing another live proof forces
-- review (and blocks verification, above); the same participation minute
-- on another agent's live proof forces review as a possible duplicate.
-- Fingerprints are optional — when OCR couldn't read the number with
-- confidence, nothing is guessed and the existing checks stand.
create or replace function public.rc_campaign_record_trusted_checks(
  p_proof_id bigint, p_status text, p_checks jsonb, p_note text, p_actor text,
  p_cert_fp text, p_time_fp text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p public.rc_campaign_proofs%rowtype;
  v_claim public.rc_campaign_cert_claims%rowtype;
  v_other bigint;
  v_status text := p_status;
  v_note text := p_note;
begin
  if p_status not in ('verified', 'review') then
    return jsonb_build_object('success', false, 'error', 'bad_status');
  end if;
  select * into v_p from rc_campaign_proofs where id = p_proof_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  if v_p.status <> 'verifying' then
    return jsonb_build_object('success', false, 'error', 'status_changed', 'status', v_p.status);
  end if;

  if p_cert_fp is not null then
    perform pg_advisory_xact_lock(hashtextextended('cert_fp|' || v_p.campaign_id || '|' || p_cert_fp, 0));
    select * into v_claim from rc_campaign_cert_claims where campaign_id = v_p.campaign_id and fingerprint = p_cert_fp;
    if found and v_claim.proof_id <> v_p.id and exists (
      select 1 from rc_campaign_proofs o where o.id = v_claim.proof_id and o.status <> 'rejected'
    ) then
      v_status := 'review';
      v_note := 'duplicate_certificate';
      update rc_campaign_proofs set duplicate_of = v_claim.proof_id, duplicate_kind = 'certificate' where id = v_p.id;
    else
      insert into rc_campaign_cert_claims (campaign_id, fingerprint, proof_id)
      values (v_p.campaign_id, p_cert_fp, v_p.id)
      on conflict (campaign_id, fingerprint) do update set proof_id = excluded.proof_id, claimed_at = now();
    end if;
  end if;

  if p_time_fp is not null and v_note is distinct from 'duplicate_certificate' then
    select o.id into v_other from rc_campaign_proofs o
     where o.campaign_id = v_p.campaign_id and o.cert_time_fingerprint = p_time_fp
       and o.agent_no <> v_p.agent_no and o.status <> 'rejected' and o.id <> v_p.id
     order by o.id limit 1;
    if v_other is not null then
      v_status := 'review';
      v_note := 'possible_duplicate_certificate';
      update rc_campaign_proofs set duplicate_of = v_other, duplicate_kind = 'possible' where id = v_p.id;
    end if;
  end if;

  update rc_campaign_proofs set cert_fingerprint = p_cert_fp, cert_time_fingerprint = p_time_fp where id = v_p.id;
  return rc_campaign_transition(p_proof_id, array['verifying'], v_status, p_checks, 'reviewer_ocr', p_actor, v_note);
end;
$$;

-- ── Opening the Voting Gift ────────────────────────────────────────────
-- The VMA chest open: one lock; check fill, the daily cap and spend the
-- threshold together; N weighted rolls; repeats allowed (every kind here
-- stacks). Fixed from VMA: the daily cap counts KST days, the pool comes
-- from THIS event's config inside the database, and a repeated request id
-- replays the first result instead of opening a second gift.
create or replace function public.rc_vote_gift_open(
  p_campaign_id text, p_agent_no text, p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c public.rc_vote_campaigns%rowtype;
  v_prev public.rc_vote_gift_opens%rowtype;
  v_threshold integer;
  v_cap integer;
  v_rolls integer;
  v_fill integer;
  v_day date := rc_kst_day(now());
  v_open_id bigint;
  v_pick jsonb;
  v_got jsonb;
  v_granted jsonb := '[]'::jsonb;
  i integer;
begin
  if p_request_id is null then
    return jsonb_build_object('success', false, 'error', 'bad_request');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('vote_gift|' || p_campaign_id || '|' || p_agent_no, 0));

  select * into v_prev from rc_vote_gift_opens where request_id = p_request_id;
  if found then
    if v_prev.agent_no <> p_agent_no or v_prev.campaign_id <> p_campaign_id then
      return jsonb_build_object('success', false, 'error', 'bad_request');
    end if;
    return jsonb_build_object('success', true, 'replay', true, 'rewards', v_prev.rewards);
  end if;

  select * into v_c from rc_vote_campaigns where id = p_campaign_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'campaign_not_found');
  end if;
  v_threshold := coalesce((v_c.gift ->> 'threshold')::integer, 0);
  v_cap := coalesce((v_c.gift ->> 'daily_open_cap')::integer, 0);
  v_rolls := least(greatest(coalesce((v_c.gift ->> 'rolls')::integer, 3), 1), 5);
  if v_threshold <= 0 or rc_vote_pick_reward(v_c.gift -> 'pool') is null then
    return jsonb_build_object('success', false, 'error', 'gift_not_ready');
  end if;

  select fill into v_fill from rc_vote_gift_progress
   where campaign_id = p_campaign_id and agent_no = p_agent_no for update;
  if coalesce(v_fill, 0) < v_threshold then
    return jsonb_build_object('success', false, 'error', 'not_enough_fill');
  end if;
  if v_cap > 0 and (
    select count(*) from rc_vote_gift_opens
     where campaign_id = p_campaign_id and agent_no = p_agent_no and kst_day = v_day
  ) >= v_cap then
    return jsonb_build_object('success', false, 'error', 'daily_limit');
  end if;

  insert into rc_vote_gift_opens (campaign_id, agent_no, request_id, kst_day, spent)
  values (p_campaign_id, p_agent_no, p_request_id, v_day, v_threshold)
  returning id into v_open_id;

  for i in 1..v_rolls loop
    v_pick := rc_vote_pick_reward(v_c.gift -> 'pool');
    exit when v_pick is null;
    v_got := rc_vote_grant_reward(p_agent_no, v_pick ->> 'kind', (v_pick ->> 'amount')::integer,
      'vote-gift:' || v_open_id || ':' || i, 'vote_gift',
      jsonb_build_object('campaignId', p_campaign_id, 'openId', v_open_id));
    if v_got is not null then v_granted := v_granted || v_got; end if;
  end loop;

  update rc_vote_gift_opens set rewards = v_granted where id = v_open_id;
  update rc_vote_gift_progress set fill = fill - v_threshold, updated_at = now()
   where campaign_id = p_campaign_id and agent_no = p_agent_no;

  return jsonb_build_object('success', true, 'rewards', v_granted, 'fillRemaining', v_fill - v_threshold);
end;
$$;


-- ── Community total (database-side aggregate, never summed in JS) ──────
create or replace function public.rc_campaign_verified_total(p_campaign_id text)
returns bigint language sql stable
set search_path = public, pg_temp
as $$ select count(*) from rc_campaign_proofs where campaign_id = p_campaign_id and status = 'verified' $$;



-- ── Team battle: HOOLIGANS vs ALIENS ───────────────────────────────────
-- A friendly ReConnect competition inside the event; every verified vote
-- still supports BTS. The same proven shape as the RE:CELEBRATE team
-- choice (20260919170000), in its own MAMA tables:
--   start   stamps started_at ONCE, so a refresh / second device continues
--           the same countdown instead of restarting it;
--   choose  locks the pick only while still inside the window
--           (choose_seconds + 2s network grace);
--   resolve after the window with no pick, assigns the smaller team
--           (random on an exact tie). One per-event advisory lock
--           serializes every team write, so simultaneous timeouts are
--           counted one after another and can't all pile onto one side.
-- A team, once set, never changes for the event.
create table if not exists public.rc_campaign_teams (
  campaign_id  text not null references public.rc_vote_campaigns (id),
  agent_no     text not null references public.rc_agents (agent_no) on delete cascade,
  team         text check (team ~ '^[a-z0-9_]{1,24}$'),
  assigned_via text check (assigned_via in ('choice', 'timeout')),
  started_at   timestamptz not null default now(),
  assigned_at  timestamptz,
  primary key (campaign_id, agent_no),
  constraint rc_campaign_teams_set_together check ((team is null) = (assigned_via is null))
);
create index if not exists rc_campaign_teams_team_idx on public.rc_campaign_teams (campaign_id, team);

create or replace function public.rc_campaign_team_window(p_campaign_id text)
returns interval language sql stable
set search_path = public, pg_temp
as $$
  select make_interval(secs => coalesce((battle ->> 'choose_seconds')::integer, 7) + 2)
    from rc_vote_campaigns where id = p_campaign_id
$$;

create or replace function public.rc_campaign_team_state(p_campaign_id text, p_agent_no text)
returns jsonb language sql stable
set search_path = public, pg_temp
as $$
  select coalesce((
    select jsonb_build_object('team', t.team, 'via', t.assigned_via, 'startedAt', t.started_at,
      'deadline', t.started_at + make_interval(secs => coalesce((c.battle ->> 'choose_seconds')::integer, 7)))
      from rc_campaign_teams t join rc_vote_campaigns c on c.id = t.campaign_id
     where t.campaign_id = p_campaign_id and t.agent_no = p_agent_no
  ), jsonb_build_object('team', null, 'startedAt', null))
$$;

create or replace function public.rc_campaign_team_resolve(p_campaign_id text, p_agent_no text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.rc_campaign_teams%rowtype;
  v_pick text;
begin
  perform pg_advisory_xact_lock(hashtextextended('vote_team|' || p_campaign_id, 0));
  select * into v_row from rc_campaign_teams where campaign_id = p_campaign_id and agent_no = p_agent_no;
  if found and v_row.team is null and now() > v_row.started_at + rc_campaign_team_window(p_campaign_id) then
    -- Smallest team first; random among exact ties.
    select t ->> 'id' into v_pick
      from rc_vote_campaigns c, jsonb_array_elements(c.battle -> 'teams') t
     where c.id = p_campaign_id
     order by (select count(*) from rc_campaign_teams x
                where x.campaign_id = p_campaign_id and x.team = t ->> 'id'), random()
     limit 1;
    if v_pick is not null then
      update rc_campaign_teams set team = v_pick, assigned_via = 'timeout', assigned_at = now()
       where campaign_id = p_campaign_id and agent_no = p_agent_no and team is null;
    end if;
  end if;
  return rc_campaign_team_state(p_campaign_id, p_agent_no);
end;
$$;

create or replace function public.rc_campaign_team_start(p_campaign_id text, p_agent_no text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from rc_vote_campaigns where id = p_campaign_id and active
                  and coalesce((battle ->> 'enabled')::boolean, false)) then
    return jsonb_build_object('team', null, 'error', 'battle_off');
  end if;
  insert into rc_campaign_teams (campaign_id, agent_no) values (p_campaign_id, p_agent_no)
  on conflict (campaign_id, agent_no) do nothing;
  return rc_campaign_team_resolve(p_campaign_id, p_agent_no);
end;
$$;

create or replace function public.rc_campaign_team_choose(p_campaign_id text, p_agent_no text, p_team text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('vote_team|' || p_campaign_id, 0));
  if not exists (
    select 1 from rc_vote_campaigns c, jsonb_array_elements(c.battle -> 'teams') t
     where c.id = p_campaign_id and t ->> 'id' = p_team
  ) then
    return jsonb_build_object('team', null, 'error', 'team_invalid');
  end if;
  update rc_campaign_teams set team = p_team, assigned_via = 'choice', assigned_at = now()
   where campaign_id = p_campaign_id and agent_no = p_agent_no and team is null
     and now() <= started_at + rc_campaign_team_window(p_campaign_id);
  -- Too late (or never started): the timeout rule decides instead.
  return rc_campaign_team_resolve(p_campaign_id, p_agent_no);
end;
$$;

-- Scores are counted, never stored: one point per verified proof that the
-- server stamped with a team (rc_campaign_apply_verified). The stamp is set
-- once, before the freeze, so the score can't move after it.
create or replace function public.rc_campaign_battle_total(p_campaign_id text)
returns bigint language sql stable
set search_path = public, pg_temp
as $$
  select count(*) from rc_campaign_proofs
   where campaign_id = p_campaign_id and status = 'verified' and battle_team is not null
$$;

create or replace function public.rc_campaign_battle_state(p_campaign_id text, p_agent_no text)
returns jsonb language sql stable
set search_path = public, pg_temp
as $$
  with c as (
    select battle, coalesce((battle ->> 'freeze_at')::timestamptz, closes_at) as freeze_at
      from rc_vote_campaigns where id = p_campaign_id
  ), pts as (
    select agent_no, battle_team as team from rc_campaign_proofs
     where campaign_id = p_campaign_id and status = 'verified' and battle_team is not null
  ), teams as (
    select tm ->> 'id' as id, (select count(*) from pts where pts.team = tm ->> 'id') as points
      from c, jsonb_array_elements(c.battle -> 'teams') tm
  )
  select jsonb_build_object(
    'total', (select count(*) from pts),
    'teams', coalesce((select jsonb_object_agg(id, points) from teams), '{}'::jsonb),
    'teamSizes', coalesce((
      select jsonb_object_agg(tm ->> 'id', (select count(*) from rc_campaign_teams x
        where x.campaign_id = p_campaign_id and x.team = tm ->> 'id'))
        from c, jsonb_array_elements(c.battle -> 'teams') tm
    ), '{}'::jsonb),
    'mine', (select count(*) from pts where agent_no = p_agent_no),
    'freezeAt', (select freeze_at from c),
    'frozen', (select now() > freeze_at from c),
    -- Every team on the top score wins, so a tie gives two winners.
    'winners', case when (select now() > freeze_at from c) then coalesce((
      select jsonb_agg(id order by id) from teams where points = (select max(points) from teams)
    ), '[]'::jsonb) end
  )
$$;


-- ── Battle Gifts (community milestones) ────────────────────────────────
-- The VMA Group Supply Chest idea, fixed: milestones are ABSOLUTE verified
-- totals for this event (no baseline offset), the total is counted in the
-- database, only agents with at least one verified MAMA mission can claim,
-- each agent claims each milestone once, and a retried request replays.
create table if not exists public.rc_battle_gift_claims (
  campaign_id     text not null references public.rc_vote_campaigns (id),
  agent_no        text not null references public.rc_agents (agent_no) on delete cascade,
  milestone_index integer not null check (milestone_index >= 0),
  request_id      uuid not null unique,
  rewards         jsonb not null default '[]'::jsonb,
  claimed_at      timestamptz not null default now(),
  primary key (campaign_id, agent_no, milestone_index)
);

create or replace function public.rc_battle_gift_claim(
  p_campaign_id text, p_agent_no text, p_milestone_index integer, p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c public.rc_vote_campaigns%rowtype;
  v_prev public.rc_battle_gift_claims%rowtype;
  v_target integer;
  v_min integer;
  v_max integer;
  v_rolls integer;
  v_pick jsonb;
  v_got jsonb;
  v_granted jsonb := '[]'::jsonb;
  i integer;
begin
  if p_request_id is null or p_milestone_index is null then
    return jsonb_build_object('success', false, 'error', 'bad_request');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('battle_gift|' || p_campaign_id || '|' || p_agent_no, 0));

  select * into v_prev from rc_battle_gift_claims where request_id = p_request_id;
  if found then
    if v_prev.agent_no <> p_agent_no or v_prev.campaign_id <> p_campaign_id or v_prev.milestone_index <> p_milestone_index then
      return jsonb_build_object('success', false, 'error', 'bad_request');
    end if;
    return jsonb_build_object('success', true, 'replay', true, 'rewards', v_prev.rewards);
  end if;
  if exists (select 1 from rc_battle_gift_claims
              where campaign_id = p_campaign_id and agent_no = p_agent_no and milestone_index = p_milestone_index) then
    return jsonb_build_object('success', false, 'error', 'already_claimed');
  end if;

  select * into v_c from rc_vote_campaigns where id = p_campaign_id;
  v_target := case when jsonb_typeof(v_c.battle -> 'milestones') = 'array'
                   then (v_c.battle -> 'milestones' ->> p_milestone_index)::integer end;
  if v_target is null or rc_vote_pick_reward(v_c.battle -> 'gift' -> 'pool') is null then
    return jsonb_build_object('success', false, 'error', 'not_configured');
  end if;
  -- The battle total (team-stamped, frozen at freeze_at) is what unlocks a
  -- milestone, so nothing verified after the freeze can open another one.
  if rc_campaign_battle_total(p_campaign_id) < v_target then
    return jsonb_build_object('success', false, 'error', 'not_reached');
  end if;
  if not exists (select 1 from rc_campaign_proofs
                  where campaign_id = p_campaign_id and agent_no = p_agent_no and status = 'verified') then
    return jsonb_build_object('success', false, 'error', 'not_contributor');
  end if;

  insert into rc_battle_gift_claims (campaign_id, agent_no, milestone_index, request_id)
  values (p_campaign_id, p_agent_no, p_milestone_index, p_request_id);

  v_min := least(greatest(coalesce((v_c.battle -> 'gift' ->> 'rolls_min')::integer, 1), 1), 5);
  v_max := least(greatest(coalesce((v_c.battle -> 'gift' ->> 'rolls_max')::integer, v_min), v_min), 5);
  v_rolls := v_min + floor(random() * (v_max - v_min + 1))::integer;
  for i in 1..v_rolls loop
    v_pick := rc_vote_pick_reward(v_c.battle -> 'gift' -> 'pool');
    exit when v_pick is null;
    v_got := rc_vote_grant_reward(p_agent_no, v_pick ->> 'kind', (v_pick ->> 'amount')::integer,
      'battle-gift:' || p_campaign_id || ':' || p_agent_no || ':' || p_milestone_index || ':' || i, 'battle_gift',
      jsonb_build_object('campaignId', p_campaign_id, 'milestone', p_milestone_index));
    if v_got is not null then v_granted := v_granted || v_got; end if;
  end loop;

  update rc_battle_gift_claims set rewards = v_granted
   where campaign_id = p_campaign_id and agent_no = p_agent_no and milestone_index = p_milestone_index;
  return jsonb_build_object('success', true, 'rewards', v_granted);
end;
$$;


-- ── Winner reward ─────────────────────────────────────────────────────
-- After the freeze, every agent who scored at least one point for a winning
-- team (both teams on a tie) can claim the event's winner_reward once.
-- Nothing is taken from anyone; the losing team keeps every Battle Gift.
create table if not exists public.rc_battle_winner_claims (
  campaign_id text not null references public.rc_vote_campaigns (id),
  agent_no    text not null references public.rc_agents (agent_no) on delete cascade,
  team        text not null,
  request_id  uuid not null unique,
  rewards     jsonb not null default '[]'::jsonb,
  claimed_at  timestamptz not null default now(),
  primary key (campaign_id, agent_no)
);

create or replace function public.rc_battle_winner_claim(
  p_campaign_id text, p_agent_no text, p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c public.rc_vote_campaigns%rowtype;
  v_prev public.rc_battle_winner_claims%rowtype;
  v_state jsonb;
  v_team text;
  v_item jsonb;
  v_got jsonb;
  v_granted jsonb := '[]'::jsonb;
  i integer := 0;
begin
  if p_request_id is null then
    return jsonb_build_object('success', false, 'error', 'bad_request');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('battle_winner|' || p_campaign_id || '|' || p_agent_no, 0));

  select * into v_prev from rc_battle_winner_claims where request_id = p_request_id;
  if found then
    if v_prev.agent_no <> p_agent_no or v_prev.campaign_id <> p_campaign_id then
      return jsonb_build_object('success', false, 'error', 'bad_request');
    end if;
    return jsonb_build_object('success', true, 'replay', true, 'rewards', v_prev.rewards);
  end if;
  if exists (select 1 from rc_battle_winner_claims where campaign_id = p_campaign_id and agent_no = p_agent_no) then
    return jsonb_build_object('success', false, 'error', 'already_claimed');
  end if;

  select * into v_c from rc_vote_campaigns where id = p_campaign_id;
  if jsonb_typeof(v_c.battle -> 'winner_reward') is distinct from 'array'
     or jsonb_array_length(v_c.battle -> 'winner_reward') = 0 then
    return jsonb_build_object('success', false, 'error', 'not_configured');
  end if;
  v_state := rc_campaign_battle_state(p_campaign_id, p_agent_no);
  if not coalesce((v_state ->> 'frozen')::boolean, false) then
    return jsonb_build_object('success', false, 'error', 'not_final');
  end if;
  -- The team the agent actually scored for (all their points share one
  -- team, since a team never changes).
  select battle_team into v_team from rc_campaign_proofs
   where campaign_id = p_campaign_id and agent_no = p_agent_no and status = 'verified' and battle_team is not null
   limit 1;
  if v_team is null then
    return jsonb_build_object('success', false, 'error', 'not_contributor');
  end if;
  if not (v_state -> 'winners') ? v_team then
    return jsonb_build_object('success', false, 'error', 'not_winner');
  end if;

  insert into rc_battle_winner_claims (campaign_id, agent_no, team, request_id)
  values (p_campaign_id, p_agent_no, v_team, p_request_id);
  for v_item in select * from jsonb_array_elements(v_c.battle -> 'winner_reward') loop
    i := i + 1;
    v_got := rc_vote_grant_reward(p_agent_no, v_item ->> 'kind', (v_item ->> 'amount')::integer,
      'battle-winner:' || p_campaign_id || ':' || p_agent_no || ':' || i, 'battle_winner',
      jsonb_build_object('campaignId', p_campaign_id, 'team', v_team));
    if v_got is not null then v_granted := v_granted || v_got; end if;
  end loop;
  update rc_battle_winner_claims set rewards = v_granted where campaign_id = p_campaign_id and agent_no = p_agent_no;
  return jsonb_build_object('success', true, 'rewards', v_granted, 'team', v_team);
end;
$$;


-- ── BTS X Vote Pulse ───────────────────────────────────────────────────
-- A shared, cached running count of tracked public vote posts, for display
-- only. Nothing in this section is read by any proof, reward, gift, streak
-- or badge function above, and nothing above writes to it.
--
-- Only aggregates are stored: a running total, the previous total (for the
-- delta), the newest post id seen (the collection cursor — a number, not a
-- person) and run bookkeeping. No usernames, no post text.
create table if not exists public.rc_vote_pulse (
  campaign_id        text primary key references public.rc_vote_campaigns (id),
  total_count        bigint not null default 0 check (total_count >= 0),
  previous_count     bigint,
  cursor_post_id     numeric,                          -- newest tracked post id
  complete           boolean not null default true,    -- false once any run hit its cap
  last_success_at    timestamptz,
  last_attempt_at    timestamptz,
  last_status        text check (last_status in ('ok', 'partial', 'failed', 'exhausted')),
  pending_run_id     text,                             -- provider run being collected
  pending_started_at timestamptz,
  spent_usd          numeric(10, 4) not null default 0,
  updated_at         timestamptz not null default now()
);

create table if not exists public.rc_vote_pulse_runs (
  id           bigint generated always as identity primary key,
  campaign_id  text not null references public.rc_vote_campaigns (id),
  run_ref      text,
  status       text not null check (status in ('ok', 'partial', 'failed', 'exhausted')),
  fetched      integer not null default 0,
  counted      integer not null default 0,
  cost_usd     numeric(10, 4) not null default 0,
  note         text,
  finished_at  timestamptz not null default now()
);
create unique index if not exists rc_vote_pulse_runs_ref_key
  on public.rc_vote_pulse_runs (campaign_id, run_ref) where run_ref is not null;

comment on table public.rc_vote_pulse is
  'BTS X Vote Pulse: cached aggregate of tracked public vote posts. Display only — an unofficial lower bound, never used for verification or rewards.';

-- Claims the collector slot for one provider run. Refuses while another run
-- is still pending, so two schedules can never count the same window.
create or replace function public.rc_vote_pulse_begin(p_campaign_id text, p_run_ref text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v public.rc_vote_pulse%rowtype;
begin
  insert into rc_vote_pulse (campaign_id) values (p_campaign_id) on conflict (campaign_id) do nothing;
  select * into v from rc_vote_pulse where campaign_id = p_campaign_id for update;
  if v.pending_run_id is not null then
    return jsonb_build_object('success', false, 'error', 'run_pending', 'runRef', v.pending_run_id);
  end if;
  update rc_vote_pulse set pending_run_id = p_run_ref, pending_started_at = now(),
         last_attempt_at = now(), updated_at = now()
   where campaign_id = p_campaign_id;
  return jsonb_build_object('success', true);
end;
$$;

-- Records a finished run. Idempotent per run_ref. A successful run ADDS its
-- new posts (never subtracts); a failed or exhausted run changes nothing
-- but the status, so the last good count is always what players see.
create or replace function public.rc_vote_pulse_finish(
  p_campaign_id text, p_run_ref text, p_status text, p_counted integer,
  p_newest_post_id numeric, p_complete boolean, p_fetched integer, p_cost_usd numeric, p_note text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v public.rc_vote_pulse%rowtype;
begin
  if p_status not in ('ok', 'partial', 'failed', 'exhausted') then
    return jsonb_build_object('success', false, 'error', 'bad_status');
  end if;
  insert into rc_vote_pulse (campaign_id) values (p_campaign_id) on conflict (campaign_id) do nothing;
  select * into v from rc_vote_pulse where campaign_id = p_campaign_id for update;

  if p_run_ref is not null and exists (
    select 1 from rc_vote_pulse_runs where campaign_id = p_campaign_id and run_ref = p_run_ref
  ) then
    return jsonb_build_object('success', true, 'replay', true, 'total', v.total_count);
  end if;
  if p_run_ref is not null and v.pending_run_id is distinct from p_run_ref then
    return jsonb_build_object('success', false, 'error', 'not_pending');
  end if;

  insert into rc_vote_pulse_runs (campaign_id, run_ref, status, fetched, counted, cost_usd, note)
  values (p_campaign_id, p_run_ref, p_status, greatest(coalesce(p_fetched, 0), 0),
          case when p_status in ('ok', 'partial') then greatest(coalesce(p_counted, 0), 0) else 0 end,
          greatest(coalesce(p_cost_usd, 0), 0), p_note);

  if p_status in ('ok', 'partial') then
    update rc_vote_pulse set
      previous_count  = total_count,
      total_count     = total_count + greatest(coalesce(p_counted, 0), 0),
      cursor_post_id  = greatest(coalesce(cursor_post_id, 0), coalesce(p_newest_post_id, 0)),
      complete        = complete and coalesce(p_complete, false) and p_status = 'ok',
      last_success_at = now()
     where campaign_id = p_campaign_id;
  end if;
  update rc_vote_pulse set
    last_status = p_status, last_attempt_at = now(),
    spent_usd = spent_usd + greatest(coalesce(p_cost_usd, 0), 0),
    pending_run_id = case when p_run_ref is null or pending_run_id = p_run_ref then null else pending_run_id end,
    pending_started_at = case when p_run_ref is null or pending_run_id = p_run_ref then null else pending_started_at end,
    updated_at = now()
   where campaign_id = p_campaign_id;

  select * into v from rc_vote_pulse where campaign_id = p_campaign_id;
  return jsonb_build_object('success', true, 'total', v.total_count, 'status', v.last_status);
end;
$$;

-- ── Retention ──────────────────────────────────────────────────────────
-- Producer: proof files of campaigns that closed more than p_days ago.
-- Queue only; the row keeps its path until Storage confirms deletion.
create or replace function public.rc_queue_expired_campaign_proofs(
  p_days integer default 30, p_limit integer default 5000
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer;
begin
  insert into rc_storage_deletion_queue (bucket, path, reason)
  select p.proof_path_q, p.proof_path, 'vote_proof_expired'
    from (
      select 'campaign-proofs'::text as proof_path_q, pr.proof_path
        from rc_campaign_proofs pr
        join rc_vote_campaigns c on c.id = pr.campaign_id
       where pr.proof_path is not null
         and now() >= c.closes_at + make_interval(days => p_days)
       order by pr.id
       limit p_limit
    ) p
  on conflict (bucket, path) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Producer 2, extended: everything one agent uploaded. Called first thing
-- in rc_purge_agent_data, before any of their rows go. The vma-vote-proofs
-- statement is unchanged from 20260928060000; the campaign statement is new.
-- (rc_campaign_proofs rows then go with rc_agents through ON DELETE CASCADE.)
create or replace function public.rc_queue_agent_proof_files(p_agent_no text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer; m integer;
begin
  insert into rc_storage_deletion_queue (bucket, path, reason)
  select distinct 'vma-vote-proofs', v.proof_path, 'agent_purged'
    from rc_vma_votes v
   where v.agent_no = p_agent_no
     and v.proof_path is not null
     -- Never delete a file another agent's vote still points at.
     and not exists (
       select 1 from rc_vma_votes o
        where o.proof_path = v.proof_path and o.agent_no <> p_agent_no
     )
  on conflict (bucket, path) do nothing;
  get diagnostics n = row_count;

  insert into rc_storage_deletion_queue (bucket, path, reason)
  select distinct 'campaign-proofs', p.proof_path, 'agent_purged'
    from rc_campaign_proofs p
   where p.agent_no = p_agent_no and p.proof_path is not null
  on conflict (bucket, path) do nothing;
  get diagnostics m = row_count;
  return n + m;
end;
$$;

-- Step three, extended: clear references only to files Storage confirmed
-- gone. The VMA statement is unchanged from 20260928060000. Hashes are kept
-- on both tables for the same reason given there (duplicate-proof blocking).
create or replace function public.rc_clear_expired_proof_refs(p_limit integer default 5000)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n integer; m integer;
begin
  with gone as (
    select q.path
      from rc_storage_deletion_queue q
     where q.bucket = 'vma-vote-proofs'
       and q.deleted_at is not null
       and q.reason <> 'qa'      -- a rehearsal never touches rc_vma_votes
     limit p_limit
  )
  update rc_vma_votes v
     set proof_path = null, ocr_text = null
    from gone
   where v.proof_path = gone.path;
  get diagnostics n = row_count;

  with gone as (
    select q.path
      from rc_storage_deletion_queue q
     where q.bucket = 'campaign-proofs'
       and q.deleted_at is not null
       and q.reason <> 'qa'
     limit p_limit
  )
  update rc_campaign_proofs p
     set proof_path = null
    from gone
   where p.proof_path = gone.path;
  get diagnostics m = row_count;
  return n + m;
end;
$$;


-- ── Lockdown ───────────────────────────────────────────────────────────
-- Same as 20260819140000: service role only, fixed search_path.
alter table public.rc_vote_campaigns enable row level security;
alter table public.rc_campaign_proofs enable row level security;
alter table public.rc_agent_x_handles enable row level security;
alter table public.rc_vote_gift_progress enable row level security;
alter table public.rc_vote_gift_fills enable row level security;
alter table public.rc_vote_gift_opens enable row level security;
alter table public.rc_campaign_teams enable row level security;
alter table public.rc_campaign_cert_claims enable row level security;
alter table public.rc_battle_gift_claims enable row level security;
alter table public.rc_battle_winner_claims enable row level security;
alter table public.rc_vote_pulse enable row level security;
alter table public.rc_vote_pulse_runs enable row level security;
revoke all on table
  public.rc_vote_campaigns, public.rc_campaign_proofs, public.rc_agent_x_handles,
  public.rc_vote_gift_progress, public.rc_vote_gift_fills, public.rc_vote_gift_opens,
  public.rc_campaign_teams, public.rc_campaign_cert_claims, public.rc_battle_gift_claims, public.rc_battle_winner_claims,
  public.rc_vote_pulse, public.rc_vote_pulse_runs
from anon, authenticated;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'rc_kst_day', 'rc_campaign_apply_verified', 'rc_campaign_submit_proof', 'rc_campaign_register_x_handle',
       'rc_campaign_transition', 'rc_campaign_record_trusted_checks', 'rc_vote_pick_reward', 'rc_vote_grant_reward',
       'rc_vote_gift_open', 'rc_campaign_verified_total',
       'rc_campaign_team_window', 'rc_campaign_team_state', 'rc_campaign_team_resolve',
       'rc_campaign_team_start', 'rc_campaign_team_choose', 'rc_campaign_battle_state',
       'rc_battle_gift_claim', 'rc_campaign_battle_total', 'rc_battle_winner_claim',
       'rc_vote_pulse_begin', 'rc_vote_pulse_finish',
       'rc_queue_expired_campaign_proofs', 'rc_queue_agent_proof_files',
       'rc_clear_expired_proof_refs'
     )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;


-- ── MAMA 2026 badge template (art via Badge Makers) ────────────────────
-- Awarded by rc_campaign_apply_verified after verified votes on 5 different
-- KST days. Never part of a Voting Gift or Battle Gift roll.
insert into public.rc_badge_catalog (id, section, rarity, name, unlock_hint, sort_order, active)
values ('event_mama_2026', 'event', 'rare', 'MAMA 2026',
        'Verified MAMA 2026 votes on 5 different days during Fans'' Choice Round 1.', 150, true)
on conflict (id) do update set
  name = excluded.name, unlock_hint = excluded.unlock_hint, active = true;


-- ── MAMA 2026 ──────────────────────────────────────────────────────────
-- Window: the official Round 1 schedule (@MnetMAMA 1st VOTE GUIDE),
-- 26.10.12 19:00 – 26.10.22 23:59 KST. Oct 12 is a partial KST day; it is
-- still one voting day for credit, streaks and the badge.
--
-- Voting Gift (approved): the VMA Supply Chest model. +1 fill per verified
-- mission, threshold 5, leftover carries over, 2 opens per KST day, 3
-- weighted rolls per open: Charge Cell 30, XP(10) 20, Streak Freeze 15,
-- Extension 10, Wings 15, Backup Pass 10. No per-mission XP.
-- MAMA badge: verified votes on 5 different KST days.
--
-- Battle (approved): HOOLIGANS vs ALIENS, 7-second choice, +1 point per
-- verified mission for an agent already on a team. Frozen Oct 23 12:00 KST:
-- scores, the community total, milestones and the winner stop moving then.
-- Battle Gifts at 200 · 500 · 900 · 1,400 · 2,200 community points, 1–2 rolls:
-- Charge Cell 32, XP(10) 26, Wings 17, Streak Freeze 15, Extension 6,
-- Backup Pass 4. Winner reward: +20 XP + 1 Charge Cell for contributors on
-- the winning team (both teams on a tie).
--
-- BTS X Vote Pulse ships DISABLED until a real free Apify token proves the
-- actor runs through the API. Reposts are not excluded: fan guides for
-- 2024–25 count a repost or quote post as that account's daily vote.
--
-- Mnet: the official Round 1 vote link, and the launch reference
-- certificate ("VOTING CERTIFICATE", "FANS' CHOICE Category 1st VOTE",
-- "Participation Date …", issued by Mnet Plus). The certificate never
-- prints "BTS"; the BTS artist image is matched separately (bts-tile-match.js).
-- X: #2026MAMAVOTE + #BTS, both required, case-insensitive; the Pulse
-- query uses the same list, reposts included.
insert into public.rc_vote_campaigns (id, title, round_label, opens_at, closes_at, missions, rewards, gift, battle, pulse)
values (
  'mama_2026', 'MAMA 2026', 'Fans'' Choice · Round 1',
  '2026-10-12T19:00:00+09:00', '2026-10-22T23:59:59+09:00',
  '[
    {
      "id": "mnet", "kind": "mnet_certificate", "label": "Mnet Vote", "max_daily": 3,
      "vote_url": "https://mnetplus.world/event/2026-mama?deeplink=mnetplus%3A%2F%2Fvote%2Ftemplates%2Fmama-fans-choice-vote-r1%2F6ab09532c314bb17315adc4e%3Furl_fallback_type%3Dupdate&missionType=MAMA_2026_FANS_CHOICE_VOTE_1ST_SHARE&refererCode=",
      "certificate": {
        "title_keywords": ["voting certificate"],
        "structure_keywords": ["participation date"],
        "issuer_keywords": ["mnet plus", "mnetplus"],
        "category_keywords": ["fans'' choice category 1st vote", "fans choice category 1st vote"]
      }
    },
    {
      "id": "x", "kind": "x_post", "label": "X Vote", "max_daily": 3, "max_handles": 3,
      "hashtags": ["2026MAMAVOTE", "BTS"],
      "require_handle_match": true
    }
  ]'::jsonb,
  '{"badge_template_id": "event_mama_2026", "badge_verified_days": 5}'::jsonb,
  '{"name": "Voting Gift", "fill_per_verified": 1, "threshold": 5, "daily_open_cap": 2, "rolls": 3,
    "pool": [
      {"kind": "charge_cell", "weight": 30, "amount": 1},
      {"kind": "xp", "weight": 20, "amount": 10},
      {"kind": "streak_freeze", "weight": 15, "amount": 1},
      {"kind": "extension", "weight": 10, "amount": 1},
      {"kind": "wings", "weight": 15, "amount": 1},
      {"kind": "backup_pass", "weight": 10, "amount": 1}
    ]}'::jsonb,
  '{"enabled": true, "choose_seconds": 7,
    "teams": [{"id": "hooligans", "label": "HOOLIGANS"}, {"id": "aliens", "label": "ALIENS"}],
    "freeze_at": "2026-10-23T12:00:00+09:00", "final_visible_hours": 48,
    "milestones": [200, 500, 900, 1400, 2200],
    "gift": {"name": "Battle Gift", "rolls_min": 1, "rolls_max": 2, "pool": [
      {"kind": "charge_cell", "weight": 32, "amount": 1},
      {"kind": "xp", "weight": 26, "amount": 10},
      {"kind": "wings", "weight": 17, "amount": 1},
      {"kind": "streak_freeze", "weight": 15, "amount": 1},
      {"kind": "extension", "weight": 6, "amount": 1},
      {"kind": "backup_pass", "weight": 4, "amount": 1}
    ]},
    "winner_reward": [{"kind": "xp", "amount": 20}, {"kind": "charge_cell", "amount": 1}]}'::jsonb,
  '{"enabled": false, "provider": "apify", "actor": "xquik~x-tweet-scraper",
    "price_per_1000_usd": 0.15, "max_items_per_run": 600, "budget_usd": 4.00,
    "collect_until_hours_after_close": 12, "exclude_retweets": false}'::jsonb
)
on conflict (id) do nothing;

commit;
