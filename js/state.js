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
  document.body.appendChild(t)
  setTimeout(() => t.remove(), ms)
}

export function showOverlay(contentNode) {
  const overlay = document.getElementById('overlay')
  overlay.innerHTML = ''
  overlay.appendChild(contentNode)
  overlay.hidden = false
  overlay.onclick = (e) => { if (e.target === overlay) hideOverlay() }
}

export function hideOverlay() {
  const overlay = document.getElementById('overlay')
  overlay.hidden = true
  overlay.innerHTML = ''
}
