// Pure Badge Vault rules shared by the Deno handler and Node tests.
// Keeping identity/ownership decisions here makes it much harder for the
// browser labels and the server permission check to drift apart.

export const BADGE_MEMBERS = Object.freeze([
  'BTS', 'RM', 'Jin', 'SUGA', 'j-hope', 'Jimin', 'V', 'Jung Kook',
])

const MEMBER_BY_KEY = new Map(BADGE_MEMBERS.map((member) => [member.toLowerCase(), member]))
const BADGE_POOLS = new Set(['cute', 'hot'])

export function canonicalBadgeMember(value) {
  return MEMBER_BY_KEY.get(String(value || '').trim().toLowerCase()) || null
}
export function canonicalBadgePool(value) {
  const pool = String(value || '').trim().toLowerCase()
  return BADGE_POOLS.has(pool) ? pool : null
}

export function canManageBadgeArt(agentNo, uploadedBy) {
  const viewer = String(agentNo || '').trim().toUpperCase()
  const owner = String(uploadedBy || '').trim().toUpperCase()
  return viewer === 'AGENT000' || (!!viewer && !!owner && viewer === owner)
}
