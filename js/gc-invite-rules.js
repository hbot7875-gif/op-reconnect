// Pure rules for gc-invite-popup.js (testable in Node).
//
// New agents kept missing the Instagram group chats, so they had nowhere to
// ask. Onboarding (which only a brand-new agent ever sees) marks this device
// with the time it ran; for NEW_DAYS after that, a popup offers both chats
// once per KST day until the agent taps a Join link or "I've joined".

export const GC_LINKS = {
  updates: 'https://ig.me/j/AbZZsW13xRAgMb_D/',
  discussion: 'https://ig.me/j/AbZYVFwKMMuh1zzV/',
}

export const NEW_DAYS = 3

// Also asked, with no time limit, of every agent from AGENT201 on and of
// AGENT139 — the recent agents who joined before this popup existed.
const FIRST_INVITED = 201
const ALSO_INVITED = new Set(['AGENT139'])

/** Is this agent on the invite list by number? */
export function invitedByNumber(agentNo) {
  const id = String(agentNo || '').toUpperCase()
  if (ALSO_INVITED.has(id)) return true
  const m = /^AGENT(\d+)$/.exec(id)
  return !!m && Number(m[1]) >= FIRST_INVITED
}
const DAY_MS = 86_400_000
const NEW_KEY = 'rc_new_agent_since:'
const DONE_KEY = 'rc_gc_invite_done:'
const SEEN_KEY = 'rc_gc_invite_seen:'

const kstDay = (now) => new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10)

/** Onboarding calls this once, when the agent joins. */
export function markNewAgent(storage, agentNo, now = new Date()) {
  try { storage.setItem(NEW_KEY + agentNo, String(now.getTime())) } catch (_) {}
}

/** Joined a chat, or said they already had: never ask again. */
export function markGcInviteDone(storage, agentNo) {
  try { storage.setItem(DONE_KEY + agentNo, '1') } catch (_) {}
}

export function markGcInviteSeen(storage, agentNo, now = new Date()) {
  try { storage.setItem(`${SEEN_KEY}${agentNo}:${kstDay(now)}`, '1') } catch (_) {}
}

/** Due now? On the voting screen only once today's vote is in, so it never
 *  lands on top of the side chooser or an upload. Storage failing reads as
 *  "not due", so a broken store never nags. */
export function gcInviteDue({ agentNo, storage, now = new Date(), screen, votedToday = false } = {}) {
  if (!agentNo) return false
  if (screen === 'voting' && !votedToday) return false
  try {
    const since = Number(storage.getItem(NEW_KEY + agentNo))
    const isNew = since && now.getTime() - since <= NEW_DAYS * DAY_MS
    if (!isNew && !invitedByNumber(agentNo)) return false
    if (storage.getItem(DONE_KEY + agentNo) === '1') return false
    return storage.getItem(`${SEEN_KEY}${agentNo}:${kstDay(now)}`) !== '1'
  } catch (_) {
    return false
  }
}

export const GC_INVITE_COPY = {
  eyebrow: 'New agent',
  title: 'Got questions? Join our group chats',
  body: 'Ask anything about voting, uploading your certificate or charging your ARMY Bomb in the Discussion GC, and other ARMY will help. News and updates come in the Main GC.',
  discussion: 'Join Discussion GC (questions)',
  updates: 'Join Main GC (updates)',
  done: "I've already joined",
}
