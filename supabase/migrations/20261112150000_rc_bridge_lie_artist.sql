-- "Lie" is a BTS track (Jimin's solo on WINGS, credited to BTS), not a Jimin
-- release. 20261112140000 added the Bangtan Seven Bridge goal with
-- artist 'Jimin'; this corrects the label. The artist on a goal is display
-- only: plays match by title, and XP checks the play's own artist against the
-- allowlist, so no count, target or XP changes. Idempotent.
update rc_goals set artist = 'BTS'
 where id = 'bridge-lie' and artist is distinct from 'BTS';
