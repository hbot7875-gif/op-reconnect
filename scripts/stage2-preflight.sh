#!/usr/bin/env bash
# Stage 2 pre-flight. Read-only. Exits non-zero unless it is safe to apply the
# retention migration.
#
#   bash scripts/stage2-preflight.sh --inspect   # look around; 0 pending is OK
#   bash scripts/stage2-preflight.sh             # FINAL gate; demands 1 pending
#
# Exit 0 = approved. Anything else = STOP.
#
# Same discipline as Stage 1: every check captures output into a variable and
# tests the exit code before parsing, so a CLI that failed cannot be read as a
# clean result.
#
# Stage 2 differs from Stage 1 in one important way: applying it has immediate
# consequences beyond creating objects. This script's job is to show them
# BEFORE they happen — how many log rows the first purge would remove, how many
# real people would be emailed, and whether anything is at the deletion
# threshold tonight.

set -uo pipefail

SB="${SB:-/c/Users/sunke/AppData/Local/npm-cache/_npx/6f1b058a4d9555af/node_modules/@supabase/cli-windows-x64/bin/supabase.exe}"
REF="${REF:-lcvmwlioqpyaprxicdfl}"

EXPECT_MIGRATION="20260928060000"
# v317 adds the revised inactivity reminder template (HopeTrackers branding
# and the /game?mode=signin return link). v316 was the Stage 1/2A build.
EXPECT_FN_VERSION="${EXPECT_FN_VERSION:-317}"     # what Stage 1 deployed
MAX_BACKUP_AGE_HOURS="${MAX_BACKUP_AGE_HOURS:-36}"
# Stage 1 deployment completion. Everything about "has Stage 1 held?" is
# measured from here, never from a rolling window.
STAGE1_T="${STAGE1_T:-2026-09-28 03:53:40.327721+00}"

MODE="final"
[ "${1:-}" = "--inspect" ] && MODE="inspect"

fail=0
say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  OK    %s\n' "$1"; }
bad()  { printf '  STOP  %s\n' "$1"; fail=1; }
note() { printf '  NOTE  %s\n' "$1"; }
warn() { printf '  WATCH %s\n' "$1"; }

q() {  # run a read-only query, fail loudly rather than returning empty
  local out rc
  out="$("$SB" db query --linked "$1" 2>/dev/null)"; rc=$?
  if [ "$rc" -ne 0 ] || ! printf '%s' "$out" | grep -q '"rows"'; then return 1; fi
  printf '%s' "$out"
}

# ── 1. Stage 1 must still be in place ─────────────────────────────────
say "1. Stage 1 still in place (Stage 2 does not replace it)"

# Anchored on Stage 1's deployment timestamp, NOT a rolling window. A rolling
# window reaches back before the deployment and counts rows the fix was never
# going to prevent — which reads as a regression that is not one.
s1="$(q "select
  (select count(*) from pg_trigger where tgrelid='rc_scrobbles'::regclass and tgname='rc_scrobbles_block_retired' and tgenabled='O') as trigger_ok,
  (select count(*) from rc_scrobbles s join rc_agents a on a.agent_no=s.agent_no
    where a.retired_at is not null and s.created_at > '$STAGE1_T'::timestamptz) as retired_stored_since_T,
  (select count(*) from rc_stream_sync_state st join rc_agents a on a.agent_no=st.agent_no
    where a.retired_at is not null and st.last_attempt_at > '$STAGE1_T'::timestamptz) as retired_polled_since_T")"
if [ $? -ne 0 ]; then
  bad "could not verify Stage 1 state"
else
  t_ok="$(printf '%s' "$s1" | grep -o '"trigger_ok": *[0-9]*' | grep -o '[0-9]*$')"
  r_st="$(printf '%s' "$s1" | grep -o '"retired_stored_since_t": *[0-9]*' | grep -o '[0-9]*$')"
  r_pl="$(printf '%s' "$s1" | grep -o '"retired_polled_since_t": *[0-9]*' | grep -o '[0-9]*$')"
  [ "$t_ok" = "1" ] && ok "retirement trigger present and enabled" || bad "retirement trigger missing or disabled"
  [ "$r_st" = "0" ] && ok "no retired-account scrobbles stored since T ($STAGE1_T)" || bad "$r_st retired scrobbles stored since T — Stage 1 has regressed"
  [ "$r_pl" = "0" ] && ok "no retired-account provider polls since T" || bad "$r_pl retired poll attempts since T — Stage 1 has regressed"
fi

# ── 2. Migration history ──────────────────────────────────────────────
say "2. Migration history — local vs remote"

