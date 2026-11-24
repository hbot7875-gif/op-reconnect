// Weekly Collection XP settle: players who qualify and never reopen HT are
// still paid; the week is read as it stood at the reset; late plays inside the
// catch-up window are picked up; app polls and settle runs racing each other
// never pay twice or pass the cap; the earning week is recorded apart from the
// credit time; and the values and activity rules are the app's own.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  settleCollectionXp, itemsAt, districtsAt, helpingDuring, weekToSettle, weekBounds, CATCH_UP_HOURS,
} from './collectible-settle.ts'
import { awardCollectibleXp, WEEKLY_CAP, QUALIFY_PLAYS } from './collectible-rewards.ts'

const WEEK = '2026-11-30'                                  // Mon 30 Nov – Sun 6 Dec (KST)
const RESET = '2026-12-06T15:00:00.000Z'                   // Mon 7 Dec 00:00 KST = Sun 6 Dec 8:30 PM IST
const at = (iso, mins = 0) => Date.parse(iso) + mins * 60_000
const FIRST_RUN = at(RESET, 65)                            // the 16:05 UTC cron
const BEFORE = '2026-11-20T10:00:00.000Z'                  // long before rewards began

// ── A small in-memory Supabase ───────────────────────────────────────────
// Enough of the query builder for these modules, plus rc_award_collectible_xp
// with the migration's semantics: a lock per player-week, the cap re-checked
// against that week's paid rows, unique dedup keys. `slowRpc` yields between
// the paid read and the inserts so racing callers really interleave.
function fakeDb(seed) {
  const t = {
    rc_player_items: [], rc_item_placement_log: [], rc_player_districts: [], rc_daily_activity: [],
    rc_reconnect_participants: [], rc_reconnect_missions: [], rc_xp_ledger: [], rc_agents: [], rc_players: [],
    rc_items: [
      { id: 'album-be', name: 'BE', kind: 'album', era: 'BE' },
      { id: 'lightstick-v4', name: 'ARMY Bomb Ver.4', kind: 'lightstick' },
      { id: 'hoodie-hope', name: 'Hoodie', kind: 'apparel' },
      { id: 'pc-arirang', name: 'Arirang photocard', kind: 'photocard' },
      { id: 'mug', name: 'Mug', kind: 'mug' },
      { id: 'ticket-voyage', name: 'Ticket', kind: 'ticket' },
    ],
    rc_content_goals: [],
    ...seed,
  }
  let clock = 0
  const locks = new Map()
  const tick = () => new Promise((r) => setTimeout(r, 1))
  function q(name) {
    const filters = []
    let op = 'select', lim = Infinity
    const b = {
      select() { return b }, order() { return b }, limit(n) { lim = n; return b },
      eq(c, v) { filters.push((r) => r[c] === v); return b },
      gte(c, v) { filters.push((r) => r[c] != null && String(r[c]) >= String(v)); return b },
      lte(c, v) { filters.push((r) => r[c] != null && String(r[c]) <= String(v)); return b },
      lt(c, v) { filters.push((r) => r[c] != null && String(r[c]) < String(v)); return b },
      in(c, vs) { filters.push((r) => vs.includes(r[c])); return b },
      not(c, o, v) { filters.push((r) => r[c] != null); return b },
      delete() { op = 'delete'; return b },
      then(ok, bad) {
        const rows = t[name] || []
        const hit = rows.filter((r) => filters.every((f) => f(r)))
        if (op === 'delete') { t[name] = rows.filter((r) => !hit.includes(r)); return Promise.resolve({ data: null, error: null }).then(ok, bad) }
        return Promise.resolve({ data: hit.slice(0, lim).map((r) => ({ ...r })), error: null }).then(ok, bad)
      },
    }
    return b
  }
  const db = {
    t, slowRpc: false, calls: 0,
    from: q,
    async rpc(fn, a) {
      assert.equal(fn, 'rc_award_collectible_xp')
      db.calls++
      const prefix = `collectible:${a.p_agent_no}:${a.p_week}:`
      while (locks.get(prefix)) await locks.get(prefix)
      let release
      locks.set(prefix, new Promise((r) => { release = r }))
      try {
        let paid = t.rc_xp_ledger.filter((r) => r.agent_no === a.p_agent_no && r.source === 'collectible' && r.dedup_key.startsWith(prefix))
          .reduce((s, r) => s + r.amount, 0)
        if (db.slowRpc) await tick()
        const out = []
        for (const aw of a.p_awards) {
          if (paid >= a.p_cap) break
          const key = prefix + aw.itemId
          if (t.rc_xp_ledger.some((r) => r.dedup_key === key)) continue
          const xp = Math.min(Math.max(aw.xp, 0), a.p_cap - paid)
          if (xp <= 0) continue
          if (db.slowRpc) await tick()
          t.rc_xp_ledger.push({ agent_no: a.p_agent_no, amount: xp, source: 'collectible', dedup_key: key, earned_week: a.p_week,
            meta: { weekKey: a.p_week, itemId: aw.itemId, via: a.p_via }, created_at: new Date(db.now ?? Date.now()).toISOString(), seq: ++clock })
          paid += xp
          out.push({ item_id: aw.itemId, amount: xp })
        }
        return { data: out, error: null }
      } finally { locks.delete(prefix); release() }
    },
  }
  return db
}

