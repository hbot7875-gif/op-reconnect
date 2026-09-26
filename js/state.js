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

/** Every sheet gets a dismiss pinned to its top-right.
 *
 *  Sheets are `max-height: 82vh; overflow-y: auto`, and most put their Close
 *  at the very bottom — so on any sheet whose content outgrows that cap, the
 *  only way out is to scroll past everything first. Measured: the VMA
 *  mission sheet renders 753px of content into 664px and leaves its Close
 *  24px below the fold; the Agent Manual sits exactly on the cap with
 *  nothing to spare. Clicking the backdrop already dismissed, but nothing
 *  ever said so.
 *
 *  Added here rather than sheet by sheet because showOverlay is the one
 *  door every sheet comes through, including ones not written yet. The bar
 *  is zero-height and sticky, so it pins to the top while the sheet scrolls
 *  without pushing any existing layout down. Sheets that already have their
 *  own top dismiss are left alone. */
function addSheetDismiss(contentNode) {
  if (!contentNode.classList?.contains('sheet')) return
  if (contentNode.querySelector('.sheet-x, .vault-sheet-close, .rcp-chat-close')) return
  const bar = document.createElement('div')
  bar.className = 'sheet-x-bar'
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'sheet-x'
  btn.setAttribute('aria-label', 'Close')
  btn.textContent = '✕'
  btn.onclick = hideOverlay
  bar.appendChild(btn)
  contentNode.prepend(bar)
}

// Some sheets repaint by clearing their own innerHTML after they are already
// on screen — vma.js does it three times, and that swallowed the dismiss
// along with everything else, so the one sheet measured to need it most was
// also the one that lost it. Watching for that is what makes "every sheet
// has a reachable close" a guarantee rather than a default. Re-adding is a
// no-op once the button is back, so this cannot loop.
let dismissWatcher = null
function watchSheetDismiss(contentNode) {
  dismissWatcher?.disconnect()
  if (!contentNode.classList?.contains('sheet')) { dismissWatcher = null; return }
  dismissWatcher = new MutationObserver(() => {
    if (!contentNode.querySelector('.sheet-x, .vault-sheet-close, .rcp-chat-close')) addSheetDismiss(contentNode)
  })
  dismissWatcher.observe(contentNode, { childList: true })
}

export function showOverlay(contentNode) {
  const overlay = document.getElementById('overlay')
  if (overlay.hidden) overlayReturnFocus = document.activeElement
  overlay.innerHTML = ''
  addSheetDismiss(contentNode)
  contentNode.setAttribute('role', 'dialog')
  contentNode.setAttribute('aria-modal', 'true')
  if (!contentNode.hasAttribute('aria-label') && !contentNode.hasAttribute('aria-labelledby')) {
    const heading = contentNode.querySelector('h1, h2, h3, .eyebrow')
    contentNode.setAttribute('aria-label', heading?.textContent?.trim() || 'Game dialog')
  }
  if (!contentNode.hasAttribute('tabindex')) contentNode.tabIndex = -1
  overlay.appendChild(contentNode)
  watchSheetDismiss(contentNode)
  overlay.hidden = false
  document.body.classList.add('overlay-open')
  overlay.onclick = (e) => { if (e.target === overlay) hideOverlay() }
  // Destructive confirmations can nominate their safe action. Falling back
  // to the first focusable preserves every existing sheet's behaviour.
  requestAnimationFrame(() => (
    overlay.querySelector('[data-autofocus="true"]')
    // Skip the dismiss when picking what to focus first: it is prepended, so
    // without this every sheet would open focused on its own close button
    // instead of whatever it used to focus. It stays in the tab order.
    || overlayFocusables(overlay).filter((n) => !n.classList.contains('sheet-x'))[0]
    || contentNode
  ).focus())
}

export function hideOverlay() {
  const overlay = document.getElementById('overlay')
  dismissWatcher?.disconnect()
  dismissWatcher = null
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
