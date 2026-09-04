// A tiny, player-facing interpretation of the authoritative 14-day
// last-fed clock. This is deliberately separate from charge hours: the
// purple liquid can be low while the agent-file health clock is still safe.

export function bombHealthStatus(feedHealth) {
  if (!feedHealth || !Number.isFinite(Number(feedHealth.daysLeft))) return null
  const daysLeft = Math.max(0, Math.min(14, Math.ceil(Number(feedHealth.daysLeft))))

  if (daysLeft <= 0) return { tone: 'urgent', icon: '!', label: 'ARMY, FEED ME', detail: 'LIMIT REACHED' }
  if (daysLeft <= 2) return { tone: 'urgent', icon: '!', label: 'ARMY, FEED ME', detail: `${daysLeft}D LEFT` }
  if (daysLeft <= 5) return { tone: 'hungry', icon: '♡', label: 'LOW ON BORA', detail: `FEED · ${daysLeft}D LEFT` }
  if (daysLeft <= 9) return { tone: 'steady', icon: '◇', label: 'STILL GLOWING', detail: `FEED · ${daysLeft}D LEFT` }
  return { tone: 'happy', icon: '♥', label: 'FULL OF BORA', detail: `FEED · ${daysLeft}D LEFT` }
}

export function lastFedLabel(feedHealth, nowMs = Date.now()) {
  const fedMs = Date.parse(feedHealth?.lastFedAt || '')
  if (!Number.isFinite(fedMs)) return null
  const hours = Math.max(0, (nowMs - fedMs) / 3_600_000)
  if (hours < 1) return 'FED JUST NOW'
  if (hours < 24) return `FED ${Math.floor(hours)}H AGO`
  return `FED ${Math.floor(hours / 24)}D AGO`
}
