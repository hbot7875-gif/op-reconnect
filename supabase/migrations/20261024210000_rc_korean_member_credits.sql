-- ListenBrainz often credits BTS and the members in Hangul only. The group's
-- Korean name was already on the allowlist but could never match (fixed in
-- lib/text.ts's artistAllowed, which now normalizes entries the way it
-- normalizes artists). The members' Korean names were never on it at all.
--
-- Last 90 days, plays credited ONLY in Hangul (every top track is the member's
-- own BTS-catalog song — The Astronaut, Who, Standing Next to You, Seven ...):
--   방탄소년단 4,510   진 875   지민 500   정국 444
-- 슈가, 제이홉 and 뷔 have no such plays yet; added so they count when they do.
-- Matching is whole-token ("진" never matches inside "진아"), the same rule
-- that keeps "v" from matching "vantae".
update public.rc_config
   set value = value || (
         select coalesce(jsonb_agg(n), '[]'::jsonb)
           from unnest(array['진', '지민', '정국', '슈가', '제이홉', '뷔']) as n
          where not value ? n),
       updated_at = now()
 where key = 'bts_artists';

do $$
declare
  v_missing integer;
begin
  select count(*) into v_missing
    from unnest(array['방탄소년단', '진', '지민', '정국', '슈가', '제이홉', '뷔']) as n
   where not exists (select 1 from rc_config where key = 'bts_artists' and value ? n);
  if v_missing > 0 then raise exception '% Korean credit(s) missing from bts_artists', v_missing; end if;
end $$;
