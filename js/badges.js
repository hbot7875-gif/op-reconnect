// Only the new photo-based Badge Collection counts as a badge in ReConnect.
// The earlier fire/star/XP/district emoji achievements are intentionally kept
// out of the Drawer, HUD count and profile-icon resolver. Their historical DB
// rows can remain as harmless audit history without showing up to players.
const COLLECTION_TEMPLATES = new Set([
  'district_frag_1', 'district_frag_2', 'district_frag_3',
  'district_restored', 'ward', 'mission_bond',
  'event_vma_voter', 'event_vma_power_hour', 'event_vma_double_day',
  'event_vma_supply_chest',
  // Awarded by the same rc_award_badge() every other collection badge
  // goes through (rc_claim_birthday_era), just missing from this
  // allow-list — meaning completing the GOLDEN card never triggered the
  // usual unlock reveal or counted toward the Drawer/Pack badge count.
  'event_jk_birthday_2026',
  // The rarer badge's city-wide companion — any Defender (1+ GOLDEN play),
  // awarded once the whole City finishes the room, not personal completion.
  'event_jk_golden_defender_2026',
])

export const BADGE_CATALOG = []

export function badgeById(id) {
  return null
}

export function collectionBadgeIds(state) {
  return [...new Set((state?.player?.badges || []).filter((badgeId) => {
    const templateId = String(badgeId).split(':', 1)[0]
    return COLLECTION_TEMPLATES.has(templateId)
  }))]
}

export function earnedBadgeCount(state) {
  return collectionBadgeIds(state).length
}

export function equippedBadge(state) {
  return null
}
