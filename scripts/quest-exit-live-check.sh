#!/usr/bin/env bash
# Live regression check for the ReConnect quest-exit paths, run against the
# real deployed backend with a short-lived AGENT001 session (see
# docs/test-account-and-session-tokens.md). Read-write on the TEST account
# only; it cleans up after itself.
#
#   bash scripts/quest-exit-live-check.sh
#
# Covers: the four free paths, the paid path, the 24h gate, the 7-day
# cooldown, insufficient balances, the old self-removal endpoint, and that a
# leaver's pooled streams stay with the team.

set -uo pipefail
API=https://lcvmwlioqpyaprxicdfl.supabase.co/functions/v1/op-reconnect
H='Content-Type: application/json'
R='x-region: ap-northeast-2'
AG=AGENT001
DIST=relay-zero-hq
pass=0; fail=0

sql() { npx supabase db query --linked "$1" >/dev/null 2>&1; }
api() { curl -s -X POST "$API" -H "$H" -H "$R" -d "$1"; }
check() { # name expected_substring actual
  if [[ "$3" == *"$2"* ]]; then echo "  PASS  $1"; pass=$((pass+1));
  else echo "  FAIL  $1"; echo "        want ~ $2"; echo "        got    $3"; fail=$((fail+1)); fi
}

TOK=$(npx supabase db query --linked \
  "update rc_agents set session_token='test-'||gen_random_uuid()::text, session_expires_at=now()+interval '30 minutes' where agent_no='$AG' returning session_token" \
  2>&1 | grep -o 'test-[0-9a-f-]*' | head -1)
[[ -z "$TOK" ]] && { echo "could not mint a test session"; exit 1; }
AUTH="\"agentNo\":\"$AG\",\"sessionToken\":\"$TOK\""

reset() { # fresh quest, joined_at backdated by $1 hours, streamed_at per $2
  sql "delete from rc_reconnect_participants where mission_id in (select id from rc_reconnect_missions where created_by='$AG'); delete from rc_reconnect_missions where created_by='$AG'"
  api "{\"action\":\"startDistrict\",$AUTH,\"districtId\":\"$DIST\"}" >/dev/null
  api "{\"action\":\"openReconnectMission\",$AUTH,\"districtId\":\"$DIST\"}" >/dev/null
  sql "update rc_reconnect_participants set joined_at=now()-interval '$1 hours', streamed_at=$2 where agent_no='$AG' and status='joined'"
}
quote() { api "{\"action\":\"getQuestSkipQuote\",$AUTH,\"districtId\":\"$DIST\"}"; }
exitq() { api "{\"action\":\"skipQuest\",$AUTH,\"districtId\":\"$DIST\"}"; }

echo "== setup =="
sql "update rc_players set mode='medium', charge_cells=500 where agent_no='$AG'"
sql "delete from rc_quest_skips where agent_no='$AG'"
sql "delete from rc_xp_ledger where agent_no='$AG' and source in ('qe_seed','quest_skip')"
sql "insert into rc_xp_ledger (agent_no, amount, source, kind, dedup_key) values ('$AG',600,'qe_seed','earn','qe-seed-1')"

echo "== 1. cancel_join: within 24h, nothing streamed -> free =="
reset 2 null
check "action is cancel_join" '"action":"cancel_join"' "$(quote)"
check "costs nothing"        '"costXp":0'              "$(quote)"
check "exit succeeds free"   '"free":true'             "$(exitq)"

echo "== 2. within 24h but already streamed -> must wait, no charge =="
reset 2 now\(\)
check "waitingPeriod set"    '"waitingPeriod":true'    "$(quote)"
check "refused as too_soon"  'too_soon'                "$(exitq)"

echo "== 3. teammate silent 48h+ -> free rescue =="
reset 30 now\(\)
sql "insert into rc_reconnect_participants (mission_id, agent_no, status, joined_at) select mission_id,'AGENT002','invited',now()-interval '50 hours' from rc_reconnect_participants where agent_no='$AG' and status='joined' limit 1 on conflict do nothing"
check "action is teammate_rescue" '"action":"teammate_rescue"' "$(quote)"
check "exit is free"              '"freeReason":"teammate_rescue"' "$(exitq)"

echo "== 4. expired quest -> free =="
reset 30 now\(\)
sql "update rc_reconnect_missions set expires_at=now()-interval '1 hour' where created_by='$AG'"
check "action is expired"    '"action":"expired"'      "$(quote)"
check "exit is free"         '"freeReason":"expired"'  "$(exitq)"

