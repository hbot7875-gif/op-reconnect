#!/usr/bin/env bash
# Stage 2B pre-flight. Read-only. Exits non-zero unless it is safe to start the
# three retention jobs.
#
#   bash scripts/stage2b-preflight.sh --inspect   # look around
#   bash scripts/stage2b-preflight.sh             # FINAL gate
#
# Exit 0 = approved. Anything else = STOP.
#
# Stage 2B is different from every gate before it. Stage 1 and Stage 2A created
# things; this one STARTS things, and two of them are visible to real people on
# the first night: log rows are deleted, and inactivity warnings are emailed.
#
# So this script's most important job is not the pass/fail. It is printing the
# user-visible consequences, refreshed, in the seconds before the decision —
# because those numbers move daily and the ones in any earlier review are
# already stale.

set -uo pipefail

SB="${SB:-/c/Users/sunke/AppData/Local/npm-cache/_npx/6f1b058a4d9555af/node_modules/@supabase/cli-windows-x64/bin/supabase.exe}"
REF="${REF:-lcvmwlioqpyaprxicdfl}"

STAGE2A_MIGRATION="20260928060000"
# v317 adds the revised inactivity reminder template (HopeTrackers branding
# and the /game?mode=signin return link). v316 was the Stage 1/2A build.
EXPECT_FN_VERSION="${EXPECT_FN_VERSION:-317}"
MAX_BACKUP_AGE_HOURS="${MAX_BACKUP_AGE_HOURS:-36}"
STAGE1_T="${STAGE1_T:-2026-09-28 03:53:40.327721+00}"
STAGE2B_FILE="${STAGE2B_FILE:-supabase/pending/STAGE2B_rc_privacy_retention_schedules.sql}"
# The timestamp Stage 2B takes when it moves into migrations/.
STAGE2B_MIGRATION="${STAGE2B_MIGRATION:-20260928080000}"

# The EXACT counts that were reviewed for this deployment. Not ceilings.
#
# A ceiling is the wrong shape here: "at most 5 emails" would let 5 people be
# written to because 5 <= 5, when only 3 were ever looked at. Drift in either
# direction means the review no longer covers who is affected, so any change
# stops the gate and prints the current recipients for a fresh look.
EXPECT_EMAILS="${EXPECT_EMAILS:-3}"
EXPECT_LOG_DELETES="${EXPECT_LOG_DELETES:-5}"
EXPECT_PROOFS_QUEUED="${EXPECT_PROOFS_QUEUED:-0}"

MODE="final"
[ "${1:-}" = "--inspect" ] && MODE="inspect"

fail=0
say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  OK    %s\n' "$1"; }
bad()  { printf '  STOP  %s\n' "$1"; fail=1; }
note() { printf '  NOTE  %s\n' "$1"; }
warn() { printf '  WATCH %s\n' "$1"; }

q() {
  local out rc
  out="$("$SB" db query --linked "$1" 2>/dev/null)"; rc=$?
  if [ "$rc" -ne 0 ] || ! printf '%s' "$out" | grep -q '"rows"'; then return 1; fi
  printf '%s' "$out"
}
# Splits on the FIRST colon only — a timestamp value contains colons of its
# own, and a greedy match silently truncated "2026-09-28 06:45:33+00" to "33+00".
val() { printf '%s' "$1" | grep -o "\"$2\": *[^,}]*" | head -1 | sed 's/^[^:]*: *//; s/"//g; s/ *$//'; }

# ── 1. Stage 2A must be applied AND healthy ───────────────────────────
say "1. Stage 2A applied and healthy"

hist_raw="$("$SB" migration list --linked 2>/dev/null)"; hist_rc=$?
hist="$(printf '%s' "$hist_raw" | grep -o '{"migrations".*}')"
if [ "$hist_rc" -ne 0 ] || [ -z "$hist" ]; then
  bad "could not read migration history (cli exit $hist_rc)"
else
  if printf '%s' "$hist" | grep -q "\"remote\":\"$STAGE2A_MIGRATION\""; then
    ok "Stage 2A migration $STAGE2A_MIGRATION is applied"
  else
    bad "Stage 2A ($STAGE2A_MIGRATION) is NOT applied — Stage 2B schedules functions that would not exist"
  fi
  pending="$(printf '%s' "$hist" | python -c "
import sys,json
d=json.load(sys.stdin)
print('\n'.join(r['local'] for r in d.get('migrations',[]) if r.get('local') and not r.get('remote')))" 2>/dev/null)"
  # Before the move, nothing should be pending. After it, exactly the Stage 2B
  # schedules migration should be — and nothing else. Anything other than that
  # one file means something is riding along.
  if [ -z "$pending" ]; then
    ok "nothing pending yet (Stage 2B not moved into migrations/ yet)"
  elif [ "$pending" = "$STAGE2B_MIGRATION" ]; then
    ok "exactly one pending: $STAGE2B_MIGRATION (Stage 2B, as expected)"
  else
    bad "unexpected pending migration(s) — only $STAGE2B_MIGRATION may be pending:"
    printf '        %s
