-- Let retention clear a VMA vote's screenshot reference.
--
-- rc_vma_votes.proof_path was created NOT NULL (20260819091000). The privacy
-- retention added later (20260928060000, extended in 20261013150000) deletes a
-- proof file 30 days after its event and then, as step three, clears the
-- row's reference: proof_path = null, ocr_text = null. The NOT NULL was never
-- dropped, so that step has failed on every hourly sweep since the VMA 2026
-- files were deleted (2026-10-25/26): "null value in column proof_path of
-- relation rc_vma_votes violates not-null constraint". The whole function
-- rolls back with it, so its campaign-proof statement never ran either.
--
-- The files are already gone from Storage; only the references to them stay.
-- Nothing else on the row changes when a reference is cleared: verify_status,
-- votes_logged, verified_at, image_hash (kept on purpose — it blocks a reused
-- screenshot) and every reward already granted stay exactly as they are.
--
-- A NEW vote still cannot be stored without its screenshot: the guarantee the
-- NOT NULL gave at insert time moves to a BEFORE INSERT trigger. Only an
-- UPDATE (retention, after Storage confirmed the delete) may empty it.

alter table public.rc_vma_votes alter column proof_path drop not null;

create or replace function public.rc_vma_votes_require_proof()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(new.proof_path, '') = '' then
    raise exception 'a VMA vote needs its proof screenshot (proof_path)' using errcode = 'not_null_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists rc_vma_votes_require_proof on public.rc_vma_votes;
create trigger rc_vma_votes_require_proof
  before insert on public.rc_vma_votes
  for each row execute function public.rc_vma_votes_require_proof();

revoke all on function public.rc_vma_votes_require_proof() from public, anon, authenticated;

comment on column public.rc_vma_votes.proof_path is
  'Object key in vma-vote-proofs. Required on insert (trigger rc_vma_votes_require_proof); set to null by rc_clear_expired_proof_refs once retention has deleted the file.';
