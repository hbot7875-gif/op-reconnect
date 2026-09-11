-- Team Boost, rebuilt: the site owner confirmed "drag a goal, target goes
-- up" means literal pooling — up to 3 of the district's OWN track goals get
-- a raised, TEAM-WIDE shared target once the 9-agent mission completes, and
-- every joined member's real plays toward those 3 tracks (from the moment
-- the pick is made) count for everyone, same shape as an ordinary
-- sharedTrack mission — not a personal, one-shot progress bonus (the first
-- build, shipped in 26c1168, misread "increased a little" as progress
-- rather than target and was never used: zero rows in
-- rc_reconnect_participants.boost_picks).
--
-- Picking is a TEAM decision, not a per-agent one — any of the 9 can spend
-- it once for the whole mission, so it lives on rc_reconnect_missions, not
-- per-participant. The old per-participant column is dropped outright
-- rather than left dormant: it was never written to, so there is nothing
-- to migrate.
alter table public.rc_reconnect_participants drop column if exists boost_picks;

alter table public.rc_reconnect_missions add column if not exists team_boost_picks jsonb;
alter table public.rc_reconnect_missions add column if not exists team_boost_activated_at timestamptz;
comment on column public.rc_reconnect_missions.team_boost_picks is
  'Team Boost (teamBoost reconnect config): up to maxPicks {ref,label,keys,originalTarget,pooledTarget} entries the team spent its one-shot pick on. Null = not picked yet. Set together with team_boost_activated_at, which is the shared clock every participant''s pooled contribution is counted from.';

-- poolFactor replaces the old bonusPercent — see reconnect-missions.ts's
-- pickTeamBoostGoals for the formula (originalTarget * requiredAgents *
-- poolFactor, rounded). 0.4 sized so a fully-engaged 9-agent team clears
-- one pooled track in a few days of normal streaming, not in one sitting
-- and not as a second full-length grind on top of the team-up they just
-- finished: e.g. Swim (target 50 solo) pools to round(50*9*0.4)=180 combined
-- plays across the team.
update rc_goals
set config = jsonb_set(config, '{teamBoost}', '{"maxPicks": 3, "poolFactor": 0.4}'::jsonb)
where id = 'taepier-team-boost-9';

update rc_player_districts
set goals = jsonb_set(goals, '{reconnect,config,teamBoost}', '{"maxPicks": 3, "poolFactor": 0.4}'::jsonb)
where district_id = 'mono-tae-pier' and status = 'active'
  and goals->'reconnect'->>'id' = 'taepier-team-boost-9';
