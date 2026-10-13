-- Jimin Day reward split: the Jimin Birthday Badge now comes from the shared
-- room's Jimin Day Gift (room at 100% + your own Era Card complete), not from
-- the Era Card alone. Ships with the room/gift release so the live hint never
-- describes a rule that is not live yet.

update rc_badge_catalog
   set unlock_hint = 'Complete your Jimin Birthday Era Card and help restore the Jimin Birthday Room on Jimin Day 2026.'
 where id = 'event_jimin_birthday_2026';
