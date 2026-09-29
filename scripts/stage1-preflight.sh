#!/usr/bin/env bash
# Stage 1 pre-flight. Read-only. Exits non-zero unless it is genuinely safe to
# deploy the retirement-protection migration and Edge Function.
#
#   bash scripts/stage1-preflight.sh --inspect   # look around; 0 pending is OK
#   bash scripts/stage1-preflight.sh             # FINAL gate; demands 1 pending
#
# Exit 0 = approved to deploy. Anything else = STOP.
#
# Every check writes its command output to a variable and tests the exit code
# before parsing. Piping straight into grep would report the exit status of
# grep, so a CLI that failed outright could be read as a clean result — which
# is the failure mode a pre-flight most needs not to have.

set -uo pipefail

SB="${SB:-/c/Users/sunke/AppData/Local/npm-cache/_npx/6f1b058a4d9555af/node_modules/@supabase/cli-windows-x64/bin/supabase.exe}"
REF="${REF:-lcvmwlioqpyaprxicdfl}"

EXPECT_MIGRATION="20260927180000"
# The commit the rollback is pinned to. NOT "current HEAD": HEAD moves, and a
# rollback that followed it would restore whatever happened to be committed
# last rather than what is actually running.
ROLLBACK_COMMIT="3138ae0"
EXPECT_FN_VERSION="${EXPECT_FN_VERSION:-315}"
MAX_BACKUP_AGE_HOURS="${MAX_BACKUP_AGE_HOURS:-36}"

MODE="final"
[ "${1:-}" = "--inspect" ] && MODE="inspect"

fail=0
say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  OK    %s\n' "$1"; }
bad()  { printf '  STOP  %s\n' "$1"; fail=1; }
note() { printf '  NOTE  %s\n' "$1"; }

# ── 1. Migration history ──────────────────────────────────────────────
say "1. Migration history — local vs remote"

# NOTE: `-o json` on this subcommand prints a TABLE; the DEFAULT output is the
# JSON. Counter-intuitive, and worth leaving written down.
hist_raw="$("$SB" migration list --linked 2>/dev/null)"
hist_rc=$?
hist="$(printf '%s' "$hist_raw" | grep -o '{"migrations".*}')"

if [ "$hist_rc" -ne 0 ] || [ -z "$hist" ]; then
  bad "could not read migration history (cli exit $hist_rc) — cannot confirm what would apply"
else
  pending="$(printf '%s' "$hist" | python -c "
import sys, json
d = json.load(sys.stdin)
print('\n'.join(r['local'] for r in d.get('migrations', []) if r.get('local') and not r.get('remote')))
" 2>/dev/null)"
  orphan="$(printf '%s' "$hist" | python -c "
import sys, json
d = json.load(sys.stdin)
print('\n'.join(r['remote'] for r in d.get('migrations', []) if r.get('remote') and not r.get('local')))
" 2>/dev/null)"

  count="$(printf '%s' "$pending" | grep -c . || true)"

  if [ "$count" = "1" ] && [ "$pending" = "$EXPECT_MIGRATION" ]; then
    ok "exactly one pending: $EXPECT_MIGRATION"
  elif [ "$count" = "0" ]; then
    if [ "$MODE" = "inspect" ]; then
      note "nothing pending — fine while inspecting; move the migration in and re-run without --inspect"
    else
      # Zero pending means db push would apply NOTHING, so approving here would
      # green-light a deployment that never happens.
      bad "nothing pending — the migration is not staged, so this run cannot approve a deployment"
    fi
  else
    bad "$count migration(s) would be applied, expected only $EXPECT_MIGRATION:"
    printf '        %s\n' $pending
  fi

  if [ -n "$orphan" ]; then
    bad "applied remotely but missing locally — histories have diverged:"
    printf '        %s\n' $orphan
  else
    ok "no remote-only migrations"
  fi
fi

# ── 2. The live Edge Function ─────────────────────────────────────────
say "2. Live Edge Function"

fn_raw="$("$SB" functions list --project-ref "$REF" -o json 2>/dev/null)"
fn_rc=$?
if [ "$fn_rc" -ne 0 ] || [ -z "$fn_raw" ]; then
  bad "could not list functions (cli exit $fn_rc)"
else
  fn_line="$(printf '%s' "$fn_raw" | python -c "
import sys, json
t = sys.stdin.read(); i = t.find('[')
if i < 0: raise SystemExit(1)
for f in json.loads(t[i:t.rfind(']')+1]):
    if f.get('slug') == 'op-reconnect':
        print('%s|%s' % (f.get('version'), f.get('status')))
        break
" 2>/dev/null)"
  if [ -z "$fn_line" ]; then
    bad "op-reconnect is not deployed — there is nothing to roll back to"
  else
    live_ver="${fn_line%%|*}"
    live_status="${fn_line##*|}"
    if [ "$live_status" = "ACTIVE" ]; then ok "status ACTIVE"; else bad "status is $live_status, expected ACTIVE"; fi
    if [ "$live_ver" = "$EXPECT_FN_VERSION" ]; then
      ok "live version $live_ver matches the reviewed version"
    else
      bad "live version is $live_ver, expected $EXPECT_FN_VERSION — something was deployed since this was reviewed; re-verify the rollback pin before continuing"
    fi
  fi
