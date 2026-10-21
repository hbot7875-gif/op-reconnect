// Pure rules for voting-alerts.js (testable in Node).
//
// A certificate turned down as a duplicate becomes one popup, once per proof
// per agent on this device. The server sends only { id, kind, voteDay }.

const SEEN_KEY = 'rc_seen_vote_alert:'
const seenKey = (agentNo, a) => `${SEEN_KEY}${agentNo}:${a.kind}:${a.id}`

/** The alerts this agent hasn't been shown yet. Storage failing reads as
 *  "seen", so a broken store never repeats a popup on every poll. */
export function unseenAlerts(alerts, agentNo, storage) {
  if (!agentNo || !Array.isArray(alerts)) return []
  return alerts.filter((a) => {
    if (!a || a.kind !== 'duplicate_certificate' || !Number.isInteger(a.id)) return false
    try { return storage.getItem(seenKey(agentNo, a)) !== '1' } catch (_) { return false }
  })
}

export function markAlertsSeen(alerts, agentNo, storage) {
  for (const a of alerts || []) {
    try { storage.setItem(seenKey(agentNo, a), '1') } catch (_) {}
  }
}

export const DUPLICATE_POPUP = {
  eyebrow: 'MAMA 2026 · Mnet vote',
  title: 'Certificate not counted',
  body: 'This certificate has already been submitted. Please upload a new voting certificate.',
  action: 'Upload a new certificate',
}

/** "2 certificates" when several were turned down since the last popup. */
export function duplicatePopupCopy(alerts) {
  const n = (alerts || []).length
  return n > 1
    ? { ...DUPLICATE_POPUP, title: `${n} certificates not counted`, body: 'These certificates had already been submitted. Please upload new voting certificates.' }
    : DUPLICATE_POPUP
}
