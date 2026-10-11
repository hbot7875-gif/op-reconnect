// The shared HUD ReConnect button, re-presented as a compact action row inside
// a screen -- the treatment City (screen-world.js) and Agent Pack
// (screen-resources.js) give it. The element renderHud() built is moved, not
// copied, so its visibility, live label, unread badge and click (open the
// active district) stay exactly the HUD's; only its look changes. Dropping
// the id stops the next HUD-first repaint from finding this copy.

const USERS = '<svg class="rc-row-i" viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
const CHEVRON = '<svg class="rc-row-i" viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>'

export function adoptHudReconnectRow() {
  const button = document.getElementById('hudReconnectStatus')
  if (!button) return null
  const statusText = button.querySelector('b')?.textContent?.trim() || 'Open ReConnect'
  const icon = button.querySelector('span')
  if (icon) {
    icon.className = 'rc-row-icon'
    icon.setAttribute('aria-hidden', 'true')
    icon.innerHTML = USERS
  }
  const unread = button.querySelector('.hud-reconnect-chat-badge')
  if (unread) unread.textContent = unread.textContent.replace('\u{1F4AC}', '').trim()
  const go = button.querySelector(':scope > i')
  if (go) { go.className = 'rc-row-go'; go.setAttribute('aria-hidden', 'true'); go.innerHTML = CHEVRON }
  if (!button.hasAttribute('aria-label')) button.setAttribute('aria-label', `ReConnect. ${statusText}`)
  button.removeAttribute('id')
  button.classList.add('rc-reconnect-row')
  return button
}
