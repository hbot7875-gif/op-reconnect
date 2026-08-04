-- Reconnect Missions — the cooperative bonus stage a district's own player
-- unlocks after finishing ITS solo track+album goals: team up with other
-- agents who have ALSO personally finished that same district, and stream
-- one shared target track together to earn a bonus reward. Doesn't gate or
-- change solo restoration in any way — rc_player_districts.status still
-- flips to 'restored' exactly as it always has; this is what becomes
-- available to do next, not a requirement to get there.
--
-- required_agents/track are configured per-district here directly (no admin
-- UI yet — same as how district content itself is seeded). A district with
-- reconnect_required left null simply never offers this.

alter table rc_districts add column if not exists reconnect_required int;
alter table rc_districts add column if not exists reconnect_track_label text;
alter table rc_districts add column if not exists reconnect_track_artist text;
alter table rc_districts add column if not exists reconnect_track_aliases jsonb not null default '[]';

create table if not exists rc_reconnect_missions (
  id               uuid primary key default gen_random_uuid(),
  district_id      text not null references rc_districts(id),
  required_agents  int not null,
  track_label      text not null,
  track_artist     text,
  track_aliases    jsonb not null default '[]',
  status           text not null default 'open' check (status in ('open','complete','expired','cancelled')),
  created_by       text not null,
  created_at       timestamptz not null default now(),
  completed_at     timestamptz,
  -- 7 days to fill the roster and get everyone's stream in, mirroring how
  -- Red Zone events (rc_defuse_events.active_until) already expire.
  expires_at       timestamptz not null default (now() + interval '7 days')
);

-- At most one open mission per district at a time — once it resolves
-- (complete/expired/cancelled), a fresh one can open.
create unique index if not exists rc_reconnect_one_open_per_district
  on rc_reconnect_missions (district_id) where status = 'open';

create table if not exists rc_reconnect_participants (
  mission_id   uuid not null references rc_reconnect_missions(id) on delete cascade,
  agent_no     text not null,
  -- 'invited' = a pending invite, doesn't count toward required_agents until
  -- accepted (status -> 'joined'). Open-matchmaking joins go straight to
  -- 'joined'. A declined invite is deleted outright rather than kept as a
  -- third status — nothing downstream needs to know someone said no.
  status       text not null default 'joined' check (status in ('invited','joined')),
  invited_by   text,
  joined_at    timestamptz not null default now(),
  streamed_at  timestamptz,
  primary key (mission_id, agent_no)
);

create index if not exists rc_reconnect_participants_agent on rc_reconnect_participants (agent_no);

-- Reward for everyone who finishes a mission — same tunable-without-redeploy
-- pattern as level_rewards/xp_rules (config.ts's xpRules/modeMultiplier).
insert into rc_config (key, value) values
('reconnect_rewards', '{"xp":100,"fuel":20}')
on conflict (key) do update set value = excluded.value;

-- A first batch of Mono Ward districts get this enabled, required_agents
-- genuinely varying per district (not a fixed constant) — same track
-- references (id/label/artist/aliases) already seeded in rc_goals above,
-- so this is real, already-catalogued content, not new song data.
update rc_districts set
  reconnect_required = 4,
  reconnect_track_label = 'Swim',
  reconnect_track_artist = 'BTS',
  reconnect_track_aliases = '[]'
where id = 'mono-hopesize-station';

update rc_districts set
  reconnect_required = 3,
  reconnect_track_label = 'Wild Flower',
  reconnect_track_artist = 'RM',
  reconnect_track_aliases = '["Wild Flower (with 조유진)","야생화","야생화 Wild Flower","야생화 Wild Flower (with 조유진)","Wild Flower (with youjeen)"]'
where id = 'mono-dazzledew-fountain';

update rc_districts set
  reconnect_required = 6,
  reconnect_track_label = 'Haegeum',
  reconnect_track_artist = 'Agust D',
  reconnect_track_aliases = '["해금","해금 Haegeum"]'
where id = 'mono-map-of-seven-crossing';
