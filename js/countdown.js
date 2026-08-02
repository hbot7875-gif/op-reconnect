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

export function tickCountdowns() {
  for (const node of document.querySelectorAll('[data-deadline]')) {
    node.textContent = fmtLeft(new Date(node.dataset.deadline).getTime() - Date.now())
  }
}

setInterval(tickCountdowns, 1000)
