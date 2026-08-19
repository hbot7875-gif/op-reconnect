// Only the new photo-based Badge Collection counts as a badge in ReConnect.
// The earlier fire/star/XP/district emoji achievements are intentionally kept
// out of the Drawer, HUD count and profile-icon resolver. Their historical DB
// rows can remain as harmless audit history without showing up to players.
const COLLECTION_TEMPLATES = new Set([
  'district_frag_1', 'district_frag_2', 'district_frag_3',
  'district_restored', 'ward', 'mission_bond', 'quiz_perfect',
  'event_vma_voter', 'event_vma_power_hour', 'event_vma_double_day',
  'event_vma_supply_chest',
])

export const BADGE_CATALOG = []

export function badgeById(id) {
  return null
}

export function earnedBadgeCount(state) {
  return new Set((state?.player?.badges || []).filter((badgeId) => {
    const templateId = String(badgeId).split(':', 1)[0]
    return COLLECTION_TEMPLATES.has(templateId)
  })).size
}

export function equippedBadge(state) {
  return null
}
