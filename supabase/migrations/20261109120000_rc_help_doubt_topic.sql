-- Help portal: a "Doubt / question" topic, so agents can ask how something
-- works, not only report what is broken. Widens the topic check; existing
-- requests keep their topics.
alter table public.rc_help_requests drop constraint if exists rc_help_requests_topic_check;
alter table public.rc_help_requests add constraint rc_help_requests_topic_check
  check (topic in ('streams', 'doubt', 'reconnect', 'badges', 'voting', 'account', 'other'));
