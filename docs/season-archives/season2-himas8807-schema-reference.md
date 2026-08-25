# Season 2 — schema & feature reference

Archived 2026-08-24, ahead of deleting the retired Supabase project
(`himas8807-lgtm's Project`, ref `uspezooqcdrwaqxcqojn`). This is a structural
reference for future idea-mining, not a full data backup — schema, real row
counts at the time of archiving, and a plain-English read of what each table
did. The user confirmed no real players use this season anymore before it
was archived this way.

Real historical usage (not currently active, but this was a live season):
172 agents, ~25K individual scrobble-detail rows, ~4.2K SOTD answer
submissions, ~2K weekly ranking snapshots — this had genuine player activity
at the time.

## Feature areas, inferred from the schema

- **Teams** — `agents.team`, `team_missions`, `team_goals_progress`,
  `weekly_summary.team_xp` — players were grouped into teams competing on
  shared weekly goals, not purely solo like op-reconnect.
- **Weekly cadence** — nearly everything is keyed by `week_label`
  (`goal_definitions`, `weekly_summary`, `weekly_member_stats`,
  `live_rankings`, `sync_logs`) — the whole game reset/scored on a weekly
  boundary, op-reconnect's closest equivalent is the KST-day/week reset but
  season 2 built entire ranking + goal infrastructure around it.
- **"Defuse"** — `defuse_schedule`, `defuse_daily_stats`,
  `defuse_user_progress` — a daily bomb-defusal-style mechanic: a
  scheduled wire/codename/album+track target per day, a 2x-pass flag, team
  goal gating, badge/XP reward on qualifying. op-reconnect's own
  `rc_defuse_*` tables/bomb.ts are the same lineage, evolved further.
- **Song of the Day** — `daily_sotd` + `sotd_answers` — a daily guess-the-song
  puzzle with attempt tracking and XP reward, direct ancestor of
  op-reconnect's own SOTD reconnect-puzzle variant.
- **Streaks** — `streaks` — current/longest streak, monthly freeze
  allowance, freeze usage tracking. Simpler than op-reconnect's own streak
  system but the same core shape.
- **Live rankings & stats** — `live_rankings`, `weekly_member_stats`,
  `member_scrobble_details` — per-agent, per-week XP/scrobble breakdowns by
  target type, feeding a leaderboard.
- **Announcements & chat** — `announcements`, `chat_messages`,
  `activity_feed` — real-time-ish social layer op-reconnect doesn't have an
  equivalent of (op-reconnect has cityFeed/broadcasts, narrower in scope).
- **Leave requests** — `leave_requests` — agents could formally request a
  week off from team goal obligations; op-reconnect has no equivalent (no
  team obligations to excuse yourself from).
- **Sync infrastructure** — `sync_logs`, `sync_sessions`,
  `admin_sessions`, `online_users` — batch sync run tracking (agents
  synced/failed/skipped per run, duration), a precursor to op-reconnect's
  own hourly-stream-sync GitHub Action + `rc_daily_activity` rollup
  pipeline.
- **Playlists** — `playlists` — team-curated playlist links per week,
  simpler than Candy Star's generated-playlist system in op-reconnect.
- **Badges** — `badges` — flat badge_type/name/image_url/week_earned, no
  rarity or art-pool concept yet; op-reconnect's Badge Collection
  (rc_badge_catalog/rc_badge_art/rc_badges) is a substantially more built-out
  descendant of this idea.

## Full column-level schema

<details>
<summary>Every table, every column (click to expand)</summary>

### activity_feed
id:uuid, activity_type:text, data:jsonb, agent_no:text, created_at:timestamp with time zone

### admin_sessions
id:uuid, agent_no:text, session_token:text, expires_at:timestamp with time zone, created_at:timestamp with time zone

### agents
id:uuid, created_at:timestamp with time zone, agent_no:text, name:text, instagram_handle:text, team:text, last_fm_username:text, status:text, last_synced_at:timestamp with time zone, last_fm_usernames:ARRAY, password:text

### announcements
id:uuid, week:text, title:text, message:text, priority:text, link:text, link_text:text, created_at:timestamp with time zone

### badges
id:uuid, agent_no:text, badge_type:text, badge_name:text, image_url:text, week_earned:text, description:text, created_at:timestamp with time zone

### chat_messages
id:uuid, agent_no:text, username:text, team:text, message:text, created_at:timestamp with time zone

### daily_sotd
id:uuid, date:date, song_title:text, artist:text, youtube_id:text, hint:text, xp_reward:integer, created_by:text, created_at:timestamp with time zone

