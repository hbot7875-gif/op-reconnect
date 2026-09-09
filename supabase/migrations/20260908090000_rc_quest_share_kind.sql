-- Frozen Quest shares reuse the existing private table and opaque public token.
alter table public.rc_share_snapshots drop constraint if exists rc_share_snapshots_kind_check;
alter table public.rc_share_snapshots add constraint rc_share_snapshots_kind_check
  check (kind in ('district','red_zone_active','red_zone_success','quest'));