// loadContent reads these; the fake answers each with an empty list except
// the goals a ReConnect test sets.
const contentStub = (db) => {
  const orig = db.from
  db.from = (name) => {
    if (['rc_districts', 'rc_wards', 'rc_goals', 'rc_config', 'rc_ranks', 'rc_levels', 'rc_eras', 'rc_badges', 'rc_content'].includes(name) && !db.t[name]) db.t[name] = []
    return orig(name)
  }
  return db
}

const player = (db, agentNo) => { db.t.rc_players.push({ agent_no: agentNo }); return agentNo }
const own = (db, agentNo, id, itemId, districtId, obtained = BEFORE, usedAt = null) =>
  db.t.rc_player_items.push({ id, agent_no: agentNo, item_id: itemId, district_id: districtId, used_at: usedAt, obtained_at: obtained })
const restored = (db, agentNo, districtId, completedAt = BEFORE) =>
  db.t.rc_player_districts.push({ agent_no: agentNo, district_id: districtId, status: 'restored', goals: {}, activated_at: '2026-11-01T00:00:00Z', completed_at: completedAt })
const active = (db, agentNo, districtId, keys, activatedAt = '2026-11-25T00:00:00Z') =>
  db.t.rc_player_districts.push({ agent_no: agentNo, district_id: districtId, status: 'active', goals: { trackGoals: [{ keys }] }, activated_at: activatedAt, completed_at: null })
const plays = (db, agentNo, date, key, n) => {
  const row = db.t.rc_daily_activity.find((r) => r.agent_no === agentNo && r.kst_date === date)
  if (row) row.track_counts[key] = { n }
  else db.t.rc_daily_activity.push({ agent_no: agentNo, kst_date: date, track_counts: { [key]: { n } } })
}
const move = (db, id, districtId, when) => {
  const r = db.t.rc_player_items.find((x) => x.id === id)
  db.t.rc_item_placement_log.push({ player_item_id: id, agent_no: r.agent_no, item_id: r.item_id, obtained_at: r.obtained_at,
    op: 'update', old_district_id: r.district_id, old_used_at: r.used_at, new_district_id: districtId, new_used_at: r.used_at, changed_at: when })
  r.district_id = districtId
}
const xpOf = (db, agentNo, week = WEEK) => db.t.rc_xp_ledger.filter((r) => r.agent_no === agentNo && r.earned_week === week).reduce((s, r) => s + r.amount, 0)
const settle = (db, nowMs = FIRST_RUN, params = {}) => { db.now = nowMs; return settleCollectionXp(contentStub(db), params, nowMs) }

