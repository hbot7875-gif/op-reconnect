-- create or replace with a DIFFERENT argument list creates a new overload
-- rather than replacing the old one — the previous migration's 6-arg
-- rc_vma_review_vote (with the daily-cap fix) left the original 4-arg
-- version sitting alongside it uncapped. The security-lockdown migration
-- already restricted both to service_role, but a dead, buggy overload is
-- still a real latent risk (a future call, a mistaken signature match)
-- worth removing outright rather than just leaving locked down.
drop function if exists rc_vma_review_vote(bigint, text, text, text);
