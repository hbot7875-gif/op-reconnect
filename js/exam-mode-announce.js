// One-time nudge introducing School/Exam mode — shown once per agent, same
// localStorage-seen pattern badge-reveal.js already uses. Skipped outright
// for anyone already on exam mode; nothing to announce to them.

import { call } from './api.js'
import { getAgentNo } from './session.js'
import { el, hideOverlay, showOverlay, setState, toast } from './state.js'

const SEEN_KEY = 'rc_seen_exam_mode_announce:'

function seen(agentNo) {
  try { return localStorage.getItem(SEEN_KEY + agentNo) === '1' } catch (_) { return true }
}
function markSeen(agentNo) {
  try { localStorage.setItem(SEEN_KEY + agentNo, '1') } catch (_) {}
}

export function checkForExamModeAnnounce(state) {
  const agentNo = getAgentNo()
  if (!agentNo || !state?.joined) return
  if (state.player?.mode === 'exam') return
  if (seen(agentNo)) return
  // Don't fight another sheet (e.g. a badge reveal) for the shared overlay —
  // skip this poll and retry on the next one, same as badge-reveal.js does.
  const overlay = document.getElementById('overlay')
  if (overlay && !overlay.hidden) return
  markSeen(agentNo)
  showOverlay(announceSheet())
}

function announceSheet() {
  const sheet = el('div', 'sheet')
  sheet.append(
    el('div', 'eyebrow', '🎒 NEW MODE'),
    el('h3', '', 'School/Exam Mode'),
    el('p', 'muted', 'Smaller targets, faster XP. Only switch to it for a genuinely busy week — you can switch back anytime.'),
  )
  const switchBtn = el('button', 'btn btn-primary', 'Switch to School/Exam')
  switchBtn.onclick = async () => {
    switchBtn.disabled = true
    const res = await call('setMode', { agentNo: getAgentNo(), mode: 'exam' })
    if (res.success) { setState(res); toast("You're on School/Exam mode now") }
    else toast(res.error || "Couldn't switch mode")
    hideOverlay()
  }
  sheet.appendChild(switchBtn)
  const keep = el('button', 'btn btn-ghost', "I'm ok with my mode")
  keep.onclick = hideOverlay
  sheet.appendChild(keep)
  return sheet
}
