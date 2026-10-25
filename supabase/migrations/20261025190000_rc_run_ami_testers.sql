-- War of Cards (RUN AMI) testers, managed from the app by AGENT000.
--
-- Until now the closed-test list was a constant in lib/run-ami-access.js,
-- so adding a tester meant a code change and a deploy. This table is the
-- live list; the Edge Function (lib/run-ami.ts) is the only reader and
-- writer, and only AGENT000 may change it (checked there). AGENT000 is
-- always a tester whatever this table says, so the owner can't lock
-- themselves out.
--
-- Same posture as every rc_* object (20260927090000): RLS on, no policies,
-- nothing for anon or authenticated; the browser ships the publishable key.

create table if not exists public.rc_run_ami_testers (
  agent_no text primary key references public.rc_agents (agent_no) on delete cascade,
  added_by text,
  added_at timestamptz not null default now()
);

alter table public.rc_run_ami_testers enable row level security;
revoke all on public.rc_run_ami_testers from public, anon, authenticated;
grant select, insert, delete on public.rc_run_ami_testers to service_role;

-- Start with the closed-test list the code had (run-ami-access.js), for the
-- agents that exist.
insert into public.rc_run_ami_testers (agent_no, added_by)
select a.agent_no, 'AGENT000'
  from public.rc_agents a
 where a.agent_no in ('AGENT000', 'AGENT050', 'AGENT120', 'AGENT140', 'AGENT196')
on conflict (agent_no) do nothing;
