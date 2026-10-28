-- MAMA Round 2: the real Mnet Plus vote link for Fans' Choice 2nd vote.
-- Already applied to production by hand on 2026-10-28; idempotent.
update rc_vote_campaigns c set missions = (
  select jsonb_agg(case when m->>'id' = 'mnet'
    then jsonb_set(m, '{vote_url}', to_jsonb('https://mnetplus.world/event/2026-mama?deeplink=mnetplus%3A%2F%2Fvote%2Ftemplates%2Fmama-fans-choice-vote-r2-v2%2F6acecda6f3778e1b06f5170b%3Furl_fallback_type%3Dupdate&missionType=MAMA_2026_FANS_CHOICE_VOTE_2ND_SHARE&refererCode='::text))
    else m end order by i)
  from jsonb_array_elements(c.missions) with ordinality e(m, i))
where c.id = 'mama_2026_r2';
