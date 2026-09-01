-- Third GOLDEN badge: an "Encore" for anyone who keeps streaming past their
-- own completed 13/13 card, until every track has been counted at least
-- twice within the same event window. Rarer than the base completion badge
-- (event_jk_birthday_2026) since it needs double the plays; independent of
-- Golden Corner Defender (community-wide, not personal). Awarded directly
-- via rc_award_badge from agent-charge.ts's computeWeeklyEraCards, same
-- idempotent-upsert pattern as Defender — no separate claim RPC needed.
insert into rc_badge_catalog (id, section, rarity, name, unlock_hint, sort_order, active)
values (
  'event_jk_golden_encore_2026', 'event', 'rare', 'GOLDEN Encore',
  'Stream every track on the GOLDEN Birthday Era Card twice over.', 132, true
)
on conflict (id) do update set
  name = excluded.name,
  unlock_hint = excluded.unlock_hint,
  active = true;