// ── Pure pieces ──────────────────────────────────────────────────────────
test('the cron settles the week that just ended, inside a 72-hour window', () => {
  assert.equal(weekToSettle(FIRST_RUN), WEEK)
  assert.equal(weekToSettle(at(RESET, 49 * 60)), WEEK)        // Tue 16:05 UTC catch-up
  assert.equal(weekToSettle(at(RESET, -1)), '2026-11-23')     // a minute before the reset: still the week before
  assert.equal(weekBounds(WEEK).endIso, RESET)
  assert.equal(CATCH_UP_HOURS, 72)
})

test('items as they stood at the reset: later moves, uses, deletes and new items are undone', () => {
  const cur = [
    { id: 'a', agent_no: 'X', item_id: 'album-be', district_id: null, used_at: null, obtained_at: BEFORE },          // moved to Pack after
    { id: 'b', agent_no: 'X', item_id: 'mug', district_id: 'd1', used_at: null, obtained_at: BEFORE },                // placed after
    { id: 'c', agent_no: 'X', item_id: 'pc-arirang', district_id: 'd1', used_at: null, obtained_at: '2026-12-06T16:00:00Z' }, // new after
    { id: 'e', agent_no: 'X', item_id: 'lightstick-v4', district_id: 'd2', used_at: null, obtained_at: BEFORE },     // untouched
  ]
  const log = [
    { player_item_id: 'a', agent_no: 'X', item_id: 'album-be', obtained_at: BEFORE, old_district_id: 'd1', old_used_at: null, changed_at: '2026-12-06T15:00:05Z' },
    { player_item_id: 'a', agent_no: 'X', item_id: 'album-be', obtained_at: BEFORE, old_district_id: 'd9', old_used_at: null, changed_at: '2026-12-06T14:00:00Z' }, // before reset: ignored
    { player_item_id: 'b', agent_no: 'X', item_id: 'mug', obtained_at: BEFORE, old_district_id: null, old_used_at: null, changed_at: '2026-12-06T15:30:00Z' },
    { player_item_id: 'd', agent_no: 'X', item_id: 'hoodie-hope', obtained_at: BEFORE, old_district_id: 'd1', old_used_at: null, changed_at: '2026-12-07T01:00:00Z' }, // deleted after
  ]
  const got = Object.fromEntries(itemsAt(cur, log, RESET).map((x) => [x.id, x.districtId]))
  assert.deepEqual(got, { a: 'd1', b: null, e: 'd2', d: 'd1' })
})

test('districts at the reset: restored after it was still the active attempt', () => {
  const rows = [
    { district_id: 'd1', status: 'restored', completed_at: BEFORE, activated_at: '2026-11-01T00:00:00Z' },
    { district_id: 'd2', status: 'restored', completed_at: '2026-12-06T15:20:00Z', activated_at: '2026-12-01T00:00:00Z' },
  ]
  const d = districtsAt(rows, RESET)
  assert.deepEqual([...d.restored], ['d1'])
  assert.equal(d.activePd.district_id, 'd2')
})

test('ReConnect help counted for teams the player was in during the week', () => {
  const goals = [{ id: 'g1', config: { sharedTrack: { keys: ['k-help'] } } }]
  const missions = [
    { id: 'm1', goal_id: 'g1', status: 'complete', created_at: '2026-11-29T00:00:00Z', completed_at: '2026-12-03T00:00:00Z' },  // ended mid-week: counts
    { id: 'm2', goal_id: 'g1', status: 'expired', created_at: '2026-11-01T00:00:00Z', expires_at: '2026-11-20T00:00:00Z' },     // ended before: no
    { id: 'm3', goal_id: 'g1', status: 'open', created_at: '2026-12-06T16:00:00Z' },                                             // after the reset: no
  ]
  const parts = [
    { mission_id: 'm1', status: 'joined', joined_at: '2026-11-29T00:00:00Z' },
    { mission_id: 'm2', status: 'joined', joined_at: '2026-11-02T00:00:00Z' },
    { mission_id: 'm3', status: 'joined', joined_at: '2026-12-06T16:10:00Z' },
  ]
  assert.deepEqual(helpingDuring(parts, missions, goals, weekBounds(WEEK).startIso, RESET), [{ keys: ['k-help'] }])
})

