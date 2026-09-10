-- Lightweight private signals sent from the live "agents in this district"
-- roster. The Edge Function is the only reader/writer: clients never receive
-- agent numbers and direct PostgREST access stays closed.
create table if not exists public.rc_district_messages (
  id uuid primary key default gen_random_uuid(),
  sender_agent_no text not null references public.rc_agents(agent_no) on delete cascade,
  recipient_agent_no text not null references public.rc_agents(agent_no) on delete cascade,
  district_id text not null,
  body text not null check (char_length(body) between 1 and 240),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_agent_no <> recipient_agent_no)
);

create index if not exists rc_district_messages_recipient_idx
  on public.rc_district_messages (recipient_agent_no, created_at desc);

create index if not exists rc_district_messages_sender_recent_idx
  on public.rc_district_messages (sender_agent_no, created_at desc);

alter table public.rc_district_messages enable row level security;
revoke all on public.rc_district_messages from anon, authenticated;

comment on table public.rc_district_messages is
  'Private player signals originating from the live district-presence roster. Edge Function access only.';
