-- MAMA Battle share: one more private engagement event type.
--
-- The share sheet records which of its actions ran (opened, share poster,
-- share link, try another style, save, copy link, copy text) as
-- event_type 'battle_share' with metadata { action, style?, outcome? } —
-- fixed words only, validated by the Edge Function (battle-share-events.js).
-- Never the custom team lines or the share text. Same table, same privacy
-- rules and retention as every other engagement event.
alter table public.rc_engagement_events drop constraint if exists rc_engagement_events_event_type_check;
alter table public.rc_engagement_events add constraint rc_engagement_events_event_type_check check (event_type in (
  'app_opened', 'screen_viewed', 'district_opened', 'reconnect_opened',
  'invite_sent', 'invite_accepted', 'queue_built', 'stream_detected',
  'battle_share'
));
