-- MTV VMAs 2026 voting mission. Votes happen on vote.mtv.com, outside this
-- app, so there is nothing to verify server-side by itself — this is a
-- self-reported log, verified with plain code (OCR text matching + a daily
-- per-agent watermark code + exact-duplicate image detection), not an AI
-- vision call. No API key, no per-request cost. See lib/vma-voting.ts.
--
-- All windows below are precomputed to UTC from the ET rules (ET = UTC-4,
-- EDT, for the whole Aug 18 - Sep 25 period) so the backend never has to do
-- timezone math at request time. Cross-checked against the IST figures given
-- alongside the ET ones; both convert to the same UTC instants.
insert into rc_config (key, value) values (
  'vma_2026',
  '{
    "title": "MTV VMAs 2026 — Vote for BTS",
    "url": "https://vote.mtv.com/song-of-the-year",
    "categories": ["song_of_the_year", "best_kpop"],
    "category_labels": {
      "song_of_the_year": "Song of the Year",
      "best_kpop": "Best K-Pop"
    },
    "category_keywords": {
      "song_of_the_year": ["swim"],
      "best_kpop": ["swim"]
    },
    "submitted_phrase": "votes submitted",
    "daily_cap_per_category": 10,
    "period_start_utc": "2026-08-18T13:00:00Z",
    "period_end_utc": "2026-09-25T21:59:59Z",
    "power_hour_first_utc": "2026-08-20T00:00:00Z",
    "power_hour_last_utc": "2026-09-24T23:59:59Z",
    "power_hour_utc_start": "17:00",
    "power_hour_utc_end": "17:59",
    "double_days_utc": [
      { "start": "2026-08-18T13:00:00Z", "end": "2026-08-19T03:59:59Z" },
      { "start": "2026-08-19T04:00:00Z", "end": "2026-08-20T03:59:59Z" },
      { "start": "2026-09-25T04:00:00Z", "end": "2026-09-26T03:59:59Z" }
    ],
    "watermark_words": [
      "RECONNECT", "PURPLE", "SIGNAL", "BEACON", "RESTORE",
      "UPLINK", "ARIRANG", "DISTRICT", "ECHO", "VOYAGE", "ANCHOR", "RELAY"
    ]
  }'::jsonb
) on conflict (key) do update set value = excluded.value;

-- Private bucket for vote-proof screenshots. Not public: a screenshot shows
-- the phone's status bar/notifications. Only the service-role edge function
-- reads/writes it (no client ever gets a direct Storage URL), so no RLS
-- policies are added — service role already bypasses Storage RLS.
insert into storage.buckets (id, name, public)
values ('vma-vote-proofs', 'vma-vote-proofs', false)
on conflict (id) do nothing;

create table if not exists rc_vma_votes (
  id bigint generated always as identity primary key,
  agent_no text not null references rc_agents (agent_no),
  category text not null check (category in ('song_of_the_year', 'best_kpop')),
  vote_day date not null,              -- ET calendar day the votes count toward
  votes_logged integer not null check (votes_logged between 1 and 10),
  is_power_hour boolean not null default false,
  is_double_day boolean not null default false,
  proof_path text not null,            -- object key in the vma-vote-proofs bucket
  image_hash text not null,            -- sha-256 of the raw upload — exact-duplicate detection
  ocr_text text,                       -- raw OCR output, kept for audit / tuning the keyword rules
  watermark_ok boolean not null default false,
  verify_status text not null default 'pending' check (verify_status in ('pending', 'verified', 'rejected')),
  verify_note text,                    -- which check(s) passed/failed, for the agent and for review
  verified_at timestamptz,
  voted_at timestamptz not null default now()
);

create index if not exists rc_vma_votes_agent_day_idx
  on rc_vma_votes (agent_no, vote_day, category);
-- Exact-duplicate lookup: same screenshot bytes reused (by this agent or
-- copied from someone else's).
create index if not exists rc_vma_votes_image_hash_idx on rc_vma_votes (image_hash);

comment on table rc_vma_votes is
  'Self-reported MTV VMA vote log. Auto-verified with OCR text matching (mtv/BTS/category keyword/vote count/"votes submitted") plus a daily+agent watermark code the agent writes on the screenshot, plus exact-duplicate image-hash rejection — no AI vision call, no API key. See lib/vma-voting.ts::checkProofImage. Anything that does not clear every check stays "pending" for manual review, never silently auto-approved. Backend enforces daily_cap_per_category per agent/category/vote_day, doubled on a double_day, from rc_config.vma_2026.';
