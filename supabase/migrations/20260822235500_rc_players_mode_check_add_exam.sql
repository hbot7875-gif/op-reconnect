-- rc_players_mode_check never got updated when School/Exam mode was added
-- (20260822230000) -- setMode()/joinGame() accepted 'exam' at the app
-- layer, but every actual write hit this constraint and failed silently
-- (handlers.ts's setMode doesn't check the update's error, so it returned
-- success with the in-memory player object showing 'exam' even though
-- nothing was persisted). Caught while testing the exam-mode target
-- override for Puple Sky Overlook.
alter table rc_players drop constraint rc_players_mode_check;
alter table rc_players add constraint rc_players_mode_check
  check (mode = any (array['easy', 'medium', 'hard', 'exam']));
