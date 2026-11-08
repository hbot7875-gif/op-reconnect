-- War of Cards unlock reveal: what the agent did with it. seen_at only says
-- it opened on a screen (once it opened on a tab nobody was looking at);
-- this records the first answer: LET'S GO! ('go'), Later ('later'), or
-- closing it any other way ('closed'). Additive only.
alter table public.rc_war_unlock_notices
  add column if not exists action text,
  add column if not exists acted_at timestamptz;

alter table public.rc_war_unlock_notices drop constraint if exists rc_war_unlock_notices_action_check;
alter table public.rc_war_unlock_notices add constraint rc_war_unlock_notices_action_check
  check (action is null or action in ('go', 'later', 'closed'));