# NOTE: `-o json` prints a TABLE here; the DEFAULT output is the JSON.
hist_raw="$("$SB" migration list --linked 2>/dev/null)"; hist_rc=$?
hist="$(printf '%s' "$hist_raw" | grep -o '{"migrations".*}')"
if [ "$hist_rc" -ne 0 ] || [ -z "$hist" ]; then
  bad "could not read migration history (cli exit $hist_rc)"
else
  pending="$(printf '%s' "$hist" | python -c "
import sys,json
d=json.load(sys.stdin)
print('\n'.join(r['local'] for r in d.get('migrations',[]) if r.get('local') and not r.get('remote')))" 2>/dev/null)"
  orphan="$(printf '%s' "$hist" | python -c "
import sys,json
d=json.load(sys.stdin)
print('\n'.join(r['remote'] for r in d.get('migrations',[]) if r.get('remote') and not r.get('local')))" 2>/dev/null)"
  count="$(printf '%s' "$pending" | grep -c . || true)"

  # Stage 1's migration must already be applied.
  if printf '%s' "$hist" | grep -q '"remote":"20260927180000"'; then
    ok "Stage 1 migration 20260927180000 is applied"
  else
    bad "Stage 1 migration 20260927180000 is NOT applied — Stage 2 assumes it"
  fi

  if [ "$count" = "1" ] && [ "$pending" = "$EXPECT_MIGRATION" ]; then
    ok "exactly one pending: $EXPECT_MIGRATION"
  elif [ "$count" = "0" ]; then
    if [ "$MODE" = "inspect" ]; then
      note "nothing pending — fine while inspecting"
    else
      bad "nothing pending — the migration is not staged, so this run cannot approve a deployment"
    fi
  else
    bad "$count migration(s) would be applied, expected only $EXPECT_MIGRATION:"
    printf '        %s\n' $pending
  fi

  if [ -n "$orphan" ]; then
    bad "applied remotely but missing locally — histories have diverged:"; printf '        %s\n' $orphan
  else
    ok "no remote-only migrations"
  fi

  # The two files that must NOT ride along.
  for forbidden in 20260927160000 20260927170000; do
    if printf '%s' "$pending" | grep -q "$forbidden"; then
      bad "$forbidden is staged — the 13-account purge and orphan cleanup are OUT of Stage 2"
    fi
  done
fi

# ── 3. Edge Function ──────────────────────────────────────────────────
say "3. Edge Function"

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
  # HARD STOP, not a warning. Stage 2 was reviewed against one specific build,
  # and "it probably still calls the same RPCs" is an assumption, not a check —
  # a newer build could have changed the arguments, the call sites, or the
  # error handling the migration's behaviour depends on. An unknown version
  # means the review no longer covers what is running.
  if [ "$live_ver" = "$EXPECT_FN_VERSION" ]; then
    ok "live version $live_ver — the reviewed build"
  else
    bad "live version is $live_ver, expected $EXPECT_FN_VERSION — Stage 2 was reviewed against v$EXPECT_FN_VERSION. Re-verify the function against this migration and set EXPECT_FN_VERSION before proceeding; do not assume a newer build is compatible"
  fi
  note "the deployed function already references rc_queue_expired_vote_proofs and"
  note "rc_next_storage_deletions; until this migration lands it logs them as"
  note "missing in proofSweep.errors and degrades harmlessly"
fi

# ── 4. Backup ─────────────────────────────────────────────────────────
say "4. Most recent physical backup"

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
  [ "$bk_parse" -eq 0 ] && ok "$bk_out" || bad "${bk_out:-backup check failed} — must be newer than ${MAX_BACKUP_AGE_HOURS}h"
fi

# ── 5. WHAT APPLYING THIS WILL IMMEDIATELY DO ─────────────────────────
say "5. Immediate effect of applying — read this before approving"

imm="$(q "select
  (select count(*) from rc_deleted_agent_log where deleted_at < now() - interval '30 days') as log_rows_deleted_first_run,
  (select count(*) from rc_deleted_agent_log) as log_rows_total,
  (select count(*) from rc_inactive_agent_candidates(14)) as at_deletion_threshold,
  (select count(*) from rc_inactive_agent_candidates(9) c join rc_agents a on a.agent_no=c.agent_no
    where c.days_inactive < 14 and coalesce(a.email,'') <> '') as would_be_emailed_first_run,
  (select ((value->>'period_end_utc')::timestamptz + interval '30 days')::date::text from rc_config where key='vma_2026') as proofs_due_date,
  (select count(*) from rc_vma_votes where proof_path is not null) as proofs_held")"
if [ $? -ne 0 ]; then
  bad "could not compute the immediate effects — do not apply blind"
