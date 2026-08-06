-- Magic Shop's one-time ticket must exist as a real collection object so
-- items.js can launch the concert. It is never eligible for random drops.
insert into rc_items (id, kind, name, rarity, blurb, active, drop_weight)
select 'concert-ticket', 'ticket', 'Concert Ticket', 'legendary',
  'Your way into the concert. Tap to open the doors.', false, 0
where not exists (select 1 from rc_items where kind = 'ticket');

-- Backfill agents who claimed the old numeric ticket before the collection
-- object was wired in. Idempotent across repeated migration runs.
insert into rc_player_items (agent_no, item_id, district_id)
select p.agent_no, i.id, null
from rc_players p
cross join lateral (select id from rc_items where kind = 'ticket' order by id limit 1) i
where p.tickets > 0
  and not exists (
    select 1 from rc_player_items pi
    join rc_items ri on ri.id = pi.item_id
    where pi.agent_no = p.agent_no and ri.kind = 'ticket'
  );
