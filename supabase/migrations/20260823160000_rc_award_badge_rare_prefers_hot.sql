-- Rare badges should draw from the Hot pool when there's Hot art tagged for
-- that template, falling back to the whole active pool otherwise -- so this
-- is a no-op today (no art is tagged 'hot' yet) and starts mattering as soon
-- as editors tag Hot art for a rare template through the Badge Vault. Common
-- badges are untouched: fully random across the whole active pool, same as
-- before.
create or replace function rc_award_badge(
  p_agent_no text, p_template_id text, p_scope_id text default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_badge_id text;
  v_artwork_id bigint;
  v_rarity text;
begin
  select rarity into v_rarity
    from rc_badge_catalog where id = p_template_id and active = true;
  if v_rarity is null then
    return null;
  end if;

  v_badge_id := p_template_id || case
    when nullif(p_scope_id, '') is null then '' else ':' || p_scope_id end;

  if v_rarity = 'rare' then
    select id into v_artwork_id
      from rc_badge_art
     where template_id = p_template_id and active = true and pool = 'hot'
     order by random()
     limit 1;
  end if;

  if v_artwork_id is null then
    select id into v_artwork_id
      from rc_badge_art
     where template_id = p_template_id and active = true
     order by random()
     limit 1;
  end if;

  insert into rc_badges (agent_no, badge_id, artwork_id)
  values (p_agent_no, v_badge_id, v_artwork_id)
  on conflict (agent_no, badge_id) do update
    set artwork_id = coalesce(rc_badges.artwork_id, excluded.artwork_id);

  return v_badge_id;
end;
$$;

revoke all on function rc_award_badge(text, text, text) from public, anon, authenticated;
grant execute on function rc_award_badge(text, text, text) to service_role;
