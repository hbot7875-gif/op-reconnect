// Pure Badge Vault rules shared by the Deno handler and Node tests.
// Keeping identity/ownership decisions here makes it much harder for the
// browser labels and the server permission check to drift apart.

export const BADGE_MEMBERS = Object.freeze([
  'BTS', 'RM', 'Jin', 'SUGA', 'j-hope', 'Jimin', 'V', 'Jung Kook',
])

const SOLO_MEMBERS = BADGE_MEMBERS.filter((member) => member !== 'BTS')
const MEMBER_BY_KEY = new Map([
  ...BADGE_MEMBERS.map((member) => [member.toLowerCase(), member]),
  ['namjoon', 'RM'], ['seokjin', 'Jin'], ['yoongi', 'SUGA'],
  ['jhope', 'j-hope'], ['hoseok', 'j-hope'], ['taehyung', 'V'],
  ['jungkook', 'Jung Kook'],
])
const BADGE_POOLS = new Set(['cute', 'hot'])

export function canonicalBadgeMember(value) {
  return MEMBER_BY_KEY.get(String(value || '').trim().toLowerCase()) || null
}

/** Canonical subjects for one photo. BTS is the explicit full-group value;
 * individual chips can be combined for duos/sub-units. A mixed BTS + member
 * payload is rejected instead of silently guessing what the maker meant. */
export function canonicalBadgeMembers(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || '').split(/\s*(?:\+|,)\s*/).filter(Boolean)
  const canonical = source.map(canonicalBadgeMember)
  if (!canonical.length || canonical.some((member) => !member)) return null

  const unique = [...new Set(canonical)]
  if (unique.includes('BTS')) return unique.length === 1 ? ['BTS'] : null
  const ordered = SOLO_MEMBERS.filter((member) => unique.includes(member))
  return ordered.length === SOLO_MEMBERS.length ? ['BTS'] : ordered
}

export function badgeMembersLabel(members) {
  const canonical = canonicalBadgeMembers(members)
  return canonical?.join(' + ') || ''
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