fi

# ── 3. Rollback source, pinned ────────────────────────────────────────
say "3. Rollback source (pinned to $ROLLBACK_COMMIT)"

if ! git rev-parse --verify --quiet "${ROLLBACK_COMMIT}^{commit}" >/dev/null; then
  bad "commit $ROLLBACK_COMMIT does not exist in this repository"
else
  ok "commit $ROLLBACK_COMMIT exists"
  # The pin is valid only while nothing newer has been COMMITTED to the
  # function. Uncommitted edits are the deployment itself, and are expected.
  newer="$(git log --oneline "${ROLLBACK_COMMIT}..HEAD" -- supabase/functions/ 2>/dev/null)"
  if [ -n "$newer" ]; then
    bad "commits touch supabase/functions/ after $ROLLBACK_COMMIT — the pin is stale:"
    printf '        %s\n' "$newer"
  else
    ok "no committed change to supabase/functions/ since the pin"
  fi
  note "the pin is corroborated by the live VERSION NUMBER above; Supabase does not"
  note "expose the deployed bundle's hash, and 'functions download' cannot reproduce"
  note "it here — it refuses to extract the js/ files the bundle contains"
fi

# ── 4. Backup ─────────────────────────────────────────────────────────
say "4. Most recent physical backup"

bk_raw="$("$SB" backups list --project-ref "$REF" -o json 2>/dev/null)"
bk_rc=$?
if [ "$bk_rc" -ne 0 ] || [ -z "$bk_raw" ]; then
  bad "could not read backups (cli exit $bk_rc)"
else
  bk_out="$(printf '%s' "$bk_raw" | MAXH="$MAX_BACKUP_AGE_HOURS" python -c "
import sys, json, os, datetime
t = sys.stdin.read(); i = t.find('{')
d = json.loads(t[i:t.rfind('}')+1])
b = sorted(d.get('backups', []), key=lambda r: r.get('inserted_at',''), reverse=True)
if not b:
    print('no backups found'); raise SystemExit(2)
newest = b[0]['inserted_at']
age = (datetime.datetime.now(datetime.timezone.utc)
       - datetime.datetime.fromisoformat(newest.replace('Z','+00:00'))).total_seconds()/3600
print('newest %s (%.1fh old), %d retained' % (newest, age, len(b)))
raise SystemExit(0 if age <= float(os.environ['MAXH']) else 2)
" 2>/dev/null)"
  bk_parse=$?
  # A stale backup now FAILS the gate rather than printing and carrying on.
  if [ "$bk_parse" -eq 0 ]; then
    ok "$bk_out"
  else
    bad "${bk_out:-backup check failed} — must be newer than ${MAX_BACKUP_AGE_HOURS}h"
  fi
fi

# ── 5. Baseline ───────────────────────────────────────────────────────
say "5. Baseline — retired-account collection, before the fix"

base_raw="$("$SB" db query --linked "
  select now() as checked_at,
         (select count(*) from rc_scrobbles s join rc_agents a on a.agent_no=s.agent_no
           where a.retired_at is not null) as retired_scrobbles_total,
         (select count(*) from rc_scrobbles s join rc_agents a on a.agent_no=s.agent_no
           where a.retired_at is not null and s.created_at > now() - interval '1 hour') as stored_last_hour,
         (select count(*) from rc_stream_sync_state st join rc_agents a on a.agent_no=st.agent_no
           where a.retired_at is not null and st.last_attempt_at > now() - interval '1 hour') as polled_last_hour,
         (select max(st.last_attempt_at) from rc_stream_sync_state st join rc_agents a on a.agent_no=st.agent_no
           where a.retired_at is not null) as newest_poll_attempt" 2>/dev/null)"
base_rc=$?
if [ "$base_rc" -ne 0 ] || ! printf '%s' "$base_raw" | grep -q '"checked_at"'; then
  # A baseline we could not take is a verification we cannot do afterwards.
  bad "baseline query failed (cli exit $base_rc) — without it, 'collection stopped' cannot be proved later"
else
  printf '%s' "$base_raw" | grep -E '"checked_at"|"retired_scrobbles_total"|"stored_last_hour"|"polled_last_hour"|"newest_poll_attempt"' | sed 's/^ */  /'
  ok "baseline recorded — keep this output"
  note "polled_last_hour comes from rc_stream_sync_state.last_attempt_at, which is"
  note "written on every poll ATTEMPT — so it is evidence the provider was"
  note "contacted, independent of whether any row was stored"
fi

# ── Result ────────────────────────────────────────────────────────────
say "RESULT ($MODE)"
if [ "$fail" = "0" ]; then
  if [ "$MODE" = "inspect" ]; then
    echo "  INSPECTION PASSED — this is NOT a deployment approval. Re-run without --inspect."
  else
    echo "  PRE-FLIGHT PASSED — approved to deploy Stage 1."
  fi
else
  echo "  PRE-FLIGHT FAILED — do not deploy. Resolve the STOP lines above."
fi
exit "$fail"
