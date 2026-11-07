-- War of Cards — Card Champion: a new Achievement template in the Badge
-- Vault (Badge Maker), awarded for every 10 counted War of Cards wins (the award
-- itself is in 20261107120000_rc_war_of_cards_stats.sql).
--
-- Like every other template, its artwork is uploaded through the existing
-- Badge Maker workflow (badge-admin.html → addBadgeArt), so admins can add,
-- swap or switch off designs there. The award names this template id, never
-- an artwork, so a new design never changes who holds the badge.

-- A reusable frame a template can ask for. Badge Maker bakes it into the
-- uploaded image (js/badge-frames.js), so nothing that shows badges changes.
-- 'polaroid': a pastel lavender instant-film frame with rounded corners, a
-- chunky bottom and a playful tilt, around the maker's cropped photo. Null
-- (every existing template) means the photo as cropped, as before.
alter table public.rc_badge_catalog add column if not exists art_frame text;
alter table public.rc_badge_catalog drop constraint if exists rc_badge_catalog_art_frame_check;
alter table public.rc_badge_catalog add constraint rc_badge_catalog_art_frame_check
  check (art_frame is null or art_frame in ('polaroid'));

-- Card Champion: a Run BTS reaction photo in a Polaroid.
insert into public.rc_badge_catalog (id, section, rarity, name, unlock_hint, sort_order, active, art_frame)
values ('achievement_card_champion', 'achievement', 'rare', 'War of Cards — Card Champion',
        'Win 10 games of War of Cards. Every 10 more wins earns another.', 80, true, 'polaroid')
on conflict (id) do update set art_frame = excluded.art_frame, unlock_hint = excluded.unlock_hint;
