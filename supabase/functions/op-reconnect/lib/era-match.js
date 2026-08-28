/**
 * Allocate normalized play buckets to Era Card tracks without letting the
 * same play satisfy two catalog entries. This matters for services such as
 * Apple Music/Musicat which can report a Japanese re-recording under the
 * same bare English title as the original recording.
 *
 * Each entry is `{ id, canonicalKey, keys }`; `totals` is a Map of normalized
 * title key -> counted plays. The returned Map contains how many plays were
 * assigned to each catalog entry, capped at `threshold`.
 *
 * Allocation order is deliberate:
 *  1. keys used by only one catalog entry (an explicit Japanese title wins),
 *  2. canonical keys (the original recording gets the first ambiguous play),
 *  3. remaining aliases (a second bare play can then satisfy the localized
 *     Japanese entry).
 *
 * @param {{id:string, canonicalKey:string, keys:string[]}[]} entries
 * @param {Map<string, number>} totals
 * @param {number} threshold
 * @returns {Map<string, number>}
 */
export function allocateTrackHits(entries, totals, threshold = 1) {
  const need = Math.max(1, Math.floor(Number(threshold) || 1))
  const remaining = new Map()
  for (const [key, value] of totals || []) {
    const count = Math.max(0, Math.floor(Number(value) || 0))
    if (key && count) remaining.set(key, count)
  }

  const normalized = entries.map((entry) => ({
    id: entry.id,
    canonicalKey: entry.canonicalKey,
    keys: [...new Set((entry.keys || []).filter(Boolean))],
  }))
  const keyUsers = new Map()
  for (const entry of normalized) {
    for (const key of entry.keys) {
      if (!keyUsers.has(key)) keyUsers.set(key, new Set())
      keyUsers.get(key).add(entry.id)
    }
  }

  const assigned = new Map(normalized.map((entry) => [entry.id, 0]))
  const consume = (entry, key) => {
    const short = need - (assigned.get(entry.id) || 0)
    const available = remaining.get(key) || 0
    if (short <= 0 || available <= 0) return
    const used = Math.min(short, available)
    assigned.set(entry.id, (assigned.get(entry.id) || 0) + used)
    if (used === available) remaining.delete(key)
    else remaining.set(key, available - used)
  }

  // Explicit/unambiguous spellings first, including Japanese titles that
  // retain their version suffix or native/romanized subtitle.
  for (const entry of normalized) {
    for (const key of entry.keys) {
      if ((keyUsers.get(key)?.size || 0) === 1) consume(entry, key)
    }
  }

  // If a provider collapsed both recordings to the same title, reserve the
  // first play for the catalog entry whose real canonical title it is.
  for (const entry of normalized) consume(entry, entry.canonicalKey)

  // Additional ambiguous plays may now fill aliased/localized versions.
  for (const entry of normalized) {
    for (const key of entry.keys) consume(entry, key)
  }

  return assigned
}