' $pending
  fi
fi

health="$(q "select
  (to_regprocedure('public.rc_purge_deleted_agent_log(integer)') is not null) as fn_log_purge,
  (to_regprocedure('public.rc_queue_expired_vote_proofs(text,integer,integer)') is not null) as fn_queue_proofs,
  (to_regprocedure('public.rc_invoke_inactive_reminders()') is not null) as fn_reminders,
  (to_regclass('public.rc_inactivity_warnings') is not null) as warnings_table,
  (to_regclass('public.rc_storage_deletion_queue') is not null) as queue_table")"
if [ $? -ne 0 ]; then
  bad "could not verify Stage 2A objects"
else
  missing=0
  for k in fn_log_purge fn_queue_proofs fn_reminders warnings_table queue_table; do
    [ "$(val "$health" "$k")" = "true" ] || { bad "Stage 2A object missing: $k"; missing=1; }
  done
  [ "$missing" = "0" ] && ok "all three scheduled functions and both tables exist"
fi

# ── 2. Stage 1 must still hold ────────────────────────────────────────
say "2. Stage 1 still holding (anchored on T, not a rolling window)"

s1="$(q "select
  (select count(*) from pg_trigger where tgrelid='rc_scrobbles'::regclass and tgname='rc_scrobbles_block_retired' and tgenabled='O') as trigger_ok,
  (select count(*) from rc_scrobbles s join rc_agents a on a.agent_no=s.agent_no
    where a.retired_at is not null and s.created_at > '$STAGE1_T'::timestamptz) as retired_stored,
  (select count(*) from rc_stream_sync_state st join rc_agents a on a.agent_no=st.agent_no
    where a.retired_at is not null and st.last_attempt_at > '$STAGE1_T'::timestamptz) as retired_polled")"
if [ $? -ne 0 ]; then
  bad "could not verify Stage 1"
else
  [ "$(val "$s1" trigger_ok)" = "1" ] && ok "retirement trigger present and enabled" || bad "retirement trigger missing or disabled"
  [ "$(val "$s1" retired_stored)" = "0" ] && ok "0 retired-account scrobbles since T" || bad "$(val "$s1" retired_stored) retired scrobbles since T — Stage 1 has regressed"
  [ "$(val "$s1" retired_polled)" = "0" ] && ok "0 retired-account provider polls since T" || bad "$(val "$s1" retired_polled) retired polls since T — Stage 1 has regressed"
fi

# ── 3. The jobs must not already exist ────────────────────────────────
say "3. The three jobs are not already scheduled"

jobs="$(q "select
  (select count(*) from cron.job) as total,
  (select count(*) from cron.job where jobname in ('rc-purge-deleted-agent-log','rc-queue-expired-vote-proofs','rc-inactive-reminders')) as stage2b")"
if [ $? -ne 0 ]; then
  bad "could not read cron.job"
else
  if [ "$(val "$jobs" stage2b)" = "0" ]; then
    ok "none of the three exist yet (total cron jobs: $(val "$jobs" total))"
  else
    bad "$(val "$jobs" stage2b) of the three already exist — Stage 2B would fail its own guard"
  fi
fi

# ── 4. Edge Function ──────────────────────────────────────────────────
say "4. Edge Function"

fn_raw="$("$SB" functions list --project-ref "$REF" -o json 2>/dev/null)"; fn_rc=$?
if [ "$fn_rc" -ne 0 ] || [ -z "$fn_raw" ]; then
  bad "could not list functions (cli exit $fn_rc)"
else
  fn_line="$(printf '%s' "$fn_raw" | python -c "
import sys,json
t=sys.stdin.read(); i=t.find('[')
for f in json.loads(t[i:t.rfind(']')+1]):
    if f.get('slug')=='op-reconnect': print('%s|%s' % (f.get('version'), f.get('status'))); break" 2>/dev/null)"
  live_ver="${fn_line%%|*}"; live_status="${fn_line##*|}"
  [ "$live_status" = "ACTIVE" ] && ok "status ACTIVE" || bad "status is $live_status"
  # Hard stop on drift, same reasoning as Stage 2A: a newer build may have
  # changed the handler the reminder cron calls.
  if [ "$live_ver" = "$EXPECT_FN_VERSION" ]; then
    ok "live version $live_ver — the reviewed build"
  else
    bad "live version is $live_ver, expected $EXPECT_FN_VERSION — re-verify the reminder handler against this migration and set EXPECT_FN_VERSION"
  fi
