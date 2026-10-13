-- Birthday Lightkeeper: the Jimin Day Gift's community badge for anyone who
-- added light to the Jimin Birthday Room. Template only — artwork is uploaded
-- separately in Badge Makers. Applied ahead of the room/gift release so the
-- art can be in place before anyone can claim the gift.

insert into rc_badge_catalog (id, section, rarity, name, unlock_hint, sort_order, active)
values (
  'event_jimin_day_lightkeeper_2026', 'event', 'common', 'Birthday Lightkeeper',
  'Help restore the Jimin Birthday Room on Jimin Day 2026.', 147, true
)
on conflict (id) do update set
  section = excluded.section,
  name = excluded.name,
  rarity = excluded.rarity,
  unlock_hint = excluded.unlock_hint,
  sort_order = excluded.sort_order,
  active = excluded.active;
