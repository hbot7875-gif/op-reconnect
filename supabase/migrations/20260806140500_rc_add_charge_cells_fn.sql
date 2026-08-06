-- Atomic increment for rc_players.charge_cells — avoids a read-modify-write
-- race if an agent's own two devices poll at the same moment (unlikely, but
-- free to prevent with a single UPDATE rather than a select-then-update
-- round trip from the edge function).
create or replace function rc_add_charge_cells(p_agent_no text, p_amount int)
returns void
language sql
as $$
  update rc_players set charge_cells = charge_cells + p_amount where agent_no = p_agent_no;
$$;
