// The public stats contract.
//
// This endpoint is unauthenticated — anyone who finds the URL can call it —
// so the shape of what it returns is a security surface, not just an API
// detail. The test that matters most here is the negative one: the response
// must carry EXACTLY the three aggregate fields and nothing else, so a
// future edit cannot quietly start leaking per-player data through the
// landing page.
//
// It also pins the removal of districtsRestored/districtsTotal, charge,
// multiplier and wards. The district pair was counting rows of the
// per-agent rc_player_districts table with no agent filter and reported
// "377/248 districts restored"; the rest were simply unread. Re-adding any
// of them should fail here and be a deliberate decision, not a drift.

import test from 'node:test'
import assert from 'node:assert/strict'

import { getPublicStats } from './public.ts'
import { invalidateContentCache } from './config.ts'

const BTS_ARTISTS = ['bts', 'rm', 'jin', 'suga', 'agust d', 'j hope', 'jhope', 'jimin', 'v', 'jung kook', 'jungkook']

function fakeDb({ agents = 101, activity = [], playersError = null, activityThrows = false } = {}) {
  return {
    from(table) {
      if (table === 'rc_daily_activity' && activityThrows) {
        throw new Error('scan failed')
      }
      const result =
        table === 'rc_players' ? { count: agents, error: playersError, data: null }
        : table === 'rc_daily_activity' ? { data: activity.map((track_counts) => ({ track_counts })), error: null }
        : table === 'rc_config' ? { data: [{ key: 'bts_artists', value: BTS_ARTISTS }], error: null }
        : { data: [], error: null, count: 0 }
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        // campaign-streams.ts pages through rc_daily_activity; without this
        // the chain breaks and every total silently comes back null.
        range: () => chain,
        upsert: async () => ({ error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      }
      return chain
    },
  }
}

function bucket(tracks) {
  const out = {}
  for (const [key, n] of Object.entries(tracks)) out[key] = { n, a: { bts: n } }
  return out
}

test('the public response carries exactly agents + the two campaign totals', async () => {
  invalidateContentCache()
  const res = await getPublicStats(fakeDb({ activity: [bucket({ swim: 5, normal: 3, haegeum: 2 })] }), {})

  assert.equal(res.success, true)
  assert.deepEqual(Object.keys(res.stats).sort(), ['agents', 'arirangStreams', 'roadTo1BStreams'])
  assert.equal(res.stats.agents, 101)
  assert.equal(res.stats.arirangStreams, 8)  // swim + normal
  assert.equal(res.stats.roadTo1BStreams, 7) // swim + haegeum
})

test('the removed legacy fields are gone from the response', async () => {
  invalidateContentCache()
  const res = await getPublicStats(fakeDb(), {})
  for (const field of ['districtsRestored', 'districtsTotal', 'charge', 'multiplier', 'wards']) {
    assert.ok(!(field in res.stats), `${field} is still in the public stats response`)
  }
})

test('the response never carries anything per-player', async () => {
  invalidateContentCache()
  const res = await getPublicStats(fakeDb(), {})
  const serialized = JSON.stringify(res).toLowerCase()
  for (const leak of ['agent_no', 'agentno', 'handle', 'codename', 'email']) {
    assert.ok(!serialized.includes(leak), `public stats leaked "${leak}"`)
  }
})

test('a failed agent count becomes null, not zero', async () => {
  invalidateContentCache()
  const res = await getPublicStats(fakeDb({ playersError: { message: 'boom' } }), {})
  assert.equal(res.stats.agents, null)
})

test('a failed campaign scan becomes null and still returns success', async () => {
  // A landing page that shows a dash is honest; one that shows 0 streams
  // because a query failed is lying about the community's work.
  invalidateContentCache()
  const res = await getPublicStats(fakeDb({ activityThrows: true }), {})
  assert.equal(res.success, true)
  assert.equal(res.stats.arirangStreams, null)
  assert.equal(res.stats.roadTo1BStreams, null)
})

test('no activity reports zero streams, not null', async () => {
  invalidateContentCache()
  const res = await getPublicStats(fakeDb({ activity: [] }), {})
  assert.equal(res.stats.arirangStreams, 0)
  assert.equal(res.stats.roadTo1BStreams, 0)
})
