-- Private ownership and bounded raster export; public API still uses its allowlist.
alter table public.rc_share_snapshots add column if not exists created_by text;
alter table public.rc_share_snapshots add column if not exists image_png text;
alter table public.rc_share_snapshots add column if not exists cache_key text;
alter table public.rc_share_snapshots drop constraint if exists rc_share_snapshots_kind_check;
alter table public.rc_share_snapshots add constraint rc_share_snapshots_kind_check
  check (kind in ('district','red_zone_active','red_zone_success','quest','city_bomb'));
alter table public.rc_share_snapshots add constraint rc_share_image_size
  check (image_png is null or octet_length(image_png) <= 700000);
create index if not exists rc_share_reuse on public.rc_share_snapshots (created_by, cache_key);
