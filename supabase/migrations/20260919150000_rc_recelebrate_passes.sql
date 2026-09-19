-- ARIRANG RE:CELEBRATE pre-party state, one row per agent per event. The row
-- IS the Party Pass: it only exists once the agent has confirmed a Love Song,
-- so "pass issued" and "Love Song locked" are the same fact. The Edge
-- Function is the only reader/writer (agent identity comes from the verified
-- session there); direct PostgREST access stays closed.
create table if not exists public.rc_recelebrate_passes (
  event_id text not null default 'arirang-recelebrate-2026',
  agent_no text not null references public.rc_agents(agent_no) on delete cascade,
  love_song text not null check (char_length(love_song) between 1 and 80),
  pass_issued_at timestamptz not null default now(),
  -- Next step (team reveal): set when the agent starts the team choice.
  team_choice_started_at timestamptz,
  team text check (team in ('hooligans', 'aliens')),
  team_chosen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, agent_no),
  check (team is null or team_chosen_at is not null)
);

alter table public.rc_recelebrate_passes enable row level security;
revoke all on public.rc_recelebrate_passes from anon, authenticated;

comment on table public.rc_recelebrate_passes is
  'ARIRANG RE:CELEBRATE Party Pass per agent: Love Song (locked once issued), issue time, and the team step. Edge Function access only.';
