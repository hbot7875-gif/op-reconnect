-- Fix: Golden Corner Defender and GOLDEN Encore badges were awarded with
-- no artwork (artwork_id null) — rc_award_badge resolves art strictly by
-- `template_id = p_template_id` (see its definition), and these two new
-- badge templates (added this session, migrations
-- 20260901230000_rc_golden_defender_badge.sql and
-- 20260901233000_rc_golden_encore_badge.sql) never got any rc_badge_art
-- rows registered for them, unlike event_jk_birthday_2026 which already
-- has a real uploaded photo set. Confirmed live: 3 agents (AGENT101,
-- AGENT003, AGENT086) already earned the Encore badge with artwork_id
-- null, which is why AGENT086 saw a generic fallback icon instead of a
-- Jung Kook photo.
--
-- Fix: both are the same JK GOLDEN-era keepsake family, so reuse the exact
-- same already-uploaded photo set from event_jk_birthday_2026 rather than
-- needing a fresh upload — same storage objects, just registered against
-- the two new template ids too.
insert into rc_badge_art (template_id, storage_path, member, members, pool, active, image_hash, uploaded_by)
select 'event_jk_golden_defender_2026', storage_path, member, members, pool, active, image_hash, uploaded_by
from rc_badge_art where template_id = 'event_jk_birthday_2026';

insert into rc_badge_art (template_id, storage_path, member, members, pool, active, image_hash, uploaded_by)
select 'event_jk_golden_encore_2026', storage_path, member, members, pool, active, image_hash, uploaded_by
from rc_badge_art where template_id = 'event_jk_birthday_2026';

-- Backfill the badges already awarded before this artwork existed —
-- rc_award_badge's own upsert (coalesce(rc_badges.artwork_id, ...)) would
-- do this automatically on the agent's next poll, but that's a silent wait
-- with no visible confirmation; pick one directly now instead.
update rc_badges b
set artwork_id = (
  select id from rc_badge_art a
  where a.template_id = b.badge_id and a.active = true
  order by random() limit 1
)
where b.badge_id in ('event_jk_golden_defender_2026', 'event_jk_golden_encore_2026')
  and b.artwork_id is null;
