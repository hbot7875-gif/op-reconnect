// Skip Quest — the way out of a ReConnect Quest an agent no longer wants.
//
// A quiet, secondary action beside the quest's own controls: it must never
// compete with the streaming and progress actions that are the point of the
// screen. Every number shown here comes from the server's own quote
// (getQuestSkipQuote -> rc_quest_skip_quote), so the price in the sheet and
// the price charged are the same value, and mode-switching can't undercut it.

import { call } from './api.js'
import { el, esc, toast, showOverlay, hideOverlay } from './state.js'
import { getAgentNo } from './session.js'

// The same glyphs the Pack uses for these resources (screen-resources.js
// SLOT_DEFS), so a cost reads as the resources the agent already knows.
const XP_ICON = '✦'
const CELL_ICON = '⚡'

const fmt = (n) => Number(n || 0).toLocaleString('en-US')

/** "in 3 hours" / "in 2 days" — friendly, never a raw timestamp. */
function untilLabel(iso) {
  const ms = new Date(iso).getTime() - Date.now()
  if (!Number.isFinite(ms) || ms <= 0) return 'shortly'
  const mins = Math.ceil(ms / 60000)
  if (mins < 60) return `in ${mins} min`
  const hours = Math.ceil(mins / 60)
  if (hours < 48) return `in ${hours} hour${hours === 1 ? '' : 's'}`
  return `in ${Math.ceil(hours / 24)} days`
}

/** One resource chip: cost, and the agent's balance when it matters. */
function costChip(icon, amount, label, balance, short) {
  const chip = el('span', 'qs-chip' + (short ? ' is-short' : ''))
  chip.innerHTML = `
    <span class="qs-chip-icon" aria-hidden="true">${icon}</span>
    <span class="qs-chip-amount">${fmt(amount)}</span>
    <span class="qs-chip-label">${esc(label)}</span>
    ${balance === null ? '' : `<span class="qs-chip-bal">you have ${fmt(balance)}</span>`}
  `
  return chip
}

function skipSheet(quote, districtId, onDone) {
  const sheet = el('div', 'sheet qs-sheet')
  sheet.setAttribute('role', 'dialog')
  sheet.setAttribute('aria-modal', 'true')
  sheet.setAttribute('aria-labelledby', 'qsTitle')

  const free = !!quote.free
  const blocked = quote.waitingPeriod || quote.onCooldown
  const short = !free && !quote.canAfford

  sheet.append(
    el('div', 'eyebrow', 'RECONNECT QUEST'),
    el('h3', 'qs-title', free ? 'Leave this Quest?' : 'Skip this Quest?'),
    el('p', 'qs-lede', free
      ? "This quest can't be finished any more, so leaving it is free."
      : 'You can leave this quest and start a new one. This won\'t count as completing it.'),
  )
  sheet.querySelector('.qs-title').id = 'qsTitle'

  // ── Price ──────────────────────────────────────────────────────────────
  if (free) {
    const why = quote.freeReason === 'teammate_rescue'
      ? "A teammate hasn't answered or played for over 48 hours."
      : quote.freeReason === 'expired' ? 'This quest has already run out of time.'
      : "This quest is stuck, so there's nothing to pay."
    sheet.appendChild(el('div', 'qs-free', `<span>✓ No cost</span><small>${esc(why)}</small>`))
  } else {
    const row = el('div', 'qs-cost')
    row.append(
      costChip(XP_ICON, quote.costXp, 'XP', quote.balanceXp, quote.shortXp > 0),
      el('span', 'qs-plus', '+'),
      costChip(CELL_ICON, quote.costCells, quote.costCells === 1 ? 'Cell' : 'Cells', quote.balanceCells, quote.shortCells > 0),
    )
    sheet.appendChild(row)
  }

  // ── What happens ───────────────────────────────────────────────────────
  const notes = el('ul', 'qs-notes')
  notes.innerHTML = `
    <li>You won't receive this quest's completion rewards.</li>
    <li>Your existing streams will remain counted for your teammates.</li>
    <li>Your other district progress and earned rewards will stay safe.</li>
    ${free ? '' : '<li>You can skip only once every 7 days.</li>'}
  `
  sheet.appendChild(notes)

  // ── Blocking states ────────────────────────────────────────────────────
  if (quote.waitingPeriod) {
    sheet.appendChild(el('p', 'qs-hold', `You can skip this quest ${esc(untilLabel(quote.eligibleAt))}, once you've been on it for a day.`))
  } else if (quote.onCooldown) {
    sheet.appendChild(el('p', 'qs-hold', `You've skipped a quest recently. The next one is available ${esc(untilLabel(quote.cooldownUntil))}.`))
  } else if (short) {
    const missing = []
    if (quote.shortXp > 0) missing.push(`${fmt(quote.shortXp)} more XP`)
    if (quote.shortCells > 0) missing.push(`${fmt(quote.shortCells)} more ${quote.shortCells === 1 ? 'Cell' : 'Cells'}`)
    sheet.appendChild(el('p', 'qs-hold', `You need ${esc(missing.join(' and '))} to skip this one.`))
  }

  // ── Actions ────────────────────────────────────────────────────────────
  const go = el('button', 'btn btn-primary qs-go', free
    ? 'Leave this Quest'
    : `Skip for ${fmt(quote.costXp)} XP + ${fmt(quote.costCells)} ${quote.costCells === 1 ? 'Cell' : 'Cells'}`)
  go.type = 'button'
  if (blocked || short) {
    go.disabled = true
    go.setAttribute('aria-disabled', 'true')
  }
  go.onclick = async () => {
    go.disabled = true
    const label = go.textContent
    go.textContent = 'Leaving…'
    const res = await call('skipQuest', { agentNo: getAgentNo(), districtId })
    if (!res.success) {
      go.disabled = false
      go.textContent = label
      toast(skipError(res))
      return
    }
    hideOverlay()
    toast('Quest skipped. You can start a new one.')
    onDone?.()
  }
  sheet.appendChild(go)

  const keep = el('button', 'btn btn-ghost', 'Keep Playing')
  keep.type = 'button'
  keep.onclick = hideOverlay
  sheet.appendChild(keep)

  // Focus the safe choice, not the irreversible one.
  queueMicrotask(() => keep.focus())
  return sheet
}

function skipError(res) {
  return {
    too_soon: 'You can skip a quest once you have been on it for a day.',
    on_cooldown: 'You have skipped a quest recently — try again in a few days.',
    insufficient: "You don't have enough XP and Cells for this yet.",
    not_in_mission: "You're not on this quest any more.",
    already_skipped: 'That quest was already skipped.',
  }[res.error] || res.error || "Couldn't skip this quest"
}

/** The button that opens the sheet. Returns null when the agent has no quest
 *  to leave, so the caller can simply append the result. */
export function skipQuestButton(districtId, onDone) {
  const btn = el('button', 'qs-btn', '<span aria-hidden="true">⤴</span> Skip Quest')
  btn.type = 'button'
  btn.setAttribute('aria-label', 'Skip this ReConnect quest')
  btn.onclick = async () => {
    btn.disabled = true
    btn.classList.add('is-loading')
    const quote = await call('getQuestSkipQuote', { agentNo: getAgentNo(), districtId })
    btn.disabled = false
    btn.classList.remove('is-loading')
    if (!quote.success) { toast(skipError(quote)); return }
    showOverlay(skipSheet(quote, districtId, onDone))
  }
  return btn
}
