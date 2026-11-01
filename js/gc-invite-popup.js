// New-agent popup: join the Instagram group chats (see gc-invite-rules.js).
// The joins are real anchors, so phones hand ig.me links to Instagram
// without a popup blocker — same as Settings → Community.

import { getAgentNo } from './session.js'
import { el, hideOverlay, showOverlay } from './state.js'
import { getScreen } from './router.js'
import { vIcon as ic } from './voting-icons.js'
import { esc } from './voting-view.js'
import { gcInviteDue, markGcInviteSeen, markGcInviteDone, GC_LINKS, GC_INVITE_COPY as C } from './gc-invite-rules.js'

export function checkForGcInvite(state) {
  const agentNo = getAgentNo()
  if (!agentNo || !state?.joined) return
  let storage
  try { storage = localStorage } catch (_) { return }
  const votedToday = Number(state.voting?.done) > 0
  if (!gcInviteDue({ agentNo, storage, screen: getScreen()?.name, votedToday })) return
  // Don't fight another sheet for the shared overlay; the next poll retries.
  const overlay = document.getElementById('overlay')
  if (overlay && !overlay.hidden) return
  markGcInviteSeen(storage, agentNo)

  const sheet = el('div', 'sheet vt-pop', `<div class="vt-pop-ico is-accent">${ic('chat')}</div>
    <p class="vt-pop-eyebrow">${esc(C.eyebrow)}</p>
    <h3 class="vt-pop-title">${esc(C.title)}</h3>
    <p class="vt-pop-body">${esc(C.body)}</p>
    <div class="vt-pop-acts">
      <a class="vt-pop-btn is-primary" data-gc="join" href="${GC_LINKS.discussion}" target="_blank" rel="noopener" data-autofocus="true">${esc(C.discussion)}</a>
      <a class="vt-pop-btn is-outline" data-gc="join" href="${GC_LINKS.updates}" target="_blank" rel="noopener">${esc(C.updates)}</a>
      <button type="button" class="vt-pop-btn is-quiet" data-gc="done">${esc(C.done)}</button>
    </div>`)
  // A tap on either link counts as joined; the sheet stays so the other
  // chat can be joined too.
  sheet.querySelectorAll('[data-gc="join"]').forEach((a) => { a.onclick = () => markGcInviteDone(storage, agentNo) })
  sheet.querySelector('[data-gc="done"]').onclick = () => { markGcInviteDone(storage, agentNo); hideOverlay() }
  showOverlay(sheet)
}
