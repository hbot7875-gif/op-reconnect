-- New "School/Exam" streaming mode: districts were clearing too fast on
-- easy, so easy's target multiplier goes from 1x to 1.3x -- but rather than
-- just making the floor harder for everyone, busy players get an escape
-- hatch that keeps the *old* easy target (1x, unscaled base) under a new
-- name. Freely switchable anytime via setMode, same as easy/medium/hard
-- already are; freezeGoals() only reads player.mode at district activation
-- time, so this naturally applies to future activations only -- no backfill
-- needed, nobody with an already-active district is affected either way.
update rc_config set value = jsonb_build_object(
  'exam', jsonb_build_object('label', 'School/Exam — lighter goals for busy weeks', 'multiplier', 1),
  'easy', jsonb_build_object('label', 'Easy — 1 device', 'multiplier', 1.3),
  'medium', value->'medium',
  'hard', value->'hard'
)
where key = 'modes';
