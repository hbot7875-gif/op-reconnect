// An Extension Charge must carry the attempt's ReConnect quest along with it.
// Reported 2026-11-13 by AGENT247: district extended to 16 Nov 20:05 UTC, but
// her quest still expired 14 Nov 11:57 UTC on its own 7-day clock.
import test from 'node:test'
import assert from 'node:assert/strict'
import { extendedQuestExpiry } from './quest-extension.js'

globalThis.Deno = globalThis.Deno || { env: { get: () => undefined } }

const H = 3600e3, D = 24 * H

test('the quest gets the same extra time, capped at the attempt deadline', () => {
  // AGENT247: +3 days would be 17 Nov 11:57, past the district's 16 Nov 20:05.
  assert.equal(extendedQuestExpiry('2026-11-14T11:57:41.341Z', 3 * D, '2026-11-16T20:05:22.655Z'), '2026-11-16T20:05:22.655Z')
  // Plenty of room: the full 3 days.
  assert.equal(extendedQuestExpiry('2026-11-14T06:20:22.598Z', 3 * D, '2026-11-20T00:00:00.000Z'), '2026-11-17T06:20:22.598Z')
  // A quest already running past the attempt is never shortened.
  assert.equal(extendedQuestExpiry('2026-11-18T00:00:00.000Z', 3 * D, '2026-11-16T00:00:00.000Z'), null)
  assert.equal(extendedQuestExpiry('2026-11-14T00:00:00.000Z', 0, '2026-11-16T00:00:00.000Z'), null)
  assert.equal(extendedQuestExpiry('bad', 3 * D, '2026-11-16T00:00:00.000Z'), null)
})

/** In-memory client: records every update and applies the ones it supports. */
function db(tables) {
  const updates = []
  const from = (table) => {
    const filters = []
    let patch = null
    const rows = () => tables[table].filter((r) => filters.every((f) => f(r)))
    const chain = {
      select: () => chain,
      eq: (c, v) => (filters.push((r) => r[c] === v), chain),
      in: (c, vs) => (filters.push((r) => vs.includes(r[c])), chain),
      update: (p) => { patch = p; return chain },
      maybeSingle: async () => {
        const hit = rows()
        if (patch) { for (const r of hit) Object.assign(r, patch); updates.push([table, patch, hit.length]); return { data: hit[0] || null, error: null } }
        return { data: hit[0] || null, error: null }
      },
      then: (res, rej) => {
        const hit = rows()
        if (patch) { for (const r of hit) Object.assign(r, patch); updates.push([table, patch, hit.length]) }
        return Promise.resolve({ data: hit, error: null }).then(res, rej)
      },
    }
    return chain
  }
  return { from, updates }
}

test('the open quest she joined on that district moves; nothing else does', async () => {
  const { extendQuestsWithAttempt } = await import('./reconnect-missions.ts')
  const now = Date.now()
  const questExpiry = new Date(now + 1 * H).toISOString()
  const attemptDeadline = new Date(now + 2 * D).toISOString()
  const tables = {
    rc_reconnect_participants: [
      { mission_id: 'q-open', agent_no: 'AGENT247', status: 'joined' },
      { mission_id: 'q-other-district', agent_no: 'AGENT247', status: 'joined' },
      { mission_id: 'q-done', agent_no: 'AGENT247', status: 'joined' },
      { mission_id: 'q-invited', agent_no: 'AGENT247', status: 'invited' },
      { mission_id: 'q-someone-else', agent_no: 'AGENT263', status: 'joined' },
    ],
    rc_reconnect_missions: [
      { id: 'q-open', district_id: 'relay', status: 'open', expires_at: questExpiry },
      { id: 'q-other-district', district_id: 'elsewhere', status: 'open', expires_at: questExpiry },
      { id: 'q-done', district_id: 'relay', status: 'complete', expires_at: questExpiry },
      { id: 'q-invited', district_id: 'relay', status: 'open', expires_at: questExpiry },
      { id: 'q-someone-else', district_id: 'relay', status: 'open', expires_at: questExpiry },
    ],
  }
  const client = db(tables)
  const moved = await extendQuestsWithAttempt(client, 'AGENT247', 'relay', 3 * D, attemptDeadline)
  const byId = Object.fromEntries(tables.rc_reconnect_missions.map((m) => [m.id, m.expires_at]))
  assert.equal(byId['q-open'], attemptDeadline, '+3 days, capped at the attempt deadline')
  for (const id of ['q-other-district', 'q-done', 'q-invited', 'q-someone-else']) assert.equal(byId[id], questExpiry, id)
  assert.deepEqual(moved, [{ missionId: 'q-open', expiresAt: attemptDeadline }])
  // Only the one quest row was written, and only expires_at.
  assert.deepEqual(client.updates, [['rc_reconnect_missions', { expires_at: attemptDeadline }, 1]])
  // Running it again changes nothing (already at the cap).
  client.updates.length = 0
  assert.deepEqual(await extendQuestsWithAttempt(client, 'AGENT247', 'relay', 3 * D, attemptDeadline), [])
  assert.equal(client.updates.length, 0)
})

test('extendDistrictDeadline extends the quest by the time the attempt got, after the extension lands', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('./handlers.ts', import.meta.url), 'utf8')
  const fn = src.slice(src.indexOf('export async function extendDistrictDeadline'), src.indexOf('export async function resetLapsedDistrict'))
  const call = fn.indexOf('extendQuestsWithAttempt(supabase, agentNo, districtId,')
  assert.ok(call > fn.indexOf("from('rc_player_districts')\n    .update("), 'only after the district extension succeeded')
  assert.match(fn, /\(DEADLINE_EXTENSION_DAYS \* 24 \+ lateHours\) \* 3600000, newDeadline\.expiresAt\)/)
  assert.match(fn, /questsExtended \}/)
})
