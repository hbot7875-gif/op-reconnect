-- Badge Vault — let named agents upload badge art themselves.
--
-- Until now rc_badge_art was populated the hard way: upload files to the
-- 'badge-art' bucket by hand, then write a migration to register the rows
-- (see 20260819150000_rc_badge_art_seed.sql). That works once; it does not
-- work when several people are adding badges regularly.
--
-- Two small additions, no behaviour change to anything already running:
--
--   1. rc_badge_art.uploaded_by — who added this photo. Plain agent_no
--      text, deliberately NOT a foreign key: an uploader retiring their
--      agent file must never cascade-delete or block deletion of artwork
--      that other players are already wearing on their awards.
--
--   2. rc_config.badge_editors — the agent numbers allowed to use the
--      Badge Vault. Same admin-editable rc_config pattern bts_artists
--      already uses, so it can be changed from the dashboard without a
--      deploy. AGENT000 is additionally hardcoded as always-allowed in
--      the edge function, so a bad edit here can never lock everyone out.
--
-- Nothing here grants access to anything else. A badge editor is not an
-- admin: the Badge Vault routes are the only ones that accept this
-- permission, and SYNC_ADMIN_KEY still gates every existing admin action.

alter table rc_badge_art
  add column if not exists uploaded_by text;

comment on column rc_badge_art.uploaded_by is
  'agent_no of whoever uploaded this photo via the Badge Vault. Null for the original migration-seeded rows.';

-- Start with nobody but AGENT000 (which is implicit in code anyway).
-- Add agent numbers here as members join the effort, e.g.
--   update rc_config set value = '["AGENT042","AGENT117"]'::jsonb
--    where key = 'badge_editors';
insert into rc_config (key, value)
values ('badge_editors', '[]'::jsonb)
on conflict (key) do nothing;
