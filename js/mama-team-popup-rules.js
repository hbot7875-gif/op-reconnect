// Pure rules for mama-team-popup.js (testable in Node).

const SEEN_KEY = 'rc_seen_mama_team_popup:'

const kstDay = (now) => new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10)

/** Pure: which popup is due now, if any. `voting` is state.voting (getVotingBanner).
 *  'team' — no team yet, while voting is open or the battle recruits before it.
 *  'live' — on a team, voting is open, and today's votes aren't all in yet.
 *  'closing' — on a team, nothing verified today, and today's votes reset
 *  (or voting closes) within CLOSING_MS.
 *  Each shows once per KST day, and the promo, open-voting, live and closing
 *  popups are seen separately, so opening day still announces the live
 *  battle and the evening still gets its last call. */
export function mamaPopupKind(voting, { agentNo, now = new Date(), storage, screen } = {}) {
  if (!agentNo || !voting || (voting.phase !== 'open' && voting.phase !== 'soon')) return null
  if (!voting.battle) return null
  if (screen === 'voting') return null // already where the popup would send them
  if (voting.battle.myTeam && closingSoon(voting, now)) {
    try { if (storage.getItem(seenKey(agentNo, voting, 'closing', now)) !== '1') return 'closing' } catch (_) { return null }
  }
  let kind = null
  if (!voting.battle.myTeam) kind = 'team'
  else if (voting.phase === 'open' && !(voting.total > 0 && voting.done >= voting.total)) kind = 'live'
  if (!kind) return null
  try { return storage.getItem(seenKey(agentNo, voting, kind, now)) !== '1' ? kind : null } catch (_) { return null }
}

/** Is the team choice due? (The older question, still asked by tests.) */
export const mamaTeamPopupDue = (voting, opts) => mamaPopupKind(voting, opts) === 'team'

const seenKey = (agentNo, voting, kind, now) =>
  `${SEEN_KEY}${agentNo}:${voting.campaignId}:${kstDay(now)}${kind === 'live' || kind === 'closing' ? `:${kind}` : voting.phase === 'open' ? ':open' : ''}`

/** The last-call window before the daily reset: 3 hours (21:00 KST). */
export const CLOSING_MS = 3 * 3600_000

/** Pure: ms until today's votes stop counting — the 00:00 KST reset, or the
 *  close on the last day. Null unless voting is open. */
export function msToDeadline(voting, now = new Date()) {
  if (voting?.phase !== 'open') return null
  const reset = nextResetAt(voting, now)
  const end = reset ? reset.getTime() : Date.parse(voting.closesAt)
  return Number.isFinite(end) ? end - now.getTime() : null
}

/** Pure: nothing verified today and the deadline is close. */
export function closingSoon(voting, now = new Date()) {
  const left = msToDeadline(voting, now)
  return left !== null && left > 0 && left <= CLOSING_MS && !(Number(voting.done) > 0)
}

/** "2h 15m" / "40m" — rounded down, never "0m". */
export function leftLabel(ms) {
  const mins = Math.max(1, Math.floor(ms / 60_000))
  const h = Math.floor(mins / 60)
  return h ? `${h}h ${mins % 60}m` : `${mins}m`
}

export function markMamaTeamPopupSeen(storage, agentNo, voting, kind = 'team', now = new Date()) {
  try { storage.setItem(seenKey(agentNo, voting, kind, now), '1') } catch (_) {}
}

const DAY_MS = 86_400_000

/** Pure: day N of the round in KST, 1 on opening day. */
export function roundDay(voting, now = new Date()) {
  const opens = Date.parse(voting?.opensAt)
  if (!Number.isFinite(opens)) return 1
  return Math.max(1, Math.round((Date.parse(kstDay(now)) - Date.parse(kstDay(new Date(opens)))) / DAY_MS) + 1)
}

/** Pure: when the daily votes next reset (00:00 KST) — only while voting
 *  is open, and never at or after the close. */
export function nextResetAt(voting, now = new Date()) {
  if (voting?.phase !== 'open') return null
  const next = Date.parse(`${kstDay(now)}T00:00:00+09:00`) + DAY_MS
  const closes = Date.parse(voting.closesAt)
  return Number.isFinite(closes) && next < closes ? new Date(next) : null
}

/** Pure: the browser notification sent at the reset. */
export function resetNoticeCopy(voting) {
  const mine = (voting?.battle?.teams || []).find((t) => t.id === voting?.battle?.myTeam)
  return {
    title: 'MAMA votes have reset 💜',
    body: `New day, new votes. Vote for BTS on Mnet and X, then upload ${mine ? `for ${mine.label}` : 'your proof'}.`,
  }
}

/** Pure: the words, with the live score when there is one. */
export function mamaTeamPopupCopy(voting, invite = null, kind = 'team', now = new Date()) {
  const teams = voting?.battle?.teams || []
  const pair = teams.length === 2 ? teams : []
  const versus = pair.length ? `${pair[0].label} vs ${pair[1].label}. ` : ''
  const live = voting?.phase === 'open'
  const eyebrow = `${voting?.title || 'MAMA 2026'} · ${voting?.roundLabel || 'Battle'}`
  if (kind === 'closing') {
    const mine = teams.find((t) => t.id === voting.battle.myTeam)
    const left = msToDeadline(voting, now)
    const last = !nextResetAt(voting, now)
    // No "Later" on this one: the only way forward is the upload.
    return {
      eyebrow,
      title: `${last ? 'Voting closes' : 'Votes reset'} in ${leftLabel(left ?? 0)}`,
      body: `You haven't uploaded a vote today. Vote for BTS on Mnet, then upload your certificate before ${last ? 'voting closes' : '00:00 KST'}, or today's vote for ${mine?.label || 'your team'} is lost.`,
      teams: pair,
      action: 'Upload my vote now',
    }
  }
  if (kind === 'live') {
    const mine = teams.find((t) => t.id === voting.battle.myTeam)
    const day = roundDay(voting, now)
    return {
      eyebrow,
      // Opening day announces the battle; every day after, the reset.
      title: day > 1 ? 'Votes have reset!' : 'The MAMA Battle is LIVE',
      body: `${day > 1 ? `Day ${day} of the MAMA Battle. ` : ''}${versus}Vote for BTS on Mnet and X${day > 1 ? ' again' : ''}, then upload your proof. Every verified vote scores for ${mine?.label || 'your team'}.`,
      teams: pair,
      action: 'Upload now',
      later: 'Later',
    }
  }
  const invited = teams.find((t) => t.id === invite)
  return {
    eyebrow,
    title: invited ? `${invited.label} want you` : live ? 'The MAMA Battle is LIVE' : 'The battle is back',
    body: live
      ? `${versus}Pick your side, vote for BTS on Mnet and X, then upload your proof. Every verified vote scores for your team.`
      : 'Round 2 of Fans’ Choice is coming, the Daesang (VISA Fans’ Choice of the Year) included, and every vote resets to zero. Pick your side before it opens — each verified vote adds a point for your team.',
    teams: pair,
    action: 'Choose my team',
    later: 'Not now',
  }
}