echo "== 5. paid skip after 24h =="
sql "delete from rc_quest_skips where agent_no='$AG'"
reset 30 now\(\)
before_cells=$(npx supabase db query --linked "select charge_cells from rc_players where agent_no='$AG'" 2>&1 | grep -o '"charge_cells": [0-9]*' | grep -o '[0-9]*')
before_level=$(npx supabase db query --linked "select coalesce(sum(amount) filter (where kind='earn'),0) as x from rc_xp_ledger where agent_no='$AG'" 2>&1 | grep -o '"x": [0-9-]*' | grep -o '[0-9-]*$')
check "action is skip"       '"action":"skip"'         "$(quote)"
check "priced for medium"    '"costXp":150'            "$(quote)"
check "charged and left"     '"costCells":25'          "$(exitq)"
after_cells=$(npx supabase db query --linked "select charge_cells from rc_players where agent_no='$AG'" 2>&1 | grep -o '"charge_cells": [0-9]*' | grep -o '[0-9]*')
after_level=$(npx supabase db query --linked "select coalesce(sum(amount) filter (where kind='earn'),0) as x from rc_xp_ledger where agent_no='$AG'" 2>&1 | grep -o '"x": [0-9-]*' | grep -o '[0-9-]*$')
check "cells deducted by 25" "$((before_cells-25))" "$after_cells"
check "LEVEL XP unchanged"   "$before_level"        "$after_level"

echo "== 6. cooldown holds the next paid skip =="
reset 30 now\(\)
check "onCooldown reported"  '"onCooldown":true'       "$(quote)"
check "refused"              'on_cooldown'             "$(exitq)"

echo "== 7. old endpoint cannot be used as a free self-exit =="
sql "delete from rc_quest_skips where agent_no='$AG'"
reset 30 now\(\)
check "self-removal refused" 'use_quest_exit' \
  "$(api "{\"action\":\"removeReconnectParticipant\",$AUTH,\"districtId\":\"$DIST\",\"targetAgentNo\":\"$AG\"}")"
check "still on the quest"   '"action":"skip"'         "$(quote)"

echo "== 8. insufficient balance charges nothing =="
sql "update rc_players set charge_cells=1 where agent_no='$AG'"
check "reports shortfall"    '"canAfford":false'       "$(quote)"
check "refused"              'insufficient'            "$(exitq)"
cells_now=$(npx supabase db query --linked "select charge_cells from rc_players where agent_no='$AG'" 2>&1 | grep -o '"charge_cells": [0-9]*' | grep -o '[0-9]*')
check "cells untouched"      "1"                       "$cells_now"

echo "== 9. a leaver's pooled streams stay with the team =="
sql "update rc_players set charge_cells=500 where agent_no='$AG'"
sql "delete from rc_quest_skips where agent_no='$AG'"
reset 30 now\(\)
sql "update rc_reconnect_participants set contribution_frozen=0 where agent_no='$AG'"
exitq >/dev/null
frozen=$(npx supabase db query --linked "select status||':'||contribution_frozen as s from rc_reconnect_participants where agent_no='$AG' order by joined_at desc limit 1" 2>&1 | grep -o '"s": "[^"]*"')
check "row kept as 'left' with a frozen figure" 'left:' "$frozen"
seat=$(npx supabase db query --linked "select count(*) as n from rc_reconnect_participants p join rc_reconnect_missions m on m.id=p.mission_id where m.created_by='$AG' and p.status='joined'" 2>&1 | grep -o '"n": [0-9]*')
check "seat reopened (0 joined)" '"n": 0' "$seat"

echo "== 10. the agent can start a new quest afterwards =="
check "new quest opens" '"success":true' \
  "$(api "{\"action\":\"openReconnectMission\",$AUTH,\"districtId\":\"$DIST\"}")"

echo "== cleanup =="
sql "delete from rc_reconnect_participants where mission_id in (select id from rc_reconnect_missions where created_by='$AG'); delete from rc_reconnect_missions where created_by='$AG'"
sql "delete from rc_reconnect_participants where agent_no='AGENT002' and mission_id not in (select id from rc_reconnect_missions)"
sql "delete from rc_quest_skips where agent_no='$AG'"
sql "delete from rc_xp_ledger where agent_no='$AG' and source in ('qe_seed','quest_skip')"
sql "delete from rc_player_districts where agent_no='$AG'"
sql "update rc_players set mode='easy', charge_cells=0 where agent_no='$AG'"
sql "update rc_agents set session_token=null, session_expires_at=null where agent_no='$AG'"

echo
echo "passed $pass, failed $fail"
[[ $fail -eq 0 ]] || exit 1
