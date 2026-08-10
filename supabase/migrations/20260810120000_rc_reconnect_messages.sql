-- A small shared thread per reconnect mission — an invite's optional note
-- and the ongoing "team chat" once paired up are the same feature: one
-- continuous conversation scoped to the mission, not two bolted together.
-- Deleted along with the mission (matchmaking-removal-style cleanup, or the
-- new fold-away-a-dangling-solo-mission path) via ON DELETE CASCADE — a
-- mission's chat has no life of its own once the mission is gone.
create table if not exists rc_reconnect_messages (
  id bigserial primary key,
  mission_id uuid not null references rc_reconnect_missions(id) on delete cascade,
  agent_no text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists rc_reconnect_messages_mission_idx
  on rc_reconnect_messages (mission_id, created_at);
