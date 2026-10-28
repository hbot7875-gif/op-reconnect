// Pure rules for mama-team-popup.js (testable in Node).

const SEEN_KEY = 'rc_seen_mama_team_popup:'

const kstDay = (now) => new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10)

/** Pure: which popup is due now, if any. `voting` is state.voting (getVotingBanner).
 *  'team' — no team yet, while voting is open or the battle recruits before it.
 *  'live' — on a team, voting is open, and today's votes aren't all in yet.
 *  Each shows once per KST day, and the promo, open-voting and live popups
 *  are seen separately, so opening day still announces the live battle. */
export function mamaPopupKind(voting, { agentNo, now = new Date(), storage, screen } = {}) {
  if (!agentNo || !voting || (voting.phase !== 'open' && voting.phase !== 'soon')) return null
  if (!voting.battle) return null
  if (screen === 'voting') return null // already where the popup would send them
  let kind = null
  if (!voting.battle.myTeam) kind = 'team'
  else if (voting.phase === 'open' && !(voting.total > 0 && voting.done >= voting.total)) kind = 'live'
  if (!kind) return null
  try { return storage.getItem(seenKey(agentNo, voting, kind, now)) !== '1' ? kind : null } catch (_) { return null }
}

/** Is the team choice due? (The older question, still asked by tests.) */
export const mamaTeamPopupDue = (voting, opts) => mamaPopupKind(voting, opts) === 'team'

const seenKey = (agentNo, voting, kind, now) =>
  `${SEEN_KEY}${agentNo}:${voting.campaignId}:${kstDay(now)}${kind === 'live' ? ':live' : voting.phase === 'open' ? ':open' : ''}`

export function markMamaTeamPopupSeen(storage, agentNo, voting, kind = 'team', now = new Date()) {
  try { storage.setItem(seenKey(agentNo, voting, kind, now), '1') } catch (_) {}
}

/** Pure: the words, with the live score when there is one. */
export function mamaTeamPopupCopy(voting, invite = null, kind = 'team') {
  const teams = voting?.battle?.teams || []
  const pair = teams.length === 2 ? teams : []
  const versus = pair.length ? `${pair[0].label} vs ${pair[1].label}. ` : ''
  const live = voting?.phase === 'open'
  const eyebrow = `${voting?.title || 'MAMA 2026'} · ${voting?.roundLabel || 'Battle'}`
  if (kind === 'live') {
    const mine = teams.find((t) => t.id === voting.battle.myTeam)
    return {
      eyebrow,
      title: 'The MAMA Battle is LIVE',
      body: `${versus}Vote for BTS on Mnet and X, then upload your proof. Every verified vote scores for ${mine?.label || 'your team'}.`,
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
