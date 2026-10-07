// Song-name normalization for the client, mirroring the backend's text.ts
// (normalizeKey / stripVersionSuffix / normKeyFull) exactly.
//
// Why a copy and not an import: text.ts lives in supabase/functions and is
// Deno/TypeScript, so the Vite bundle cannot reach it. The pair is kept honest
// by song-key-rules.test.mjs, which runs the SAME corpus through both this
// module and the real text.ts and fails if they ever disagree.
//
// What this is for: a district goal's label and the song catalog's name for the
// same song are frequently not the same string. Measured across every active
// district on 2026-10-07, of 106 goal slots only 54 matched the catalog by
// exact name; 26 more matched once normalized. The differences are mundane and
// all of one family -- a version suffix, a featured-artist credit, a curly
// apostrophe instead of an ASCII one:
//
//   goal "Killin' It Girl"            catalog "Killin' It Girl (Solo Version)"
//   goal "Wild Flower"                catalog "Wild Flower (with 조유진)"
//   goal "they don't know 'bout us"   catalog "they don’t know ’bout us"
//   goal "Don't Say You Love Me"      catalog "Don’t Say You Love Me"
//   goal "STOP (Lollapalooza ver.)"   catalog "STOP"
//
// Both sides describe one song, so both should resolve to one key.

/** Strip diacritics, apostrophes and punctuation; fold dashes to spaces. */
export function normalizeKey(s) {
  if (!s) return ''
  return String(s)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')    // combining diacritics
    .toLowerCase()
    .replace(/['''`’‘´]/g, '')          // apostrophes / backticks / smart quotes
    .replace(/[:~–—\-]/g, ' ')          // dashes / colons -> space
    .replace(/[^\p{L}\p{N}\s]/gu, '')   // keep all letters/numbers (Hangul included)
    .replace(/\s+/g, ' ')
    .trim()
}

/** "NORMAL (Clean Ver.)" -> "NORMAL"; applies repeatedly for stacked suffixes. */
export function stripVersionSuffix(s) {
  if (!s) return s
  let result = String(s).trim()
  let prev = ''
  while (prev !== result) {
    prev = result
    result = result.replace(/\s*[([（【][^)\]）】]*[)\]）】]\s*$/, '').trim()
  }
  return result
}

/** Canonical bucket key for a raw track name. */
export function normKeyFull(s) {
  return normalizeKey(stripVersionSuffix(s))
}

/**
 * Pick the one catalog entry that best represents a normalized key.
 *
 * Several catalog names can share a key -- a base track and its remixes, a solo
 * version, a live cut. A district goal means one song, so a representative has
 * to be chosen rather than the whole group dropped, which is what used to
 * happen. The shortest title is the plainest one ("STOP" over "STOP
 * (Lollapalooza ver.)"), with the alphabetical name as a tiebreak so the
 * choice is stable across reloads instead of following catalog order.
 */
export function pickCanonicalSong(songs) {
  if (!Array.isArray(songs) || !songs.length) return null
  return songs.slice().sort((a, b) => {
    const an = String(a?.name || ''), bn = String(b?.name || '')
    return an.length - bn.length || an.localeCompare(bn)
  })[0]
}

/**
 * Resolve a district goal's label to a catalog song.
 *
 * Deliberately separate from the Custom tab's typed-input resolver. That one
 * refuses an ambiguous bare name on purpose, so that typing "Wild Flower" can
 * never silently pick a remix the player did not mean. A goal label is not
 * typed by anyone -- it is the district's own target -- so here the right
 * behaviour is the opposite: always land on a song, and pick deterministically
 * when the catalog offers several spellings of it.
 *
 * @param label       the goal's label
 * @param byExact     name (lowercased) -> song, for unambiguous exact names
 * @param byNormKey   normKeyFull(name) -> song[] for every catalog entry
 */
export function resolveGoalSong(label, byExact, byNormKey) {
  const typed = String(label || '').trim()
  if (!typed) return null
  const exact = byExact?.[typed.toLowerCase()]
  if (exact) return exact
  const group = byNormKey?.[normKeyFull(typed)]
  return pickCanonicalSong(group)
}
