import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

import { BIRTHDAY_ERA_EVENTS, birthdayTrackEntries, isBirthdayEventDate, isBirthdayGiftClaimDate } from '../supabase/functions/op-reconnect/lib/birthday-eras.ts'
import { allocateTrackHits } from '../supabase/functions/op-reconnect/lib/era-match.js'
import { normKeyFull } from '../supabase/functions/op-reconnect/lib/text.ts'
import { claimBirthdayGift } from '../supabase/functions/op-reconnect/lib/agent-charge.ts'
import {
  birthdayPopupCard, birthdayPopupCopy, birthdayCompleteMessage,
  birthdayPopupSeen, markBirthdayPopupSeen, birthdayGiftContents,
} from './birthday-era-popup.js'

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
const jimin = BIRTHDAY_ERA_EVENTS.find((event) => event.id === 'jimin-muse-birthday-2026')
const golden = BIRTHDAY_ERA_EVENTS.find((event) => event.id === 'jk-golden-birthday-2026')
const charge = read('supabase/functions/op-reconnect/lib/agent-charge.ts')
const giftSql = read('supabase/migrations/20261013121000_rc_birthday_room_gift.sql')

const APPROVED_TRACKS = [
  'Rebirth (Intro)', 'Interlude : Showtime',
  'Smeraldo Garden Marching Band (feat. Loco)',
  'Slow Dance (feat. Sofia Carson)', 'Be Mine', 'Who',
  'Closer Than This', 'SWIM with Jimin (Slow Jam R&B Remix)',
  'Serendipity (Full Length Edition)',
]

// ── Era Card ────────────────────────────────────────────────────────────────

test('the Jimin card is the approved nine tracks, live Oct 13-14 KST', () => {
  assert.ok(jimin)
  assert.deepEqual(jimin.tracks, APPROVED_TRACKS)
  assert.equal(jimin.member, 'Jimin')
  assert.equal(jimin.cardName, 'MUSE')
  assert.equal(isBirthdayEventDate(jimin, '2026-10-12'), false)
  assert.equal(isBirthdayEventDate(jimin, '2026-10-13'), true)
  assert.equal(isBirthdayEventDate(jimin, '2026-10-14'), true)
  assert.equal(isBirthdayEventDate(jimin, '2026-10-15'), false)
})

test('no two slots share a match key, so one play can never fill two slots', () => {
  const keys = jimin.tracks.map(normKeyFull)
  assert.equal(new Set(keys).size, keys.length)
  assert.deepEqual(keys, [
    'rebirth', 'interlude showtime', 'smeraldo garden marching band', 'slow dance',
    'be mine', 'who', 'closer than this', 'swim with jimin', 'serendipity',
  ])
})

test('nine counted plays complete the card; eight or a look-alike do not', () => {
  const entries = birthdayTrackEntries(jimin)
  const done = (totals) => entries.filter((e) => (allocateTrackHits(entries, totals, 1).get(e.id) || 0) >= 1).length
  const all = new Map(jimin.tracks.map((title) => [normKeyFull(title), 1]))
  assert.equal(done(all), 9)
  const missingSerendipity = new Map(all)
  missingSerendipity.delete('serendipity')
  assert.equal(done(missingSerendipity), 8)
  // Love Yourself's "Intro : Serendipity" is a different song and key.
  missingSerendipity.set('intro serendipity', 3)
  assert.equal(done(missingSerendipity), 8)
})

