-- Jimin birthday badge template -- artwork is uploaded separately in Badge Makers.
-- This release only registers the catalog entry; it does not award the badge
-- or add any birthday Era Card, popup, reward, or room behavior.

insert into rc_badge_catalog (id, section, rarity, name, unlock_hint, sort_order, active)
values (
  'event_jimin_birthday_2026', 'event', 'rare', 'Jimin Birthday Badge',
  'Complete the MUSE Birthday Era on October 13, 2026.', 146, true
)
on conflict (id) do update set
  section = excluded.section,
  name = excluded.name,
  rarity = excluded.rarity,
  unlock_hint = excluded.unlock_hint,
  sort_order = excluded.sort_order,
  active = excluded.active;
