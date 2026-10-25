// The Album's rules, on an in-memory store that mirrors the two RPCs in
// 20261025170000_rc_album.sql (the SQL text itself is checked by
// album-sql.test.mjs).

import assert from 'node:assert/strict'
import test from 'node:test'
import { createAlbumService } from './album-service.js'
import { ALBUM_ERA_IDS, ALBUM_SIZE, normalizeAgentNo } from './album-rules.js'

const DAY = 86_400_000

function memoryStore({ agents }) {
  const covers = [] // { agentNo, era, source, fromAgentNo, earnedOn }
  const gifts = [] // { from, to, era, sentOn }
  const has = (a, era) => covers.some((c) => c.agentNo === a && c.era === era)
  return {
    covers,
    gifts,
    async listCovers(agentNo) {
      return covers.filter((c) => c.agentNo === agentNo).map(({ era, source, fromAgentNo, earnedOn }) => ({ era, source, fromAgentNo, earnedOn }))
    },
    async awardDaily({ agentNo, kstDate, pick }) {
      const today = covers.find((c) => c.agentNo === agentNo && c.source === 'goal' && c.earnedOn === kstDate)
      if (today) return { ok: true, era: today.era, new: false }
      const missing = ALBUM_ERA_IDS.filter((e) => !has(agentNo, e))
      if (!missing.length) return { ok: true, era: null, new: false, complete: true }
      const era = missing[Math.min(missing.length - 1, Math.floor(Math.max(0, pick) * missing.length))]
      covers.push({ agentNo, era, source: 'goal', fromAgentNo: null, earnedOn: kstDate })
      return { ok: true, era, new: true }
    },
    async gift({ from, to, era, kstDate, minDays }) {
      if (from === to) return { ok: false, error: 'gift_self' }
      if (!agents[from] || agents[from].joined > Date.now() - minDays * DAY) return { ok: false, error: 'gift_too_new' }
      if (!agents[to]) return { ok: false, error: 'gift_no_agent' }
      if (!has(from, era)) return { ok: false, error: 'gift_not_owned' }
      if (has(to, era)) return { ok: false, error: 'gift_has_it' }
      if (gifts.some((g) => g.from === from && g.sentOn === kstDate)) return { ok: false, error: 'gift_sent_today' }
      if (gifts.some((g) => g.to === to && g.sentOn === kstDate)) return { ok: false, error: 'gift_received_today' }
      gifts.push({ from, to, era, sentOn: kstDate })
      covers.push({ agentNo: to, era, source: 'gift', fromAgentNo: from, earnedOn: kstDate })
      return { ok: true, era, toName: agents[to].name }
    },
    async giftsOn(agentNo, kstDate) {
      return { sent: gifts.some((g) => g.from === agentNo && g.sentOn === kstDate), received: gifts.some((g) => g.to === agentNo && g.sentOn === kstDate) }
    },
    async names(nos) { return new Map(nos.map((n) => [n, agents[n]?.name || 'AGENT'])) },
    async throttle() { return true },
  }
}

const old = Date.now() - 30 * DAY
const agents = {
  AGENT050: { name: 'MOCHI', joined: old },
  AGENT120: { name: 'KOYA', joined: old },
  AGENT140: { name: 'TATA', joined: old },
  AGENT777: { name: 'FRESH', joined: Date.now() - DAY },
}
const setup = (rng = () => 0.5) => {
  const store = memoryStore({ agents })
  return { store, album: createAlbumService({ store, rng }) }
}

test('the album is the 15 eras on the card faces, and agent numbers normalise', () => {
  assert.equal(ALBUM_SIZE, 15)
  assert.equal(new Set(ALBUM_ERA_IDS).size, 15)
  assert.equal(normalizeAgentNo('050'), 'AGENT050')
  assert.equal(normalizeAgentNo(' agent 50 '), 'AGENT050')
  assert.equal(normalizeAgentNo('AGENT1997'), 'AGENT1997')
  assert.equal(normalizeAgentNo('mochi'), null)
  assert.equal(normalizeAgentNo(''), null)
})

test('no cover until the daily Signal Sweep is done', async () => {
  const { album, store } = setup()
  const s = await album.awardDailyGoal('AGENT050', '2026-10-25', false)
  assert.equal(s.count, 0)
  assert.equal(store.covers.length, 0)
})

test('one goal cover per KST day, however many polls ask', async () => {
  const { album, store } = setup()
  for (let i = 0; i < 5; i++) await album.awardDailyGoal('AGENT050', '2026-10-25', true)
  assert.equal(store.covers.length, 1)
  const s = await album.summary('AGENT050', '2026-10-25')
  assert.equal(s.count, 1)
  assert.equal(s.todayGoalEra, store.covers[0].era)
  await album.awardDailyGoal('AGENT050', '2026-10-26', true)
  assert.equal(store.covers.length, 2)
})

