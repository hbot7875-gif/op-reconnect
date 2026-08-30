// Pure presentation rules for the admin ReConnect queue. Keeping the
// classification outside admin.html makes the three-bucket promise testable:
// one admin-facing urgency, one plain reason, one next action.

const has = (item, flag) => (item?.flags || []).includes(flag)

export function canAutoFillReconnect(item) {
  return item?.kind === 'mission'
    && !has(item, 'expired')
    && Number(item?.missingSeats || 0) > 0
    && Array.isArray(item?.suggestedAgentNos)
    && item.suggestedAgentNos.length === Number(item?.requiredAgents || 0)
}

export function reconnectAdminBucket(item) {
  if ((item?.flags || []).length === 1 && has(item, 'active')) return 'fine'

  if (has(item, 'puzzle_blocked') || has(item, 'expired')
    || has(item, 'idle_teammate') || has(item, 'invite_overdue')) return 'action'

  if (has(item, 'needs_people')) return canAutoFillReconnect(item) ? 'action' : 'watch'
  return 'watch'
}

export function reconnectTeamLabel(item) {
  const joined = (item?.agents || []).map((agent) => agent.codename).filter(Boolean)
  const invited = (item?.invites || []).map((agent) => agent.codename).filter(Boolean)
  const names = [...joined, ...invited]
  if (names.length) return names.join(' + ')
  return item?.goalLabel || 'ReConnect team'
}

export function reconnectPlainReason(item) {
  const missing = Math.max(0, Number(item?.missingSeats || 0))
  if (has(item, 'puzzle_blocked')) return 'No puzzle attempts left'
  if (has(item, 'expired')) return 'This ReConnect Quest expired'
  if (has(item, 'deadline_soon') && missing > 0) {
    return `Needs ${missing} teammate${missing === 1 ? '' : 's'} before the deadline`
  }
  if (has(item, 'idle_teammate')) return 'A teammate has gone quiet'
  if (has(item, 'invite_overdue')) return 'An invite has not been answered'
  if (has(item, 'needs_people')) return `Needs ${Math.max(1, missing)} teammate${missing === 1 ? '' : 's'}`
  if (has(item, 'invite_pending')) return 'Waiting for an invite reply'
  if (has(item, 'deadline_soon')) return 'The deadline is close'
  return 'Progressing normally'
}

export function reconnectAdminAction(item) {
  if (canAutoFillReconnect(item)) return { kind: 'autofill', label: 'AUTO-FILL BEST MATCH' }
  if (has(item, 'puzzle_blocked') || has(item, 'expired')) return { kind: 'open_agent', label: 'OPEN AGENT' }
  if (has(item, 'idle_teammate') || has(item, 'invite_overdue')) return { kind: 'review', label: 'REVIEW TEAM' }
  if (has(item, 'invite_pending')) return { kind: 'wait', label: 'Wait for reply' }
  if (has(item, 'needs_people')) return { kind: 'wait', label: 'Wait for a compatible agent' }
  if (has(item, 'deadline_soon')) return { kind: 'wait', label: 'Watch progress' }
  return { kind: 'none', label: 'No action needed' }
}

export function reconnectBucketCounts(cases = []) {
  return cases.reduce((counts, item) => {
    counts[reconnectAdminBucket(item)] += 1
    return counts
  }, { action: 0, watch: 0, fine: 0 })
}

/** The Red Zone "What counts" picker's options, from the same goal list the
 *  Goals tab edits. Only track and album goals can be streamed at —
 *  reconnect goals are puzzles, not stream targets, and would produce an
 *  event that counts nothing. The empty value is deliberately first and
 *  always present: no target is a valid, common choice (every eligible BTS
 *  play counts), not a "nothing selected" placeholder. */
export function redZoneTargetOptions(goals = []) {
  const options = [{ value: '', label: 'Any BTS song', group: null }]
  const rows = (goals || []).filter((g) => g && (g.kind === 'track' || g.kind === 'album'))
  for (const g of rows.filter((g) => g.kind === 'track')) {
    options.push({ value: g.id, label: g.artist ? `${g.label} — ${g.artist}` : g.label, group: 'Tracks' })
  }
  for (const g of rows.filter((g) => g.kind === 'album')) {
    const n = (g.tracks || []).length
    options.push({ value: g.id, label: `${g.label} (${n} track${n === 1 ? '' : 's'})`, group: 'Albums' })
  }
  return options
}
