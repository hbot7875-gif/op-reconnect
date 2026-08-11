-- Live City Feed — a small, append-only log of network-wide "something just
-- happened" moments (district restores, ward progress, level-ups, Signal
-- Sweep completions), so a solo-play game still feels occupied. Deliberately
-- excludes anything js/share.js already treats as unleakable — district
-- names, old-agent "Guardian" handles, memory text. Only shows CURRENT,
-- opted-in players' own activity, which is already public (codenames are
-- shown network-wide on the Rankings screen today).
--
-- Every insert reuses the SAME dedup_key already used for that event's
-- one-time side effect elsewhere (rc_xp_ledger row, badge award) — since
-- those are already guarded to fire exactly once per real completion,
-- giving the feed row an identical (prefixed) key means it also logs
-- exactly once, with zero new completion-latch columns needed anywhere.
-- See derive.ts/handlers.ts/side-missions.ts's existing dedup_key upserts.
create table if not exists rc_feed_events (
  id bigint generated always as identity primary key,
  agent_no text not null,
  event_type text not null,
  payload jsonb not null default '{}',
  dedup_key text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists rc_feed_events_created_at_idx on rc_feed_events (created_at desc);