// ── Whole runs ───────────────────────────────────────────────────────────
test('qualifies minutes before the reset and never reopens HT: paid by the first run', async () => {
  const db = fakeDb()
  const A = player(db, 'AGENT100')
  restored(db, A, 'd1'); own(db, A, 'i1', 'album-be', 'd1'); own(db, A, 'i2', 'pc-arirang', 'd1')
  active(db, A, 'd5', ['k1'])
  plays(db, A, '2026-12-05', 'k1', 4)
  plays(db, A, '2026-12-06', 'k1', QUALIFY_PLAYS - 4)       // the last ones on Sunday evening (KST 6 Dec = up to 8:30 PM IST)
  const res = await settle(db)
  assert.equal(res.success, true)
  assert.equal(res.paidXp, 15 + 8)
  assert.equal(xpOf(db, A), 23)
  const rows = db.t.rc_xp_ledger.filter((r) => r.agent_no === A)
  assert.ok(rows.every((r) => r.earned_week === WEEK && r.meta.via === 'settle'))
  // Credited after the reset, earned in the week before — recorded apart.
  assert.ok(rows.every((r) => r.created_at >= RESET))
})

test('collectibles placed before rewards began qualify without placing them again', async () => {
  const db = fakeDb()
  const A = player(db, 'AGENT101')
  restored(db, A, 'd1', '2026-10-01T00:00:00Z')
  own(db, A, 'i1', 'lightstick-v4', 'd1', '2026-09-01T00:00:00Z')   // no placement history at all
  plays(db, A, '2026-12-01', 'k1', 10); active(db, A, 'd2', ['k1'])
  await settle(db)
  assert.equal(xpOf(db, A), 12)
})

test('moves after the reset do not change the week that ended', async () => {
  const db = fakeDb()
  const A = player(db, 'AGENT102')
  restored(db, A, 'd1'); active(db, A, 'd2', ['k1']); plays(db, A, '2026-12-02', 'k1', 12)
  own(db, A, 'i1', 'album-be', 'd1'); own(db, A, 'i2', 'mug', null); own(db, A, 'i3', 'pc-arirang', 'd1')
  move(db, 'i1', null, '2026-12-06T15:00:30Z')           // album to Pack 30 s after the reset: still paid
  move(db, 'i2', 'd1', '2026-12-06T15:10:00Z')           // mug placed after the reset: not this week
  move(db, 'i3', 'd2', '2026-12-06T15:20:00Z')           // photocard to an unrestored district after: still paid
  await settle(db)
  assert.deepEqual(db.t.rc_xp_ledger.map((r) => r.meta.itemId).sort(), ['album-be', 'pc-arirang'])
})

test('a district restored after the reset counts as the active attempt, not as restored', async () => {
  const db = fakeDb()
  const A = player(db, 'AGENT103')
  own(db, A, 'i1', 'album-be', 'd2')
  db.t.rc_player_districts.push({ agent_no: A, district_id: 'd2', status: 'restored', goals: { trackGoals: [{ keys: ['k1'] }] }, activated_at: '2026-12-01T00:00:00Z', completed_at: '2026-12-06T15:30:00Z' })
  plays(db, A, '2026-12-03', 'k1', 20)
  const r = await settle(db)
  assert.equal(r.paidXp, 0)                              // d2 wasn't restored at the reset: nothing placed there earned
  assert.equal(r.results[0]?.qualified, undefined)       // and nobody was paid
})

