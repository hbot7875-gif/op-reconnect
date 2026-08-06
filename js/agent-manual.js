// Agent Manual — plain-language how-to-play, no jargon. Every mechanic in
// the game gets one short, simple entry here: what it is, how you get it,
// what it's for. Static content, no backend call — same reasoning
// playlist.js gives for staying derivable from what's already known.

import { el, hideOverlay } from './state.js'

const SECTIONS = [
  {
    head: 'The basics',
    lines: [
      'The city went dark. Every district belonged to an agent. Streaming BTS brings it back, one district at a time.',
      'Pick a district on the map, stream the tracks it asks for, and it lights back up. That\'s the whole loop.',
    ],
  },
  {
    head: '🎯 Restoring a district',
    lines: [
      'Each district has up to three jobs: stream certain tracks a set number of times (Track Goals), stream a whole album through (Album Goals), and one special team-up task (Reconnect Mission).',
      'The Weekly Mission Board (in Pack) shows all three for your district in one place.',
      'You get one week to finish a district once you start it. Run out of time and it just goes back to available — you can try again.',
    ],
  },
  {
    head: '⚡ Personal Charge (your ARMY Bomb)',
    lines: [
      'Your own ARMY Bomb needs to stay charged, or your restored districts are at risk.',
      'Charge Cells feed it — each one buys 4 hours. You earn Charge Cells by streaming your district\'s Album Goal tracks (every 20 streams = 1 cell).',
      'Streaming every track in a whole era during the week lights that era up for +10 hours of charge. It only counts for that week.',
      'Turn on Auto-feed and it spends your Charge Cells for you the moment it runs out, so you don\'t have to remember.',
      'Go dark 7 days straight and your current district resets — you keep everything else, just start that one over. Go dark 14 days straight and every restored district reverts (your XP, badges and items are safe either way). If you have Streak Freezes saved up, they cover you automatically.',
    ],
  },
  {
    head: '🔥 Streaks & Freezes',
    lines: [
      'Stream something every day to keep your streak going. Miss a day and, if you have a Streak Freeze saved, it covers you automatically — no streak lost.',
      'Longer streaks unlock badges.',
    ],
  },
  {
    head: '⭐ XP & Levels',
    lines: [
      'Streaming earns XP. XP fills your level bar — level up for rewards and a new title.',
      'Your Rank is a slower-moving, more prestigious title based on your lifetime XP.',
    ],
  },
  {
    head: '🏪 Magic Shop',
    lines: [
      'Buy up to 3 Wings a day for 1 XP.',
      'Wings are spent making playlists in the Candy Star Generator — 1 Wing per playlist, up to 3 a day.',
      'Reach Level 7, restore 3 districts, and earn 50 XP, and you can claim a Ticket.',
    ],
  },
  {
    head: '🎖️ Badges',
    lines: [
      'Badges are earned automatically — for streaks, levels, districts restored, and lifetime XP. Check the Badge Drawer (in Pack) to see what you\'ve got and what\'s still locked.',
    ],
  },
  {
    head: '📡 Era Timeline',
    lines: [
      'A running tally of how much of BTS\'s whole discography the network has streamed together, era by era. It never resets — pure long-term progress.',
    ],
  },
  {
    head: '🚨 Red Zone',
    lines: [
      'Sometimes the whole network comes under attack. Everyone streaming together toward one shared target defuses it before time runs out. Anyone who helps gets a reward.',
    ],
  },
  {
    head: '🔔 Invites',
    lines: [
      'If another agent invites you to help restore their district, it shows up under the bell icon at the top of the screen. Accept or decline from there.',
    ],
  },
  {
    head: '🪦 Retirement Protocol',
    lines: [
      'If you ever want to stop for good, Settings → Security → Retirement Protocol locks your file for good. Your district stays on the map exactly as you left it — it just isn\'t yours to touch anymore. This can\'t be undone.',
    ],
  },
  {
    head: 'Keep it secret',
    lines: [
      'Never share your agent number. It\'s how the network knows it\'s you, and not everyone on it is a friend.',
    ],
  },
]

export function agentManualSheet() {
  const sheet = el('div', 'sheet agent-manual')
  sheet.appendChild(el('div', 'eyebrow', '📖 AGENT MANUAL'))
  sheet.appendChild(el('p', 'muted', 'How everything works, in plain words.'))

  for (const s of SECTIONS) {
    const block = el('div', 'bd-block')
    block.appendChild(el('div', 'bd-block-head', s.head))
    for (const line of s.lines) block.appendChild(el('p', 'am-line', line))
    sheet.appendChild(block)
  }

  const close = el('button', 'btn btn-ghost', 'Close')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}
