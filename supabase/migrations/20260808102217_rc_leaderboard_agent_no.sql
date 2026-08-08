-- rc_leaderboard grouped by agent_no internally (correctly — one row per
-- agent even if two share a codename) but never exposed it, leaving
-- leaderboard.ts to join equipped-badge icons back onto rows by codename
-- instead. validateCodename (handlers.ts) only rejects a codename matching
-- your OWN agent number or handle — it was never checked against every
-- OTHER agent's codename, so two agents landing on the same one is a real,
-- reachable state, just one that hasn't happened yet (checked: zero
-- duplicates in production today). The moment it does, the codename->icon
-- map would silently keep only the last-processed agent's badge and show
-- it on both rows.
--
-- agent_no is fine to return from this function even though the file's own
-- header comment says "agent numbers never leave this file" — leaderboard.ts
-- uses it purely as an internal join key and still never puts it in the
-- response it sends the client, so that promise still holds from the
-- caller's perspective.
-- CREATE OR REPLACE can't change a function's return column set — Postgres
-- rejects that outright — so the old 3-column signature has to go first.
drop function if exists public.rc_leaderboard();

create function public.rc_leaderboard()
returns table(agent_no text, codename text, mode text, xp bigint)
language sql
stable
as $$
  select p.agent_no, p.codename, p.mode, coalesce(sum(l.amount), 0)::bigint as xp
  from rc_players p
  left join rc_xp_ledger l on l.agent_no = p.agent_no
  group by p.agent_no, p.codename, p.mode
  order by xp desc;
$$;