### defuse_daily_stats
id:integer, date:date, total_streams:integer, target:integer, goal_met:boolean, participating_agents:integer, qualified_agents:integer, created_at:timestamp with time zone, updated_at:timestamp with time zone

### defuse_schedule
id:integer, date:date, wire_number:integer, codename:text, albums:ARRAY, combined:boolean, tracks:ARRAY, daily_target:integer, created_at:timestamp with time zone

### defuse_user_progress
id:integer, agent_no:text, date:date, tracks_progress:jsonb, passed_2x:boolean, team_goal_met:boolean, qualified:boolean, reward_claimed:boolean, badge_earned:jsonb, xp_earned:integer, created_at:timestamp with time zone, updated_at:timestamp with time zone

### goal_definitions
id:uuid, week_label:text, target_name:text, target_type:text, goal_amount:integer, team:text, variants:ARRAY, created_at:timestamp with time zone

### leave_requests
id:uuid, agent_no:text, week_label:text, status:text, created_at:timestamp with time zone

### live_rankings
id:uuid, week_label:text, agent_no:text, agent_name:text, team:text, global_rank:integer, team_rank:integer, total_xp:integer, updated_at:timestamp with time zone

### member_scrobble_details
id:uuid, agent_id:uuid, week_label:text, target_name:text, target_type:text, scrobble_count:integer, updated_at:timestamp with time zone, temp_agent_no:text

### online_users
agent_no:text, username:text, team:text, last_seen:timestamp with time zone

### playlists
id:uuid, target_week:text, name:text, url:text, platform:text, playlist_type:text, team:text, added_by:text, created_at:timestamp with time zone

### sotd_answers
id:uuid, agent_no:text, answer_date:date, submitted_answer:text, is_correct:boolean, xp_awarded:integer, attempt_number:integer, created_at:timestamp with time zone

### streaks
id:uuid, agent_no:text, current_streak:integer, longest_streak:integer, last_active_date:date, freezes_remaining:integer, freezes_used_this_month:integer, streak_start_date:date, updated_at:timestamp with time zone

### sync_logs
id:integer, sync_id:text, week_label:text, agents_synced:integer, agents_failed:integer, agents_skipped:integer, duration_ms:integer, errors:jsonb, created_at:timestamp with time zone, sync_type:text

### sync_sessions
id:uuid, session_id:text, week_label:text, snapshot_timestamp:bigint, total_agents:integer, agents_completed:integer, agents_failed:integer, status:text, batch_status:jsonb, started_at:timestamp with time zone, completed_at:timestamp with time zone, created_at:timestamp with time zone

### team_goals_progress
id:uuid, week_label:text, team:text, target_type:text, target_name:text, goal_amount:integer, current_total:integer, percentage:numeric, status:text, updated_at:timestamp with time zone

### team_missions
id:uuid, mission_id:text, mission_type:text, title:text, briefing:text, target_teams:ARRAY, assigned_agents:jsonb, target_track:text, goal_type:text, goal_target:integer, xp_reward:integer, deadline:timestamp with time zone, status:text, week_label:text, completed_teams:ARRAY, progress:jsonb, created_at:timestamp with time zone

### weekly_member_stats
id:uuid, agent_id:uuid, week_label:text, track_scrobbles:integer, album_scrobbles:integer, track_xp:integer, album_xp:integer, song_xp:integer, secret_xp:integer, total_xp:integer, album_2x_passed:boolean, album_2x_details:jsonb, agent_no:text, updated_at:timestamp with time zone, arirang_unit_passed:boolean

### weekly_summary
id:uuid, week_label:text, team:text, track_goal_passed:boolean, album_goal_passed:boolean, album_2x_passed:boolean, level:integer, team_xp:integer, secret_xp:integer, is_winner:boolean, attendance_confirmed:boolean, police_confirmed:boolean, results_released:boolean, updated_at:timestamp with time zone, arirang_unit_passed:boolean, side_mission_passed:boolean

</details>

## Row counts at time of archiving

| table | rows |
|---|---|
| activity_feed | 509 |
| admin_sessions | 75 |
| agents | 172 |
| announcements | 0 |
| badges | 0 |
| chat_messages | 1 |
| daily_sotd | 55 |
| defuse_daily_stats | 21 |
| defuse_schedule | 0 |
| defuse_user_progress | 3423 |
| goal_definitions | 204 |
| leave_requests | 76 |
| live_rankings | 1988 |
| member_scrobble_details | 24953 |
| online_users | 0 |
| playlists | 53 |
| sotd_answers | 4195 |
| streaks | 171 |
| sync_logs | 177 |
| sync_sessions | 114 |
| team_goals_progress | 812 |
| team_missions | 5 |
| weekly_member_stats | 1958 |
| weekly_summary | 64 |
