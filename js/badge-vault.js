// DOM-free Badge Vault helpers. The page imports these directly and the Node
// tests exercise the exact filtering/coverage/escaping rules makers use.

export function escapeBadgeText(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char])
}
export function preferredPoolForRarity(rarity) {
  return rarity === 'rare' ? 'hot' : 'cute'
}

export function badgeArtMatches(art, filters, templateById) {
  const template = templateById.get(art.templateId)
  if (filters.style === 'untagged' && (art.pool === 'cute' || art.pool === 'hot')) return false
  if (filters.style && filters.style !== 'untagged' && art.pool !== filters.style) return false
  if (filters.templateId && art.templateId !== filters.templateId) return false
  if (filters.member && art.member !== filters.member) return false
  if (filters.uploader && art.uploadedBy !== filters.uploader) return false
  if (filters.status === 'active' && !art.active) return false
  if (filters.status === 'inactive' && art.active) return false
  if (filters.rarity && template?.rarity !== filters.rarity) return false
  return true
}

export function badgeCoverage(templates, art) {
  return templates.filter((template) => template.active !== false).map((template) => {
    const rows = art.filter((item) => item.templateId === template.id && item.active)
    const preferredPool = preferredPoolForRarity(template.rarity)
    return {
      id: template.id,
      name: template.name,
      rarity: template.rarity,
      active: rows.length,
      preferredPool,
      preferred: rows.filter((item) => item.pool === preferredPool).length,
    }
  })
}
