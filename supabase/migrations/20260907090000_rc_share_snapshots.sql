-- Link-first social sharing. A snapshot is intentionally detached from the
-- player who created it: the opaque id is the only lookup key and data holds
-- only the small, already-approved public card payload. Service-role access
-- only; the Edge Function exposes a strict allowlisted public projection.

create table if not exists public.rc_share_snapshots (
  id text primary key,
  kind text not null check (kind in ('district', 'red_zone_active', 'red_zone_success')),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 year'),
  constraint rc_share_snapshots_opaque_id check (id ~ '^[A-Za-z0-9_-]{22}$')
);

create index if not exists rc_share_snapshots_expires_at_idx
  on public.rc_share_snapshots (expires_at);

alter table public.rc_share_snapshots enable row level security;

comment on table public.rc_share_snapshots is
  'Opaque, identity-free public share snapshots. Read/write only through the op-reconnect Edge Function.';
