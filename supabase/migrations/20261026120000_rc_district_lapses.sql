-- District attempt history: what a lapsed attempt had reached when it ended.
--
-- An attempt that runs out of time is deleted from rc_player_districts
-- (handlers.ts getGameState, resetLapsedDistrict) and a Personal Charge
-- blackout deletes the in-progress one (agent-charge.ts softReset). Nothing
-- was kept, so the district came straight back as "Light it up" at 0% and
-- the player could only see a 4.5s toast. AGENT027 and AGENT109 (2026-10)
-- finished every solo goal of Lowkey Kavs Alley, lost the attempt to the
-- unfinished team quest, and read the 0% as their progress being wiped.
--
-- One row per ended attempt, written by the Edge Function just before the
-- delete. `summary` is the player-facing snapshot (goals with progress and
-- target, the team quest, overall percent); the district screen shows the
-- newest one. (agent_no, district_id, activated_at) identifies an attempt,
-- so two overlapping polls can't record the same lapse twice.
--
-- Same posture as every rc_* object (20260927090000): RLS on, no policies,
-- nothing for anon or authenticated; the browser ships the publishable key.

create table if not exists public.rc_district_lapses (
  id bigint generated always as identity primary key,
  agent_no text not null references public.rc_agents (agent_no) on delete cascade,
  district_id text not null,
  activated_at timestamptz not null,
  deadline_at timestamptz not null,
  lapsed_at timestamptz not null default now(),
  reason text not null check (reason in ('deadline', 'reset', 'blackout')),
  summary jsonb not null default '{}'::jsonb,
  unique (agent_no, district_id, activated_at)
);

create index if not exists rc_district_lapses_agent_idx
  on public.rc_district_lapses (agent_no, lapsed_at desc);

alter table public.rc_district_lapses enable row level security;
revoke all on public.rc_district_lapses from public, anon, authenticated;
grant select, insert on public.rc_district_lapses to service_role;
