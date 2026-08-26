-- One-off support grace for AGENT000's current district. Keep this separate
-- from activated_at: moving activation would also move the stream-counting
-- window and could erase valid early progress. It is also separate from the
-- player's one-time +3-day Deadline Extension Charge.
alter table public.rc_player_districts
  add column if not exists deadline_extension_hours integer not null default 0
  check (deadline_extension_hours >= 0);

do $$
declare
  v_active_count integer;
begin
  select count(*) into v_active_count
  from public.rc_player_districts
  where agent_no = 'AGENT000' and status = 'active';

  if v_active_count <> 1 then
    raise exception 'Expected exactly one active district for AGENT000, found %', v_active_count;
  end if;

  update public.rc_player_districts
  set deadline_extension_hours = deadline_extension_hours + 24
  where agent_no = 'AGENT000' and status = 'active';
end;
$$;
