-- Badge Vault UX v2: preserve every person visible in a photo and prevent an
-- identical crop being registered twice for the same badge template.
--
-- `member` remains as a readable compatibility label because older code and
-- migrations already know it. New code writes both fields; `members` is the
-- structured source used by filters and the maker UI.
alter table rc_badge_art
  add column if not exists members text[] not null default '{}'::text[],
  add column if not exists image_hash text;

update rc_badge_art
set members = case lower(trim(coalesce(member, '')))
  when 'bts' then array['BTS']
  when 'rm' then array['RM']
  when 'namjoon' then array['RM']
  when 'jin' then array['Jin']
  when 'seokjin' then array['Jin']
  when 'suga' then array['SUGA']
  when 'yoongi' then array['SUGA']
  when 'j-hope' then array['j-hope']
  when 'jhope' then array['j-hope']
  when 'hoseok' then array['j-hope']
  when 'jimin' then array['Jimin']
  when 'v' then array['V']
  when 'taehyung' then array['V']
  when 'jung kook' then array['Jung Kook']
  when 'jungkook' then array['Jung Kook']
  else case when nullif(trim(coalesce(member, '')), '') is null
    then array['BTS'] else array[trim(member)] end
end
where cardinality(members) = 0;

create unique index if not exists rc_badge_art_template_image_hash_uidx
  on rc_badge_art (template_id, image_hash)
  where image_hash is not null;

comment on column rc_badge_art.members is
  'Canonical people visible in the artwork. BTS means a full-group photo; duos/sub-units store each member.';
comment on column rc_badge_art.image_hash is
  'SHA-256 of the uploaded cropped bytes, unique per badge template to prevent accidental duplicate uploads.';
