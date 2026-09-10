-- Frozen milestone badge artwork; private source reference never enters public projections.
alter table public.rc_share_snapshots add column if not exists badge_art_id bigint;
alter table public.rc_share_snapshots drop constraint if exists rc_share_snapshots_kind_check;
alter table public.rc_share_snapshots add constraint rc_share_snapshots_kind_check
  check (kind in ('district','red_zone_active','red_zone_success','quest','city_bomb','badge'));
comment on column public.rc_share_snapshots.badge_art_id is
  'Private awarded art reference used only for owner-requested portrait rendering.';
