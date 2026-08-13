-- "Who's online now" — a real presence signal, not a proxy. Earlier
-- engagement work had to guess app-open activity from side-effects (Signal
-- Sweep XP, feed events) because nothing recorded it directly, and that
-- under-counted real opens. This is the direct signal: buildState (the main
-- poll every live screen runs on, handlers.ts) stamps it every call, so
-- "online now" becomes a plain "seen in the last N minutes" query instead
-- of an inference.
alter table rc_players add column if not exists last_seen_at timestamptz;

create index if not exists rc_players_last_seen_idx on rc_players (last_seen_at desc);
