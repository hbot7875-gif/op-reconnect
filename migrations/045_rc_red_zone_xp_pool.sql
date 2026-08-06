-- Red Zone rewards are a shared XP pool, divided across agents who make a
-- meaningful contribution. The launch-time baseline prevents streams logged
-- earlier on the same KST day from qualifying for a newly launched event.

alter table rc_defuse_events
  add column if not exists minimum_streams int not null default 7
    check (minimum_streams > 0);

alter table rc_defuse_events
  add column if not exists stream_baseline jsonb not null default '{}'::jsonb;

alter table rc_defuse_events
  alter column reward_xp set default 500;

comment on column rc_defuse_events.reward_xp is
  'Total event XP pool, divided exactly across qualifying contributors.';

comment on column rc_defuse_events.minimum_streams is
  'Minimum event-window streams an agent needs before their streams count and they share the XP pool.';

comment on column rc_defuse_events.stream_baseline is
  'Per-agent counted-stream totals at launch, used to exclude earlier same-day activity.';
