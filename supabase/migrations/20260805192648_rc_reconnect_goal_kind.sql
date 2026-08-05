-- The 3rd restoration goal kind: 'reconnect'. Same per-district assignment
-- as track/album goals, but a district can carry several reconnect goals at
-- once (different flavors), and freezeGoals() picks ONE at random per agent
-- per activation — so two agents restoring the same district can land on
-- genuinely different reconnect missions. See districts.ts's freezeGoals().
--
-- Five flavors (variant column): 'sotd'/'cipher'/'memory' are solo one-shot
-- guess-the-answer puzzles (admin authors {prompt, answerLabel,
-- answerAliases} in `config`); 'connect'/'invite' are the co-op mechanic
-- folded in from the old post-restoration Reconnect Mission system
-- (admin authors {requiredAgents} in `config`).
alter table rc_goals add column if not exists variant text;
alter table rc_goals add column if not exists config jsonb not null default '{}';

-- Defensive: replace whatever CHECK constrains rc_goals.kind (found by
-- introspection, not by guessing a constraint name — the original
-- CREATE TABLE predates the migrations/ convention and isn't in this repo)
-- so 'reconnect' joins 'track'/'album' as a valid kind.
do $$
declare con record;
begin
  for con in
    select c.conname from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(c.conkey)
    where rel.relname = 'rc_goals' and c.contype = 'c' and att.attname = 'kind'
  loop
    execute format('alter table rc_goals drop constraint %I', con.conname);
  end loop;
end $$;
alter table rc_goals add constraint rc_goals_kind_check check (kind in ('track','album','reconnect'));

-- Every mission is now scoped to one specific frozen goal instance, not just
-- a district — two agents with DIFFERENT reconnect goals for the same
-- district (e.g. one 'connect', one 'invite', or two 'connect's with
-- different requiredAgents) must never get cross-matched into each other's
-- mission.
alter table rc_reconnect_missions add column if not exists goal_id text references rc_goals(id);

-- Solo puzzle attempt tracking for sotd/cipher/memory. goal_id is part of
-- the primary key (not just agent_no+district_id) deliberately: if a
-- district's restoration attempt lapses (7-day deadline) and the agent
-- restarts it, freezeGoals() rolls the dice again and may land on a
-- DIFFERENT reconnect goal — the new attempt should start clean, not
-- inherit a stale attempt count from a previous, unrelated puzzle.
create table if not exists rc_reconnect_puzzle_attempts (
  agent_no    text not null,
  district_id text not null references rc_districts(id),
  goal_id     text not null references rc_goals(id) on delete cascade,
  attempts    int not null default 0,
  solved      boolean not null default false,
  solved_at   timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (agent_no, district_id, goal_id)
);
