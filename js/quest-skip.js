// Skip Quest — the way out of a ReConnect Quest an agent no longer wants.
//
// A quiet, secondary action beside the quest's own controls: it must never
// compete with the streaming and progress actions that are the point of the
// screen. Every number shown here comes from the server's own quote
// (getQuestSkipQuote -> rc_quest_skip_quote), so the price in the sheet and
// the price charged are the same value, and mode-switching can't undercut it.

import { call } from './api.js'
import { el, esc, toast, showOverlay, hideOverlay, setState } from './state.js'
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

  // Three answers, not six near-identical bullets: what it does to the
  // district, what it does to the team, what it costs.
  for (const sec of v.sections) {
    const block = el('div', `qs-sec qs-sec-${sec.key}`)
    block.innerHTML = `<h4>${esc(sec.heading)}</h4>`
      + `<ul>${sec.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
    sheet.appendChild(block)
  }

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
    const agentNo = getAgentNo()
    const res = await call('skipQuest', { agentNo, districtId })
    if (!res.success) {
      go.disabled = false
      go.textContent = label
      toast(skipError(res))
      return
    }
    // Refresh the whole authoritative wallet/game state before confirming.
    // The player must see the charged XP and Cells immediately, not discover
    // a stale balance later in the HUD or Level sheet.
    const fresh = await call('getGameState', { agentNo })
    hideOverlay()
    if (fresh?.success) setState(fresh)
    else onDone?.()
    toast(res.waivesRequirement
      ? 'ReConnect skipped. Finish your track and album goals to restore this district.'
      : 'You left the quest. You can start a new one.')
  }
  sheet.appendChild(go)

  const keep = el('button', 'btn btn-ghost', 'Keep Playing')
  keep.type = 'button'
  keep.dataset.autofocus = 'true'
  keep.onclick = hideOverlay
  sheet.appendChild(keep)
  return sheet
}

/** Deterministic visual harness hook. It uses the real production sheet
 * builder so the eight-state preview cannot drift or break by evaluating a
 * private function's source text. */
export function questSkipSheetPreview(quote) {
  return skipSheet(quote, '__preview__', null)
}

function skipError(res) {
  return {
    too_soon: 'You can skip a quest once you have been on it for a day.',
    on_cooldown: 'You have skipped a quest recently — try again in a few days.',
    insufficient: "You don't have enough XP and Cells for this yet.",
    not_in_mission: "You're not on this quest any more.",
    already_skipped: 'That quest was already skipped.',
    already_completed: 'This Quest is already complete.',
    contribution_unavailable: "We couldn't verify the latest Quest streams. Please try again.",
    contribution_changed: 'A new stream just arrived. Check again to use the latest Quest progress.',
    joined_mode_unavailable: "We couldn't verify this Quest's original mode. Please contact HQ.",
    use_quest_exit: 'Use the quest exit option to leave this quest.',
  }[res.error] || res.error || "Couldn't skip this quest"
}

/** The button that opens the sheet. Returns null when the agent has no quest
 *  to leave, so the caller can simply append the result. */
/** The entry point, outside the Details disclosure so an agent stuck behind a
 *  teammate can actually find it. Deliberately a quiet two-line row, never a
 *  button competing with "Invite teammate" above it.
 *
 *  It also asks the server for a quote in the background once the panel has
 *  painted: if this agent is entitled to a FREE exit, the row says so without
 *  anyone having to tap or expand anything. The fetch never blocks the panel,
 *  and a failure just leaves the neutral wording in place. */
export function questExitRow(districtId, onDone) {
  const row = el('div', 'qs-row')
  const btn = el('button', 'qs-entry', `
    <span class="qs-entry-copy">
      <span class="qs-entry-title">Can't continue this Quest?</span>
      <span class="qs-entry-sub">View exit and skip options</span>
    </span>
    <span class="qs-entry-go" aria-hidden="true">↗</span>
  `)
  btn.type = 'button'
  btn.setAttribute('aria-label', 'View exit and skip options for this ReConnect quest')
  row.appendChild(btn)

  let cached = null
  const open = (quote) => showOverlay(skipSheet(quote, districtId, onDone))

  btn.onclick = async () => {
    if (cached) { open(cached); return }
    btn.disabled = true
    btn.classList.add('is-loading')
    const quote = await call('getQuestSkipQuote', { agentNo: getAgentNo(), districtId })
    btn.disabled = false
    btn.classList.remove('is-loading')
    if (!quote.success) { toast(skipError(quote)); return }
    cached = quote
    open(quote)
  }

  // Background: surface free eligibility without a tap. Fires after paint.
  queueMicrotask(async () => {
    const quote = await call('getQuestSkipQuote', { agentNo: getAgentNo(), districtId })
    if (!quote?.success || !row.isConnected) return
    cached = quote
    const v = questExitView(quote)
    const sub = row.querySelector('.qs-entry-sub')
    if (v.free) {
      row.classList.add('is-free')
      sub.textContent = `${v.button} — free`
    } else {
      sub.textContent = 'View exit and skip options'
    }
  })

  return row
}
