// One ticking clock for every [data-deadline] element on the page.
//
// Shared so the Red Zone card, the core readout and the bomb dashboard all
// count down in step. The interval runs for the page's life and is a no-op
// when nothing on screen has a deadline.

export function fmtLeft(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = String(Math.floor(s / 3600)).padStart(2, '0')
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  return `${h}:${m}:${String(s % 60).padStart(2, '0')}`
}

// Compact "1D 22H" / "22H 5M" / "5M 30S" form — for a countdown label sitting
// next to other text (the ReCelebrate map venue) rather than alone in its own
// clock-style readout, where fmtLeft's fixed HH:MM:SS is the better fit.
export function fmtLeftShort(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  if (d > 0) return `${d}D ${h}H`
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}H ${m}M`
  return `${m}M ${s % 60}S`
}

export function tickCountdowns() {
  for (const node of document.querySelectorAll('[data-deadline]')) {
    const ms = new Date(node.dataset.deadline).getTime() - Date.now()
    node.textContent = node.dataset.format === 'short' ? fmtLeftShort(ms) : fmtLeft(ms)
  }
}

// Direct calls (bomb-sheet.js, celebrate.js) always run — they're one-shot
// "paint this now" calls that matter even on a backgrounded tab. Only the
// perpetual tick skips while hidden; nothing's watching it then anyway.
setInterval(() => { if (!document.hidden) tickCountdowns() }, 1000)
