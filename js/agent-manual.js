// Agent Manual — the shortest useful explanation of the game. This is not
// an encyclopedia: it answers the two questions a new agent actually has
// ("how do I keep my Bomb alive?" and "how do I earn XP?").

import { el, hideOverlay } from './state.js'

const STEPS = [
  ['1', 'Check your ARMY Bomb', 'Your remaining charge is shown on City. Tap the Bomb whenever you need to feed it.'],
  ['2', 'Earn Charge Cells', 'Stream Album Goal tracks. Every 20 counted album streams earns 1 Charge Cell, and each Cell adds 4 hours.'],
  ['3', 'Restore districts', 'Enter your active district and complete its Track Goals, Album Goal, and Reconnect Mission before the 7-day timer ends.'],
  ['4', 'Build backup power', 'Stream every track in an era during the week to add 10 hours. Auto-feed can spend stored Charge Cells when your Bomb runs out.'],
]

const XP_SOURCES = [
  ['🎵', 'Assigned goal streams', 'Only tracks listed in your active Track Goals and Album Goals count. Easy: 10 streams = 1 XP · Medium: 20 = 1 XP · Hard: 30 = 1 XP.'],
  ['🏙️', 'District restored', 'Finish its Track Goals, Album Goals, and Reconnect Goal to bring the district online and earn +50 XP.'],
  ['🚨', 'Red Zone pool', 'Stream at least 7 times during the event to qualify. If the network defuses it, the displayed XP pool is divided among every qualified agent.'],
]

function sectionTitle(text) {
  return el('div', 'am-section-title', text)
}

export function agentManualSheet() {
  const sheet = el('div', 'sheet agent-manual')
  sheet.appendChild(el('div', 'eyebrow', '📖 HOW TO PLAY'))
  sheet.appendChild(el('p', 'am-intro', 'Keep your ARMY Bomb charged. Complete assigned goals to restore districts and earn XP.'))

  const play = el('section', 'am-section')
  play.appendChild(sectionTitle('Keep the Bomb alive'))
  for (const [number, title, body] of STEPS) {
    play.appendChild(el('div', 'am-step', `
      <span class="am-step-number">${number}</span>
      <span><b>${title}</b><small>${body}</small></span>
    `))
  }
  sheet.appendChild(play)

  const xp = el('section', 'am-section')
  xp.appendChild(sectionTitle('How to earn XP'))
  for (const [icon, title, body] of XP_SOURCES) {
    xp.appendChild(el('div', 'am-xp-row', `
      <span class="am-xp-icon">${icon}</span>
      <span><b>${title}</b><small>${body}</small></span>
    `))
  }
  xp.appendChild(el('p', 'am-footnote', 'XP raises your Level and Rank. Your current progress is always shown at the top of the screen.'))
  sheet.appendChild(xp)

  const dark = el('section', 'am-section am-charge-note')
  dark.appendChild(sectionTitle('If the Bomb goes dark'))
  dark.appendChild(el('p', '', 'A short blackout is a warning. If it stays dark for 7 days, your active district resets. At 14 days, restored districts reset.'))
  dark.appendChild(el('p', '', 'Your XP, Level, Rank, badges, and merch remain safe. Streak Freezes protect missed days automatically when available.'))
  sheet.appendChild(dark)

  const close = el('button', 'btn btn-ghost', 'Got it')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}
