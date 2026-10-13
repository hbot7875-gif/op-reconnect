-- Mnet prints a certificate's "Participation Date" on the voting phone's
-- local clock, not KST: an agent in India voting at 01:11 KST on Oct 14
-- gets "2026.10.13 21:41". The trusted date check read every printed time
-- as KST, so those valid votes failed "Correct voting date".
--
-- Keep the uploading phone's UTC offset (minutes, east positive; IST = 330)
-- with the proof. The trusted check converts the printed time with it before
-- comparing against the credited KST day. Only an offset — never a location
-- or time zone name. Null = unknown: the printed time is read as KST.
alter table public.rc_campaign_proofs
  add column if not exists cert_utc_offset_min smallint
  check (cert_utc_offset_min between -720 and 840 and cert_utc_offset_min % 15 = 0);
