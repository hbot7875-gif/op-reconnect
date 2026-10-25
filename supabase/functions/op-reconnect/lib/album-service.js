// The Album — rules over a store (album-rules.js says what the Album is).
//
// Pure JS, no Supabase: album.ts gives it the real store (tables + the two
// locked-down RPCs in 20261025170000_rc_album.sql), album-service.test.mjs an
// in-memory one. Every write that must be exactly-once — one goal cover per
// KST day, one gift sent and one received per day — is decided inside the
// RPC under a lock, never here; this layer validates input and shapes views.
//
// Store contract (async, camelCase):
//   listCovers(agentNo)                       → [{ era, source, fromAgentNo, earnedOn }]
//   awardDaily({ agentNo, kstDate, pick })    → { ok, era, new, complete }
//   gift({ from, to, era, kstDate, minDays }) → { ok: true, era, toName } | { ok: false, error }
//   giftsOn(agentNo, kstDate)                 → { sent: bool, received: bool }
//   names(agentNos)                           → Map<agentNo, codename>
//   throttle(bucket, max, windowSeconds)      → bool (true = allowed)

import { ALBUM_ERA_IDS, ALBUM_SIZE, ALBUM_GIFT_MIN_DAYS, isAlbumEra, normalizeAgentNo } from './album-rules.js'

const GIFT_TRIES = 10 // per agent per 10 minutes, so agent numbers can't be probed

export function createAlbumService({ store, rng = Math.random }) {
  const order = (era) => ALBUM_ERA_IDS.indexOf(era)

  /** What the Album screen shows. `kstDate` is today in KST (YYYY-MM-DD). */
  async function view(agentNo, kstDate) {
    const rows = (await store.listCovers(agentNo)).filter((r) => isAlbumEra(r.era))
    rows.sort((a, b) => order(a.era) - order(b.era))
    const givers = [...new Set(rows.map((r) => r.fromAgentNo).filter(Boolean))]
    const names = givers.length ? await store.names(givers) : new Map()
    const gifts = await store.giftsOn(agentNo, kstDate)
    return {
      covers: rows.map((r) => ({
        era: r.era,
        source: r.source,
        // A giver is shown by codename only, never by agent number.
        fromName: r.fromAgentNo ? names.get(r.fromAgentNo) || 'An agent' : null,
        earnedOn: r.earnedOn,
      })),
      count: rows.length,
      total: ALBUM_SIZE,
      complete: rows.length >= ALBUM_SIZE,
      todayGoalEra: rows.find((r) => r.source === 'goal' && r.earnedOn === kstDate)?.era || null,
      gift: { sentToday: !!gifts.sent, receivedToday: !!gifts.received, minDays: ALBUM_GIFT_MIN_DAYS },
    }
  }

  /** The short summary that rides along with every game state. `giftToday`
   *  is the cover someone shared with this agent today (at most one a day),
   *  so the City can say it arrived; the giver is named by codename only. */
  async function summary(agentNo, kstDate) {
    const rows = (await store.listCovers(agentNo)).filter((r) => isAlbumEra(r.era))
    const gift = rows.find((r) => r.source === 'gift' && r.earnedOn === kstDate) || null
    const names = gift?.fromAgentNo ? await store.names([gift.fromAgentNo]) : null
    return {
      count: rows.length,
      total: ALBUM_SIZE,
      complete: rows.length >= ALBUM_SIZE,
      todayGoalEra: rows.find((r) => r.source === 'goal' && r.earnedOn === kstDate)?.era || null,
      giftToday: gift ? { era: gift.era, fromName: names?.get(gift.fromAgentNo) || 'An agent' } : null,
    }
  }

  /** Called on every game-state poll with whether today's Signal Sweep is
   *  done. Cheap when there's nothing to do (one read); the RPC itself is
   *  idempotent per day, so a race between two polls can't award twice. */
  async function awardDailyGoal(agentNo, kstDate, done) {
    const current = await summary(agentNo, kstDate)
    if (!done || current.todayGoalEra || current.complete) return current
    const res = await store.awardDaily({ agentNo, kstDate, pick: rng() })
    if (!res?.ok) return current
    return summary(agentNo, kstDate)
  }

  async function sendGift(agentNo, params, kstDate) {
    const to = normalizeAgentNo(params?.to)
    if (!to) return { success: false, error: 'gift_bad_agent' }
    if (to === agentNo) return { success: false, error: 'gift_self' }
    const era = String(params?.era || '')
    if (!isAlbumEra(era)) return { success: false, error: 'gift_bad_era' }
    if (!(await store.throttle(`album-gift:${agentNo}`, GIFT_TRIES, 600))) return { success: false, error: 'rate_limited' }
    const res = await store.gift({ from: agentNo, to, era, kstDate, minDays: ALBUM_GIFT_MIN_DAYS })
    if (!res?.ok) return { success: false, error: res?.error || 'server_error', album: await view(agentNo, kstDate) }
    return { success: true, gift: { era, toName: res.toName || 'An agent' }, album: await view(agentNo, kstDate) }
  }

  async function isComplete(agentNo) {
    const rows = (await store.listCovers(agentNo)).filter((r) => isAlbumEra(r.era))
    return rows.length >= ALBUM_SIZE
  }

  return { view, summary, awardDailyGoal, sendGift, isComplete }
}
