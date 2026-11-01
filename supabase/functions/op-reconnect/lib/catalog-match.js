/**
 * Title checks for linking catalog songs to Spotify tracks.
 *
 * The resolver searched Spotify for "<song> <artist>" and took the first BTS
 * result, so "RUN" + "BTS" became the query "RUN BTS" and was linked to the
 * song Run BTS; Like and Her were linked to Dimple, Go Go to Anpanman, and so
 * on. Playlists then alternated the wrong song as a "version" (AGENT061,
 * 2026-10-31). A result now has to carry the same title.
 */

/** Case, accents, punctuation and "feat."/"ft." spelling don't matter;
 *  anything else in the title — "(feat. Nicki Minaj)", "- Japanese ver." —
 *  does, so a different recording never passes for the original. */
export function catalogTitleKey(title) {
  return String(title || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/\b(feat|ft|featuring)\b\.?/g, 'feat')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function sameCatalogTitle(a, b) {
  const ka = catalogTitleKey(a)
  return ka !== '' && ka === catalogTitleKey(b)
}

/** The first search result that is a BTS track with the song's own title. */
export function pickTitleMatch(items, songName, isBTSArtists) {
  return (items || []).find((it) => isBTSArtists(it.artists || []) && sameCatalogTitle(it.name, songName)) || null
}

/** Titles every Spotify track id is stored under, across all uri entries. */
export function trackTitleOwners(uriMap) {
  const owners = new Map()
  const add = (id, name) => {
    if (!id || !name) return
    if (!owners.has(id)) owners.set(id, new Set())
    owners.get(id).add(catalogTitleKey(name))
  }
  for (const r of Object.values(uriMap || {})) {
    if (!r || !r.uri) continue
    add(r.id, r.name)
    for (const v of r.versions || []) add(v.id, r.name)
  }
  return owners
}

/** True when this track is also stored under a different title, i.e. the
 *  entry may be a wrong link and must not be merged into a song by name. */
export function trackClaimedByOtherTitle(owners, id, name) {
  const titles = owners.get(id)
  if (!titles) return false
  const own = catalogTitleKey(name)
  return [...titles].some((t) => t !== own)
}