fi

# ── 5. Backup ─────────────────────────────────────────────────────────
say "5. Most recent physical backup"

bk_raw="$("$SB" backups list --project-ref "$REF" -o json 2>/dev/null)"; bk_rc=$?
if [ "$bk_rc" -ne 0 ] || [ -z "$bk_raw" ]; then
  bad "could not read backups (cli exit $bk_rc)"
else
  bk_out="$(printf '%s' "$bk_raw" | MAXH="$MAX_BACKUP_AGE_HOURS" python -c "
import sys,json,os,datetime
t=sys.stdin.read(); i=t.find('{')
d=json.loads(t[i:t.rfind('}')+1])
b=sorted(d.get('backups',[]), key=lambda r: r.get('inserted_at',''), reverse=True)
if not b: print('no backups found'); raise SystemExit(2)
newest=b[0]['inserted_at']
age=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(newest.replace('Z','+00:00'))).total_seconds()/3600
print('newest %s (%.1fh old), %d retained' % (newest, age, len(b)))
raise SystemExit(0 if age <= float(os.environ['MAXH']) else 2)" 2>/dev/null)"; bk_parse=$?
  if [ "$bk_parse" -eq 0 ]; then
    ok "$bk_out"
    note "the 5 log rows deleted at 03:20 are recoverable ONLY from this backup"
  else
    bad "${bk_out:-backup check failed} — must be newer than ${MAX_BACKUP_AGE_HOURS}h"
  fi
fi

# ── 6. The Stage 2B file must still be only what was reviewed ─────────
say "6. Stage 2B file contains only the reviewed schedules and guards"

# The file moves from pending/ to migrations/ as part of this deployment.
if [ ! -f "$STAGE2B_FILE" ] && [ -f "supabase/migrations/${STAGE2B_MIGRATION}_rc_privacy_retention_schedules.sql" ]; then
  STAGE2B_FILE="supabase/migrations/${STAGE2B_MIGRATION}_rc_privacy_retention_schedules.sql"
fi
if [ ! -f "$STAGE2B_FILE" ]; then
  bad "cannot find the Stage 2B file in supabase/pending/ or supabase/migrations/"
else
  shape="$(python scripts/lib/schedules-only-shape.py "$STAGE2B_FILE" 2>/dev/null)"
  # Leading space matters: without it, a greedy match for "schedule=" also
  # matches inside "unschedule=" and silently returns the wrong field.
  fld() { printf ' %s' "$shape" | sed -n "s/.* $1=\([0-9]*\).*/\1/p"; }
  [ "$(fld schedule)" = "3" ]    && ok "exactly 3 cron.schedule statements" || bad "found $(fld schedule) cron.schedule statements, expected 3"
  [ "$(fld guards)" = "2" ]      && ok "both guards present (2A applied, jobs not already scheduled)" || bad "found $(fld guards) guard blocks, expected 2"
  [ "$(fld destructive)" = "0" ] && ok "no DELETE / DROP / ALTER / TRUNCATE" || bad "$(fld destructive) destructive statement(s) — this is not a schedules-only file"
  [ "$(fld other)" = "0" ]       && ok "no CREATE / GRANT / REVOKE / INSERT / UPDATE — schedules only" || bad "$(fld other) unexpected statement(s) — the file has acquired changes"
  note "sha256 $(sha256sum "$STAGE2B_FILE" 2>/dev/null | cut -c1-24)"
fi

# ── 7. WHAT REAL PEOPLE WILL SEE, refreshed right now ─────────────────
say "7. User-visible consequences on the FIRST night — refreshed just now"

# The 03:40 figure is COMPUTED, not observed. Calling
# rc_queue_expired_vote_proofs to find out what it would do would be a write:
# it inserts queue rows the moment the event is due. So this reproduces its
# predicate read-only — the event end from rc_config, plus the 30-day window,
# plus the same "not shared with a live vote" exclusion.
imm="$(q "select
  now()::text as checked_at,
  (select count(*) from rc_deleted_agent_log where deleted_at < now() - interval '30 days') as log_rows_deleted_0320,
  (select count(*) from rc_deleted_agent_log) as log_rows_total,
  (select count(*) from rc_inactive_agent_candidates(9) c join rc_agents a on a.agent_no=c.agent_no
    where c.days_inactive < 14 and coalesce(a.email,'') <> '') as emails_sent_0900,
  (select count(*) from rc_inactive_agent_candidates(14)) as deletable_1800,
  (select (value->>'period_end_utc') from rc_config where key='vma_2026') as event_end_raw,
  (select ((value->>'period_end_utc')::timestamptz + interval '30 days')::text from rc_config where key='vma_2026') as proofs_due_at,
  (select (now() >= (value->>'period_end_utc')::timestamptz + interval '30 days') from rc_config where key='vma_2026') as proofs_are_due,
  (select case
     when (select now() >= (value2->>'period_end_utc')::timestamptz + interval '30 days'
             from rc_config where key='vma_2026') is not true then 0
     else (select count(distinct v.proof_path) from rc_vma_votes v
            where v.event_id='vma_2026' and v.proof_path is not null
              and not exists (select 1 from rc_vma_votes o
                               where o.proof_path = v.proof_path and o.event_id <> 'vma_2026'))
   end from rc_config c2, lateral (select c2.value) x(value2) where c2.key='vma_2026') as proofs_would_queue_0340,
  (select count(*) from rc_vma_votes where proof_path is not null) as proofs_held")"
