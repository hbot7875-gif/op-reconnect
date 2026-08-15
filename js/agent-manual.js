// Agent Manual — a quick-start guide first, reference material second.
//
// A new agent should be able to understand the core loop without reading an
// encyclopedia. The four steps and deadline rescue stay visible; exact XP,
// ReConnect, power, shop, and safety rules live in expandable sections.
//
// Numbers here mirror the implementation: 20 album-goal streams per Charge
// Cell and 2 hours per Cell (charge-economy.ts), 10-hour Era Cards, the
// 10/20/30 goal-stream XP cadence (config.ts), +10/+30 Signal Sweep
// (side-missions.ts), +50 district restoration (config.ts), 24-hour invite
// expiry (reconnect-missions.ts), and the 7/14-day safety clocks.

import { el, hideOverlay } from './state.js'

const QUICK_START = [
  ['1', 'Check your ARMY Bomb', 'Open City and tap the Bomb. Feed it a Charge Cell, or switch on Auto Feed so it can use one when power runs out.'],
  ['2', 'Stream your assigned goals', "Open your active district and use Build today's queue. Only goals shown on that district board count toward its restoration."],
  ['3', 'Team up when ReConnect appears', 'Invite a waiting agent—or accept an invite sent to you. The mission card tells you whether acceptance completes it or the team streams toward a shared target.'],
  ['4', 'Finish before the timer ends', 'A district attempt lasts 7 days. Complete its Track, Album, and ReConnect goals to restore it and earn XP.'],
]

const XP_SOURCES = [
  ['🎵', 'Assigned goal streams', 'Easy: 10 streams = 1 XP · Medium: 20 = 1 XP · Hard: 30 = 1 XP. Only streams for your active Track and Album Goals count.'],
  ['📡', 'Signal Sweep', "Stream Wild Flower, Don't Say You Love Me, Haegeum, and Killin' It Girl. All four once before midnight KST earns +10 XP; all four at 20 streams in one week earns another +30 XP."],
  ['🏙️', 'Restore a district', 'Complete every mission on its board to bring it online and earn +50 XP.'],
  ['🚨', 'Red Zone', 'Stream at least 7 times to qualify. If the network wins, the displayed XP pool is split among all qualifying agents.'],
]

const TEAM_STEPS = [
  ['Open the mission', 'A ReConnect mission does not pair you automatically.'],
  ['Invite or accept', 'Choose one waiting agent, or accept an invite you received. Accepting is enough—you do not also need to invite someone.'],
  ['Follow the mission card', 'Some missions complete when the invite is accepted; others combine both agents’ streams toward one shared target. Either way, completion counts for both.'],
]

function detailSection(title, open = false) {
  const section = el('details', 'am-details')
  section.open = open
  section.appendChild(el('summary', '', `<span>${title}</span><i>▾</i>`))
  const body = el('div', 'am-details-body')
  section.appendChild(body)
  return { section, body }
}

function infoRow(icon, title, body) {
  return el('div', 'am-xp-row', `
    <span class="am-xp-icon">${icon}</span>
    <span><b>${title}</b><small>${body}</small></span>
  `)
}

