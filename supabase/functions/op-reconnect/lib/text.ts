// Text normalization — verbatim copies from arirang-btsbackend/index.ts
// (normalizeKey/stripVersionSuffix ~L1193, isAdScrobble ~L1232) so the game
// matches scrobbles exactly the way the rest of the platform does.

export function normalizeKey(s: string): string {
  if (!s) return ''
  return String(s)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')   // combining diacritics
    .toLowerCase()
    .replace(/[''`’‘´]/g, '')          // apostrophes / backticks / smart quotes
    .replace(/[:~–—\-]/g, ' ')         // dashes / colons → space
    .replace(/[^\p{L}\p{N}\s]/gu, '')  // keep all letters/numbers (Hangul included)
    .replace(/\s+/g, ' ')
    .trim()
}

// "NORMAL (Clean Ver.)" → "NORMAL"; applies repeatedly for stacked suffixes.
export function stripVersionSuffix(s: string): string {
  if (!s) return s
  let result = s.trim()
  let prev = ''
  while (prev !== result) {
    prev = result
    result = result.replace(/\s*[\(\[（【][^\)\]）】]*[\)\]）】]\s*$/, '').trim()
  }
  return result
}

/** Canonical bucket key for a raw track name. */
export function normKeyFull(s: string): string {
  return normalizeKey(stripVersionSuffix(s))
}

/** Spotify free-tier ad fingerprint — never store or count these. */
export function isAdScrobble(trackName: string | null | undefined, artistName: string | null | undefined): boolean {
  const t = (trackName || '').trim().toLowerCase()
  const a = (artistName || '').trim().toLowerCase()
  if (t === 'advertisement' || t === 'spotify' || t === 'spotify ad') return true
  if (a === 'open.spotify.com' || a === 'spotify.com') return true
  return false
}

/** Word-boundary-safe allowlist check ("v" must not match "vantae"). */
export function artistAllowed(artistNorm: string, allowlist: string[]): boolean {
  if (!artistNorm) return true // stats.fm rows carry no artist — trust linked sources
  const padded = ` ${artistNorm} `
  return allowlist.some((entry) => padded.includes(` ${entry} `))
}