test('Jimin card completion pays +10H only, through the charge-only RPC', () => {
  assert.equal(jimin.rewardHours, 10)
  assert.deepEqual(jimin.roomGift, { roomBadgeTemplateId: 'event_jimin_day_lightkeeper_2026', claimDays: 7, wings: 1, chargeCells: 1 })
  assert.match(charge, /birthdayDone === birthdayTracks\.length && event\.roomGift\) \{\n[^\n]*\n\s+const \{ data, error \} = await supabase\.rpc\('rc_claim_birthday_charge', \{/)
  const chargeOnly = giftSql.slice(giftSql.indexOf('create or replace function rc_claim_birthday_charge'), giftSql.indexOf('revoke all on function rc_claim_birthday_charge'))
  assert.doesNotMatch(chargeOnly, /rc_award_badge|badge/i, 'the card pays no badge on the roomGift path')
  assert.match(chargeOnly, /on conflict \(agent_no, era_id, week_key\) do nothing;\n\s+get diagnostics v_rows = row_count;\n\n\s+if v_rows = 0 then return false; end if;/)
  assert.match(chargeOnly, /charged_until = greatest\(coalesce\(ac\.charged_until, now\(\)\), now\(\)\) \+ make_interval\(hours => v_hours\)/)
  assert.match(chargeOnly, /not between p_event_date and v_date_end then\n\s+return false;/)
  assert.match(giftSql, /grant execute on function rc_claim_birthday_charge\(text, text, date, text, integer, date\)\n\s+to service_role;/)
})

// ── GOLDEN / Jung Kook stays exactly as it was ──────────────────────────────

test('JK GOLDEN keeps rc_claim_birthday_era, Golden Corner and its Defender badge unchanged', () => {
  assert.equal(golden.roomGift, undefined)
  assert.equal(golden.badgeTemplateId, 'event_jk_birthday_2026')
  assert.match(charge, /\} else if \(birthdayActive && !claimed && birthdayDone === birthdayTracks\.length\) \{\n\s+const \{ data, error \} = await supabase\.rpc\('rc_claim_birthday_era', \{\n\s+p_agent_no: agentNo,\n\s+p_event_id: event\.id,\n\s+p_event_date: event\.date,\n\s+p_era_name: event\.cardName,\n\s+p_badge_template_id: event\.badgeTemplateId,/)
  assert.match(charge, /: `\$\{event\.member\} Birthday Badge · \+\$\{event\.rewardHours\}h ARMY Bomb charge`,/)
  assert.match(charge, /computeBirthdayRoom\(\n\s+supabase, content, agentNo, 'jk-golden-birthday-2026', 'Golden Corner', GOLDEN_CORNER_TARGET,\n\s+\)/,
    'Golden Corner is computed without the gift claim period')
  assert.match(charge, /if \(result\.view\.communityLights >= GOLDEN_CORNER_TARGET && result\.yourLit > 0\) \{\n\s+await supabase\.rpc\('rc_award_badge', \{\n\s+p_agent_no: agentNo, p_template_id: GOLDEN_DEFENDER_BADGE_ID/)
  // The shared RPC is not redefined anywhere after its last migration.
  const later = readdirSync('supabase/migrations')
    .filter((f) => f.slice(0, 14) > '20260901220000' && /function\s+(public\.)?rc_claim_birthday_era\b/.test(read(`supabase/migrations/${f}`)))
  assert.deepEqual(later, [])
})

// ── Shared room + Jimin Day Gift ────────────────────────────────────────────

test('room counts each agent across both days with one 2-per-track cap', () => {
  assert.match(charge, /\.gte\('kst_date', event\.date\)\.lte\('kst_date', event\.dateEnd \|\| event\.date\)/)
  // Days are merged per agent before allocation, so 2 is per track per event.
  assert.match(charge, /const perAgentCounted = new Map<string, Map<string, number>>\(\)/)
  assert.match(charge, /allocateTrackHits\(entries, totals, BIRTHDAY_LIGHTS_PER_TRACK\)/)
  assert.match(charge, /const SERENDIPITY_ROOM_TARGET = 500/)
})

test('gift claim period is the event plus 7 days; earning stays in the event window', () => {
  assert.equal(isBirthdayGiftClaimDate(jimin, '2026-10-12'), false)
  assert.equal(isBirthdayGiftClaimDate(jimin, '2026-10-13'), true)
  assert.equal(isBirthdayGiftClaimDate(jimin, '2026-10-21'), true)
  assert.equal(isBirthdayGiftClaimDate(jimin, '2026-10-22'), false)
  assert.equal(isBirthdayGiftClaimDate(golden, '2026-09-02'), false, 'GOLDEN has no gift period')
  assert.match(giftSql, /if v_today < p_event_date or v_today > v_end \+ 7 then/)
  // Card eligibility is the claim row only the in-window charge RPC writes.
  assert.match(giftSql, /where agent_no = p_agent_no and era_id = p_event_id and week_key = 'event:' \|\| p_event_date::text/)
})

test('gift RPC is server-only, completion-gated, locked, and returns an existing claim unchanged', () => {
  const fn = giftSql.slice(giftSql.indexOf('create or replace function rc_claim_birthday_room_gift'))
  assert.match(fn, /if not exists \(select 1 from public\.rc_birthday_room_completions where event_id = p_event_id\) then\n\s+return jsonb_build_object\('state', 'locked'\);/)
  assert.match(fn, /if coalesce\(p_lights, 0\) <= 0 then\n\s+return jsonb_build_object\('state', 'ineligible'\);/)
  assert.match(fn, /pg_advisory_xact_lock\(hashtextextended\('birthday_room_gift\|' \|\| p_event_id \|\| '\|' \|\| p_agent_no, 0\)\)/)
  assert.equal((fn.match(/where event_id = p_event_id and agent_no = p_agent_no;\n\s+if found then\n\s+return jsonb_build_object\('state', 'claimed'/g) || []).length, 2,
    'checked before and again after taking the lock')
  assert.match(giftSql, /primary key \(event_id, agent_no\)/)
  assert.match(giftSql, /event_id text primary key/)
  assert.match(fn, /v_wings integer := greatest\(0, least\(coalesce\(p_wings, 1\), 1\)\)/)
  assert.match(fn, /v_cells integer := greatest\(0, least\(coalesce\(p_charge_cells, 1\), 1\)\)/)
  assert.match(fn, /v_badges := array_append\(v_badges, p_room_badge_id\);\n\s+perform public\.rc_award_badge\(p_agent_no, p_room_badge_id, null\);\n\s+if v_card then/)
  for (const name of ['rc_birthday_room_completions', 'rc_birthday_gift_claims']) {
    assert.match(giftSql, new RegExp(`revoke all on public\\.${name} from public, anon, authenticated;`))
  }
  assert.match(giftSql, /grant execute on function rc_claim_birthday_room_gift\(text, text, date, date, integer, text, text, integer, integer\)\n\s+to service_role;/)
  const index = read('supabase/functions/op-reconnect/index.ts')
  assert.match(index, /claimBirthdayGift: \{ auth: 'agent', handler: async \(sb, p\) => claimBirthdayGift\(sb, await loadContent\(sb\), String\(p\.agentNo \|\| ''\)\.trim\(\)\.toUpperCase\(\)\) \}/,
    'the client action carries nothing but its agent number')
})

test('lightkeeper badge template: Event, common, position 147, approved hint', () => {
  const sql = read('supabase/migrations/20261013120000_rc_jimin_day_lightkeeper_badge.sql')
  assert.match(sql, /'event_jimin_day_lightkeeper_2026', 'event', 'common', 'Birthday Lightkeeper',\n\s+'Help restore the Jimin Birthday Room on Jimin Day 2026\.', 147, true/)
  assert.doesNotMatch(sql, /update rc_badge_catalog/, 'template-only: applied ahead of the release')
  const hint = read('supabase/migrations/20261013120500_rc_jimin_birthday_badge_hint.sql')
  assert.match(hint, /set unlock_hint = 'Complete your Jimin Birthday Era Card and help restore the Jimin Birthday Room on Jimin Day 2026\.'\n\s+where id = 'event_jimin_birthday_2026';/)
})

// A fake Supabase that records RPC calls; just enough of the query builder
// for computeBirthdayRoom / computeSerendipityRoom.
function fakeDb(tables, rpcResult) {
  const calls = []
  const db = {
    calls,
    from(table) {
      const filters = []
      const builder = {
        select() { return builder },
        eq(col, val) { filters.push((r) => r[col] === val); return builder },
        gte(col, val) { filters.push((r) => r[col] >= val); return builder },
        lte(col, val) { filters.push((r) => r[col] <= val); return builder },
        rows() { return (tables[table] || []).filter((r) => filters.every((f) => f(r))) },
        maybeSingle() { return Promise.resolve({ data: builder.rows()[0] || null }) },
        then(resolve) { resolve({ data: builder.rows() }) },
        upsert(row) {
          tables[table] ||= []
          if (!tables[table].some((r) => r.event_id === row.event_id)) tables[table].push(row)
          return Promise.resolve({ data: null })
        },
      }
      return builder
    },
    rpc(name, args) { calls.push({ name, args }); return Promise.resolve({ data: rpcResult(name, args), error: null }) },
  }
  return db
}
const content = { config: { bts_artists: ['jimin', 'bts'], track_artist_overrides: {} } }
const fullDay = (agent, date, plays = 2) => ({
  agent_no: agent, kst_date: date,
  track_counts: Object.fromEntries(jimin.tracks.map((t) => [normKeyFull(t), { a: { jimin: plays } }])),
})

test('the gift claim sends the server-computed contribution, and records completion once', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-14T03:00:00Z') })
  try {
    // 28 agents × 18 lights = 504 ≥ 500, split across both event days; a
    // stray Oct 15 row must not count.
    const activity = []
    for (let i = 0; i < 28; i++) activity.push(fullDay(`A${i}`, i % 2 ? '2026-10-13' : '2026-10-14'))
    activity.push(fullDay('A0', '2026-10-15', 50))
    const tables = { rc_daily_activity: activity, rc_birthday_room_completions: [], rc_birthday_gift_claims: [] }
    const db = fakeDb(tables, () => ({ state: 'claimed', badgeIds: ['event_jimin_day_lightkeeper_2026'], wings: 1, chargeCells: 1, cardComplete: false }))
    const res = await claimBirthdayGift(db, content, 'A3')
    assert.equal(res.success, true)
    assert.equal(tables.rc_birthday_room_completions.length, 1)
    assert.equal(tables.rc_birthday_room_completions[0].community_lights, 504)
    const call = db.calls.find((c) => c.name === 'rc_claim_birthday_room_gift')
    assert.equal(call.args.p_lights, 18, 'own lights, capped at 2 per track, computed on the server')
    assert.equal(call.args.p_event_date_end, '2026-10-14')
    assert.equal(call.args.p_room_badge_id, 'event_jimin_day_lightkeeper_2026')
    assert.equal(call.args.p_card_badge_id, 'event_jimin_birthday_2026')
    // Same total again: completion is not written twice.
    await claimBirthdayGift(db, content, 'A3')
    assert.equal(tables.rc_birthday_room_completions.length, 1)
  } finally { mock.timers.reset() }
})

test('a recorded completion never falls back, and claimed gifts are not re-claimed', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-14T03:00:00Z') })
  try {
    const tables = {
      rc_daily_activity: [fullDay('A1', '2026-10-13', 1)],
      rc_birthday_room_completions: [{ event_id: jimin.id, community_lights: 503, target: 500 }],
      rc_birthday_gift_claims: [{ event_id: jimin.id, agent_no: 'A1', badge_ids: ['event_jimin_day_lightkeeper_2026'], wings: 1, charge_cells: 1, card_complete: false }],
    }
    const db = fakeDb(tables, () => { throw new Error('must not call the RPC for an existing claim') })
    const res = await claimBirthdayGift(db, content, 'A1')
    assert.equal(res.success, true)
    assert.equal(res.gift.state, 'claimed')
    assert.equal(db.calls.length, 0)
  } finally { mock.timers.reset() }
})

test('before completion and after the claim period the gift cannot be claimed', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-14T03:00:00Z') })
  try {
    const tables = { rc_daily_activity: [fullDay('A1', '2026-10-13')], rc_birthday_room_completions: [], rc_birthday_gift_claims: [] }
    const db = fakeDb(tables, (name, args) => ({ state: 'locked' }))
    const res = await claimBirthdayGift(db, content, 'A1')
    assert.equal(res.success, false)
    assert.equal(res.error, 'gift_locked')
  } finally { mock.timers.reset() }
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-22T03:00:00Z') })
  try {
    const tables = { rc_daily_activity: [fullDay('A1', '2026-10-13')], rc_birthday_room_completions: [{ event_id: jimin.id, community_lights: 600, target: 500 }], rc_birthday_gift_claims: [] }
    const db = fakeDb(tables, () => ({ state: 'claimed' }))
    const res = await claimBirthdayGift(db, content, 'A1')
    assert.equal(res.success, false)
    assert.equal(db.calls.length, 0)
  } finally { mock.timers.reset() }
})

// ── Popup, copy and gift contents ───────────────────────────────────────────

const darkCard = { id: jimin.id, isSpecial: true, roomGift: true, status: 'dark', member: 'Jimin', name: 'MUSE', icon: '🌙' }

test('popup appears only for a live, unfinished birthday card', () => {
  assert.equal(birthdayPopupCard({ agentCharge: { eraCards: [{ id: 'ly', status: 'dark' }, darkCard] } }), darkCard)
  assert.equal(birthdayPopupCard({ agentCharge: { eraCards: [{ ...darkCard, status: 'keepsake' }] } }), null)
  assert.equal(birthdayPopupCard({ agentCharge: { eraCards: [{ id: 'ly', status: 'dark' }] } }), null)
  assert.equal(birthdayPopupCard({}), null)
})

test('popup and completion copy are the approved words', () => {
  assert.deepEqual(birthdayPopupCopy(darkCard), {
    title: 'Happy Birthday, Jimin',
    body: 'Complete your Birthday Era Card for +10H ARMY Bomb charge. Every qualifying stream also helps restore the shared Jimin Birthday Room.',
    note: 'When the room reaches 100%, everyone who helped can open a Jimin Day Gift.',
    action: 'Start Era Card',
  })
  assert.equal(birthdayCompleteMessage({ ...darkCard, status: 'keepsake' }), 'Birthday Era Complete · +10H ARMY Bomb charge added.')
})

test('popup is shown once per agent per event, and never when storage fails', () => {
  const store = new Map()
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
  assert.equal(birthdayPopupSeen(storage, 'A1', jimin.id), false)
  markBirthdayPopupSeen(storage, 'A1', jimin.id)
  assert.equal(birthdayPopupSeen(storage, 'A1', jimin.id), true)
  assert.equal(birthdayPopupSeen(storage, 'A2', jimin.id), false)
  const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  assert.equal(birthdayPopupSeen(broken, 'A1', jimin.id), true)
})

test('gift contents: Lightkeeper for every contributor, Jimin Birthday Badge only with a completed card', () => {
  const names = { event_jimin_day_lightkeeper_2026: 'Birthday Lightkeeper', event_jimin_birthday_2026: 'Jimin Birthday Badge' }
  const gift = { state: 'ready', roomBadgeId: 'event_jimin_day_lightkeeper_2026', cardBadgeId: 'event_jimin_birthday_2026', wings: 1, chargeCells: 1 }
  assert.deepEqual(birthdayGiftContents(gift, false, names).map((i) => i.label), ['Birthday Lightkeeper', '1 Wing', '1 Charge Cell'])
  assert.deepEqual(birthdayGiftContents(gift, true, names).map((i) => i.label), ['Birthday Lightkeeper', 'Jimin Birthday Badge', '1 Wing', '1 Charge Cell'])
  // After the claim, exactly what the server recorded.
  const claimed = { ...gift, state: 'claimed', badgeIds: ['event_jimin_day_lightkeeper_2026'], cardComplete: true }
  assert.deepEqual(birthdayGiftContents(claimed, true, names).map((i) => i.label), ['Birthday Lightkeeper', '1 Wing', '1 Charge Cell'])
})

// ── City map ────────────────────────────────────────────────────────────────

test('Jimin Day Party reuses the single GOLDEN birthday marker, in Candy Star\'s top spot', () => {
  const map = read('js/city-map.js')
  const world = read('js/screen-world.js')
  assert.match(map, /const marker = toolMarker\(opts\.birthdayAtTop \? -Math\.PI \/ 2 - 0\.20 : Math\.PI \/ 2 \+ \(onVma \? 0\.20 : 0\), opts\.birthdayIcon \|\| '🐰', opts\.birthdayLabel \|\| 'Golden Corner', onGoldenCorner,/)
  assert.match(map, /const candyAngle = onParty \? Math\.PI : opts\.birthdayAtTop \? Math\.PI \/ 2 - 0\.20 : -Math\.PI \/ 2 - 0\.20/)
  assert.match(map, /toolMarker\(opts\.birthdayAtTop \? Math\.PI \/ 2 \+ 0\.20 : Math\.PI \/ 2 - \(onGoldenCorner \? 0\.20 : 0\), '⚡', 'VMA'/)
  assert.match(world, /const jiminRoom = golden \? null : state\.agentCharge\?\.serendipityRoom/)
  assert.match(map, /opts\.birthdayAtTop \? 2 : 0\)/, 'Jimin Day Party breaks after two words beside Magic Shop')
  assert.match(map, /function toolMarker\(angle, icon, label, onClick, extraClass, splitAfter = 0\)/)
  assert.match(world, /: jiminRoom \? \(origin\) => goSerendipityRoom\(origin\) : null,/)
  assert.match(world, /birthdayIcon: '🌙', birthdayLabel: 'Jimin Day Party', birthdayAtTop: true/)
})
