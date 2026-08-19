-- Correct the previous migration's scope: restore the BTS photo artwork and
-- remove only the old fire/star/XP/district emoji badges from player profiles.
-- Historical badge rows remain untouched; they simply stop being wearable.

begin;

-- Rebuild the photo catalogue directly from the files that remain safely in
-- the public badge-art bucket. Distribute them evenly over active templates,
-- matching the round-robin intent of the original seed without hardcoding
-- hundreds of filenames again.
with available_templates as (
  select id,
         row_number() over (order by sort_order, id) as template_no,
         count(*) over () as template_count
  from rc_badge_catalog
  where active = true
),
stored_photos as (
  select o.name as storage_path,
         split_part(o.name, '/', 1) as pool,
         lower(regexp_replace(split_part(split_part(o.name, '/', 2), '.', 1), '[( _].*$', '')) as member,
         row_number() over (order by o.name) as photo_no
  from storage.objects o
  where o.bucket_id = 'badge-art'
    and (o.name like 'set1/%' or o.name like 'set2/%')
)
insert into rc_badge_art (template_id, storage_path, member, pool)
select t.id, p.storage_path, p.member, p.pool
from stored_photos p
join available_templates t
  on t.template_no = ((p.photo_no - 1) % t.template_count) + 1
where not exists (
  select 1 from rc_badge_art existing
  where existing.storage_path = p.storage_path
);

-- Give existing photo-collection awards their artwork back. The choice is
-- made once here and remains attached to that earned badge afterward.
update rc_badges b
set artwork_id = (
  select a.id
  from rc_badge_art a
  where a.active = true
    and a.template_id = split_part(b.badge_id, ':', 1)
  order by random()
  limit 1
)
where b.artwork_id is null
  and exists (
    select 1 from rc_badge_catalog c
    where c.id = split_part(b.badge_id, ':', 1)
      and c.active = true
  );

-- If an old emoji achievement was worn, return the profile to the default
-- agent icon. Photo badges and their equipped state are left alone.
update rc_players
set equipped_badge_id = null
where equipped_badge_id ~ '^(streak|level|districts|xp):';

commit;
