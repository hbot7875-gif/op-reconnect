-- "Perfect Quiz" was defined in the catalog with an unlock hint ("Get every
-- quiz answer correct") but no quiz feature was ever built -- nothing in the
-- backend ever checks or awards it. Confirmed zero awards and zero art rows
-- attached before removing it, so this is a clean delete, not a deactivate.
delete from rc_badge_catalog where id = 'quiz_perfect';
