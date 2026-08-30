-- Winning a Red Zone now charges every qualified agent's own ARMY Bomb to
-- full, the mirror of the Blackout penalty: lose and your charge drops to
-- 0, win and it fills. Until now success paid XP only, so "we saved the
-- Bomb" left the Bomb itself in exactly the state it started in.
--
-- Two rules this function exists to enforce, neither of which a plain
-- UPDATE from the edge function could:
--
--  * A reward must never take charge away. An agent sitting on 60 hours
--    (Cells, lit eras) would be cut to 48 by a naive "set charged_until to
--    now + 48h". greatest() keeps whichever is further out.
--  * An agent who has never fed their Bomb has no rc_agent_charge row at
--    all, so this has to insert one rather than update nothing. The join
--    against rc_players keeps a stale agent_no from tripping the foreign
--    key and failing the whole settlement.
--
-- Deliberately NOT idempotent-guarded here: refreshDefuse settles an event
-- exactly once (the compare-and-set on progress_refreshed_at), and calling
-- this twice would in any case be a no-op thanks to greatest().

create or replace function rc_red_zone_full_charge(
  p_agent_nos text[],
  p_hours integer
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_agent_nos is null or array_length(p_agent_nos, 1) is null or p_hours is null or p_hours <= 0 then
    return 0;
  end if;

  insert into rc_agent_charge as ac (agent_no, charged_until, updated_at)
  select p.agent_no, now() + make_interval(hours => p_hours), now()
    from unnest(p_agent_nos) as a(agent_no)
    join rc_players p on p.agent_no = a.agent_no
  on conflict (agent_no) do update
    set charged_until = greatest(coalesce(ac.charged_until, excluded.charged_until), excluded.charged_until),
        blackout_started_at = null,
        soft_reset_at = null,
        full_reset_at = null,
        updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function rc_red_zone_full_charge(text[], integer) from public, anon, authenticated;
grant execute on function rc_red_zone_full_charge(text[], integer) to service_role;

comment on function rc_red_zone_full_charge(text[], integer) is
  'Red Zone win reward: charge each qualified agent''s ARMY Bomb to full, never lowering an agent already charged further out. Mirror of the Blackout penalty in bomb.ts.';
