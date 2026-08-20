-- Lets a player adjust how their equipped badge photo is framed in the
-- Agent ID card (52x52 object-fit:cover crops arbitrary uploaded/selected
-- art unpredictably — a face can land half out of frame). Stored as a
-- simple {x, y, zoom} object: x/y are 0-100 object-position percentages,
-- zoom is a 1.0-2.0 scale factor. Null means "use the default centered
-- crop", so existing players are unaffected until they adjust it.
alter table rc_players add column if not exists avatar_crop jsonb;
