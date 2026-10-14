// MAMA Battle share — what one 'battle_share' engagement event may carry.
//
// Shared by the share sheet (js/voting.js, which sends them), the Edge
// Function (engagement.ts, which accepts them) and Node tests. Only these
// fixed words are ever stored: never the poster's custom team lines, never
// anything typed, never the share text.

export const BATTLE_SHARE_ACTIONS = ['opened', 'share_poster', 'share_link', 'try_style', 'save', 'copy_link', 'copy_text']
export const BATTLE_SHARE_STYLES = ['V1', 'V2', 'V3']
// What a share attempt ended as (from battle-share-flow.js).
export const BATTLE_SHARE_OUTCOMES = ['shared', 'cancelled', 'failed', 'copied', 'downloaded', 'hold']

/** The stored metadata for one battle_share event, or null if the action
 *  isn't one we record. Everything else the client sent is dropped. */
export function battleShareMetadata(raw) {
  const m = raw && typeof raw === 'object' ? raw : {}
  if (!BATTLE_SHARE_ACTIONS.includes(m.action)) return null
  const out = { action: m.action }
  if (BATTLE_SHARE_STYLES.includes(m.style)) out.style = m.style
  if (BATTLE_SHARE_OUTCOMES.includes(m.outcome)) out.outcome = m.outcome
  return out
}
