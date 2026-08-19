-- Follow-up fixes for the MTV VMA voting mission and Badge Collection,
-- from a second review after the first pass shipped. Deliberately a NEW
-- migration — 20260819090000 and 20260819091000 are already applied to
-- production and are not touched here.
--
-- ============================================================
-- 1. Voting mission fixes
-- ============================================================

-- (9) The third double-day window (Sep 25) was copied from the per-day
-- 12:00AM-11:59PM ET rule without noticing the *overall* voting period
-- closes earlier that day, at 5:59PM ET (21:59:59 UTC) — so the window as
-- originally entered claimed a double-day cap for hours voting is already
-- closed. Clamp its end to the real period end.
--
-- (1) category_keywords only distinguished "which song" (swim), not "which
-- category" — a Song of the Year screenshot and a Best K-Pop screenshot for
-- the same song would pass identically. Add category_match_keywords, the
-- text unique to each category's own page heading.
--
-- (8) Watermark is now ONE shared daily code for every agent (not
-- per-agent) — see lib/vma-voting.ts::dailyWatermarkCode. watermark_words
-- stays as-is; the per-agent suffix was application logic, not config.
update rc_config set value = jsonb_set(
  jsonb_set(
    value,
    '{double_days_utc,2,end}',
    '"2026-09-25T21:59:59Z"'
  ),
  '{category_match_keywords}',
  '{
    "song_of_the_year": ["song of the year"],
    "best_kpop": ["best k-pop", "best kpop", "best k pop"]
  }'::jsonb
)
where key = 'vma_2026';

