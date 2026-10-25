// The Album: 15 BTS album covers, collected one at a time.
//
// Each RUN AMI card face carries one era's artwork (js/run-ami-art.js
// ERA_OF), and those 15 eras are the album. A cover is the era, not a card:
// a Red 6 and a Blue 6 are both the PERSONA cover. Owning all 15 unlocks
// RUN AMI (run-ami.ts's allowAgent), alongside the closed-test list.
//
// How covers arrive (album-service.js):
//   goal — the first time each KST day an agent finishes the daily Signal
//          Sweep, one cover they don't have yet. Never a duplicate.
//   gift — another agent shares a copy of a cover they own. The giver keeps
//          theirs. One sent and one received per agent per KST day, only
//          to an agent missing that cover, and only from an account at least
//          ALBUM_GIFT_MIN_DAYS old (so new accounts can't feed a main one).
//
// Shared by the server and the browser; the SQL migration repeats the era
// ids in its check constraint and pick order (album-sql.test.mjs keeps the
// two lists identical).

/** Release order. `k` is the card value that carries the era's artwork. */
export const ALBUM_ERAS = Object.freeze([
  { id: 'dw', name: 'Dark & Wild', k: 'skip' },
  { id: 'hyyh', name: 'HYYH', k: 'd2' },
  { id: 'yf', name: 'Young Forever', k: '0' },
  { id: 'wings', name: 'WINGS', k: '1' },
  { id: 'ynwa', name: 'You Never Walk Alone', k: '2' },
  { id: 'her', name: 'Love Yourself: Her', k: '3' },
  { id: 'tear', name: 'Love Yourself: Tear', k: '4' },
  { id: 'answer', name: 'Love Yourself: Answer', k: '5' },
  { id: 'persona', name: 'Map of the Soul: Persona', k: '6' },
  { id: 'mots7', name: 'Map of the Soul: 7', k: '7' },
  { id: 'be', name: 'BE', k: '8' },
  { id: 'ptd', name: 'Permission to Dance', k: 'wild' },
  { id: 'proof', name: 'Proof', k: '9' },
  { id: 'arirang', name: 'ARIRANG', k: 'wd4' },
  { id: 'swim', name: 'SWIM', k: 'rev' },
].map((e) => Object.freeze(e)))

export const ALBUM_SIZE = ALBUM_ERAS.length
export const ALBUM_ERA_IDS = Object.freeze(ALBUM_ERAS.map((e) => e.id))
export const ALBUM_GIFT_MIN_DAYS = 3

export const isAlbumEra = (id) => ALBUM_ERA_IDS.includes(id)
export const albumEra = (id) => ALBUM_ERAS.find((e) => e.id === id) || null

/** "050", "agent 50", "AGENT050" → "AGENT050"; anything else → null. */
export function normalizeAgentNo(input) {
  const s = String(input ?? '').trim().toUpperCase().replace(/\s+/g, '')
  const digits = s.replace(/^AGENT/, '')
  if (!/^\d{1,6}$/.test(digits)) return null
  return `AGENT${digits.padStart(3, '0')}`
}

export const ALBUM_ERRORS = Object.freeze({
  gift_self: "You can't gift a cover to yourself.",
  gift_no_agent: 'No agent with that number.',
  gift_bad_agent: 'Enter an agent number, like 050.',
  gift_bad_era: 'Pick one of your covers to share.',
  gift_not_owned: "You don't have that cover yet.",
  gift_has_it: 'That agent already has this cover.',
  gift_sent_today: "You've already sent today's gift. Try again tomorrow.",
  gift_received_today: 'That agent has already received a gift today.',
  gift_too_new: `Gifting opens ${ALBUM_GIFT_MIN_DAYS} days after you join.`,
  rate_limited: 'Too many tries. Wait a few minutes.',
  server_error: 'Something went wrong. Try again.',
})

export const albumErrorText = (code) => ALBUM_ERRORS[code] || ALBUM_ERRORS.server_error
