-- Defender Comms — a small shared thread scoped to one Red Zone event, same
-- idea as rc_reconnect_messages' per-mission thread (see that migration's
-- own comment) but never forced into the mission model: a Red Zone can have
-- dozens of contributors, not a 2-7 person team, and has no district/goal of
-- its own. `kind` distinguishes real agent messages from the deterministic
-- system lines (progress milestones, final push, success/failure) bomb.ts
-- writes at the same points it already transitions event state — those get
-- a `dedup_key` so a retried settlement or concurrent poll can never insert
-- the same milestone line twice; user messages don't need one.
--
-- Deleted along with the event (ON DELETE CASCADE) — like a mission's chat,
-- a Red Zone's chat has no life of its own once the event is gone. Isolation
-- between one Red Zone and the next is automatic: each event gets its own
-- id, and old messages are never visible under a new one.
create table if not exists rc_defuse_messages (
  id bigserial primary key,
  event_id uuid not null references rc_defuse_events(id) on delete cascade,
  agent_no text not null,
  body text not null,
  kind text not null default 'user' check (kind in ('user', 'system')),
  dedup_key text,
  created_at timestamptz not null default now()
);

create index if not exists rc_defuse_messages_event_idx
  on rc_defuse_messages (event_id, created_at);

-- Partial unique index (not a plain unique constraint) so multiple user
-- messages — which never set dedup_key — are unaffected; only system lines
-- are deduplicated, one row per (event, dedup_key) ever.
create unique index if not exists rc_defuse_messages_dedup_idx
  on rc_defuse_messages (event_id, dedup_key) where dedup_key is not null;
