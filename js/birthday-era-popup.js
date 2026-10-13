// The one-time birthday popup and completion copy for dated Birthday Era
// Cards (birthday-eras.ts). Pure on purpose — screen-world.js owns the
// overlay, main.js owns the completion toast; both read their words here so
// a future member's birthday needs no new strings, only a new event entry.

const SEEN_KEY = 'rc_seen_birthday_era_popup:'

/** The birthday card worth inviting this agent to: dated, live today, and
 *  not yet completed. The backend only sends a dated card while its event
 *  window is open or once it has been claimed (then status 'keepsake'), so
 *  'dark' here already means "today, and still to do". */
export function birthdayPopupCard(state) {
  const cards = state?.agentCharge?.eraCards
  if (!Array.isArray(cards)) return null
  return cards.find((card) => card?.isSpecial && card.status === 'dark' && card.member) || null
}

export function birthdayPopupCopy(card) {
  if (card.roomGift) {
    return {
      title: `Happy Birthday, ${card.member}`,
      body: `Complete your Birthday Era Card for +10H ARMY Bomb charge. Every qualifying stream also helps restore the shared ${card.member} Birthday Room.`,
      note: `When the room reaches 100%, everyone who helped can open a ${card.member} Day Gift.`,
      action: 'Start Era Card',
    }
  }
  return {
    title: `Happy Birthday, ${card.member}`,
    body: `Complete the Birthday Era Card to unlock the ${card.member} Birthday Badge and earn +10H ARMY Bomb charge.`,
    action: 'Start Era Card',
  }
}

export function birthdayCompleteMessage(card) {
  if (card?.roomGift) return 'Birthday Era Complete · +10H ARMY Bomb charge added.'
  const badge = card?.member ? `the ${card.member} Birthday Badge` : 'the birthday badge'
  return `Birthday Era Complete · You unlocked ${badge} and earned +10H charge.`
}

/** What the Jimin Day Gift holds, in display order. Before the claim it is
 *  a preview built from the room's gift config and the agent's own card;
 *  after it, exactly what the server recorded. */
export function birthdayGiftContents(gift, cardComplete, names = {}) {
  if (!gift) return []
  const badgeIds = gift.state === 'claimed'
    ? (gift.badgeIds || []).map((id) => String(id).split(':', 1)[0])
    : [gift.roomBadgeId, ...(cardComplete ? [gift.cardBadgeId] : [])]
  return [
    ...badgeIds.map((id) => ({ kind: 'badge', id, label: names[id] || id })),
    ...(gift.wings ? [{ kind: 'wings', label: `${gift.wings} Wing${gift.wings === 1 ? '' : 's'}` }] : []),
    ...(gift.chargeCells ? [{ kind: 'cells', label: `${gift.chargeCells} Charge Cell${gift.chargeCells === 1 ? '' : 's'}` }] : []),
  ]
}

/** Seen once per agent per event, the same localStorage-seen pattern
 *  exam-mode-announce.js and badge-reveal.js use. Storage failing reads as
 *  "seen" so a locked-down browser never gets the popup on every poll. */
export function birthdayPopupSeen(storage, agentNo, eventId) {
  try { return storage.getItem(`${SEEN_KEY}${agentNo}:${eventId}`) === '1' } catch (_) { return true }
}

export function markBirthdayPopupSeen(storage, agentNo, eventId) {
  try { storage.setItem(`${SEEN_KEY}${agentNo}:${eventId}`, '1') } catch (_) {}
}
