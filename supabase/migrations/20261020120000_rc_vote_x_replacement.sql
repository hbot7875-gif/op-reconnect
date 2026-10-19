-- MAMA voting: replace a suspended, deleted or inaccessible X account
-- without losing the votes it already earned.
--
-- * rc_agent_x_handles gains retired_at / replaced_by. A retired account is
--   never deleted: its proofs, voting days, gift fills and team points stay
--   exactly as they are, and it stays owned by its agent so nobody else can
--   link it. It no longer counts toward the 3 active accounts and can't earn
--   new credit (a post submitted after retirement can't be verified).
-- * rc_x_handle_replacements: the player's request (old account, new account,
--   a reason from a fixed list and an optional short note — never a password
--   or login detail) and the admin decision. Approval retires the old account
--   and links the new one in the same transaction, so the active count never
--   goes above the limit.
-- * Rotation limits: one request waiting per agent, a capped number of
--   approved replacements per event (mission max_replacements, default 1),
--   an account can be replaced only once, and a new account must never have
--   been linked by anyone this event.
-- * The X daily limits are untouched: 3 per agent per day across every
--   account (retired ones included) and one per account per day.
-- No existing proof, credit or reward row is changed.

alter table public.rc_agent_x_handles add column if not exists retired_at timestamptz;
alter table public.rc_agent_x_handles add column if not exists replaced_by text;

create table if not exists public.rc_x_handle_replacements (
  id          bigserial primary key,
  campaign_id text not null references public.rc_vote_campaigns (id),
  agent_no    text not null references public.rc_agents (agent_no) on delete cascade,
  old_handle  text not null check (old_handle ~ '^[a-z0-9_]{1,15}$'),
  new_handle  text not null check (new_handle ~ '^[a-z0-9_]{1,15}$'),
  reason      text not null check (reason in ('suspended', 'deleted', 'locked', 'other')),
  note        text check (char_length(note) <= 200),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  text,
  admin_note  text check (char_length(admin_note) <= 300),
  check (old_handle <> new_handle)
);
create unique index if not exists rc_x_handle_replacements_one_pending
  on public.rc_x_handle_replacements (campaign_id, agent_no) where status = 'pending';
create unique index if not exists rc_x_handle_replacements_new_pending
  on public.rc_x_handle_replacements (campaign_id, new_handle) where status = 'pending';
create unique index if not exists rc_x_handle_replacements_old_once
  on public.rc_x_handle_replacements (campaign_id, old_handle) where status in ('pending', 'approved');
create index if not exists rc_x_handle_replacements_queue
  on public.rc_x_handle_replacements (campaign_id, status, created_at);

comment on table public.rc_x_handle_replacements is
  'Player requests to replace an inaccessible X account that already carries votes, and the admin decision. Reason is a fixed code plus an optional short note; no credentials. Never shown publicly.';

alter table public.rc_x_handle_replacements enable row level security;
revoke all on table public.rc_x_handle_replacements from anon, authenticated;
revoke all on sequence public.rc_x_handle_replacements_id_seq from anon, authenticated;

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
    if v_owner = p_agent_no and exists (select 1 from rc_agent_x_handles
        where campaign_id = p_campaign_id and x_handle = p_x_handle and retired_at is not null) then
      return jsonb_build_object('success', false, 'error', 'x_handle_retired');
    end if;
    if v_owner = p_agent_no then
      return jsonb_build_object('success', true, 'xHandle', p_x_handle, 'replay', true);
    end if;
    return jsonb_build_object('success', false, 'error', 'x_handle_taken');
  end if;
  -- Asked for by someone in a replacement that is still waiting: not free.
  if exists (select 1 from rc_x_handle_replacements
      where campaign_id = p_campaign_id and new_handle = p_x_handle and status = 'pending') then
    return jsonb_build_object('success', false, 'error', 'x_handle_taken');
  end if;
  if (select count(*) from rc_agent_x_handles where campaign_id = p_campaign_id and agent_no = p_agent_no and retired_at is null) >= v_max then
    return jsonb_build_object('success', false, 'error', 'x_handle_limit');
  end if;
  insert into rc_agent_x_handles (campaign_id, agent_no, x_handle) values (p_campaign_id, p_agent_no, p_x_handle);
  return jsonb_build_object('success', true, 'xHandle', p_x_handle);
exception when unique_violation then
  return jsonb_build_object('success', false, 'error', 'x_handle_taken');
end;
$$;

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
         and retired_at is null
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
      where campaign_id = v_p.campaign_id and agent_no = v_p.agent_no and x_handle = v_p.post_author
        and (retired_at is null or v_p.submitted_at < retired_at)) then
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

