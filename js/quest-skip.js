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
import { questExitView } from './quest-exit-rules.js'

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
    ${balance === null ? '' : `<span class="qs-chip-bal">${fmt(balance)} to spend</span>`}
  `
  return chip
}

function skipSheet(quote, districtId, onDone) {
  const v = questExitView(quote)
  const sheet = el('div', 'sheet qs-sheet')
  sheet.setAttribute('role', 'dialog')
  sheet.setAttribute('aria-modal', 'true')
  sheet.setAttribute('aria-labelledby', 'qsTitle')

  sheet.append(
    el('div', 'eyebrow', 'RECONNECT QUEST'),
    el('h3', 'qs-title', v.title),
    el('p', 'qs-lede', v.lede),
  )
  sheet.querySelector('.qs-title').id = 'qsTitle'

  if (v.showPrice) {
    const row = el('div', 'qs-cost')
    row.append(
      costChip(XP_ICON, quote.costXp, 'XP', quote.balanceXp, quote.shortXp > 0),
      el('span', 'qs-plus', '+'),
      costChip(CELL_ICON, quote.costCells, quote.costCells === 1 ? 'Cell' : 'Cells', quote.balanceCells, quote.shortCells > 0),
    )
    sheet.appendChild(row)
  } else {
    sheet.appendChild(el('div', 'qs-free', `<span>✓ No cost</span><small>${esc(v.why || '')}</small>`))
  }

  const notes = el('ul', 'qs-notes')
  notes.innerHTML = v.notes.map((n) => `<li>${esc(n)}</li>`).join('')
  sheet.appendChild(notes)

  if (v.hold) sheet.appendChild(el('p', 'qs-hold', esc(v.hold)))

  const go = el('button', 'btn btn-primary qs-go', v.confirm)
  go.type = 'button'
  if (v.blocked) {
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
    toast(res.free ? 'You left the quest. You can start a new one.' : 'Quest skipped. You can start a new one.')
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
    use_quest_exit: 'Use the quest exit option to leave this quest.',
  }[res.error] || res.error || "Couldn't skip this quest"
}

/** The button that opens the sheet. Returns null when the agent has no quest
 *  to leave, so the caller can simply append the result. */
export function skipQuestButton(districtId, onDone) {
  // One entry point. Its label only becomes specific once the server says
  // which exit applies, so the screen never offers a free leave beside a
  // paid one.
  const btn = el('button', 'qs-btn', '<span aria-hidden="true">⤴</span> Leave Quest')
  btn.type = 'button'
  btn.setAttribute('aria-label', 'Leave this ReConnect quest')
  btn.onclick = async () => {
    btn.disabled = true
    btn.classList.add('is-loading')
    const quote = await call('getQuestSkipQuote', { agentNo: getAgentNo(), districtId })
    btn.disabled = false
    btn.classList.remove('is-loading')
    if (!quote.success) { toast(skipError(quote)); return }
    const v = questExitView(quote)
    btn.innerHTML = `<span aria-hidden="true">⤴</span> ${esc(v.button)}`
    showOverlay(skipSheet(quote, districtId, onDone))
  }
  return btn
}
