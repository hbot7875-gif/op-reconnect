// Pure rules for mama-team-popup.js (testable in Node).

const SEEN_KEY = 'rc_seen_mama_team_popup:'

const kstDay = (now) => new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10)

/** Pure: should the popup show now? `voting` is state.voting (getVotingBanner). */
export function mamaTeamPopupDue(voting, { agentNo, now = new Date(), storage, screen } = {}) {
  if (!agentNo || !voting || voting.phase !== 'open') return false
  if (!voting.battle || voting.battle.myTeam) return false
  if (screen === 'voting') return false // the chooser is already on its way there
  try { return storage.getItem(`${SEEN_KEY}${agentNo}:${voting.campaignId}:${kstDay(now)}`) !== '1' } catch (_) { return false }
}

export function markMamaTeamPopupSeen(storage, agentNo, campaignId, now = new Date()) {
  try { storage.setItem(`${SEEN_KEY}${agentNo}:${campaignId}:${kstDay(now)}`, '1') } catch (_) {}
}

/** Pure: the words, with the live score when there is one. */
export function mamaTeamPopupCopy(voting) {
  const teams = voting?.battle?.teams || []
  const score = teams.length === 2 ? `${teams[0].label} ${teams[0].points} · ${teams[1].label} ${teams[1].points}` : null
  return {
    eyebrow: `${voting?.title || 'MAMA 2026'} · Battle`,
    title: 'Pick your side',
    body: `${teams.map((t) => t.label).join(' vs ') || 'Two teams'} are battling with every verified vote. Choose your team so your votes count for your side.`,
    score,
    action: 'Choose my team',
  }
}
