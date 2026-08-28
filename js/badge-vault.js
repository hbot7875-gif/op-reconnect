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

export function artMembers(art) {
  if (Array.isArray(art?.members) && art.members.length) return [...new Set(art.members)]
  return String(art?.member || '').split(/\s*(?:\+|,)\s*/).filter(Boolean)
}

export function duplicateBadgeArt(art, imageHash, templateId) {
  if (!imageHash) return null
  return art.find((item) => item.imageHash === imageHash && item.templateId === templateId) || null
}

export function imageQuality(width, height) {
  const shortest = Math.min(Number(width) || 0, Number(height) || 0)
  if (shortest < 512) return { level: 'bad', message: 'This photo may look blurry. Choose one at least 512 px wide and tall.' }
  if (shortest < 900) return { level: 'warn', message: 'Usable, but a 900 px or larger photo will look sharper.' }
  return { level: 'good', message: 'Good quality for every badge size.' }
}

export function badgeArtMatches(art, filters, templateById) {
  const template = templateById.get(art.templateId)
  if (filters.style === 'untagged' && (art.pool === 'cute' || art.pool === 'hot')) return false
  if (filters.style && filters.style !== 'untagged' && art.pool !== filters.style) return false
  if (filters.templateId && art.templateId !== filters.templateId) return false
  if (filters.member && !artMembers(art).includes(filters.member)) return false
  if (filters.uploader && art.uploadedBy !== filters.uploader) return false
  if (filters.mine && art.uploadedBy !== filters.viewer) return false
  if (filters.activeOnly && !art.active) return false
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
