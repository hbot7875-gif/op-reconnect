-- A simple public suggestions board — feature ideas, new goals, anything a
-- player wants to see next. Deliberately minimal: no voting, no categories,
-- no moderation queue, no status tracking. Just a chronological list anyone
-- can read and add to, the same "codename only, never the agent number"
-- rule everything else public in this game already follows (see feed.ts).
create table if not exists rc_suggestions (
  id bigint generated always as identity primary key,
  agent_no text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists rc_suggestions_created_at_idx on rc_suggestions (created_at desc);