test('late scrobbles: not qualified at the first run, paid by the catch-up, and refused after the window', async () => {
  const db = fakeDb()
  const A = player(db, 'AGENT104')
  restored(db, A, 'd1'); own(db, A, 'i1', 'hoodie-hope', 'd1'); active(db, A, 'd2', ['k1'])
  plays(db, A, '2026-12-06', 'k1', 9)
  let r = await settle(db)
  assert.equal(r.paidXp, 0)
  plays(db, A, '2026-12-06', 'k1', 11)                   // Sunday's late Musicat / ListenBrainz plays land
  r = await settle(db, at(RESET, 25 * 60))               // Monday's catch-up
  assert.equal(r.paidXp, 10)
  r = await settle(db, at(RESET, 49 * 60))               // Tuesday's catch-up: nothing more to pay
  assert.equal(r.paidXp, 0)
  assert.equal(xpOf(db, A), 10)
  r = await settle(db, at(RESET, (CATCH_UP_HOURS + 1) * 60), { weekKey: WEEK })
  assert.equal(r.success, false)
  assert.equal(r.error, 'outside_catch_up_window')
})

test('app polls during the week plus the settle: topped up to the cap, never past it, nothing twice', async () => {
  const db = fakeDb()
  const A = player(db, 'AGENT105')
  restored(db, A, 'd1'); active(db, A, 'd2', ['k1']); plays(db, A, '2026-12-01', 'k1', 10)
  own(db, A, 'i1', 'album-be', 'd1'); own(db, A, 'i2', 'lightstick-v4', 'd1')
  // The player opens HT on Tuesday: the poll pays these two.
  db.now = Date.parse('2026-12-01T05:00:00Z')
  const items = (ids) => db.t.rc_player_items.filter((r) => ids.includes(r.id)).map((r) => {
    const c = db.t.rc_items.find((x) => x.id === r.item_id)
    return { id: r.id, itemId: r.item_id, name: c.name, kind: c.kind, era: c.era, districtId: r.district_id, usedAt: null }
  })
  const poll = () => awardCollectibleXp(db, {
    agentNo: A, today: '2026-12-01', items: items(db.t.rc_player_items.map((r) => r.id)), restored: new Set(['d1']),
    rollups: db.t.rc_daily_activity, activePd: db.t.rc_player_districts.find((r) => r.status === 'active'), pdRows: db.t.rc_player_districts, helpingQuests: [],
  })
  assert.equal((await poll()).awardedXp, 27)
  // Later that week they place three more and stop opening HT.
  own(db, A, 'i3', 'hoodie-hope', 'd1'); own(db, A, 'i4', 'pc-arirang', 'd1'); own(db, A, 'i5', 'mug', 'd1')
  await settle(db)
  assert.equal(xpOf(db, A), WEEKLY_CAP)                  // 27 + 10 + 8 + 5 = 50 → exactly the cap
  const keys = db.t.rc_xp_ledger.map((r) => r.dedup_key)
  assert.equal(new Set(keys).size, keys.length)
})

test('simultaneous calculations: two settle runs and an app poll at once pay once, within the cap', async () => {
  const db = fakeDb()
  db.slowRpc = true
  const A = player(db, 'AGENT106')
  restored(db, A, 'd1'); active(db, A, 'd2', ['k1']); plays(db, A, '2026-12-06', 'k1', 15)
  for (const [i, id] of ['album-be', 'lightstick-v4', 'hoodie-hope', 'pc-arirang', 'mug'].entries()) own(db, A, `i${i}`, id, 'd1')
  db.now = Date.parse('2026-12-06T14:59:59Z')
  const items = db.t.rc_player_items.map((r) => {
    const c = db.t.rc_items.find((x) => x.id === r.item_id)
    return { id: r.id, itemId: r.item_id, name: c.name, kind: c.kind, era: c.era, districtId: r.district_id, usedAt: null }
  })
  const poll = awardCollectibleXp(db, {
    agentNo: A, today: '2026-12-06', items, restored: new Set(['d1']), rollups: db.t.rc_daily_activity,
    activePd: db.t.rc_player_districts.find((r) => r.status === 'active'), pdRows: db.t.rc_player_districts, helpingQuests: [],
  })
  const [, s1, s2] = await Promise.all([poll, settleCollectionXp(contentStub(db), {}, FIRST_RUN), settleCollectionXp(db, {}, FIRST_RUN)])
  assert.equal(xpOf(db, A), WEEKLY_CAP)
  const keys = db.t.rc_xp_ledger.map((r) => r.dedup_key)
  assert.equal(new Set(keys).size, keys.length)
  assert.ok(s1.success && s2.success)
})

