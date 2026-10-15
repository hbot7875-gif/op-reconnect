// MAMA Event Hub — migration 20261015150000 against a real Postgres engine
// (PGlite): the own-team roster, Instagram opt-in, the Chat feed's privacy,
// slow mode, timeouts, reactions, mutes and the report thresholds.
//
//   PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite/dist/index.js node --test <this file>
// Without PGLITE_MODULE the suite is skipped (and says so).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const MIGRATION = readFileSync(new URL('../../../migrations/20261015150000_rc_battle_hub.sql', import.meta.url), 'utf8')
const TODAY_MIGRATION = readFileSync(new URL('../../../migrations/20261016090000_rc_battle_team_today.sql', import.meta.url), 'utf8')
const modulePath = process.env.PGLITE_MODULE
const skip = modulePath ? false : 'set PGLITE_MODULE to run the SQL suite'
const C = 'mama_2026'

// H1..H4 are HOOLIGANS, A1..A5 ALIENS, N1 has no team yet.
const PEOPLE = [
  ['H1', 'hooligans', 'Moonchild', 'moon.child'], ['H2', 'hooligans', 'Dalmajung', 'dal.ma'], ['H3', 'hooligans', 'golden hour', '@gold_jk'],
  ['H4', 'hooligans', 'Tannie', 'tannie'],
  ['A1', 'aliens', 'Koya', 'koya.nav'], ['A2', 'aliens', 'Star', 'star7'], ['A3', 'aliens', 'Mochi', 'mochi'], ['A4', 'aliens', 'Vante', 'vante'],
  ['A5', 'aliens', 'Tata', 'tata'], ['N1', null, 'Newbie', 'newbie'],
]
const ag = (k) => `AGENT9${k}`

