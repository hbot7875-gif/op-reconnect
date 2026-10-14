// Custom team lines on the MAMA Battle share poster — the safety check.
//
// Players can swap "Watch this." / "Yeah, we aliens." for their own short
// line. It lives only in the open share sheet (never sent, never stored) but
// it lands on a HopeTrackers-branded image, so it must not carry links,
// @handles or hashtags, slurs or hate, explicit sexual content, serious
// threats against people, or text that pretends to come from BTS, HYBE, Mnet
// or HopeTrackers. Playful battle banter ("aliens are trash", "ride or die",
// "we're killing it") is fine.
//
// This is a deliberately basic, local filter: it catches the obvious cases
// (including common l33t spellings and stretched letters), not every one.

export const LYRIC_MAX = 40

export const LYRIC_ERRORS = {
  too_long: `${LYRIC_MAX} characters max.`,
  link: 'Links, @handles and hashtags can’t go on the poster.',
  blocked: 'That line can’t go on a HopeTrackers poster.',
  impersonation: 'Lines can’t sound like they’re from BTS, HYBE, Mnet or HopeTrackers.',
}

/** One line of plain text: no line breaks, control or zero-width characters. */
export function cleanLyric(raw) {
  return String(raw ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\s?\.\s?(com|net|org|io|me|co|ly|gg|tv|app|xyz|kr|in|link|site|info|shop|club|live)\b)/i
const HANDLE_OR_TAG = /[@#＠＃]/

// l33t and stretched spellings → plain letters, for word matching.
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't' }
const plain = (s) => s.toLowerCase().replace(/[013457@$!|+8]/g, (c) => LEET[c] || c).replace(/(.)\1{2,}/g, '$1$1')
const squash = (s) => plain(s).replace(/[^a-z]/g, '')
const words = (s) => plain(s).split(/[^a-z']+/).filter(Boolean)

// Slurs, hate and explicit sexual stems that are never innocent inside other
// words (matched in the squashed text, so spacing and l33t don't hide them).
const STEMS = ['nigg', 'nigr', 'fagg', 'kike', 'chink', 'tranny', 'retard', 'wetback', 'nazi', 'hitler', 'porn', 'molest', 'whore', 'slut', 'pussy']
// Whole words only (they hide inside harmless words otherwise).
const WORDS = new Set([
  'fag', 'spic', 'gook', 'coon', 'dyke', 'heil', 'kkk',
  'cock', 'dick', 'tits', 'boobs', 'cum', 'sex', 'sexting', 'nude', 'nudes', 'nsfw', 'horny', 'rape', 'raped', 'rapist', 'pedo', 'pedophile',
])
// Serious threats aimed at people — not "killing it", "ride or die" or the ARMY bomb.
const THREATS = [
  /\b(kill|murder|stab|shoot|behead|lynch|hang|bomb)\s+(you|u|ya|them|him|her|they|em|aliens|hooligans|everyone|yourself|urself)\b/,
  /\b(you|u|ya|them|him|her|they|em|aliens|hooligans|everyone)\s+(should|will|gonna|must|better|deserve to)\s+die\b/,
  /\b(kys|kms)\b/, /\bgo (die|kill yourself)\b/, /\bdie in a\b/, /\bdeath to\b/, /\bi('ll| will) (find|hurt|kill)\b/,
]
// Masked slur spellings ("n*gg…"): symbols standing in for letters.
const MASKED = [/n\W*[i1*!]\W*g\W*g/, /f\W*[a@*4]\W*g\W*g/]
const IMPERSONATION = [
  /\b(official|verified|announcement|admin|staff|moderator)\b/,
  /\b(big ?hit|hybe|mnet|cj ?enm|weverse|hope ?trackers?)\b/,
  /\b(i am|i'm|im|this is|from|signed|love,?|xoxo,?)\s+(bts|bangtan|rm|namjoon|jin|seokjin|suga|yoongi|j-?hope|hoseok|jimin|v|taehyung|jung ?kook|jk)\b/,
  /\b(bts|bangtan|rm|jin|suga|j-?hope|jimin|taehyung|jung ?kook) (here|says|said|speaking)\b/,
]

/**
 * → { ok: true, value } with the cleaned line, or { ok: false, reason }.
 * An empty line is ok and means "use the default".
 */
export function checkLyric(raw) {
  const value = cleanLyric(raw)
  if (!value) return { ok: true, value: '' }
  if ([...value].length > LYRIC_MAX) return { ok: false, reason: 'too_long' }
  if (HANDLE_OR_TAG.test(value) || LINK.test(value)) return { ok: false, reason: 'link' }
  const flat = squash(value)
  const flat1 = flat.replace(/(.)\1+/g, '$1') // "fuuuck" → "fuck"
  const lower = plain(value)
  if (STEMS.some((s) => flat.includes(s) || flat1.includes(s)) || words(value).some((w) => WORDS.has(w))
    || MASKED.some((re) => re.test(value.toLowerCase())) || THREATS.some((re) => re.test(lower)))
    return { ok: false, reason: 'blocked' }
  if (IMPERSONATION.some((re) => re.test(lower))) return { ok: false, reason: 'impersonation' }
  return { ok: true, value }
}
