-- BOTZ redesign Phase 3 — per-agent ARMY Bomb charge, replacing the shared
-- network-wide pool in bomb.ts. See docs/botz-network-redesign.md decision 1.
--
-- charged_until: an absolute expiry, not a decaying counter — "how much
-- charge is left" is just `charged_until - now()`, computed at read time
-- (same philosophy derive.ts's header comment states for the rest of this
-- game: no background job decrements anything). Feeding the Bomb (Charge
-- Cells or a Lit-up Era) pushes this further into the future.
--
-- blackout_started_at: set the moment charged_until first falls behind now
-- and stays null again the moment the agent re-feeds. soft_reset_at /
-- full_reset_at mark the two blackout consequences (decisions: 7 days →
-- abandon the active district back to Home Base; 14 days → every restored
-- district reverts, XP stays banked) as already applied for THIS blackout
-- stretch, so they never re-fire on every subsequent poll once there's
-- nothing left to reset.
create table if not exists rc_agent_charge (
  agent_no          text primary key references rc_players(agent_no) on delete cascade,
  charged_until     timestamptz,
  auto_feed         boolean not null default false,
  blackout_started_at timestamptz,
  soft_reset_at     timestamptz,
  full_reset_at     timestamptz,
  updated_at        timestamptz not null default now()
);

-- Lit-up Eras — per-agent, per-week. A row existing means that era was lit
-- (every one of its tracks streamed at least once) during that week; the
-- +10h charge grant happens once, at insert (charge-economy.ts guards
-- against granting twice via this table's own primary key). Doesn't carry
-- into next week by design — week_key changing is the whole reset.
create table if not exists rc_agent_lit_eras (
  agent_no  text not null references rc_players(agent_no) on delete cascade,
  era_id    text not null,
  week_key  text not null,
  lit_at    timestamptz not null default now(),
  primary key (agent_no, era_id, week_key)
);
