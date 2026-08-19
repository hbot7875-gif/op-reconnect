-- Retire the photo pools carried over from the previous badge experience.
-- Earned badge rows are permanent player progress, so keep those awards and
-- only detach their old artwork. The public UI will use its neutral badge
-- fallback until the new cute/stage artwork pools are uploaded and catalogued.

begin;

-- The foreign key prevents deleting artwork that is still assigned. Clear
-- only assignments pointing at the two retired pools; unrelated future pools
-- are deliberately untouched.
update rc_badges b
set artwork_id = null
from rc_badge_art a
where b.artwork_id = a.id
  and a.pool in ('set1', 'set2');

delete from rc_badge_art
where pool in ('set1', 'set2');

commit;
