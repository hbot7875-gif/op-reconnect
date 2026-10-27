-- MAMA 2026 · Round 2: the official category names, in the event's own
-- words (values only — no table, function or rule changes).
--
-- Round 2 is Fans' Choice, not "the Daesang": one Mnet round is three
-- categories — Fans' Choice Male, Fans' Choice Female and VISA Fans' Choice
-- of the Year (the Daesang). The header now reads "Round 2 · Fans' Choice";
-- the Mnet rule and guide name each category, and a structured
-- `categories` list lets the guide and the Mnet card show them as three
-- distinct rows. The schedule (Oct 28 18:00 – Nov 8 23:59 KST), the
-- certificate keywords, hashtags and every verification rule are unchanged.

begin;

update public.rc_vote_campaigns c
   set round_label = 'Round 2 · Fans'' Choice',
       missions = (
         select jsonb_agg(
           case m ->> 'id'
             when 'mnet' then m || '{
               "rule": "Vote all three categories, then save the certificate. It should show BTS / your female pick / BTS.",
               "categories": [
                 {"name": "Fans'' Choice Male", "pick": "BTS"},
                 {"name": "Fans'' Choice Female", "pick": "Your pick"},
                 {"name": "VISA Fans'' Choice of the Year", "tag": "Daesang", "pick": "BTS"}
               ],
               "guide": [
                 "Vote once per day per Mnet Plus ID and device. The day resets at 00:00 KST.",
                 "One round is all three categories: Fans'' Choice Male → BTS, Fans'' Choice Female → your pick, VISA Fans'' Choice of the Year (the Daesang) → BTS.",
                 "Fan tip: many ARMY pick the lowest-ranked artist in Fans'' Choice Female. The VISA Fans'' Choice of the Year vote for BTS matters most.",
                 "Press the final submit button, then save the certificate Mnet shows you. It should read BTS / your female pick / BTS.",
                 "Round 1 votes are not added to Round 2. Every day counts again."
               ]
             }'::jsonb
             when 'x' then m || '{
               "guide": [
                 "Once per day per X account, and only public accounts count.",
                 "Use exactly #2026MAMAVOTE and #BTS (any case). Add no other artist hashtag; posts with several artist hashtags are not counted.",
                 "Only your first voting post of the day counts. One post counts for both Fans'' Choice Male and VISA Fans'' Choice of the Year (the Daesang).",
                 "Reposting a valid vote post also counts on X. Here, add the link to your own post. Don''t delete it until voting closes."
               ]
             }'::jsonb
             else m
           end order by i)
         from jsonb_array_elements(c.missions) with ordinality as e(m, i)
       )
 where c.id = 'mama_2026_r2';

commit;
