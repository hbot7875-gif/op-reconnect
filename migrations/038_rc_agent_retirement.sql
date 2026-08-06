-- Retirement Protocol — a soft delete. An agent who retires is locked out of
-- login (auth.ts's loginAgent/verifySession both check this), but nothing
-- about them is erased: rc_players, rc_player_districts, badges, xp ledger
-- all stay exactly as they are. Districts are named after real agents and
-- there are 258 of them with no team structure to fall back on — pulling a
-- retired agent's district off the shared map would leave a hole in it, so
-- it just stops being editable instead.
alter table rc_agents add column if not exists retired_at timestamptz;
