-- Badge Collection: the reskinned successor to the old site's Badge Drawer.
-- Keeps what worked there (weekly/chapter grouping, common-vs-rare shapes,
-- locked silhouettes, permanent archive, equip-as-PFP, rare reveal) but in
-- OP: ReConnect's own language and visuals — see design thread for the full
-- old-vs-new terminology table. No neon/combat styling, no per-district rows.
--
-- rc_badge_catalog holds *templates* only (Fragment I, Recovered Memory, ...),
-- reused across every district/ward the same way rc_items' 40-item catalogue
-- is reused across all 247 districts — nothing here is per-district data.
--
-- Art is real member photos (matching the old site's actual Badge Drawer,
-- not the "drawn, never copied" rule that's specific to the merch/item
-- catalogue). rc_badge_art holds a pool of photos per template — several per
-- template, one gets picked at award time. Unlike the old site, no separate
-- "freeze" table is needed: an rc_badges row is already permanent per
-- (agent, badge_id), so picking the art once at insert time is enough — see
-- rc_badges.artwork_id below.
--
-- Awards reuse the existing rc_badges (agent_no, badge_id, earned_at) log.
-- An award's badge_id is "<template_id>:<scope_id>" for scoped badges
-- (e.g. 'district_frag_1:tae13') or just "<template_id>" for global ones
-- (e.g. 'mission_bond'). Splitting on the last ':' at read time recovers the
-- template to render (name/rarity/unlock hint) and the scope to label it with.

create table if not exists rc_badge_catalog (
  id text primary key,                    -- template id, e.g. 'district_frag_1'
  section text not null check (section in ('district', 'ward', 'achievement', 'event')),
  rarity text not null default 'common' check (rarity in ('common', 'rare')),
  name text not null,                     -- "Fragment I" — plain, not themed jargon
  unlock_hint text not null,              -- "Reach 25% progress in this district."
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Public bucket: badge art is fan photos meant to be shown to the agent who
-- earned them, no privacy concern the way vote-proof screenshots have.
insert into storage.buckets (id, name, public)
values ('badge-art', 'badge-art', true)
on conflict (id) do nothing;

-- Pool of candidate photos per template. `pool` is a free-text label for
-- whatever grouping the source images came in (e.g. 'cute_ones', 'hot_ones')
-- so a template can later be restricted to a specific pool if wanted —
-- nothing here hardcodes a selection rule, that's an admin/backend decision.
create table if not exists rc_badge_art (
  id bigint generated always as identity primary key,
  template_id text not null references rc_badge_catalog (id),
  storage_path text not null,             -- object key in the 'badge-art' bucket
  member text,                            -- which BTS member, if relevant (label only)
  pool text,                              -- source grouping, e.g. 'cute_ones'
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists rc_badge_art_template_idx on rc_badge_art (template_id) where active;

-- Which rc_badge_art photo a specific award actually got. Picked once, at
-- award time, from that template's active pool — permanent from then on.
alter table rc_badges add column if not exists artwork_id bigint references rc_badge_art (id);

-- Equipping already exists: rc_players.equipped_badge_id + setEquippedBadge()
-- in lib/badge-profile.ts. No new column needed — see that file's ownership
-- check, which is extended below to recognize catalog-templated badge_ids
-- (e.g. 'district_frag_1:tae13') the same way it already checks STREAK_BADGES:
-- an exact-match lookup against rc_badges, not a hardcoded threshold.

create index if not exists rc_badges_agent_no_idx on rc_badges (agent_no);

comment on table rc_badge_catalog is
  'Reusable badge templates for the Badge Collection screen. Not per-district — see migration header.';
comment on table rc_badge_art is
  'Photo pool per badge template. One gets picked and stored on rc_badges.artwork_id at award time — permanent from then on, no freeze step needed.';

-- Seed: the initial template set from the design spec. INSERT-only, additive
-- (matches the existing catalogue convention — see rc_items/rc_wards).
-- No rc_badge_art rows seeded here — those get inserted once the actual
-- photo files are uploaded to the 'badge-art' bucket.
insert into rc_badge_catalog (id, section, rarity, name, unlock_hint, sort_order) values
  ('district_frag_1',  'district',    'common', 'Badge',       'Reach 25% progress in this district.',            10),
  ('district_frag_2',  'district',    'common', 'Badge',       'Reach 50% progress in this district.',            20),
  ('district_frag_3',  'district',    'common', 'Badge',       'Reach 75% progress in this district.',            30),
  ('district_restored','district',    'rare',   'Rare Badge',  'Restore this district.',                          40),
  ('ward_restored',    'ward',        'rare',   'Rare Badge',  'Restore every district in this ward.',            50),
  ('mission_bond',     'achievement', 'common', 'Badge',       'Complete a ReConnect mission.',                   60),
  ('quiz_perfect',     'achievement', 'rare',   'Rare Badge',  'Get every quiz answer correct.',                  70),
  ('event_vma_voter',       'event', 'common', 'Badge',       'Vote for BTS in the MTV VMAs 2026 voting mission.', 80),
  ('event_vma_power_hour',  'event', 'rare',   'Rare Badge',  'Vote during a VMA Power Hour.',                     90),
  ('event_vma_double_day',  'event', 'common', 'Badge',       'Vote on a VMA Double Day.',                         100)
on conflict (id) do nothing;