if [ $? -ne 0 ]; then
  bad "could not compute the consequences — do not schedule blind"
else
  emails="$(val "$imm" emails_sent_0900)"
  logs="$(val "$imm" log_rows_deleted_0320)"
  proofs="$(val "$imm" proofs_would_queue_0340)"
  due="$(val "$imm" proofs_are_due)"

  printf '  checked at  %s

' "$(val "$imm" checked_at)"
  printf '    03:20  DELETES  %s of %s deleted-agent-log rows   (irreversible outside the backup)
' "$logs" "$(val "$imm" log_rows_total)"
  printf '    03:40  queues   %s proof deletions  (due %s; due-now=%s; %s proofs held)
' "$proofs" "$(val "$imm" proofs_due_at)" "$due" "$(val "$imm" proofs_held)"
  printf '    09:00  EMAILS   %s real people
' "$emails"
  printf '    18:00  deletes  %s accounts  (existing job; now additionally gated on a delivered warning)

' "$(val "$imm" deletable_1800)"

  # ── exact-match gates ──
  if [ "$emails" = "$EXPECT_EMAILS" ]; then
    ok "$emails recipient(s) — exactly what was reviewed"
  else
    bad "recipient count changed: $emails now, $EXPECT_EMAILS reviewed. Re-review before scheduling. Current recipients:"
    recips="$(q "select c.agent_no, round(c.days_inactive::numeric,2) as days_inactive,
                        greatest(1, round(14 - c.days_inactive)) as days_left
                   from rc_inactive_agent_candidates(9) c
                   join rc_agents a on a.agent_no=c.agent_no
                  where c.days_inactive < 14 and coalesce(a.email,'') <> ''
                  order by c.days_inactive desc")"
    if [ $? -eq 0 ]; then
      printf '%s' "$recips" | python -c "
import sys,json
t=sys.stdin.read(); i=t.find('{')
for r in json.loads(t[i:t.rfind('}')+1])['rows']:
    print('          %s  days_inactive=%s  email_would_say=%s day(s) left' % (r['agent_no'], r['days_inactive'], r['days_left']))" 2>/dev/null
    fi
  fi

  if [ "$logs" = "$EXPECT_LOG_DELETES" ]; then
    ok "$logs log row(s) — exactly what was reviewed"
  else
    bad "log-deletion count changed: $logs now, $EXPECT_LOG_DELETES reviewed. Re-review before scheduling."
  fi

  if [ "$proofs" = "$EXPECT_PROOFS_QUEUED" ]; then
    ok "$proofs proof deletion(s) expected — exactly what was reviewed (computed read-only)"
  else
    bad "expected proof queue changed: $proofs now, $EXPECT_PROOFS_QUEUED reviewed — proofs have become due or the event config moved. STOP and re-review."
  fi
  if [ "$due" = "true" ] && [ "$EXPECT_PROOFS_QUEUED" = "0" ]; then
    bad "vma_2026 proofs are now DUE — the reviewed expectation of 0 no longer holds"
  fi

  warn "these numbers move daily. They are only true for the next few hours."
fi

# ── Result ────────────────────────────────────────────────────────────
say "RESULT ($MODE)"
if [ "$fail" = "0" ]; then
  if [ "$MODE" = "inspect" ]; then
    echo "  INSPECTION PASSED — this is NOT a deployment approval."
  else
    echo "  PRE-FLIGHT PASSED — approved to schedule Stage 2B."
    echo "  Scheduling starts the jobs. Unschedule all three to stop them:"
    echo "    select cron.unschedule('rc-purge-deleted-agent-log');"
    echo "    select cron.unschedule('rc-queue-expired-vote-proofs');"
    echo "    select cron.unschedule('rc-inactive-reminders');"
  fi
else
  echo "  PRE-FLIGHT FAILED — do not schedule. Resolve the STOP lines above."
fi
exit "$fail"