export function agentManualSheet() {
  const sheet = el('div', 'sheet agent-manual')
  const content = el('div', 'am-scroll')
  content.appendChild(el('div', 'eyebrow', '📖 HOW TO PLAY'))
  content.appendChild(el('h3', 'am-title', 'Your mission in 30 seconds'))
  content.appendChild(el('p', 'am-intro', 'Keep your ARMY Bomb powered, finish the missions in your active district, and restore the city one district at a time.'))

  const quick = el('section', 'am-section am-quick')
  for (const [number, title, body] of QUICK_START) {
    quick.appendChild(el('div', 'am-step', `
      <span class="am-step-number">${number}</span>
      <span><b>${title}</b><small>${body}</small></span>
    `))
  }
  content.appendChild(quick)

  const rescue = el('section', 'am-rescue')
  rescue.appendChild(el('div', 'am-rescue-icon', '⏳'))
  rescue.appendChild(el('div', '', `
    <b>Need more time?</b>
    <p>Every Level grants <strong>1 Deadline Extension Charge</strong>. During the final 2 days, the district board lets you spend one to add <strong>3 days</strong>.</p>
    <small>Only one extension can be used per district attempt. Unused Charges stay in your Pack.</small>
  `))
  content.appendChild(rescue)

  const xp = detailSection('XP and Level rewards', true)
  for (const [icon, title, body] of XP_SOURCES) xp.body.appendChild(infoRow(icon, title, body))
  xp.body.appendChild(infoRow('⬆️', 'Level up', 'Every Level grants 1 Deadline Extension Charge, 1 Streak Freeze, and 2× XP for 60 minutes. Fuel is no longer a Level reward.'))
  xp.body.appendChild(el('p', 'am-footnote', 'XP raises your Level and Rank. Buying Wings in the Magic Shop is the only action that spends XP.'))
  content.appendChild(xp.section)

  const team = detailSection('How ReConnect teams work')
  team.body.appendChild(el('p', 'am-intro', 'Some districts need one other agent before they can come back online.'))
  for (const [title, body] of TEAM_STEPS) {
    team.body.appendChild(el('div', 'am-step', `
      <span class="am-step-number">·</span>
      <span><b>${title}</b><small>${body}</small></span>
    `))
  }
  team.body.appendChild(el('p', 'am-footnote', 'Unanswered invites expire after 24 hours. If a teammate goes quiet, the mission explains when they can be removed; an actively streaming teammate cannot be removed. You may leave a mission yourself at any time.'))
  content.appendChild(team.section)

  const power = detailSection('Bomb power and emergency backup')
  power.body.appendChild(infoRow('⚡', 'Charge Cells', 'Every 20 counted Album Goal streams earns 1 Cell automatically. Goal progress stays counted, and each Cell adds 2 hours of Bomb power.'))
  power.body.appendChild(infoRow('💿', 'Lit Era Cards', 'Stream every track in an era during the week to light its card. Use it from Pack for 10 emergency hours; cards reset Monday.'))
  power.body.appendChild(el('p', 'am-footnote', 'Auto Feed can spend banked Cells when the Bomb runs out, but it does not count as personally feeding the Bomb.'))
  content.appendChild(power.section)

  const extras = detailSection('Streaks, Wings, and the Ticket')
  extras.body.appendChild(infoRow('🔥', 'Streaks', 'Streaming on consecutive days builds a streak, with badges at 7, 30, and 100 days. A Streak Freeze automatically covers one missed day.'))
  extras.body.appendChild(infoRow('🪽', 'Wings', 'The Magic Shop sells up to 3 Wings a day for 1 XP total. Candy Star spends 1 Wing each time it generates a playlist.'))
  extras.body.appendChild(infoRow('🎫', 'Ticket', 'Unlocks at Level 7 after restoring 3 districts while holding 50 XP. Claiming it does not spend that XP.'))
  content.appendChild(extras.section)

  const safety = detailSection('Deadlines and account safety')
  safety.body.appendChild(infoRow('⏳', 'District deadline', 'If the 7-day timer expires, that attempt resets and its goal progress is cleared. Start the district again whenever you like; XP, Charges, merch, and badges remain safe.'))
  safety.body.appendChild(infoRow('💡', 'Bomb blackout', 'A short blackout is only a warning. After 7 dark days your active district resets; after 14 dark days restored districts reset. Streak Freezes can delay these resets.'))
  safety.body.appendChild(infoRow('⚠️', 'Agent-file inactivity', 'Go 7 days without personally tapping Feed the Bomb and you receive a warning. At 14 days the agent file is permanently deleted. Auto Feed does not reset this clock.'))
  content.appendChild(safety.section)

  sheet.appendChild(content)

  const close = el('button', 'btn btn-ghost', 'Got it')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}
