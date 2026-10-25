// The Album: what the migration, the adapter and the routes must (and must
// never) contain. No local Postgres here, so the database half is checked
// against the SQL text — same approach as run-ami-sql.test.mjs.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ALBUM_ERA_IDS } from './album-rules.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const sql = read('../../../migrations/20261025170000_rc_album.sql').replace(/--[^\n]*/g, '')
const adapter = read('./album.ts')
const index = read('../index.ts')
const handlers = read('./handlers.ts')
const runAmi = read('./run-ami.ts')

const eraLists = [...sql.matchAll(/(?:era in \(|array\[)([^)\]]*)[)\]]/g)].map((m) => [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]))

test('the SQL era list is album-rules.js, in release order, everywhere it appears', () => {
  assert.equal(eraLists.length, 2)
  for (const list of eraLists) assert.deepEqual(list, ALBUM_ERA_IDS)
})

test('both tables: RLS on, nothing for browser roles', () => {
  for (const t of ['rc_album_covers', 'rc_album_gifts']) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`), t)
    assert.match(sql, new RegExp(`revoke all on [^;]*public\\.${t}[^;]*from public, anon, authenticated`), t)
  }
  assert.doesNotMatch(sql, /grant [^;]* to (anon|authenticated)/)
  assert.doesNotMatch(sql, /create policy/)
})

test('both functions: security definer, pinned search_path, service_role only', () => {
  for (const f of ['rc_album_award_daily', 'rc_album_gift']) {
    const body = sql.slice(sql.indexOf(`function public.${f}(`))
    assert.match(body.slice(0, 400), /security definer\s+set search_path = public, pg_temp/, f)
  }
  assert.match(sql, /revoke all on function\s+public\.rc_album_award_daily\(text, date, double precision\),\s+public\.rc_album_gift\(text, text, text, date, integer\)\s+from public, anon, authenticated/)
  assert.match(sql, /grant execute on function\s+public\.rc_album_award_daily\(text, date, double precision\),\s+public\.rc_album_gift\(text, text, text, date, integer\)\s+to service_role/)
})

test('exactly-once rules are in the database', () => {
  assert.match(sql, /unique index if not exists rc_album_covers_one_goal_per_day\s+on public\.rc_album_covers \(agent_no, earned_on\) where source = 'goal'/)
  assert.match(sql, /unique index if not exists rc_album_gifts_one_sent_per_day\s+on public\.rc_album_gifts \(from_agent_no, sent_on\)/)
  assert.match(sql, /unique index if not exists rc_album_gifts_one_received_per_day\s+on public\.rc_album_gifts \(to_agent_no, sent_on\)/)
  assert.match(sql, /primary key \(agent_no, era\)/)
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('rc_album:' \|\| least\(p_from, p_to\)\)\)/)
})

test('routes are agent-only; the poll awards and never fails on the Album', () => {
  assert.match(index, /albumState: \{ auth: 'agent'/)
  assert.match(index, /albumGift: \{ auth: 'agent'/)
  assert.match(handlers, /const album = await albumForState\(supabase, player\.agent_no, today, !!sideMissions\.todayDone\)/)
  assert.match(adapter, /export async function albumForState[\s\S]*?try \{[\s\S]*?catch \(_\) \{\s*return null/)
})

test('RUN AMI lets in testers or a full album, nobody else', () => {
  assert.match(runAmi, /const allowAgent = async \(agentNo: string\) =>\s+\(await testers\(supabase\)\.isTester\(agentNo\)\.catch\(\(\) => false\)\) \|\| albumService\(supabase\)\.isComplete\(agentNo\)\.catch\(\(\) => false\)/)
  assert.match(runAmi, /createRunAmiService\(\{[^}]*allowAgent \}\)/)
})
