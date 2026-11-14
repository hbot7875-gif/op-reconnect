// A tiny, player-facing interpretation of the authoritative 14-day
// last-fed clock. This is deliberately separate from charge hours: the
// purple liquid can be low while the agent-file health clock is still safe.

// Never charged: charged_until is still null (City reads hoursRemaining 0
// with isDark false). For these agents feedHealth.lastFedAt is only the join
// time (agent-charge.ts bombFeedHealth's fallback), so the meter must not
// say FULL OF BORA or FED JUST NOW. Days are spelled out ("14 DAYS"): in
// the meter's font "14D" read as "140".
export function bombHealthStatus(feedHealth, { neverCharged = false } = {}) {
  if (!feedHealth || !Number.isFinite(Number(feedHealth.daysLeft))) return null
  const daysLeft = Math.max(0, Math.min(14, Math.ceil(Number(feedHealth.daysLeft))))
  const days = `${daysLeft} DAY${daysLeft === 1 ? '' : 'S'}`

  if (neverCharged) {
    const tone = daysLeft <= 2 ? 'urgent' : daysLeft <= 5 ? 'hungry' : 'new'
    return { tone, icon: tone === 'new' ? '◇' : '!', label: 'NOT CHARGED YET',
      detail: daysLeft <= 0 ? 'CHARGE TODAY' : `CHARGE IN ${days}` }
  }

  if (daysLeft <= 0) return { tone: 'urgent', icon: '!', label: 'ARMY, FEED ME', detail: 'LIMIT REACHED' }
  if (daysLeft <= 2) return { tone: 'urgent', icon: '!', label: 'ARMY, FEED ME', detail: `${days} LEFT` }
  if (daysLeft <= 5) return { tone: 'hungry', icon: '♡', label: 'LOW ON BORA', detail: `${days} LEFT` }
  if (daysLeft <= 9) return { tone: 'steady', icon: '◇', label: 'STILL GLOWING', detail: `${days} LEFT` }
  return { tone: 'happy', icon: '♥', label: 'FULL OF BORA', detail: `${days} LEFT` }
}

export function lastFedLabel(feedHealth, nowMs = Date.now()) {
  const fedMs = Date.parse(feedHealth?.lastFedAt || '')
  if (!Number.isFinite(fedMs)) return null
  const hours = Math.max(0, (nowMs - fedMs) / 3_600_000)
  if (hours < 1) return 'FED JUST NOW'
  if (hours < 24) return `FED ${Math.floor(hours)}H AGO`
  return `FED ${Math.floor(hours / 24)}D AGO`
}
