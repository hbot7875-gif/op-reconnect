// RUN AMI room chat: what may be sent. Checked on the server (run-ami-service
// .js) and used by the game for its input limit and reaction buttons.
//
// Text reuses the Event Hub chat filter (battle-text-filter.js): one clean
// line, no links, @handles, hashtags, agent numbers, slurs or BTS
// impersonation. RUN AMI's panel is small, so messages are shorter.
// Reactions are a fixed set and sent as their own kind.

import { checkChatText, CHAT_ERRORS } from './battle-text-filter.js'

export const RUN_AMI_CHAT_MAX = 120
export const RUN_AMI_REACTIONS = Object.freeze(['😂', '😭', '💜', '👀', '🔥'])

export const RUN_AMI_CHAT_ERRORS = {
  ...CHAT_ERRORS,
  too_long: `${RUN_AMI_CHAT_MAX} characters max.`,
  reaction: 'Pick one of the quick reactions.',
}

/** { kind, body } from a request → { ok: true, kind, body } or { ok: false, reason }. */
export function checkRunAmiChat(kind, raw) {
  if (kind === 'react') {
    return RUN_AMI_REACTIONS.includes(raw) ? { ok: true, kind: 'react', body: raw } : { ok: false, reason: 'reaction' }
  }
  const text = checkChatText(raw)
  if (!text.ok) return text.reason === 'too_long' ? { ok: false, reason: 'too_long' } : text
  if ([...text.value].length > RUN_AMI_CHAT_MAX) return { ok: false, reason: 'too_long' }
  return { ok: true, kind: 'text', body: text.value }
}
