-- Lit Eras are weekly, manually-used emergency cards. Existing rows already
-- granted +10h under the old automatic system, so mark them used during the
-- migration to prevent a second reward after this release.
alter table public.rc_agent_lit_eras
  add column if not exists used_at timestamptz;

update public.rc_agent_lit_eras
set used_at = coalesce(used_at, lit_at)
where used_at is null;

-- Atomically consume one ready card and extend personal ARMY Bomb charge.
-- The Edge Function calls this with the service role after agent-session
-- verification; public clients cannot invoke it directly.
create or replace function public.rc_use_lit_era(
  p_agent_no text,
  p_era_id text,
  p_week_key text,
  p_hours integer default 10
) returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_until timestamptz;
begin
  update public.rc_agent_lit_eras
  set used_at = now()
  where agent_no = p_agent_no
    and era_id = p_era_id
    and week_key = p_week_key
    and used_at is null;

  if not found then return null; end if;

  insert into public.rc_agent_charge (
    agent_no, charged_until, auto_feed, blackout_started_at,
    soft_reset_at, full_reset_at, updated_at
  ) values (
    p_agent_no, now() + make_interval(hours => p_hours), false,
    null, null, null, now()
  )
  on conflict (agent_no) do update set
    charged_until = greatest(coalesce(rc_agent_charge.charged_until, now()), now())
      + make_interval(hours => p_hours),
    blackout_started_at = null,
    soft_reset_at = null,
    full_reset_at = null,
    updated_at = now()
  returning charged_until into v_until;

  return v_until;
end;
$$;

revoke all on function public.rc_use_lit_era(text, text, text, integer) from public;
grant execute on function public.rc_use_lit_era(text, text, text, integer) to service_role;
