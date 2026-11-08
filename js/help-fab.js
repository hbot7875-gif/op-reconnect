// The floating help button: a small round button above the tab bar on every
// game screen, so agents don't have to find Get help in Settings. It opens
// the same sheet (help.js) and carries a dot when the team has replied.
// Hidden on the War of Cards table (CSS) and behind open sheets (the
// overlay sits above it).

import { openHelp } from './help.js'

// Lucide "circle-help" (ISC), drawn in currentColor.
const ICON = '<svg class="help-fab-i" viewBox="0 0 24 24" focusable="false" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>'

/** Creates the button once, then keeps its reply dot current. Called from
 *  renderHud, which runs whenever the game state changes. */
export function paintHelpFab(state) {
  const game = document.getElementById('game')
  if (!game) return
  let btn = document.getElementById('helpFab')
  if (!btn) {
    btn = document.createElement('button')
    btn.id = 'helpFab'
    btn.type = 'button'
    btn.className = 'help-fab'
    btn.innerHTML = `${ICON}<span class="help-fab-dot" hidden></span>`
    btn.onclick = () => openHelp()
    game.appendChild(btn)
  }
  const replies = Number(state?.help?.replyUnread) || 0
  btn.querySelector('.help-fab-dot').hidden = !replies
  btn.setAttribute('aria-label', replies ? `Get help — ${replies} new repl${replies === 1 ? 'y' : 'ies'} from the team` : 'Get help')
  btn.title = 'Get help'
}
