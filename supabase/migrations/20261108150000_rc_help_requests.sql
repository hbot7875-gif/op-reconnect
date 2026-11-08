-- Help portal: agents describe a problem from Settings → Get help; AGENT000
-- reads and replies from Settings → Help inbox, and the reply shows up in
-- the agent's bell (lib/help.ts, js/help.js).
--
-- diagnostics holds only what helps answer "why isn't this counting": the
-- stream source, which connections exist (yes/no, never the usernames, IDs,
-- PINs or tokens), the last sync result and the last stored play. It is
-- written by the server, never taken from the browser.
create table if not exists public.rc_help_requests (
  id uuid primary key default gen_random_uuid(),
  agent_no text not null references public.rc_agents (agent_no) on delete cascade,
  topic text not null check (topic in ('streams', 'reconnect', 'badges', 'voting', 'account', 'other')),
  message text not null check (char_length(message) between 1 and 1000),
  diagnostics jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved')),
  reply text check (reply is null or char_length(reply) between 1 and 1000),
  replied_at timestamptz,
  replied_by text,
  reply_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rc_help_requests_agent_idx on public.rc_help_requests (agent_no, created_at desc);
create index if not exists rc_help_requests_open_idx on public.rc_help_requests (created_at desc) where status = 'open';

alter table public.rc_help_requests enable row level security;
revoke all on public.rc_help_requests from public, anon, authenticated;
grant select, insert, update on public.rc_help_requests to service_role;
