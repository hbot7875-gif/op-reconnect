-- Two new ways to earn a Backup Pass, neither of them guaranteed.
--
-- Until now the only source was the Supply Chest (weight 10 in its reward
-- pool). The pass is deliberately NOT in the district collectible pool —
-- rc_items.backup-pass has drop_weight 0 — because that drop is a keepsake
-- you place in a district, and rc_drop_district_item stamps district_id on
-- the row it inserts. A utility that lives in the Pack cannot ride that
-- path: it would be placed somewhere it can't be used, AND it would satisfy
-- rc_drop_district_item's own "has this district already dropped?" check and
-- silently rob the agent of their collectible. So both new sources grant the
-- pass directly, with district_id null.
--
--   1. Level-ups, alternating. The rule lives in lib/backup-pass-rewards.js
--      (pure + unit-tested); this migration only stores the latch it needs,
--      rc_players.last_backup_pass_level.
--   2. District restoration, as a chance — "not always, not for every
--      district". rc_award_district_backup_pass below.
--
-- The one thing a chance-based reward must never do is reroll. getGameState
-- is polled every 60-90s and the restoration latch is recomputed each time,
-- so a roll that only recorded its WINS would be rerolled on every poll
-- until it eventually won — a 20% chance that pays out 100% of the time,
-- just later. Hence backup_pass_rolled_at: the roll is recorded whether it
-- won or lost, under the same row lock that performs it.

alter table public.rc_players
  add column if not exists last_backup_pass_level integer not null default 0;

comment on column public.rc_players.last_backup_pass_level is
  'Level that last granted a Backup Pass (0 = never). Drives the every-other-level rule in lib/backup-pass-rewards.js.';

alter table public.rc_player_districts
  add column if not exists backup_pass_rolled_at timestamptz,
  add column if not exists backup_pass_awarded boolean not null default false;

comment on column public.rc_player_districts.backup_pass_rolled_at is
  'When the restoration Backup Pass chance was rolled. Non-null means rolled — win or lose — so a re-poll can never reroll it.';

-- Rolls the restoration chance exactly once per district attempt.
-- Returns {rolled, awarded}: rolled=false means it had already been rolled
-- and nothing happened, which is the normal answer on every poll after the
-- first. Locks the agent's own rc_player_districts row, the same way
-- rc_drop_district_item locks rc_players, so two polls landing together
-- cannot both roll.
create or replace function public.rc_award_district_backup_pass(
  p_agent_no text,
  p_district_id text,
  p_chance numeric
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rolled_at timestamptz;
  v_win boolean;
begin
  select backup_pass_rolled_at into v_rolled_at
    from rc_player_districts
   where agent_no = p_agent_no and district_id = p_district_id
     for update;
  if not found then
    return jsonb_build_object('rolled', false, 'awarded', false, 'error', 'no_district_row');
  end if;
  if v_rolled_at is not null then
    return jsonb_build_object('rolled', false, 'awarded', false);
  end if;

  v_win := random() < greatest(0, least(1, coalesce(p_chance, 0)));

  -- Recorded before the grant and regardless of the outcome: a lost roll is
  -- as final as a won one.
  update rc_player_districts
     set backup_pass_rolled_at = now(), backup_pass_awarded = v_win
   where agent_no = p_agent_no and district_id = p_district_id;

  if v_win then
    -- district_id null: a Backup Pass is a Pack utility, not something
    -- placed in a district (see the header note above).
    insert into rc_player_items (agent_no, item_id, district_id)
    values (p_agent_no, 'backup-pass', null);
  end if;

  return jsonb_build_object('rolled', true, 'awarded', v_win);
end;
$$;

revoke all on function public.rc_award_district_backup_pass(text, text, numeric)
  from public, anon, authenticated;
grant execute on function public.rc_award_district_backup_pass(text, text, numeric)
  to service_role;

-- Every district already restored before this shipped is marked as rolled,
-- with no award. Without this, the first poll after deploy would roll the
-- chance for every past restoration at once — 356 of them today — and hand
-- out a wave of passes for districts finished weeks ago. New sources start
-- from now, not retroactively.
update public.rc_player_districts
   set backup_pass_rolled_at = coalesce(completed_at, now())
 where status = 'restored' and backup_pass_rolled_at is null;

-- Same reasoning for levels: an agent sitting on level 12 should not be paid
-- six passes on their next poll. Seeding last_backup_pass_level to the level
-- they are already on means the alternation starts cleanly at their NEXT
-- level-up, which is the first one this feature was ever announced for.
update public.rc_players
   set last_backup_pass_level = greatest(coalesce(last_level, 1) - 1, 0)
 where last_backup_pass_level = 0;

-- The knobs, alongside the two this feature already had. Tunable with no
-- redeploy, same as every other rc_config value.
--   level_reward_from      no passes below this level
--   level_reward_every_other  the alternation; false pays at every level
--   district_drop_chance   0.2 = about one restored district in five
update public.rc_config
   set value = value
     || jsonb_build_object(
          'level_reward_from', 2,
          'level_reward_every_other', true,
          'district_drop_chance', 0.2
        )
 where key = 'backup_pass';
