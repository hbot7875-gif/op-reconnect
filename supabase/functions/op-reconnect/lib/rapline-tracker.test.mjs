// cronRaplineRefresh against a fake API and a fake database: it must spend
// at most one request per track, log every request (including failures) for
// the budget, stop at once when the provider says the quota is gone, and
// never call the API without a key or inside the 3-day window.

import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.Deno ??= { env: { get: (k) => process.env[k] } }
const { cronRaplineRefresh } = await import('./rapline-tracker.ts')

function fakeDb({ requests = [] } = {}) {
  const log = [...requests]
  const stored = []
  const builder = (table) => {
    const q = { table, filters: [], orderDesc: false, lim: null, head: false }
    const api = {
      select(_cols, opts) { q.head = !!opts?.head; return api },
      gte(col, v) { q.filters.push((r) => r[col] >= v); return api },
      eq(col, v) { q.filters.push((r) => r[col] === v); return api },
      not(col, _op, _v) { q.filters.push((r) => r[col] != null); return api },
      in() { return api },
      order(_c, o) { q.orderDesc = o?.ascending === false; return api },
      limit(n) { q.lim = n; return api },
      insert(row) { log.push({ requested_at: new Date().toISOString(), ...row }); return Promise.resolve({ error: null }) },
      then(resolve) {
        let rows = log.filter((r) => q.filters.every((f) => f(r)))
        rows.sort((a, b) => (a.requested_at < b.requested_at ? 1 : -1))
        if (q.lim) rows = rows.slice(0, q.lim)
        resolve(q.head ? { count: rows.length, error: null } : { data: rows, error: null })
      },
    }
    return api
  }
  return {
    log, stored,
    from: builder,
    rpc: async (name, args) => { stored.push(args); return { data: args.p_points.length, error: null } },
  }
}

function fakeFetch(responses) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, key: init.headers['x-rapidapi-key'] })
    const r = responses[Math.min(calls.length - 1, responses.length - 1)]
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'x-ratelimit-requests-remaining': String(r.remaining) } })
  }
  return calls
}

const history = [{ date: '2026-10-26', streams: 10 }, { date: '2026-10-27', streams: 20 }]

test('no key: no request at all', async () => {
  delete process.env.RAPIDAPI_KEY
  const calls = fakeFetch([{ status: 200, body: history, remaining: 47 }])
  const r = await cronRaplineRefresh(fakeDb())
  assert.equal(r.error, 'rapidapi_key_missing')
  assert.equal(calls.length, 0)
})

test('a due refresh makes one request per track, stores and logs each', async () => {
  process.env.RAPIDAPI_KEY = 'test-key'
  const calls = fakeFetch([{ status: 200, body: history, remaining: 46 }])
  const db = fakeDb()
  const r = await cronRaplineRefresh(db)
  assert.equal(calls.length, 3)
  assert.ok(calls.every((c) => c.key === 'test-key' && /\/v1\/spotify\/tracks\/[A-Za-z0-9]{22}\/streams$/.test(c.url)))
  assert.equal(db.stored.length, 3)
  assert.equal(db.log.length, 3)
  assert.ok(db.log.every((l) => l.ok && l.quota_remaining === 46))
  assert.ok(r.results.every((x) => x.ok))
  assert.equal(JSON.stringify(r).includes('test-key'), false)
})

test('inside the 3-day window nothing is fetched', async () => {
  process.env.RAPIDAPI_KEY = 'test-key'
  const calls = fakeFetch([{ status: 200, body: history, remaining: 40 }])
  const recent = new Date(Date.now() - 24 * 3_600_000).toISOString()
  const r = await cronRaplineRefresh(fakeDb({ requests: [{ requested_at: recent, ok: true, quota_remaining: 44, spotify_id: 'x' }] }))
  assert.equal(r.skipped, 'fresh')
  assert.equal(calls.length, 0)
})

test('quota exhausted: stops after the first refusal and logs it', async () => {
  process.env.RAPIDAPI_KEY = 'test-key'
  const calls = fakeFetch([{ status: 429, body: { message: 'quota' }, remaining: 0 }])
  const db = fakeDb()
  const r = await cronRaplineRefresh(db)
  assert.equal(calls.length, 1)
  assert.equal(db.stored.length, 0)
  assert.equal(db.log.length, 1)
  assert.equal(db.log[0].ok, false)
  assert.equal(r.results[0].error, 'http_429')
})

test('an unexpected payload is logged as a failure and never stored', async () => {
  process.env.RAPIDAPI_KEY = 'test-key'
  fakeFetch([{ status: 200, body: { message: 'You are not subscribed to this API.' }, remaining: 45 }])
  const db = fakeDb()
  const r = await cronRaplineRefresh(db)
  assert.equal(db.stored.length, 0)
  assert.ok(r.results.every((x) => !x.ok && x.error === 'history_not_array'))
  assert.equal(db.log.length, 3)
})
