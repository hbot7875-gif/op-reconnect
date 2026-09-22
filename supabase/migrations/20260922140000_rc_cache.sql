-- A tiny shared cache for network-wide computations that every agent's
-- poll needs but none should recompute: the era timeline (a full scan of
-- rc_daily_activity) and the ARMY Bomb's community snapshot. In-isolate
-- caches were tried first and never hit — each request lands on a fresh
-- edge isolate — so the cache has to live where every isolate can see it.
-- One indexed row read (~50ms) replaces 500–900ms of recomputation.
-- See lib/cache.ts.

create table if not exists public.rc_cache (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.rc_cache enable row level security;
revoke all on public.rc_cache from public, anon, authenticated;
grant select, insert, update, delete on public.rc_cache to service_role;
