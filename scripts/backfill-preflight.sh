#!/usr/bin/env bash
# Read-only preflight for 20260927160000_rc_purge_previously_retired.sql —
# the one-time purge of the 13 accounts that retired before retirement deleted
# anything.
#
#   bash scripts/backfill-preflight.sh
#
# Exit 0 = safe to apply. Anything else = STOP.
#
# This is the most destructive step in the whole privacy programme: ~58,000 rows
# of real people's data, plus 50 Storage files that database backups do not
# cover. Unlike every earlier gate, there is no rollback — so this one's job is
# to prove the population is exactly what was reviewed and that nothing live is
# in scope.

set -uo pipefail

SB="${SB:-/c/Users/sunke/AppData/Local/npm-cache/_npx/6f1b058a4d9555af/node_modules/@supabase/cli-windows-x64/bin/supabase.exe}"
REF="${REF:-lcvmwlioqpyaprxicdfl}"

MIGRATION="20260928100000_rc_purge_previously_retired.sql"
EXPECT_RETIRED="${EXPECT_RETIRED:-13}"
EXPECT_FN_VERSION="${EXPECT_FN_VERSION:-317}"
MAX_BACKUP_AGE_HOURS="${MAX_BACKUP_AGE_HOURS:-36}"
STAGE1_T="${STAGE1_T:-2026-09-28 03:53:40.327721+00}"

# sha256 of the COMMENT-STRIPPED executable body, as reviewed. Comments were
# updated after review (the figures were stale); the logic was not.
EXPECT_BODY_SHA="${EXPECT_BODY_SHA:-2bdaaaa2e634ce2c}"

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
val() { printf '%s' "$1" | grep -o "\"$2\": *[^,}]*" | head -1 | sed 's/^[^:]*: *//; s/"//g; s/ *$//'; }

MIG_PATH=""
for d in supabase/pending supabase/migrations; do
  [ -f "$d/$MIGRATION" ] && MIG_PATH="$d/$MIGRATION"
done

# ── 1. The population ─────────────────────────────────────────────────
say "1. The 13 accounts — still exactly 13, none reactivated"

pop="$(q "select
  (select count(*) from rc_agents where retired_at is not null) as retired_now,
  (select count(*) from rc_agents where retired_at is not null and last_login_at > retired_at) as reactivated,
  (select count(*) from rc_agents where retired_at is not null and agent_no = 'AGENT001') as test_account_in_scope,
  (select count(*) from rc_agents where retired_at is null) as active_agents,
  (select count(*) from rc_deleted_agent_log where reason = 'retired_backfill') as already_run")"
if [ $? -ne 0 ]; then
  bad "could not read the population — do not apply blind"
else
  r="$(val "$pop" retired_now)"
  [ "$r" = "$EXPECT_RETIRED" ] && ok "$r retired accounts — exactly what was reviewed" \
    || bad "$r retired accounts now, $EXPECT_RETIRED reviewed — re-run the preview and have this re-approved"
  [ "$(val "$pop" reactivated)" = "0" ] && ok "0 reactivated (none has logged in since retiring)" \
    || bad "$(val "$pop" reactivated) retired account(s) have logged in since retiring — STOP"
  [ "$(val "$pop" test_account_in_scope)" = "0" ] && ok "AGENT001 is not in scope" || bad "AGENT001 is retired and would be in scope"
  [ "$(val "$pop" already_run)" = "0" ] && ok "the backfill has never run" || bad "$(val "$pop" already_run) rows already carry reason 'retired_backfill' — it may have run before"
  note "$(val "$pop" active_agents) active agents are out of scope by the migration's own WHERE clause"
fi

# ── 2. Nothing live is reachable ──────────────────────────────────────
say "2. No active agent or shared file can be caught"

shared="$(q "with r as (select agent_no from rc_agents where retired_at is not null)
select
  (select count(*) from rc_vma_votes v join r using (agent_no)
    where v.proof_path is not null
      and exists (select 1 from rc_vma_votes o
                   where o.proof_path = v.proof_path
                     and o.agent_no not in (select agent_no from r))) as proofs_shared_with_live,
  (select count(*) from rc_badge_art a join r on r.agent_no = a.uploaded_by) as badge_art_uploaded,
  (select count(*) from rc_badges b
    where b.artwork_id in (select id from rc_badge_art a join r on r.agent_no = a.uploaded_by)
      and b.agent_no not in (select agent_no from r)) as badges_others_wear")"