async function setup() {
  const { PGlite } = await import(pathToFileURL(modulePath).href)
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table rc_agents (agent_no text primary key, handle text);
    create table rc_players (agent_no text primary key references rc_agents on delete cascade, codename text);
    create table rc_vote_campaigns (id text primary key, active boolean default true, opens_at timestamptz, closes_at timestamptz, battle jsonb);
    create table rc_campaign_teams (
      campaign_id text not null references rc_vote_campaigns (id),
      agent_no text not null references rc_agents (agent_no) on delete cascade,
      team text check (team ~ '^[a-z0-9_]{1,24}$'),
      assigned_via text, started_at timestamptz not null default now(), assigned_at timestamptz,
      primary key (campaign_id, agent_no));
    create table rc_campaign_proofs (id bigserial primary key, campaign_id text, agent_no text, vote_day date, status text);
    create table rc_cache (key text primary key, value jsonb, updated_at timestamptz);
    insert into rc_vote_campaigns values ('${C}', true, now() - interval '1 day', now() + interval '3 days', '{"enabled":true}');
  `)
  for (const [k, team, name, handle] of PEOPLE) {
    await db.query('insert into rc_agents values ($1, $2)', [ag(k), handle])
    await db.query('insert into rc_players values ($1, $2)', [ag(k), name])
    await db.query('insert into rc_campaign_teams (campaign_id, agent_no, team, assigned_via) values ($1, $2, $3, $4)', [C, ag(k), team, team ? 'choice' : null])
  }
  await db.exec(MIGRATION)
  await db.exec(MIGRATION) // re-runnable
  await db.exec(TODAY_MIGRATION)
  return db
}
const one = async (db, sql, args) => (await db.query(sql, args)).rows[0]
const fn = async (db, name, args) => Object.values(await one(db, `select ${name}(${args.map((_, i) => `$${i + 1}`).join(', ')}) as r`, args))[0]
const send = (db, k, body, reply = null) => fn(db, 'rc_battle_chat_send', [C, ag(k), body, reply])
const age = (db, k, seconds) => db.query(`update rc_battle_chat set created_at = created_at - make_interval(secs => $2) where agent_no = $1`, [ag(k), seconds])

test('roster: own team only, A–Z with me first, Instagram only when opted in, no agent numbers', { skip }, async () => {
  const db = await setup()
  try {
    await db.query(`insert into rc_campaign_proofs (campaign_id, agent_no, vote_day, status) values ($1, $2, '2026-10-15', 'verified'), ($1, $2, '2026-10-15', 'verified'), ($1, $3, '2026-10-15', 'review'), ($1, $4, '2026-10-14', 'verified'), ($1, $5, '2026-10-15', 'verified')`, [C, ag('H2'), ag('H3'), ag('H4'), ag('A1')])
    await db.query(`update rc_campaign_teams set show_ig = true where agent_no in ($1, $2)`, [ag('H3'), ag('A1')])
    const r = await fn(db, 'rc_battle_team_roster', [C, ag('H4'), '2026-10-15'])
    assert.equal(r.team, 'hooligans')
    assert.equal(r.count, 4)
    assert.deepEqual(r.members.map((m) => m.codename), ['Tannie', 'Dalmajung', 'golden hour', 'Moonchild'], 'me first, then A–Z')
    assert.equal(r.members[0].me, true)
    assert.deepEqual(r.members.map((m) => m.ig), [null, null, 'gold_jk', null], 'only the opted-in member, @ stripped')
    assert.deepEqual(r.members.map((m) => m.today), [0, 2, 0, 0], 'verified votes today only — not in review, not yesterday, not the other team')
    assert.ok(r.members.every((m) => !('votedToday' in m)))
    const json = JSON.stringify(r)
    assert.doesNotMatch(json, /AGENT9/, 'no agent numbers')
    for (const other of ['Koya', 'Star', 'Mochi', 'koya.nav']) assert.ok(!json.includes(other), `${other} is on the other team`)
    assert.equal(r.online, 1, 'the caller is online; nobody else has been seen')
    await fn(db, 'rc_battle_team_roster', [C, ag('H1'), '2026-10-15'])
    assert.equal((await fn(db, 'rc_battle_team_roster', [C, ag('H4'), '2026-10-15'])).online, 2)
    assert.equal((await fn(db, 'rc_battle_team_roster', [C, ag('N1'), '2026-10-15'])).team, null, 'no side yet: nothing')
    assert.equal((await fn(db, 'rc_battle_team_roster', [C, 'AGENT404', '2026-10-15'])).team, null)
  } finally { await db.close() }
})

test('send: team needed, 200 chars, slow mode, six a minute, repeats, timeouts, closed or paused room', { skip }, async () => {
  const db = await setup()
  try {
    assert.equal((await send(db, 'N1', 'hi')).error, 'team_required')
    assert.equal((await send(db, 'H1', 'x'.repeat(201))).error, 'bad_length')
    assert.equal((await send(db, 'H1', 'hello aliens')).ok, true)
    const slow = await send(db, 'H1', 'second one')
    assert.equal(slow.error, 'slow_down')
    assert.ok(slow.wait >= 1 && slow.wait <= 5)
    await age(db, 'H1', 6)
    assert.equal((await send(db, 'H1', 'HELLO ALIENS ')).error, 'repeat', 'same words within 2 minutes')
    assert.equal((await send(db, 'H1', 'second one')).ok, true)
    for (let i = 0; i < 4; i++) { await age(db, 'H1', 6); assert.equal((await send(db, 'H1', `msg ${i}`)).ok, true) }
    await age(db, 'H1', 6)
    assert.equal((await send(db, 'H1', 'seventh')).error, 'slow_down', 'six a minute')
    await db.query(`update rc_campaign_teams set chat_timeout_until = now() + interval '1 hour' where agent_no = $1`, [ag('A1')])
    const to = await send(db, 'A1', 'let me talk')
    assert.equal(to.error, 'timed_out')
    assert.ok(to.until)
    await db.query(`update rc_vote_campaigns set battle = '{"enabled":true,"chat_paused":true}'`)
    assert.equal((await send(db, 'A2', 'paused?')).error, 'chat_paused')
    await db.query(`update rc_vote_campaigns set battle = '{"enabled":true}', closes_at = now() - interval '1 minute'`)
    assert.equal((await send(db, 'A2', 'closed?')).error, 'chat_closed')
  } finally { await db.close() }
})

test('feed: codename + team + member key, never agent numbers; replies; hidden bodies; presence', { skip }, async () => {
  const db = await setup()
  try {
    const first = await send(db, 'A1', 'aliens never sleep')
    await send(db, 'H1', 'neither do we', first.id)
    await db.query(`insert into rc_battle_chat (campaign_id, kind, team, body, system_key) values ($1, 'system', 'hooligans', 'HOOLIGANS TOOK THE LEAD', 'lead:hooligans:x')`, [C])
    await assert.rejects(db.query(`insert into rc_battle_chat (campaign_id, kind, team, body, system_key) values ($1, 'system', null, 'again', 'lead:hooligans:x')`, [C]), /unique|duplicate/i, 'one row per moment key')
    const f = await fn(db, 'rc_battle_chat_feed', [C, ag('H2'), 60])
    assert.equal(f.team, 'hooligans')
    assert.deepEqual(f.messages.map((m) => [m.kind, m.codename, m.team]), [['player', 'Koya', 'aliens'], ['player', 'Moonchild', 'hooligans'], ['system', null, 'hooligans']])
    assert.equal(f.messages[1].replyTo.codename, 'Koya')
    assert.equal(f.messages[1].replyTo.body, 'aliens never sleep')
    assert.equal(f.messages[2].sys, 'lead')
    assert.match(f.messages[0].memberKey, /^[0-9a-f-]{36}$/)
    assert.equal(f.moments.length, 1)
    assert.doesNotMatch(JSON.stringify(f), /AGENT9/, 'no agent numbers anywhere in the feed')
    assert.deepEqual(f.presence, { hooligans: 1 }, 'only the reader has polled; sending is not presence')
    await db.query(`update rc_battle_chat set status = 'removed' where id = $1`, [first.id])
    const g = await fn(db, 'rc_battle_chat_feed', [C, ag('H2'), 60])
    assert.equal(g.messages[0].body, null, 'removed text is not sent')
    assert.equal(g.messages[1].replyTo.body, null, 'nor quoted')
    assert.equal((await fn(db, 'rc_battle_chat_feed', [C, ag('N1'), 60])).team, null)
  } finally { await db.close() }
})

test('reactions toggle, one per emoji, visible messages only, and an allowed set', { skip }, async () => {
  const db = await setup()
  try {
    const m = await send(db, 'A1', 'go go')
    assert.deepEqual(await fn(db, 'rc_battle_chat_react', [C, ag('H1'), m.id, '🔥']), { ok: true, on: true })
    await fn(db, 'rc_battle_chat_react', [C, ag('H2'), m.id, '🔥'])
    let f = await fn(db, 'rc_battle_chat_feed', [C, ag('H1'), 60])
    assert.deepEqual(f.messages[0].reactions, { '🔥': 2 })
    assert.deepEqual(f.messages[0].myReactions, ['🔥'])
    assert.deepEqual(await fn(db, 'rc_battle_chat_react', [C, ag('H1'), m.id, '🔥']), { ok: true, on: false })
    f = await fn(db, 'rc_battle_chat_feed', [C, ag('H1'), 60])
    assert.deepEqual(f.messages[0].reactions, { '🔥': 1 })
    assert.equal((await fn(db, 'rc_battle_chat_react', [C, ag('H1'), m.id, '💩'])).error, 'bad_emoji')
    assert.equal((await fn(db, 'rc_battle_chat_react', [C, ag('N1'), m.id, '🔥'])).error, 'team_required')
    await db.query(`update rc_battle_chat set status = 'auto_hidden' where id = $1`, [m.id])
    assert.equal((await fn(db, 'rc_battle_chat_react', [C, ag('H1'), m.id, '😂'])).error, 'not_found')
  } finally { await db.close() }
})

test('mute by member key hides that member (and their reactions) for the muter only', { skip }, async () => {
  const db = await setup()
  try {
    const m = await send(db, 'A1', 'spam spam')
    await fn(db, 'rc_battle_chat_react', [C, ag('A1'), m.id, '😂'])
    const key = (await one(db, 'select member_key::text as k from rc_campaign_teams where agent_no = $1', [ag('A1')])).k
    const own = (await one(db, 'select member_key::text as k from rc_campaign_teams where agent_no = $1', [ag('H1')])).k
    assert.equal((await fn(db, 'rc_battle_chat_mute', [C, ag('H1'), own, true])).error, 'own_message')
    assert.deepEqual(await fn(db, 'rc_battle_chat_mute', [C, ag('H1'), key, true]), { ok: true, muted: true })
    const mine = await fn(db, 'rc_battle_chat_feed', [C, ag('H1'), 60])
    assert.equal(mine.messages.length, 0)
    assert.deepEqual(mine.muted, [{ memberKey: key, codename: 'Koya' }])
    assert.equal((await fn(db, 'rc_battle_chat_feed', [C, ag('H2'), 60])).messages.length, 1, 'others still see it')
    await fn(db, 'rc_battle_chat_mute', [C, ag('H1'), key, false])
    assert.equal((await fn(db, 'rc_battle_chat_feed', [C, ag('H1'), 60])).messages.length, 1)
  } finally { await db.close() }
})

test('reports: hidden for the reporter at once; for everyone at 3 with an own-team report, else at 5', { skip }, async () => {
  const db = await setup()
  try {
    const status = async (id) => (await one(db, 'select status from rc_battle_chat where id = $1', [id])).status
    // A HOOLIGANS message reported only by ALIENS: needs five.
    const m = await send(db, 'H1', 'hooligans rule')
    assert.equal((await fn(db, 'rc_battle_chat_report', [C, ag('H1'), m.id, 'spam'])).error, 'own_message')
    assert.equal((await fn(db, 'rc_battle_chat_report', [C, ag('A1'), m.id, 'nope'])).error, 'bad_reason')
    for (const k of ['A1', 'A2', 'A3', 'A4']) assert.deepEqual(await fn(db, 'rc_battle_chat_report', [C, ag(k), m.id, 'harassment']), { ok: true, hidden: false })
    await fn(db, 'rc_battle_chat_report', [C, ag('A1'), m.id, 'harassment']) // a repeat counts once
    assert.equal(await status(m.id), 'visible', 'four rival reports are not enough')
    assert.equal((await fn(db, 'rc_battle_chat_feed', [C, ag('A1'), 60])).messages.length, 0, 'gone for a reporter')
    assert.equal((await fn(db, 'rc_battle_chat_feed', [C, ag('H2'), 60])).messages[0].body, 'hooligans rule')
    assert.deepEqual(await fn(db, 'rc_battle_chat_report', [C, ag('A5'), m.id, 'spam']), { ok: true, hidden: true })
    assert.equal(await status(m.id), 'auto_hidden')
    // Three with one from the sender's own team.
    await age(db, 'H1', 10)
    const n = await send(db, 'H1', 'something rude')
    await fn(db, 'rc_battle_chat_report', [C, ag('A1'), n.id, 'hate'])
    await fn(db, 'rc_battle_chat_report', [C, ag('A2'), n.id, 'hate'])
    assert.equal(await status(n.id), 'visible')
    assert.deepEqual(await fn(db, 'rc_battle_chat_report', [C, ag('H2'), n.id, 'hate']), { ok: true, hidden: true })
    assert.equal(await status(n.id), 'auto_hidden')
    const f = await fn(db, 'rc_battle_chat_feed', [C, ag('H3'), 60])
    assert.equal(f.messages.find((x) => x.id === n.id).body, null, 'hidden for everyone')
    assert.equal(f.messages.find((x) => x.id === n.id).status, 'auto_hidden')
    // System moments can't be reported.
    await db.query(`insert into rc_battle_chat (campaign_id, kind, body, system_key) values ($1, 'system', 'THE BATTLE IS TIED', 'tie:1')`, [C])
    const sid = (await one(db, `select id from rc_battle_chat where kind = 'system'`)).id
    assert.equal((await fn(db, 'rc_battle_chat_report', [C, ag('A1'), sid, 'spam'])).error, 'not_found')
  } finally { await db.close() }
})

test('retiring an agent removes their messages, reactions, reports and mutes', { skip }, async () => {
  const db = await setup()
  try {
    const m = await send(db, 'A1', 'bye')
    await fn(db, 'rc_battle_chat_react', [C, ag('A1'), m.id, '💜'])
    const h = await send(db, 'H1', 'stay')
    await fn(db, 'rc_battle_chat_report', [C, ag('A1'), h.id, 'spam'])
    await db.query('delete from rc_agents where agent_no = $1', [ag('A1')])
    for (const t of ['rc_battle_chat', 'rc_battle_chat_reactions', 'rc_battle_chat_reports']) {
      const { n } = await one(db, `select count(*)::int as n from ${t} where ${t === 'rc_battle_chat_reports' ? 'reporter' : 'agent_no'} = $1`, [ag('A1')])
      assert.equal(n, 0, t)
    }
  } finally { await db.close() }
})

test('retention: Chat, mutes and Instagram choices go 30 days after the event, not before', { skip }, async () => {
  const db = await setup()
  try {
    const m = await send(db, 'H1', 'gg')
    await fn(db, 'rc_battle_chat_react', [C, ag('A1'), m.id, '👏'])
    await fn(db, 'rc_battle_chat_report', [C, ag('A2'), m.id, 'spam'])
    const key = (await one(db, 'select member_key::text as k from rc_campaign_teams where agent_no = $1', [ag('H1')])).k
    await fn(db, 'rc_battle_chat_mute', [C, ag('A1'), key, true])
    await db.query('update rc_campaign_teams set show_ig = true where agent_no = $1', [ag('H2')])
    const count = async (t) => (await one(db, `select count(*)::int as n from ${t}`)).n
    await db.query(`update rc_vote_campaigns set closes_at = now() - interval '29 days'`)
    assert.equal(await fn(db, 'rc_battle_chat_retention', []), 0, 'still inside 30 days')
    assert.equal(await count('rc_battle_chat'), 1)
    await db.query(`update rc_vote_campaigns set closes_at = now() - interval '31 days'`)
    assert.equal(await fn(db, 'rc_battle_chat_retention', []), 1)
    for (const t of ['rc_battle_chat', 'rc_battle_chat_reactions', 'rc_battle_chat_reports', 'rc_battle_chat_mutes']) assert.equal(await count(t), 0, t)
    assert.equal((await one(db, 'select count(*)::int as n from rc_campaign_teams where show_ig')).n, 0)
  } finally { await db.close() }
})
