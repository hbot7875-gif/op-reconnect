/**
 * Pure OCR helpers shared by the browser scanner and the Edge Function.
 * Kept free of DOM/Deno imports so Node can regression-test the exact logic
 * both runtimes use.
 */

export function compactOcr(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function confusionKey(value) {
  return compactOcr(value)
    .replace(/o/g, '0')
    .replace(/[il]/g, '1')
    .replace(/s/g, '5')
    .replace(/b/g, '8')
    .replace(/g/g, '6')
}

function editDistanceAtMost(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return false
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    let rowMin = next[0]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
      rowMin = Math.min(rowMin, next[j])
    }
    if (rowMin > limit) return false
    prev = next
  }
  return prev[b.length] <= limit
}

/** Match short, stylized proof words without making the whole OCR decision
 * fuzzy. Tesseract often reads BTS as 8TS/B1S and SWIM as SWlM when those
 * labels sit over a photo. Visual-confusion matching plus one edit is safe
 * here because the expected words are fixed by the event configuration and
 * the watermark + vote counter must still pass independently. */
export function proofKeywordMatches(text, keyword) {
  const expected = compactOcr(keyword)
  if (!expected) return false

  const normalized = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  if (normalized.includes(String(keyword || '').toLowerCase().trim())) return true

  const expectedKey = confusionKey(expected)
  const tokens = normalized.split(/\s+/).filter(Boolean)
  for (const token of tokens) {
    const tokenKey = confusionKey(token)
    if (tokenKey === expectedKey) return true
    if (expectedKey.length >= 3 && expectedKey.length <= 5 && editDistanceAtMost(tokenKey, expectedKey, 1)) return true
  }

  // Multi-word configured keywords can be broken across OCR lines. Their
  // compact visual form still has to appear in full; no edit-distance
  // widening is used for longer phrases.
  return confusionKey(compactOcr(text)).includes(expectedKey)
}

/**
 * Tesseract commonly swaps O/0, I/L/1, S/5, B/8 and G/6 in short markup
 * text. Accept those visual equivalents plus one genuine OCR edit, while
 * still requiring a near-complete match to today's full code.
 */
export function watermarkMatches(text, expectedCode) {
  const expected = compactOcr(expectedCode)
  const observed = compactOcr(text)
  if (!expected || !observed) return false
  if (observed.includes(expected)) return true

  const expectedKey = confusionKey(expected)
  const observedKey = confusionKey(observed)
  if (observedKey.includes(expectedKey)) return true

  // The real YOONGI19 screenshot's raw sparse-text pass returned ONGI19:
  // an otherwise-perfect suffix with its first two letters dropped. For an
  // 8+ character daily code, six matching characters is still specific
  // enough when combined with the artist, song and vote-total checks;
  // shorter codes keep the stricter one-edit allowance.
  const limit = expectedKey.length >= 8 ? 2 : 1
  const minLength = Math.max(4, expectedKey.length - limit)
  const maxLength = expectedKey.length + limit
  for (let length = minLength; length <= maxLength; length++) {
    for (let start = 0; start + length <= observedKey.length; start++) {
      if (editDistanceAtMost(observedKey.slice(start, start + length), expectedKey, limit)) return true
    }
  }
  return false
}

/** The page can show several nominee counters (often 0 and the BTS total).
 * Pick the highest positive "N Votes" value instead of whichever OCR emits
 * first, which is frequently the nominee above BTS on the mobile page. */
export function extractVoteTotal(text, allowedTotals = null) {
  const norm = String(text || '').toLowerCase().replace(/\s+/g, ' ')
  const allowed = Array.isArray(allowedTotals) && allowedTotals.length
    ? new Set(allowedTotals.map(Number).filter((n) => Number.isInteger(n) && n > 0))
    : null
  const totals = []
  const add = (raw) => {
    const value = Number(raw)
    if (Number.isInteger(value) && value > 0 && value <= 10000 && (!allowed || allowed.has(value))) totals.push(value)
  }
  for (const match of norm.matchAll(/(\d{1,4})[^a-z0-9]{0,24}votes?\b/g)) {
    add(match[1])
  }
  // Cropped OCR occasionally emits the counter below the word instead of
  // above it. Accept the reverse ordering, but still require the number to
  // be close to "Votes" so phone time/battery digits cannot become credit.
  for (const match of norm.matchAll(/votes?\b[^a-z0-9]{0,24}(\d{1,4})/g)) {
    add(match[1])
  }
  return totals.length ? Math.max(...totals) : null
}

/** The configured daily cap is also the only valid completed per-account
 * proof total: 10 on normal days, 20 on Double Days. Keeping this helper
 * pure lets browser and backend apply the same rule. */
export function validVoteTotals(dailyCap) {
  const cap = Math.floor(Number(dailyCap))
  return cap > 0 ? [cap] : []
}

/** One shared auto-approval decision for the browser and Edge Function.
 * The stylized VMA logo and category heading are not reliably present in a
 * mobile screenshot, so the proof-bearing fields are the configured song,
 * the day's valid vote counter and today's watermark code. */
export function evaluateVoteProof(text, {
  expectedCode = '', songKeywords = [], displayedTotal = null, allowedVoteTotals = null,
} = {}) {
  const ocrTotal = extractVoteTotal(text, allowedVoteTotals)
  const hasBts = proofKeywordMatches(text, 'bts')
  const hasSong = songKeywords.length === 0 || songKeywords.some((keyword) => proofKeywordMatches(text, keyword))
  const voteTotalOk = ocrTotal != null && (displayedTotal == null || ocrTotal === displayedTotal)
  const watermarkOk = watermarkMatches(text, expectedCode)
  // When a mission config names the exact song, that song is the stronger
  // identity proof. Requiring both SWIM and BTS made one piece of information
  // block the same fact twice and caused the live false-review backlog.
  const identityOk = songKeywords.length > 0 ? hasSong : hasBts

  // Automatic credit must come from the screenshot, not from a claimed
  // amount. The OCR total therefore has to be one of today's allowed totals
  // (10 normally, 20 on boosted days). If OCR cannot confirm it, the proof
  // remains pending for the admin to inspect rather than receiving credit.
  return {
    passed: identityOk && voteTotalOk && watermarkOk,
    hasBts,
    hasSong,
    voteTotalOk,
    watermarkOk,
    displayedTotal: ocrTotal,
  }
}
