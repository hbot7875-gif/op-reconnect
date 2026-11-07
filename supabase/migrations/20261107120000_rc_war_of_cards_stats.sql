-- War of Cards: the album-unlock pop-up record, the Card Champion badge
-- template, player stats for the Run ARMY leaderboard, and the badge award.
--
-- Nothing here changes how a match is played or committed. Stats are READ
-- from rc_run_ami_match_players, which rc_run_ami_commit fills exactly once
-- per match (a match leaves 'active' only once, under its version lock), so
-- a result can't be counted twice and no player can submit their own.
-- Spectators (rc_run_ami_watchers) never appear in that table.

-- ── 1. The unlock pop-up, once per agent across devices ─────────────────
create table if not exists public.rc_war_unlock_notices (
  agent_no text primary key references public.rc_agents (agent_no) on delete cascade,
  seen_at timestamptz not null default now()
);

alter table public.rc_war_unlock_notices enable row level security;
revoke all on public.rc_war_unlock_notices from public, anon, authenticated;
grant select, insert, update, delete on public.rc_war_unlock_notices to service_role;

-- ── 2. The Card Champion template is 20261107115000 (Badge Vault) ────

-- ── 3. Counted results ──────────────────────────────────────────────────
-- One row per counted result: 'win' or 'loss'.
--   win   'won' (a played-out finish) in a match of at least 12 turns. Real
--         games so far ran 25+ turns, so a shorter "win" is not a game. At
--         most 3 wins a KST day against the same opponents count, so two
--         accounts can't farm wins off each other.
--   loss  'played' (another agent went out first) in a match of 12+ turns,
--         or 'forfeited' (left, disconnected, timed out). Quitting a losing
--         game still counts as a loss, so leaving can't erase one.
-- Not counted: last_standing (a walkover is not a win), abandoned matches,
-- and anything still in progress.
create or replace function public.rc_war_outcomes()
returns table (agent_no text, match_id uuid, ended_at timestamptz, outcome text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with base as (
    select p.agent_no, p.match_id, m.ended_at, p.result, m.end_reason,
           coalesce((m.public_state->>'turnNo')::int, 0) as turns,
           (select string_agg(o.agent_no, ',' order by o.agent_no)
              from rc_run_ami_match_players o
             where o.match_id = p.match_id and o.seat <> p.seat) as opponents
      from rc_run_ami_match_players p
      join rc_run_ami_matches m on m.id = p.match_id
     where m.status = 'finished' and p.result is not null and m.ended_at is not null
  ), wins as (
    select b.agent_no, b.match_id, b.ended_at,
           row_number() over (
             partition by b.agent_no, b.opponents, (b.ended_at at time zone 'Asia/Seoul')::date
             order by b.ended_at, b.match_id) as nth
      from base b
     where b.result = 'won' and b.end_reason = 'played_out' and b.turns >= 12
  )
  select w.agent_no, w.match_id, w.ended_at, 'win'::text from wins w where w.nth <= 3
  union all
  select b.agent_no, b.match_id, b.ended_at, 'loss'::text from base b
   where b.result = 'forfeited' or (b.result = 'played' and b.turns >= 12)
$$;

-- Per agent: games and wins (since p_since, or all time when null), plus
-- the current and best winning streaks, which are always lifetime.
create or replace function public.rc_war_leaderboard(p_since timestamptz default null)
returns table (agent_no text, played integer, wins integer, current_streak integer, best_streak integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with o as (select * from rc_war_outcomes()),
  seq as (
    -- Each loss starts a new run; the wins after it belong to that run.
    select o.agent_no, o.outcome,
           sum(case when o.outcome = 'loss' then 1 else 0 end)
             over (partition by o.agent_no order by o.ended_at, o.match_id rows unbounded preceding) as run
      from o
  ), runs as (
    select s.agent_no, s.run, count(*) filter (where s.outcome = 'win') as len
      from seq s group by 1, 2
  ), streaks as (
    select r.agent_no, max(r.len) as best, (array_agg(r.len order by r.run desc))[1] as cur
      from runs r group by 1
  ), totals as (
    select o.agent_no,
           count(*) filter (where p_since is null or o.ended_at >= p_since) as played,
           count(*) filter (where o.outcome = 'win' and (p_since is null or o.ended_at >= p_since)) as wins
      from o group by 1
  )
  select t.agent_no, t.played::int, t.wins::int, coalesce(s.cur, 0)::int, coalesce(s.best, 0)::int
    from totals t left join streaks s on s.agent_no = t.agent_no
   where t.played > 0
$$;

revoke all on function public.rc_war_outcomes() from public, anon, authenticated;
revoke all on function public.rc_war_leaderboard(timestamptz) from public, anon, authenticated;
grant execute on function public.rc_war_outcomes() to service_role;
grant execute on function public.rc_war_leaderboard(timestamptz) to service_role;

-- ── 4. Card Champion: one badge every 10 counted wins ───────────────────
-- Runs when a match's results are written. Each block of 10 counted wins is
-- its own copy of the badge, scoped by the milestone ('…:10', '…:20', …),
-- the same way district badges are scoped by district. rc_award_badge is
-- idempotent on (agent, badge), so every milestone is awarded exactly once
-- and kept. Awarding every milestone reached (not only the latest) means a
-- win that didn't count can never make one get skipped, and calling it
-- again only fills in artwork that hadn't been uploaded yet. Any error is
-- swallowed with a warning: a badge must never block a match result.
create or replace function public.rc_war_award_champion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wins integer;
  v_m integer;
begin
  if new.result = 'won' and old.result is distinct from 'won' then
    begin
      select count(*) into v_wins from rc_war_outcomes() o
       where o.agent_no = new.agent_no and o.outcome = 'win';
      for v_m in 1 .. (v_wins / 10) loop
        perform rc_award_badge(new.agent_no, 'achievement_card_champion', (v_m * 10)::text);
      end loop;
    exception when others then
      raise warning 'Card Champion check failed for %: %', new.agent_no, sqlerrm;
    end;
  end if;
  return null;
end $$;

revoke all on function public.rc_war_award_champion() from public, anon, authenticated;

drop trigger if exists rc_war_award_champion on public.rc_run_ami_match_players;
create trigger rc_war_award_champion
  after update of result on public.rc_run_ami_match_players
  for each row execute function public.rc_war_award_champion();

-- Anyone already past a milestone when this lands gets those badges now.
select rc_award_badge(l.agent_no, 'achievement_card_champion', (m.n * 10)::text)
  from rc_war_leaderboard(null) l
  cross join lateral generate_series(1, l.wins / 10) as m(n)
 where l.wins >= 10;
