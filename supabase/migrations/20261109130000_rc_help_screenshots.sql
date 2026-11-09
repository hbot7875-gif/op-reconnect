-- Help portal: agents may attach up to 2 screenshots to a request.
--
-- A private bucket (never public): files are read only through short-lived
-- signed links that lib/help.ts makes for the agent who sent them and for
-- AGENT000. The browser shrinks each image before upload; 2 MB is the
-- server-side backstop. Screenshots are removed 30 days after a request is
-- resolved (lib/help.ts sweepHelpScreenshots, run by the hourly sync).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('help-shots', 'help-shots', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

alter table public.rc_help_requests add column if not exists screenshot_paths text[] not null default '{}';
alter table public.rc_help_requests drop constraint if exists rc_help_requests_screenshots_check;
alter table public.rc_help_requests add constraint rc_help_requests_screenshots_check
  check (cardinality(screenshot_paths) <= 2);
