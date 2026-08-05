-- Goals move from one shared global list to per-district assignment. Every
-- district freezes in ONLY the goals explicitly assigned to it (district_id
-- match) — a goal with no district_id contributes to nothing. Existing goals
-- backfill as unassigned (new column defaults to null), so nothing is live
-- anywhere until reassigned in the admin Goals tab, per the explicit request
-- not to auto-carry the old global set forward.
alter table rc_goals add column if not exists district_id text;
create index if not exists rc_goals_district_id_idx on rc_goals(district_id);

-- Every district gets exactly one week from activation to restore, tunable
-- here without a redeploy — same pattern as xp_rules/modes in rc_config.
insert into rc_config (key, value) values ('restoration_days', '7')
on conflict (key) do nothing;
