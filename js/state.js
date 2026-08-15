// Tiny store: latest game state + render subscribers + shared helpers.

let gameState = null
const subs = []

export function setState(next) {
  gameState = next
  for (const fn of subs) fn(gameState)
}

export function getState() {
  return gameState
}

export function subscribe(fn) {
  subs.push(fn)
}

/** The ward standing between the player and a sealed one. Wards unlock in
 *  story order, so the blocker is simply the one before it — naming it beats
 *  telling someone to "restore the previous ward" and making them count. */
export function unlockAfter(wards, wardId) {
  const i = (wards || []).findIndex((w) => w.id === wardId)
  return i > 0 ? wards[i - 1] : null
}

export function el(tag, className, html) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (html !== undefined) node.innerHTML = html
  return node
}

export function esc(s) {
  return String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
}

/** "A" / "A and B" / "A, B and C" — every ward has at least one centerpiece,
 *  Echo Quarter has four, so anywhere a ward's centerpieces get named needs
 *  this instead of assuming there's exactly one. */
export function joinNames(names) {
  const n = (names || []).filter(Boolean)
  if (n.length <= 1) return n[0] || ''
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`
}

export function toast(msg, ms = 3200) {
  const t = el('div', 'toast', esc(msg))
  t.setAttribute('role', 'status')
  t.setAttribute('aria-live', 'polite')
  document.body.appendChild(t)
  setTimeout(() => t.remove(), ms)
}

let overlayReturnFocus = null

function overlayFocusables(overlay) {
  return [...overlay.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((node) => !node.hidden && node.getAttribute('aria-hidden') !== 'true')
}

export function showOverlay(contentNode) {
  const overlay = document.getElementById('overlay')
  if (overlay.hidden) overlayReturnFocus = document.activeElement
  overlay.innerHTML = ''
  contentNode.setAttribute('role', 'dialog')
  contentNode.setAttribute('aria-modal', 'true')
  if (!contentNode.hasAttribute('aria-label') && !contentNode.hasAttribute('aria-labelledby')) {
    const heading = contentNode.querySelector('h1, h2, h3, .eyebrow')
    contentNode.setAttribute('aria-label', heading?.textContent?.trim() || 'Game dialog')
  }
  if (!contentNode.hasAttribute('tabindex')) contentNode.tabIndex = -1
  overlay.appendChild(contentNode)
  overlay.hidden = false
  document.body.classList.add('overlay-open')
  overlay.onclick = (e) => { if (e.target === overlay) hideOverlay() }
  requestAnimationFrame(() => (overlayFocusables(overlay)[0] || contentNode).focus())
}

export function hideOverlay() {
  const overlay = document.getElementById('overlay')
  overlay.hidden = true
  overlay.innerHTML = ''
  document.body.classList.remove('overlay-open')
  if (overlayReturnFocus?.isConnected) overlayReturnFocus.focus()
  overlayReturnFocus = null
}

// Every sheet in the game (Settings, Personal Charge, Candy Star pickers,
// invites, everything showOverlay ever opens) shares this one overlay, so
// one listener covers all of them. Clicking the backdrop already closed it
// (the onclick above); Escape is the other half of that same expectation —
// keyboard-only and screen-reader users had no way to back out of a sheet
// at all without this.
document.addEventListener('keydown', (e) => {
  const overlay = document.getElementById('overlay')
  if (!overlay || overlay.hidden) return
  if (e.key === 'Escape') {
    e.preventDefault()
    hideOverlay()
    return
  }
  if (e.key !== 'Tab') return
  const focusables = overlayFocusables(overlay)
  if (!focusables.length) { e.preventDefault(); overlay.firstElementChild?.focus(); return }
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
})
