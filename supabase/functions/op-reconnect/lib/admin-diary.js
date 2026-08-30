// Builds a quiet, human-readable admin diary from data ReConnect already
// stores. This does not create a second event system: feed rows remain the
// milestone source and the XP ledger remains the XP source.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

function kstDay(iso) {
  const time = new Date(iso).getTime()
  return Number.isFinite(time) ? new Date(time + KST_OFFSET_MS).toISOString().slice(0, 10) : null
}

function districtIdFromKey(key = '') {
  const match = String(key).match(/^feed:district:[^:]+:(.+)$/)
  return match?.[1] || null
}

function milestone(row, districtNames = {}) {
  const payload = row.payload || {}
  const common = { occurredAt: row.created_at, dayKey: kstDay(row.created_at), source: 'milestone' }
  if (!common.dayKey) return null

  switch (row.event_type) {
    case 'district_restored': {
      const districtId = districtIdFromKey(row.dedup_key)
      const name = districtId ? districtNames[districtId] : null
      return { ...common, kind: 'district', icon: '🌆', title: name ? `Restored ${name}` : 'Restored a district' }
    }
    case 'ward_completed':
      return { ...common, kind: 'ward', icon: '✨', title: payload.wardName ? `Restored ${payload.wardName}` : 'Restored a ward' }
    case 'level_up':
      return { ...common, kind: 'level', icon: '✦', title: `Reached Level ${payload.level || '?'}`,
        detail: payload.name || null }
    case 'reconnect_completed':
      return { ...common, kind: 'reconnect', icon: '🤝', title: 'Completed a ReConnect Quest',
        detail: payload.partnerCodename ? `with ${payload.partnerCodename}` : null }
    case 'item_dropped': {
      const rarity = payload.rarity ? `${payload.rarity} ` : ''
      return { ...common, kind: 'reward', icon: '🎁', title: `Found a ${rarity}reward` }
    }
    case 'era_lit':
      return { ...common, kind: 'era', icon: '💡', title: payload.eraName ? `Lit the ${payload.eraName} Era` : 'Lit an Era Card' }
    case 'bomb_fed':
      return { ...common, kind: 'bomb', icon: '🔋', title: 'Fed the ARMY Bomb',
        detail: payload.hoursAdded ? `+${payload.hoursAdded} hours` : null }
    case 'ticket_claimed':
      return { ...common, kind: 'ticket', icon: '🎫', title: 'Claimed a Magic Shop ticket' }
    case 'side_mission_daily':
      return { ...common, kind: 'mission', icon: '✓', title: "Completed today's Signal Sweep" }
    case 'side_mission_weekly':
      return { ...common, kind: 'mission', icon: '🏁', title: 'Completed the weekly Signal Sweep' }
    case 'streak_badge':
      return { ...common, kind: 'streak', icon: '🔥', title: `Reached a ${payload.days || '?'}-day streak` }
    default:
      return null
  }
}

export function buildAgentDiary({ feedRows = [], xpRows = [], districtNames = {} } = {}) {
  const entries = feedRows.map((row) => milestone(row, districtNames)).filter(Boolean)
  const xpByDay = new Map()

  for (const row of xpRows) {
    const amount = Number(row.amount)
    const dayKey = kstDay(row.created_at)
    if (!dayKey || !Number.isFinite(amount) || amount <= 0) continue
    const current = xpByDay.get(dayKey) || { amount: 0, occurredAt: row.created_at }
    current.amount += amount
    if (new Date(row.created_at) > new Date(current.occurredAt)) current.occurredAt = row.created_at
    xpByDay.set(dayKey, current)
  }

  for (const [dayKey, xp] of xpByDay) {
    entries.push({
      kind: 'xp', icon: '✦', title: `Earned ${xp.amount} XP`,
      occurredAt: xp.occurredAt, dayKey, source: 'xp',
    })
  }

  return entries
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, 100)
}