-- (votes_logged's check constraint needed fixing too — see the separate
-- 20260819101000 migration; this file was already applied to production by
-- the time that was caught, so it's a follow-up file, not an edit here.)

alter table rc_vma_votes add column if not exists event_id text not null default 'vma_2026';
-- (2) The screenshot shows a CUMULATIVE total on vote.mtv.com (tap +, the
-- number climbs), not "votes cast in this submission" — a 10-then-20
-- screenshot pair should credit +10, not 20+10=30. displayed_total is what
-- OCR/the agent claims the counter reads; votes_logged becomes the CREDITED
-- delta actually counted toward the cap, computed server-side in
-- rc_vma_submit_vote below (baseline = this agent/category/day's highest
-- prior *verified* displayed_total).
alter table rc_vma_votes add column if not exists displayed_total integer not null default 0;
alter table rc_vma_votes add column if not exists image_mime text;
-- (8) What the shared daily code was AT SUBMISSION TIME, so a later change
-- to watermark_words (or a bug) doesn't retroactively make an old,
-- correctly-checked submission look wrong on audit.
alter table rc_vma_votes add column if not exists expected_code text;
-- (7) Manual review trail.
alter table rc_vma_votes add column if not exists reviewed_by text;
alter table rc_vma_votes add column if not exists reviewed_at timestamptz;
alter table rc_vma_votes add column if not exists admin_note text;

-- (4) Backstop the app-level duplicate check with a real constraint — two
-- concurrent requests with the same image can no longer both slip through
-- between the app's SELECT and INSERT.
alter table rc_vma_votes drop constraint if exists rc_vma_votes_image_hash_key;
alter table rc_vma_votes add constraint rc_vma_votes_image_hash_key unique (image_hash);

create index if not exists rc_vma_votes_event_agent_day_idx
  on rc_vma_votes (event_id, agent_no, vote_day, category);

comment on table rc_vma_votes is
  'Self-reported MTV VMA vote log. OCR runs client-side (Tesseract.js in the browser); the backend matches the supplied text against expected keywords + the shared daily watermark code + per-category page-heading text, and treats client OCR as unverified input, not proof — see rc_vma_submit_vote for the atomic cap/dedupe/credit logic and lib/vma-voting.ts for the text checks. displayed_total is the cumulative counter the screenshot shows; votes_logged is the credited delta. event_id lets this table serve future voting missions, not just vma_2026.';

-- (3) Atomic submit: advisory-locks this agent/category/day/event so
-- concurrent submissions cannot both read a stale baseline/cap and both
-- credit past the limit. (5) The caller only awards badges after this
-- returns success:true — see logVmaVote.
create or replace function rc_vma_submit_vote(
  p_agent_no text, p_event_id text, p_category text, p_vote_day date,
  p_displayed_total integer, p_daily_cap integer,
  p_is_power_hour boolean, p_is_double_day boolean,
  p_proof_path text, p_image_hash text, p_image_mime text, p_ocr_text text,
  p_expected_code text, p_watermark_ok boolean,
  p_verify_status text, p_verify_note text
) returns jsonb language plpgsql security definer as $$
declare
  v_lock_key bigint;
  v_baseline integer;
  v_used integer;
  v_credited integer;
  v_id bigint;
begin
  if p_verify_status not in ('verified', 'pending') then
    return jsonb_build_object('success', false, 'error', 'bad_verify_status');
  end if;

  v_lock_key := hashtextextended(p_agent_no || '|' || p_event_id || '|' || p_category || '|' || p_vote_day::text, 0);
  perform pg_advisory_xact_lock(v_lock_key);

  if exists (select 1 from rc_vma_votes where image_hash = p_image_hash) then
    return jsonb_build_object('success', false, 'error', 'duplicate_screenshot');
  end if;

  select coalesce(max(displayed_total), 0), coalesce(sum(votes_logged), 0)
    into v_baseline, v_used
    from rc_vma_votes
   where agent_no = p_agent_no and event_id = p_event_id and category = p_category
     and vote_day = p_vote_day and verify_status = 'verified';

  if p_verify_status = 'verified' then
    v_credited := greatest(0, least(p_displayed_total - v_baseline, p_daily_cap - v_used));
  else
    v_credited := 0;
  end if;

  insert into rc_vma_votes (
    agent_no, event_id, category, vote_day, displayed_total, votes_logged,
    is_power_hour, is_double_day, proof_path, image_hash, image_mime, ocr_text,
    expected_code, watermark_ok, verify_status, verify_note, verified_at
  ) values (
    p_agent_no, p_event_id, p_category, p_vote_day, p_displayed_total, v_credited,
    p_is_power_hour, p_is_double_day, p_proof_path, p_image_hash, p_image_mime, p_ocr_text,
    p_expected_code, p_watermark_ok, p_verify_status, p_verify_note,
    case when p_verify_status = 'pending' then null else now() end
  ) returning id into v_id;

  return jsonb_build_object(
    'success', true, 'id', v_id, 'creditedVotes', v_credited,
    'remaining', greatest(0, p_daily_cap - v_used - v_credited)
  );
exception when unique_violation then
  return jsonb_build_object('success', false, 'error', 'duplicate_screenshot');
end;
$$;

-- (7) Admin approve/reject for anything OCR couldn't auto-clear. Approval
-- computes credit the same way the atomic submit path does (baseline =
-- highest prior *verified* displayed_total), just applied at review time
-- instead of submit time — so an admin working through a backlog out of
-- chronological order still gets a correct, capped credit, not whatever the
-- agent originally claimed.
create or replace function rc_vma_review_vote(
  p_vote_id bigint, p_decision text, p_admin text, p_note text
) returns jsonb language plpgsql security definer as $$
declare
  v_row rc_vma_votes%rowtype;
  v_lock_key bigint;
  v_baseline integer;
  v_used integer;
  v_credited integer;
begin
  if p_decision not in ('approve', 'reject') then
    return jsonb_build_object('success', false, 'error', 'bad_decision');
  end if;

  select * into v_row from rc_vma_votes where id = p_vote_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'not_found');
  end if;
  if v_row.verify_status != 'pending' then
    return jsonb_build_object('success', false, 'error', 'already_reviewed');
  end if;

  if p_decision = 'reject' then
    update rc_vma_votes set verify_status = 'rejected', reviewed_by = p_admin,
      reviewed_at = now(), admin_note = p_note
      where id = p_vote_id;
    return jsonb_build_object('success', true, 'verifyStatus', 'rejected');
  end if;

  v_lock_key := hashtextextended(v_row.agent_no || '|' || v_row.event_id || '|' || v_row.category || '|' || v_row.vote_day::text, 0);
  perform pg_advisory_xact_lock(v_lock_key);

  select coalesce(max(displayed_total), 0), coalesce(sum(votes_logged), 0)
    into v_baseline, v_used
    from rc_vma_votes
   where agent_no = v_row.agent_no and event_id = v_row.event_id and category = v_row.category
     and vote_day = v_row.vote_day and verify_status = 'verified';

  v_credited := greatest(0, v_row.displayed_total - v_baseline);
  -- Daily cap isn't passed in here (this function only knows the row, not
  -- rc_config) — the caller (adminReviewVmaVote) re-derives the correct cap
  -- for that day/event and passes an already-clamped ceiling.

  update rc_vma_votes set verify_status = 'verified', votes_logged = v_credited,
    verified_at = now(), reviewed_by = p_admin, reviewed_at = now(), admin_note = p_note
    where id = p_vote_id;

  return jsonb_build_object('success', true, 'verifyStatus', 'verified', 'creditedVotes', v_credited);
end;
$$;

-- ============================================================
-- 2. Badge Collection fixes
-- ============================================================

-- (14) districts.ts/handlers.ts already awards ward-completion badges as
-- 'ward:<wardId>' (predates this Badge Collection work). The first
-- migration seeded a *different* template id, 'ward_restored', for the same
-- concept — rename it to match the id already live in real award rows
-- instead of creating a second, disconnected "ward badge". No rc_badge_art
-- rows reference it yet (table was empty until now), so this is a pure
-- rename with nothing to cascade.
update rc_badge_catalog set id = 'ward' where id = 'ward_restored';
