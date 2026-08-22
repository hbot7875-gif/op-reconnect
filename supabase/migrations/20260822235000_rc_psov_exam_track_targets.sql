-- Puple Sky Overlook's exam-mode track targets get their own hand-picked
-- values (40 for the base-50 lead-single tier, 30 for the base-40 tier),
-- decreased from what a flat 1x exam multiplier would otherwise give
-- (50/40 -- exam mode should read as lighter than easy, not identical to
-- it). Easy/medium/hard keep scaling off the unchanged base target, so
-- this doesn't touch anything but exam. Scoped to this district's own
-- track goals only -- Map of Seven Crossing's and Dazzledew's identical-
-- looking tracks are untouched, both already have real player progress.
update rc_goals set config = config || '{"examTarget": 40}'::jsonb
where id in ('psov-haegeum', 'psov-swim', 'psov-kig', 'psov-wild-flower', 'psov-winter-ahead');

update rc_goals set config = config || '{"examTarget": 30}'::jsonb
where id in ('psov-euphoria', 'psov-spring-day', 'psov-running-wild',
             'psov-life-goes-on-agustd', 'psov-normal', 'psov-come-over');
