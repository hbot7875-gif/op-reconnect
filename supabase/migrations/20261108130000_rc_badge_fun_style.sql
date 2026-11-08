-- A third Badge Maker photo style, 'fun', for game badges such as War of
-- Cards — Card Champion, where Cute and Hot don't fit (it's a Run BTS
-- reaction photo, not a stage or selca shot).
--
-- rc_badge_catalog.photo_style lets a template name the style it wants.
-- Null (every existing template) keeps today's rule: rare badges prefer Hot,
-- common badges prefer Cute. rc_award_badge prefers the template's own style
-- when it has one, and still falls back to any active photo, as before.
alter table public.rc_badge_catalog add column if not exists photo_style text;
alter table public.rc_badge_catalog drop constraint if exists rc_badge_catalog_photo_style_check;
alter table public.rc_badge_catalog add constraint rc_badge_catalog_photo_style_check
  check (photo_style is null or photo_style in ('cute', 'hot', 'fun'));

update public.rc_badge_catalog set photo_style = 'fun' where id = 'achievement_card_champion';

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
  v_style text;
  v_preferred_pool text;
begin
  select rarity, photo_style into v_rarity, v_style
    from rc_badge_catalog where id = p_template_id and active = true;
  if v_rarity is null then
    return null;
  end if;

  v_badge_id := p_template_id || case
    when nullif(p_scope_id, '') is null then '' else ':' || p_scope_id end;
  v_preferred_pool := coalesce(v_style, case when v_rarity = 'rare' then 'hot' else 'cute' end);

  select id into v_artwork_id
    from rc_badge_art
   where template_id = p_template_id
     and active = true
     and pool = v_preferred_pool
   order by random()
   limit 1;

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

do $$
begin
  if (select photo_style from rc_badge_catalog where id = 'achievement_card_champion') is distinct from 'fun' then
    raise exception 'Card Champion photo_style not set';
  end if;
end $$;
