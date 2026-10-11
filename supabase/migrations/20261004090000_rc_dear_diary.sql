-- Dear Diary is private, per-agent, and one row per KST calendar day.
create table if not exists public.rc_dear_diary_entries (
  agent_no text not null references public.rc_agents(agent_no) on delete cascade,
  kst_date date not null,
  note text not null default '' check (char_length(note) <= 1200),
  summary_text text,
  summary_version integer not null default 0,
  summary_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (agent_no, kst_date)
);

create index if not exists rc_dear_diary_entries_agent_date_idx
  on public.rc_dear_diary_entries (agent_no, kst_date desc);

alter table public.rc_dear_diary_entries enable row level security;
revoke all on table public.rc_dear_diary_entries from anon, authenticated;
comment on table public.rc_dear_diary_entries is
  'Private daily diary notes and stable generated summaries. Accessed only through verified agent-session Edge routes.';

-- Theme is a single private presentation preference, never diary content.
create table if not exists public.rc_dear_diary_preferences (
  agent_no text primary key references public.rc_agents(agent_no) on delete cascade,
  theme text not null check (theme in ('oldworld', 'school90s', 'y2k', 'modern', 'future')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rc_dear_diary_preferences enable row level security;
revoke all on table public.rc_dear_diary_preferences from anon, authenticated;
comment on table public.rc_dear_diary_preferences is
  'Private per-agent Dear Diary visual preference. Accessed only through verified agent-session Edge routes.';
