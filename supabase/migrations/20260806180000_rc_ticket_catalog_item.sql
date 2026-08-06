-- Magic Shop's claimTicket only ever bumped rc_players.tickets (an integer),
-- never created anything in rc_player_items — so a claimed ticket had no
-- item.kind === 'ticket' row for the Pack/concert-launch flow (items.js's
-- useTicket) to ever find or tap. This seeds one real catalog row so
-- claimTicket can insert a genuine rc_player_items row against it.
--
-- active=false, drop_weight=0: this item must never surface through the
-- random district-restoration drop roll (rc_roll_item) — a concert ticket
-- is a deliberate Magic Shop unlock (Level 7+, 3 districts, 50 XP), not
-- something that should ever come out of a random collectible drop.
insert into rc_items (id, kind, name, rarity, blurb, active, drop_weight)
select 'concert-ticket', 'ticket', 'Concert Ticket', 'legendary',
  'Your way into the concert. Tap to open the doors.', false, 0
where not exists (select 1 from rc_items where kind = 'ticket');

-- Repair agents who claimed the numeric ticket before it became a usable
-- inventory object. Safe to rerun: one row per agent is inserted only when
-- no ticket item already exists for them.
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