else
  printf '%s' "$imm" | grep -oE '"[a-z_]+": *[^,}]+' | sed 's/^/  /'
  warn "the log purge DELETES those rows on its first 03:20 UTC run"
  warn "the reminder job EMAILS that many real people on its first 09:00 UTC run"
  note "no agent is purged by applying this; the 18:00 job keeps its own schedule"
  note "and now additionally requires a delivered warning"
fi

# ── 6. Scheduled jobs ─────────────────────────────────────────────────
say "6. Scheduled jobs — all pg_cron, none on GitHub Actions"

jobs="$(q "select jobname, schedule, active from cron.job order by jobname")"
if [ $? -ne 0 ]; then
  bad "could not read cron.job"
else
  printf '%s' "$jobs" | python -c "
import sys,json
t=sys.stdin.read(); i=t.find('{')
for r in json.loads(t[i:t.rfind('}')+1])['rows']:
    print('  existing  %-28s %-18s active=%s' % (r['jobname'], r['schedule'], r['active']))" 2>/dev/null
  note "every retention job runs inside Supabase pg_cron, not GitHub Actions —"
  note "the GitHub hourly workflow is unreliable (6 runs in 21h observed) and no"
  note "privacy guarantee depends on it"
fi

# ── 7. Stage 2A must schedule NOTHING ─────────────────────────────────
say "7. Stage 2A installs machinery only — proving it schedules nothing"

# 7a. The three jobs must not exist yet. If they do, either 2B has already been
#     applied or something scheduled them by hand, and "2A is inert" is false.
existing="$(q "select count(*) as n from cron.job where jobname in
  ('rc-purge-deleted-agent-log','rc-queue-expired-vote-proofs','rc-inactive-reminders')")"
if [ $? -ne 0 ]; then
  bad "could not check for the Stage 2B jobs"
else
  n="$(printf '%s' "$existing" | grep -o '"n": *[0-9]*' | grep -o '[0-9]*$')"
  if [ "$n" = "0" ]; then
    ok "none of the three Stage 2B jobs exist yet"
  else
    bad "$n of the Stage 2B jobs already exist — Stage 2A is not the inert step it claims to be"
  fi
fi

# 7b. The migration about to be applied must contain no scheduling at all.
#     Checked in the file rather than trusted: this is the whole basis for
#     saying 2A sends no email and deletes no row.
MIG_2A=""
for d in supabase/migrations supabase/pending; do
  [ -f "$d/${EXPECT_MIGRATION}_rc_privacy_retention.sql" ] && MIG_2A="$d/${EXPECT_MIGRATION}_rc_privacy_retention.sql"
done
if [ -z "$MIG_2A" ]; then
  bad "cannot find ${EXPECT_MIGRATION}_rc_privacy_retention.sql to inspect"
else
  sched="$(grep -c 'cron[.]schedule' "$MIG_2A" || true)"
  unsched="$(grep -c 'cron[.]unschedule' "$MIG_2A" || true)"
  if [ "$sched" = "0" ] && [ "$unsched" = "0" ]; then
    ok "$MIG_2A contains no cron.schedule — applying it starts nothing"
  else
    bad "$MIG_2A contains $sched cron.schedule and $unsched cron.unschedule calls — that is Stage 2B, not 2A"
  fi
  # A DELETE inside a function body is the purge doing its job and is fine —
  # it only runs when the function is CALLED. What matters is a DELETE at the
  # top level, which would run the moment the migration is applied.
  topdel="$(python scripts/lib/top-level-deletes.py "$MIG_2A" 2>/dev/null)"
  topdel_n="$(printf '%s' "$topdel" | head -1)"
  if [ "${topdel_n:-1}" = "0" ]; then
    ok "no top-level DELETE or TRUNCATE — 0 log rows, 0 agents, 0 files removed on apply"
  else
    bad "$MIG_2A has $topdel_n top-level DELETE/TRUNCATE statement(s) — Stage 2A must not remove data on apply:"
    printf '%s
' "$topdel" | tail -n +2
  fi
fi

# 7c. Stage 2B must not be riding along.
if ls supabase/migrations/*privacy_retention_schedules* >/dev/null 2>&1; then
  bad "a Stage 2B schedules migration is staged in supabase/migrations/ — it must not ride along with 2A"
else
  ok "no Stage 2B schedules migration staged"
fi


# ── Result ────────────────────────────────────────────────────────────
say "RESULT ($MODE)"
if [ "$fail" = "0" ]; then
  [ "$MODE" = "inspect" ] && echo "  INSPECTION PASSED — NOT a deployment approval." \
                          || echo "  PRE-FLIGHT PASSED — approved to apply Stage 2."
else
  echo "  PRE-FLIGHT FAILED — do not apply. Resolve the STOP lines above."
fi
exit "$fail"