if [ $? -ne 0 ]; then
  bad "could not check shared content"
else
  [ "$(val "$shared" proofs_shared_with_live)" = "0" ] && ok "0 proof files shared with a live agent" \
    || bad "$(val "$shared" proofs_shared_with_live) proof file(s) are shared with an ACTIVE agent — STOP"
  [ "$(val "$shared" badge_art_uploaded)" = "0" ] && ok "0 badge artwork uploaded by them (nothing shared to preserve)" \
    || note "$(val "$shared" badge_art_uploaded) badge photo(s) — kept, uploader nulled"
  [ "$(val "$shared" badges_others_wear)" = "0" ] && ok "0 badges worn by other agents depend on their uploads" \
    || note "$(val "$shared" badges_others_wear) badge(s) other agents wear — the photo is kept"
fi

# ── 3. What would go ──────────────────────────────────────────────────
say "3. Current counts — what this would delete"

counts="$(q "with r as (select agent_no from rc_agents where retired_at is not null)
select
  (select count(*) from rc_scrobbles x join r using (agent_no)) as scrobbles,
  (select count(*) from rc_engagement_events x join r using (agent_no)) as engagement_events,
  (select count(*) from rc_feed_events x join r using (agent_no)) as feed_events,
  (select count(*) from rc_xp_ledger x join r using (agent_no)) as xp_rows,
  (select count(*) from rc_badges x join r using (agent_no)) as badges,
  (select count(*) from rc_vma_votes x join r using (agent_no)) as votes,
  (select count(*) from rc_vma_votes x join r using (agent_no) where x.proof_path is not null) as proof_files,
  (select count(*) from rc_share_snapshots x join r on r.agent_no = x.created_by) as share_snapshots")"
if [ $? -ne 0 ]; then
  bad "could not compute the counts — do not apply blind"
else
  printf '%s' "$counts" | grep -oE '"[a-z_]+": *[0-9]+' | sed 's/^/    /'
  warn "the $(val "$counts" proof_files) proof files are queued as 'agent_purged' and the hourly sweep DELETES them, typically within the hour"
  warn "database backups do not cover Storage — once swept, those files are gone by any route"
fi

# ── 4. Stage 1 and Stage 2 still healthy ──────────────────────────────
say "4. Stage 1 and Stage 2 healthy"

st="$(q "select
  (select count(*) from pg_trigger where tgrelid='rc_scrobbles'::regclass and tgname='rc_scrobbles_block_retired' and tgenabled='O') as stage1_trigger,
  (select count(*) from rc_scrobbles s join rc_agents a on a.agent_no=s.agent_no
    where a.retired_at is not null and s.created_at > '$STAGE1_T'::timestamptz) as retired_stored_since_T,
  (select count(*) from rc_stream_sync_state st2 join rc_agents a on a.agent_no=st2.agent_no
    where a.retired_at is not null and st2.last_attempt_at > '$STAGE1_T'::timestamptz) as retired_polled_since_T,
  (to_regprocedure('public.rc_purge_agent_data(text,text)') is not null) as purge_fn,
  (to_regprocedure('public.rc_queue_agent_proof_files(text)') is not null) as queue_files_fn,
  (select count(*) from cron.job where jobname in ('rc-purge-deleted-agent-log','rc-queue-expired-vote-proofs','rc-inactive-reminders') and active) as stage2b_jobs,
  (select count(*) from cron.job) as cron_total")"
if [ $? -ne 0 ]; then
  bad "could not verify Stage 1/2"
else
  [ "$(val "$st" stage1_trigger)" = "1" ] && ok "Stage 1 trigger enabled" || bad "Stage 1 trigger missing"
  [ "$(val "$st" retired_stored_since_t)" = "0" ] && ok "0 retired scrobbles since T" || bad "Stage 1 regressed"
  [ "$(val "$st" retired_polled_since_t)" = "0" ] && ok "0 retired polls since T" || bad "Stage 1 regressed"
  [ "$(val "$st" purge_fn)" = "true" ] && ok "rc_purge_agent_data present" || bad "rc_purge_agent_data missing — Stage 2A not applied"
  [ "$(val "$st" queue_files_fn)" = "true" ] && ok "rc_queue_agent_proof_files present" || bad "rc_queue_agent_proof_files missing"
  [ "$(val "$st" stage2b_jobs)" = "3" ] && ok "3 Stage 2B jobs active (cron total $(val "$st" cron_total))" || bad "$(val "$st" stage2b_jobs) Stage 2B jobs active, expected 3"