test('each week is its own: settling last week never touches this one, and a re-run is a no-op', async () => {
  const db = fakeDb()
  const A = player(db, 'AGENT107')
  restored(db, A, 'd1'); active(db, A, 'd2', ['k1'])
  own(db, A, 'i1', 'album-be', 'd1')
  plays(db, A, '2026-12-02', 'k1', 10); plays(db, A, '2026-12-08', 'k1', 10)
  await settle(db)
  await settle(db)
  assert.equal(db.t.rc_xp_ledger.length, 1)
  // Next week's poll still pays next week.
  db.now = Date.parse('2026-12-08T05:00:00Z')
  const res = await awardCollectibleXp(db, {
    agentNo: A, today: '2026-12-08', items: [{ id: 'i1', itemId: 'album-be', name: 'BE', kind: 'album', era: 'BE', districtId: 'd1', usedAt: null }],
    restored: new Set(['d1']), rollups: db.t.rc_daily_activity, activePd: db.t.rc_player_districts.find((r) => r.status === 'active'), pdRows: db.t.rc_player_districts, helpingQuests: [],
  })
  assert.equal(res.awardedXp, 15)
  assert.deepEqual(db.t.rc_xp_ledger.map((r) => r.earned_week).sort(), ['2026-11-30', '2026-12-07'])
})

test('not a restoring week, retired agents, and weeks before rewards began pay nothing', async () => {
  const db = fakeDb()
  const A = player(db, 'AGENT108'); const R = player(db, 'AGENT109')
  restored(db, A, 'd1'); own(db, A, 'i1', 'album-be', 'd1'); active(db, A, 'd2', ['k1']); plays(db, A, '2026-12-02', 'k1', 9)
  restored(db, R, 'd1'); own(db, R, 'i2', 'album-be', 'd1'); active(db, R, 'd2', ['k1']); plays(db, R, '2026-12-02', 'k1', 30)
  db.t.rc_agents.push({ agent_no: R, retired_at: '2026-12-03T00:00:00Z' })
  const r = await settle(db)
  assert.equal(r.paidXp, 0)
  assert.equal(r.considered, 1)
  const early = await settle(db, at('2026-11-29T15:00:00Z', 65))
  assert.equal(early.skipped, 'before_start_week')
  const tooSoon = await settle(db, at(RESET, -10), { weekKey: WEEK })
  assert.equal(tooSoon.error, 'week_not_ended')
})

test('the migration: one locked writer, an earning week, a placement log, and the schedule', () => {
  const sql = readFileSync(new URL('../../../migrations/20261124120000_rc_collection_xp_settle.sql', import.meta.url), 'utf8')
  assert.match(sql, /add column if not exists earned_week date/)
  assert.match(sql, /pg_advisory_xact_lock/)
  assert.match(sql, /on conflict \(dedup_key\) do nothing/)
  assert.match(sql, /after update of district_id, used_at or delete on public\.rc_player_items/)
  assert.match(sql, /cron\.schedule\('rc-collection-settle', '5 16 \* \* 0,1,2'/)
  assert.match(sql, /grant execute on function public\.rc_award_collectible_xp\(text, date, integer, jsonb, text\) to service_role/)
  assert.doesNotMatch(sql, /update public\.rc_player_items|delete from public\.rc_player_items/)
})
