-- Private product analytics for the agent-engagement report. Unlike
-- rc_feed_events, these rows never appear in the public City feed: they
-- describe app sessions and navigation, not achievements.
create table if not exists rc_engagement_events (
  id bigint generated always as identity primary key,
  agent_no text not null,
  event_type text not null check (event_type in (
    'app_opened', 'screen_viewed', 'district_opened', 'reconnect_opened',
    'invite_sent', 'invite_accepted', 'queue_built', 'stream_detected'
  )),
  screen text,
  district_id text,
  session_id text,
  metadata jsonb not null default '{}',
  dedup_key text unique,
  created_at timestamptz not null default now()
);

create index if not exists rc_engagement_agent_time_idx
  on rc_engagement_events (agent_no, created_at desc);
create index if not exists rc_engagement_type_time_idx
  on rc_engagement_events (event_type, created_at desc);
create index if not exists rc_engagement_screen_time_idx
  on rc_engagement_events (screen, created_at desc) where screen is not null;

alter table rc_engagement_events enable row level security;

-- rc_players predates foreign keys in this repo. Keep analytics deletion
-- coupled to the player row without assuming agent_no has a declared unique
-- constraint in every deployed database.
create or replace function rc_delete_engagement_for_player()
returns trigger language plpgsql security definer as $$
begin
  delete from rc_engagement_events where agent_no = old.agent_no;
  return old;
end;
$$;

drop trigger if exists rc_delete_engagement_for_player_trigger on rc_players;
create trigger rc_delete_engagement_for_player_trigger
  before delete on rc_players for each row execute function rc_delete_engagement_for_player();