fi

# ── 5. The migration itself ───────────────────────────────────────────
say "5. The migration's executable SQL is the reviewed logic"

if [ -z "$MIG_PATH" ]; then
  bad "cannot find $MIGRATION"
else
  ok "found at $MIG_PATH"
  body_sha="$(python scripts/lib/sql-body-sha.py "$MIG_PATH" 2>/dev/null)"
  if [ -n "$EXPECT_BODY_SHA" ]; then
    [ "$body_sha" = "$EXPECT_BODY_SHA" ] && ok "executable body matches the reviewed logic (sha $body_sha)" \
      || bad "executable body CHANGED — sha $body_sha, expected $EXPECT_BODY_SHA"
  else
    note "executable-body sha $body_sha  (set EXPECT_BODY_SHA to pin it)"
  fi
  # The guards that make this safe must all still be present.
  for guard in "expected 13 retired accounts" "have logged in since retiring" "agent_no <> 'AGENT001'" "expected 0 retired accounts after the purge" "rc_purge_agent_data is missing"; do
    grep -q "$guard" "$MIG_PATH" && ok "guard present: ${guard:0:44}" || bad "GUARD MISSING: $guard"
  done
  dele="$(python scripts/lib/top-level-deletes.py "$MIG_PATH" 2>/dev/null | head -1)"
  [ "${dele:-1}" = "0" ] && ok "no raw top-level DELETE — everything goes through rc_purge_agent_data" \
    || bad "$dele top-level DELETE statement(s) — the purge should not delete directly"
fi

# ── 6. Nothing else would be applied ──────────────────────────────────
say "6. No unrelated migration would be applied"

hist_raw="$("$SB" migration list --linked 2>/dev/null)"; hist_rc=$?
hist="$(printf '%s' "$hist_raw" | grep -o '{"migrations".*}')"
if [ "$hist_rc" -ne 0 ] || [ -z "$hist" ]; then
  bad "could not read migration history (cli exit $hist_rc)"
else
  pending="$(printf '%s' "$hist" | python -c "
import sys,json
d=json.load(sys.stdin)
print('\n'.join(r['local'] for r in d.get('migrations',[]) if r.get('local') and not r.get('remote')))" 2>/dev/null)"
  count="$(printf '%s' "$pending" | grep -c . || true)"
  if [ "$count" = "0" ]; then
    note "nothing pending yet — move the backfill into migrations/ and re-run"
  elif [ "$count" = "1" ] && [ "$pending" = "20260928100000" ]; then
    ok "exactly one pending: 20260928100000 (the backfill)"
  else
    bad "$count migration(s) would be applied, expected only the backfill:"; printf '        %s\n' $pending
  fi
  if ls supabase/migrations/*reconcile_orphan* >/dev/null 2>&1; then
    bad "the 92-orphan cleanup is staged in migrations/ — it must not ride along"
  else
    ok "the 92-orphan cleanup is not staged"
  fi
fi

# ── 7. Backup ─────────────────────────────────────────────────────────
say "7. Backup — the only recovery path, and only for the database"

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
print('newest %s (%.1fh old), %d retained, pitr=%s' % (newest, age, len(b), d.get('pitr_enabled')))
raise SystemExit(0 if age <= float(os.environ['MAXH']) else 2)" 2>/dev/null)"; bk_parse=$?
  [ "$bk_parse" -eq 0 ] && ok "$bk_out" || bad "${bk_out:-backup check failed} — must be newer than ${MAX_BACKUP_AGE_HOURS}h"
  warn "recovery means restoring the WHOLE database to that snapshot, losing every other player's activity since"
  warn "Storage is not in the backup at all"
fi

# ── Result ────────────────────────────────────────────────────────────
say "RESULT"
if [ "$fail" = "0" ]; then
  echo "  PREFLIGHT PASSED — the population and scope are exactly as reviewed."
  echo "  This deletes ~58,000 rows and 50 files. There is no rollback."
else
  echo "  PREFLIGHT FAILED — do not apply. Resolve the STOP lines above."
fi
exit "$fail"
