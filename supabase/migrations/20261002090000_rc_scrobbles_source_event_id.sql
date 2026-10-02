-- Observational only: record the provider's own event id alongside each
-- scrobble. Nothing reads it yet, nothing dedupes on it, nothing changes.
--
-- WHY THIS EXISTS, AND WHY IT DOES NOTHING YET
--
-- rc_scrobbles dedupes on UNIQUE (agent_no, listened_at, track_name), so the
-- provider's timestamp IS the identity. Stats.fm reports the same physical
-- play two ways -- once with seconds, once truncated to the minute -- and the
-- two therefore land as two rows. Measured 2026-10-02: 27,633 such pairs
-- across 26 agents, roughly 3,000 new ones a day, and one player correctly
-- reported 20 plays of a track showing as 41.
--
-- The obvious fix is to key on the provider's own id instead. Stats.fm's
-- /streams/recent does return one -- `streamId`, a 32-char hex -- and it is
-- unique per item within a response. What is NOT known is whether that id
-- survives the timestamp changing. If it is a hash over (user, track, time)
-- it will change with the timestamp and be useless for exactly the case it is
-- needed for, and we have no history to check because we never stored it.
--
-- So this migration stores it and stops. No unique index, no constraint, no
-- backfill, no change to the existing key. Once a few days of real pairs have
-- accumulated, one read-only query answers the question -- do the two rows of
-- a known precision-pair share a streamId? -- and the dedup identity is then
-- a measured fact rather than a guess.
--
-- The column is deliberately nullable and unconstrained: every row written
-- before this, and every row from a source with no stable event id, keeps a
-- NULL here and behaves exactly as it does today.

alter table public.rc_scrobbles
  add column if not exists source_event_id text;

comment on column public.rc_scrobbles.source_event_id is
  'Provider-side event id when the source supplies a stable one (Stats.fm streamId). Observational: not part of any uniqueness rule. NULL for sources without one and for every row predating 2026-10-02.';

-- Read-performance only, for the diagnostic that compares ids within a
-- precision-pair. Deliberately NOT unique: proving that it COULD be unique is
-- the entire point of collecting it, and a unique index here would start
-- silently rejecting inserts before that question is answered.
create index if not exists rc_scrobbles_source_event_id_idx
  on public.rc_scrobbles (agent_no, source, source_event_id)
  where source_event_id is not null;
