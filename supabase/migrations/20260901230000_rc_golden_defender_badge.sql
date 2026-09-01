-- A second, more common badge alongside event_jk_birthday_2026 (which
-- needs a personal 13/13 GOLDEN card). This one is for any Defender --
-- anyone who logged at least one counted GOLDEN play during the event
-- window -- awarded once the whole City finishes lighting the room
-- together, not tied to personal completion at all. Awarded directly via
-- rc_award_badge from the edge function (agent-charge.ts's
-- computeGoldenCorner) once communityLights reaches target; no separate
-- claim RPC needed since rc_award_badge is itself idempotent.

insert into rc_badge_catalog (id, section, rarity, name, unlock_hint, sort_order, active)
values (
  'event_jk_golden_defender_2026', 'event', 'common', 'Golden Corner Defender',
  'Help light Golden Corner before the whole City reaches 100%.', 131, true
)
on conflict (id) do update set
  name = excluded.name,
  unlock_hint = excluded.unlock_hint,
  active = true;
