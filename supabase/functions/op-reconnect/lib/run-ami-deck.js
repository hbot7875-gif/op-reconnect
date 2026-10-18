// RUN AMI — LAST CARD: configuration, the deck and randomness.
//
// Split out of run-ami-rules.js unchanged. Pure: no clock, no database, no
// Math.random — every shuffle and id takes the caller's `rng`.

export const COLORS = ['r', 'y', 'g', 'b']
export const HAND_SIZE = 7
export const MIN_PLAYERS = 2
export const MAX_PLAYERS = 4

const NUMBER_KINDS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
const ACTION_KINDS = ['skip', 'rev', 'd2']
const WILD_KINDS = ['wild', 'wd4']

/** Every tunable, with the V1 defaults. rc_config.run_ami overrides any of
 *  these; resolveConfig clamps them so a typo in the admin JSON can't make a
 *  match unplayable. The resolved copy is frozen into each match at start,
 *  so changing config never changes a match already in progress. */
export const DEFAULT_CONFIG = Object.freeze({
  turnSeconds: 30,
  runAmiGraceMs: 2000,
  catchPenalty: 2,
  maxTimeouts: 3,
  disconnectGraceSeconds: 90,
  heartbeatStaleSeconds: 15,
  roomIdleMinutes: 30,
  catchCooldownMs: 1500,
})

const LIMITS = {
  turnSeconds: [10, 120],
  runAmiGraceMs: [500, 10000],
  catchPenalty: [1, 4],
  maxTimeouts: [1, 10],
  disconnectGraceSeconds: [30, 600],
  heartbeatStaleSeconds: [5, 120],
  roomIdleMinutes: [5, 240],
  catchCooldownMs: [250, 10000],
}

export function resolveConfig(raw) {
  const out = { ...DEFAULT_CONFIG }
  const src = raw && typeof raw === 'object' ? raw : {}
  for (const [key, [lo, hi]] of Object.entries(LIMITS)) {
    const n = Number(src[key])
    if (Number.isFinite(n)) out[key] = Math.min(hi, Math.max(lo, Math.round(n)))
  }
  return out
}

export const isWild = (card) => WILD_KINDS.includes(card.k)
export const isNumber = (card) => NUMBER_KINDS.includes(card.k)

/** The 108 card faces, unshuffled and without ids. */
export function buildDeck() {
  const deck = []
  for (const c of COLORS) {
    deck.push({ c, k: '0' })
    for (const k of [...NUMBER_KINDS.slice(1), ...ACTION_KINDS]) deck.push({ c, k }, { c, k })
  }
  for (const k of WILD_KINDS) for (let i = 0; i < 4; i++) deck.push({ c: null, k })
  return deck
}

export function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'

/** Opaque per-match card ids. Random rather than derived from the face, so
 *  an id seen in one match (or one hand) says nothing about any other. */
export function assignIds(cards, rng) {
  const used = new Set()
  for (const card of cards) {
    let id
    do {
      id = 'c'
      for (let i = 0; i < 7; i++) id += ID_ALPHABET[Math.floor(rng() * ID_ALPHABET.length)]
    } while (used.has(id))
    used.add(id)
    card.id = id
  }
  return cards
}
