// Help portal rules, shared by the server (help.ts) and the browser
// (js/help.js). Pure, so they can be tested without a database.

export const HELP_OWNER = 'AGENT000'

export const HELP_TOPICS = Object.freeze([
  { id: 'streams', label: 'Streams not counting' },
  { id: 'doubt', label: 'Doubt / question' },
  { id: 'reconnect', label: 'ReConnect quest' },
  { id: 'badges', label: 'Badges & album' },
  { id: 'voting', label: 'Voting' },
  { id: 'account', label: 'Account & sign-in' },
  { id: 'other', label: 'Something else' },
])

export const HELP_MESSAGE_MIN = 10
export const HELP_MESSAGE_MAX = 1000
export const HELP_REPLY_MAX = 1000
/** At most this many unanswered requests per agent, and this many a day. */
export const HELP_OPEN_LIMIT = 3
export const HELP_DAILY_LIMIT = 5

export const HELP_ERRORS = Object.freeze({
  bad_topic: 'Choose what the problem is about.',
  too_short: `Tell us a little more — at least ${HELP_MESSAGE_MIN} characters.`,
  too_long: `Keep it under ${HELP_MESSAGE_MAX} characters.`,
  too_many_open: `You already have ${HELP_OPEN_LIMIT} open requests. We'll reply to those first.`,
  daily_limit: "That's the most requests for today. Try again tomorrow.",
  not_owner: 'Only the ReConnect team can do that.',
  not_found: 'That request no longer exists.',
  empty_reply: 'Write a reply first.',
  server_error: "Couldn't send that — try again in a moment.",
})

export const topicLabel = (id) => HELP_TOPICS.find((t) => t.id === id)?.label || 'Something else'

/** Checks a request before it is saved: { ok, topic, message } or { ok:false, error }. */
export function validateHelpRequest({ topic, message } = {}) {
  const t = String(topic || '')
  if (!HELP_TOPICS.some((x) => x.id === t)) return { ok: false, error: 'bad_topic' }
  const m = String(message || '').replace(/\s+\n/g, '\n').trim()
  if (m.length < HELP_MESSAGE_MIN) return { ok: false, error: 'too_short' }
  if (m.length > HELP_MESSAGE_MAX) return { ok: false, error: 'too_long' }
  return { ok: true, topic: t, message: m }
}

/** The details attached to a request: only what helps answer "why isn't
 *  this counting". Connections are yes/no — never a username, ID, PIN or
 *  token. Inputs are plain values the server looked up. */
export function helpDiagnostics({ source = null, connections = {}, sync = null, lastPlayAt = null, joinedAt = null, district = null } = {}) {
  return {
    source: source || null,
    connections: {
      listenbrainz: !!connections.listenbrainz,
      statsfm: !!connections.statsfm,
      musicat: !!connections.musicat,
    },
    sync: sync ? {
      source: sync.source || null,
      lastSuccessAt: sync.lastSuccessAt || null,
      newestAtProvider: sync.newestAtProvider || null,
      lastError: sync.lastError || null,
      failures: Number(sync.failures) || 0,
    } : null,
    lastPlayAt: lastPlayAt || null,
    joinedAt: joinedAt || null,
    district: district || null,
  }
}

/** One plain line for the inbox: source, newest play, sync health. */
export function diagnosticsLine(d, fmt = (iso) => iso) {
  if (!d) return ''
  const parts = [d.source ? `Source: ${d.source}` : 'No stream source']
  parts.push(d.lastPlayAt ? `last play ${fmt(d.lastPlayAt)}` : 'no plays stored')
  if (d.sync?.newestAtProvider) parts.push(`newest at provider ${fmt(d.sync.newestAtProvider)}`)
  if (d.sync?.lastError) parts.push(`sync error: ${d.sync.lastError}`)
  else if (d.sync?.lastSuccessAt) parts.push(`last sync ok ${fmt(d.sync.lastSuccessAt)}`)
  if (d.district) parts.push(`district ${d.district}`)
  return parts.join(' · ')
}
