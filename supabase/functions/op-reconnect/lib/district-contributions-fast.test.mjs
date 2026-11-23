// Your Contributions now makes its reads together and pages raw plays in
// parallel. These check it returns exactly what the sequential code did:
// questTotals must equal the live quest's contributionTotals, and paging
// must read every row once, however many pages there are.
import assert from 'node:assert/strict'
import test from 'node:test'
import { questTotals, rawTrackNames } from './district-contributions.ts'
import { contributionTotals } from './reconnect-missions.ts'

/** In-memory stand-in for the Supabase query builder (the subset used). */
function fakeDb(tables) {
  const calls = []
  const from = (name) => {
    const filters = []
    let orders = []
    let rangeAt = null
    let wantCount = false
    let single = false
    const q = {
      select(_cols, opts) { if (opts?.count) wantCount = true; return q },
      eq(c, v) { filters.push((r) => r[c] === v); return q },
      gt(c, v) { filters.push((r) => r[c] > v); return q },
      gte(c, v) { filters.push((r) => r[c] >= v); return q },
      lt(c, v) { filters.push((r) => r[c] < v); return q },
      lte(c, v) { filters.push((r) => r[c] <= v); return q },
      in(c, arr) { filters.push((r) => arr.includes(r[c])); return q },
      order(c) { orders.push(c); return q },
      range(a, b) { rangeAt = [a, b]; return q },
      maybeSingle() { single = true; return q },
      then(ok, bad) {
        calls.push(name)
        let rows = (tables[name] || []).filter((r) => filters.every((f) => f(r)))
        if (orders.length) rows = [...rows].sort((x, y) => { for (const c of orders) { if (x[c] < y[c]) return -1; if (x[c] > y[c]) return 1 } return 0 })
        const count = rows.length
        if (rangeAt) rows = rows.slice(rangeAt[0], rangeAt[1] + 1)
        const res = { data: single ? rows[0] ?? null : rows, error: null, count: wantCount ? count : null }
        return Promise.resolve(res).then(ok, bad)
      },
    }
    return q
  }
  return { from, calls }
}

// 2,600 plays across three KST days for one agent, plus another agent's noise.
const KST = 9 * 3600
const dayStart = (d) => Date.parse(`${d}T00:00:00Z`) / 1000 - KST
const songs = ['Swim', 'Haegeum', 'Danger', 'Wild Flower']
const scrobbles = []
let n = 0
for (const [d, count] of [['2026-11-03', 1300], ['2026-11-04', 0], ['2026-11-05', 1300]]) {
  for (let i = 0; i < count; i++) scrobbles.push({ agent_no: 'A1', listened_at: dayStart(d) + 30 + i * 60, track_name: songs[(n++) % songs.length] })
}
for (let i = 0; i < 200; i++) scrobbles.push({ agent_no: 'B2', listened_at: dayStart('2026-11-03') + i * 60, track_name: 'Swim' })
const daily = [
  { agent_no: 'A1', kst_date: '2026-11-04', track_counts: { swim: { n: 40 }, danger: { n: 12 } } },
  { agent_no: 'A1', kst_date: '2026-11-03', track_counts: { swim: { n: 999 } } }, // raw day: must not be used
]

test('questTotals gives the same totals as the live contributionTotals', async () => {
  const since = new Date((dayStart('2026-11-03') + 3 * 3600 + 7) * 1000).toISOString()
  const until = new Date((dayStart('2026-11-05') + 14 * 3600) * 1000).toISOString()
  const live = await contributionTotals(fakeDb({ rc_scrobbles: scrobbles, rc_daily_activity: daily }), 'A1', since, true, until)
  const fast = await questTotals(fakeDb({ rc_scrobbles: scrobbles, rc_daily_activity: daily }), 'A1', since, until)
  assert.deepEqual(Object.fromEntries([...fast].sort()), Object.fromEntries([...live].sort()))
  assert.ok((fast.get('swim') || 0) > 40, 'raw plays were counted')
})

test('same-day join and finish agree too', async () => {
  const since = new Date((dayStart('2026-11-05') + 3600) * 1000).toISOString()
  const until = new Date((dayStart('2026-11-05') + 9 * 3600) * 1000).toISOString()
  const live = await contributionTotals(fakeDb({ rc_scrobbles: scrobbles, rc_daily_activity: daily }), 'A1', since, true, until)
  const fast = await questTotals(fakeDb({ rc_scrobbles: scrobbles, rc_daily_activity: daily }), 'A1', since, until)
  assert.deepEqual(Object.fromEntries([...fast].sort()), Object.fromEntries([...live].sort()))
})

test('parallel paging reads every row exactly once', async () => {
  const from = dayStart('2026-11-03'); const to = dayStart('2026-11-06')
  const want = scrobbles.filter((r) => r.agent_no === 'A1' && r.listened_at >= from && r.listened_at <= to).length
  const db = fakeDb({ rc_scrobbles: scrobbles })
  const got = await rawTrackNames(db, 'A1', from, to, true)
  assert.equal(got.length, want)
  assert.equal(want, 2600)
  assert.equal(db.calls.length, 3) // one counted page, then the other two together
  const exclusive = await rawTrackNames(fakeDb({ rc_scrobbles: scrobbles }), 'A1', from, scrobbles[0].listened_at, false)
  assert.equal(exclusive.length, 0)
})
