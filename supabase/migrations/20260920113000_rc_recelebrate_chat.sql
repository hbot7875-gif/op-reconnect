-- One shared, temporary chat room for ARIRANG RE:CELEBRATE. The Edge
-- Function is the only reader/writer: clients never receive agent numbers,
-- and direct PostgREST access remains closed. Rows disappear automatically
-- if their agent account is deleted.
create table if not exists public.rc_recelebrate_messages (
  id bigint generated always as identity primary key,
  event_id text not null default 'arirang-recelebrate-2026',
  agent_no text not null references public.rc_agents(agent_no) on delete cascade,
  body text not null check (char_length(body) between 1 and 200),
  created_at timestamptz not null default now()
);

create index if not exists rc_recelebrate_messages_event_created_idx
  on public.rc_recelebrate_messages (event_id, created_at desc, id desc);

create index if not exists rc_recelebrate_messages_agent_recent_idx
  on public.rc_recelebrate_messages (agent_no, created_at desc);

alter table public.rc_recelebrate_messages enable row level security;
revoke all on public.rc_recelebrate_messages from anon, authenticated;

comment on table public.rc_recelebrate_messages is
  'Temporary ARIRANG RE:CELEBRATE party chat. Edge Function access only; public responses expose codename and team, never agent_no.';