create or replace function public.rc_campaign_remove_x_handle(
  p_campaign_id text, p_agent_no text, p_x_handle text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Same lock as rc_campaign_register_x_handle: add and remove can't race.
  perform pg_advisory_xact_lock(hashtextextended('vote_x_handles|' || p_campaign_id || '|' || p_agent_no, 0));
  if not exists (select 1 from rc_agent_x_handles
                  where campaign_id = p_campaign_id and agent_no = p_agent_no and x_handle = p_x_handle
                    and retired_at is null) then
    return jsonb_build_object('success', false, 'error', 'x_handle_not_linked');
  end if;
  if exists (select 1 from rc_campaign_proofs
              where campaign_id = p_campaign_id and agent_no = p_agent_no
                and post_author = p_x_handle and status <> 'rejected') then
    return jsonb_build_object('success', false, 'error', 'x_handle_has_votes');
  end if;
  delete from rc_agent_x_handles
   where campaign_id = p_campaign_id and agent_no = p_agent_no and x_handle = p_x_handle;
  return jsonb_build_object('success', true);
end;
$$;

-- The player asks. Only for an active account of theirs that already carries
-- a counted or pending vote (one without votes can simply be removed).
create or replace function public.rc_campaign_request_x_replacement(
  p_campaign_id text, p_agent_no text, p_old_handle text, p_new_handle text, p_reason text, p_note text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c public.rc_vote_campaigns%rowtype;
  v_max integer;
  v_id bigint;
begin
  select * into v_c from rc_vote_campaigns where id = p_campaign_id and active;
  if not found then return jsonb_build_object('success', false, 'error', 'campaign_not_found'); end if;
  if p_new_handle !~ '^[a-z0-9_]{1,15}$' or p_old_handle !~ '^[a-z0-9_]{1,15}$' or p_old_handle = p_new_handle then
    return jsonb_build_object('success', false, 'error', 'bad_handle');
  end if;
  if p_reason not in ('suspended', 'deleted', 'locked', 'other') then
    return jsonb_build_object('success', false, 'error', 'bad_reason');
  end if;
  select coalesce((m ->> 'max_replacements')::integer, 1) into v_max
    from jsonb_array_elements(v_c.missions) m where m ->> 'kind' = 'x_post' limit 1;

  perform pg_advisory_xact_lock(hashtextextended('vote_x_handles|' || p_campaign_id || '|' || p_agent_no, 0));
  if not exists (select 1 from rc_agent_x_handles
      where campaign_id = p_campaign_id and agent_no = p_agent_no and x_handle = p_old_handle and retired_at is null) then
    return jsonb_build_object('success', false, 'error', 'x_handle_not_linked');
  end if;
  if not exists (select 1 from rc_campaign_proofs
      where campaign_id = p_campaign_id and agent_no = p_agent_no and post_author = p_old_handle and status <> 'rejected') then
    return jsonb_build_object('success', false, 'error', 'x_handle_no_votes');
  end if;
  if exists (select 1 from rc_x_handle_replacements
      where campaign_id = p_campaign_id and agent_no = p_agent_no and status = 'pending') then
    return jsonb_build_object('success', false, 'error', 'x_replacement_pending');
  end if;
  if (select count(*) from rc_x_handle_replacements
       where campaign_id = p_campaign_id and agent_no = p_agent_no and status = 'approved') >= v_max then
    return jsonb_build_object('success', false, 'error', 'x_replacement_limit', 'limit', v_max);
  end if;
  if exists (select 1 from rc_agent_x_handles where campaign_id = p_campaign_id and x_handle = p_new_handle)
     or exists (select 1 from rc_x_handle_replacements
       where campaign_id = p_campaign_id and new_handle = p_new_handle and status = 'pending') then
    return jsonb_build_object('success', false, 'error', 'x_handle_taken');
  end if;

  insert into rc_x_handle_replacements (campaign_id, agent_no, old_handle, new_handle, reason, note)
  values (p_campaign_id, p_agent_no, p_old_handle, p_new_handle, p_reason, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id, 'status', 'pending');
exception when unique_violation then
  return jsonb_build_object('success', false, 'error', 'x_replacement_pending');
end;
$$;

-- The admin decides. Approval re-checks everything under the same lock,
-- retires the old account and links the new one in one step.
create or replace function public.rc_campaign_decide_x_replacement(
  p_request_id bigint, p_decision text, p_actor text, p_note text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r public.rc_x_handle_replacements%rowtype;
begin
  if p_decision not in ('approve', 'reject') then
    return jsonb_build_object('success', false, 'error', 'bad_decision');
  end if;
  select * into v_r from rc_x_handle_replacements where id = p_request_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'not_found'); end if;
  if v_r.status <> 'pending' then
    return jsonb_build_object('success', false, 'error', 'already_decided', 'status', v_r.status);
  end if;

  if p_decision = 'approve' then
    perform pg_advisory_xact_lock(hashtextextended('vote_x_handles|' || v_r.campaign_id || '|' || v_r.agent_no, 0));
    if not exists (select 1 from rc_agent_x_handles
        where campaign_id = v_r.campaign_id and agent_no = v_r.agent_no and x_handle = v_r.old_handle and retired_at is null) then
      return jsonb_build_object('success', false, 'error', 'x_handle_not_linked');
    end if;
    if exists (select 1 from rc_agent_x_handles where campaign_id = v_r.campaign_id and x_handle = v_r.new_handle) then
      return jsonb_build_object('success', false, 'error', 'x_handle_taken');
    end if;
    update rc_agent_x_handles set retired_at = now(), replaced_by = v_r.new_handle
     where campaign_id = v_r.campaign_id and x_handle = v_r.old_handle;
    insert into rc_agent_x_handles (campaign_id, agent_no, x_handle) values (v_r.campaign_id, v_r.agent_no, v_r.new_handle);
  end if;

  update rc_x_handle_replacements set
    status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
    decided_at = now(), decided_by = left(coalesce(p_actor, 'admin'), 80),
    admin_note = nullif(left(btrim(coalesce(p_note, '')), 300), '')
  where id = v_r.id;
  return jsonb_build_object('success', true, 'id', v_r.id, 'status', case when p_decision = 'approve' then 'approved' else 'rejected' end);
exception when unique_violation then
  return jsonb_build_object('success', false, 'error', 'x_handle_taken');
end;
$$;

revoke all on function public.rc_campaign_request_x_replacement(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.rc_campaign_request_x_replacement(text, text, text, text, text, text) to service_role;
revoke all on function public.rc_campaign_decide_x_replacement(bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.rc_campaign_decide_x_replacement(bigint, text, text, text) to service_role;