test('goal covers never repeat: 15 days fill the album, the 16th brings nothing', async () => {
  let r = 0
  const { album, store } = setup(() => (r = (r + 0.37) % 1))
  for (let d = 1; d <= 16; d++) await album.awardDailyGoal('AGENT050', `2026-11-${String(d).padStart(2, '0')}`, true)
  const mine = store.covers.filter((c) => c.agentNo === 'AGENT050').map((c) => c.era)
  assert.equal(mine.length, 15)
  assert.equal(new Set(mine).size, 15)
  assert.equal(await album.isComplete('AGENT050'), true)
  const v = await album.view('AGENT050', '2026-11-16')
  assert.equal(v.complete, true)
  assert.deepEqual(v.covers.map((c) => c.era), ALBUM_ERA_IDS) // shown in release order
})

test('a gift is a copy: the giver keeps it, the receiver sees who sent it', async () => {
  const { album, store } = setup()
  await album.awardDailyGoal('AGENT050', '2026-10-25', true)
  const era = store.covers[0].era
  const res = await album.sendGift('AGENT050', { to: '120', era }, '2026-10-25')
  assert.equal(res.success, true)
  assert.equal(res.gift.toName, 'KOYA')
  assert.equal((await album.view('AGENT050', '2026-10-25')).count, 1)
  const theirs = await album.view('AGENT120', '2026-10-25')
  assert.equal(theirs.count, 1)
  assert.equal(theirs.covers[0].source, 'gift')
  assert.equal(theirs.covers[0].fromName, 'MOCHI')
  assert.equal(JSON.stringify(theirs).includes('AGENT050'), false, 'no agent numbers in a view')
  // The game state says a gift arrived today, by codename, so the City can announce it.
  const sum = await album.summary('AGENT120', '2026-10-25')
  assert.deepEqual(sum.giftToday, { era, fromName: 'MOCHI' })
  assert.equal(JSON.stringify(sum).includes('AGENT050'), false)
  assert.equal((await album.summary('AGENT120', '2026-10-26')).giftToday, null)
})

test('gift limits: one sent and one received a day, only what you own, only what they lack', async () => {
  const { album, store } = setup()
  store.covers.push(
    { agentNo: 'AGENT050', era: 'wings', source: 'goal', fromAgentNo: null, earnedOn: '2026-10-20' },
    { agentNo: 'AGENT050', era: 'be', source: 'goal', fromAgentNo: null, earnedOn: '2026-10-21' },
    { agentNo: 'AGENT120', era: 'proof', source: 'goal', fromAgentNo: null, earnedOn: '2026-10-21' },
    { agentNo: 'AGENT140', era: 'tear', source: 'goal', fromAgentNo: null, earnedOn: '2026-10-22' },
  )
  const day = '2026-10-25'
  assert.equal((await album.sendGift('AGENT050', { to: 'AGENT050', era: 'wings' }, day)).error, 'gift_self')
  assert.equal((await album.sendGift('AGENT050', { to: 'nobody', era: 'wings' }, day)).error, 'gift_bad_agent')
  assert.equal((await album.sendGift('AGENT050', { to: '120', era: 'nope' }, day)).error, 'gift_bad_era')
  assert.equal((await album.sendGift('AGENT050', { to: '999', era: 'wings' }, day)).error, 'gift_no_agent')
  assert.equal((await album.sendGift('AGENT050', { to: '120', era: 'proof' }, day)).error, 'gift_not_owned')
  // 120 shares PROOF with 050: 120 has sent today, 050 has received today.
  assert.equal((await album.sendGift('AGENT120', { to: '050', era: 'proof' }, day)).success, true)
  assert.equal((await album.sendGift('AGENT050', { to: '120', era: 'proof' }, day)).error, 'gift_has_it')
  assert.equal((await album.sendGift('AGENT120', { to: '140', era: 'proof' }, day)).error, 'gift_sent_today')
  assert.equal((await album.sendGift('AGENT140', { to: '050', era: 'tear' }, day)).error, 'gift_received_today')
  // Sending and receiving are separate: 050 can still send today.
  assert.equal((await album.sendGift('AGENT050', { to: '120', era: 'wings' }, day)).success, true)
  assert.equal((await album.sendGift('AGENT050', { to: '140', era: 'be' }, day)).error, 'gift_sent_today')
  const v = await album.view('AGENT050', day)
  assert.deepEqual(v.gift, { sentToday: true, receivedToday: true, minDays: 3 })
  // Tomorrow the limits reset.
  assert.equal((await album.sendGift('AGENT050', { to: '140', era: 'be' }, '2026-10-26')).success, true)
})

test('a new account cannot gift yet', async () => {
  const { album, store } = setup()
  store.covers.push({ agentNo: 'AGENT777', era: 'wings', source: 'goal', fromAgentNo: null, earnedOn: '2026-10-25' })
  assert.equal((await album.sendGift('AGENT777', { to: '050', era: 'wings' }, '2026-10-25')).error, 'gift_too_new')
})
