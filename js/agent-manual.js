// Agent Manual — the shortest useful explanation of the game. This is not
// an encyclopedia: it answers the questions a new agent actually has
// ("how do I keep my Bomb alive?", "how do I earn XP?", "how does teaming
// up work?", "what happens if I run out of time?").
//
// Teaming up gets a section of its own because it was the single biggest
// source of real confusion: it used to be one clause inside step 3, which
// never said that one agent invites and the other accepts — so an agent who
// had only ever ACCEPTED an invite reported their mission completing without
// them having invited anybody, with nothing in the game to explain it.
//
// Everything with a number in it is mirrored from code, not restated from
// memory: 20 streams/Cell and 2h each (charge-economy.ts, agent-charge.ts),
// 10h era cards (HOURS_PER_LIT_ERA), 10/20/30 streams per XP by mode
// (config.ts's streamsPerXpFor), +10/+30 Signal Sweep (side-missions.ts),
// +50 district (xpRules), the 1-day invite expiry (INVITE_TTL_MS) and the
// 7/14-day blackout tiers (agent-charge.ts). If any of those change, this
// file is the other place that has to change.

import { el, hideOverlay } from './state.js'

const STEPS = [
  ['1', 'Check your ARMY Bomb', 'Your remaining charge is shown on City. Tap the Bomb to feed it, or turn on Auto Feed to use Cells when its power runs out.'],
  ['2', 'Earn Charge Cells', 'Every 20 counted Album Goal streams automatically earns 1 Charge Cell. Your Album Goal progress does not drop, and each Cell adds 2 hours.'],
  ['3', 'Restore districts', 'Complete the active Track, Album, and ReConnect goals before the 7-day timer ends. A ReConnect goal needs another agent — see Teaming up below.'],
  ['4', 'Build backup power', 'Stream every track in an era during the week to activate its card. It stays in Pack until you use it for 10 emergency hours, then resets Monday.'],
]

const XP_SOURCES = [
  ['🎵', 'Assigned goal streams', 'Only tracks listed in your active Track Goals and Album Goals count. Easy: 10 streams = 1 XP · Medium: 20 = 1 XP · Hard: 30 = 1 XP.'],
  ['📡', 'Signal Sweep', "BOTZ needs four signals to stay stable. Stream Wild Flower, Don't Say You Love Me, Haegeum, and Killin' It Girl once each before midnight KST. Recovering all four protects the city signal and earns +10 XP once that day. Getting all four to 20 streams in the same week earns a further +30 XP, once per week."],
  ['🏙️', 'District restored', 'Finish its Track Goals, Album Goals, and ReConnect Goal to bring the district online and earn +50 XP.'],
  ['🚨', 'Red Zone pool', 'Stream at least 7 times during the event to qualify. If the network defuses it, the displayed XP pool is divided among every qualified agent.'],
  ['⬆️', 'Every Level you reach', 'Each Level pays 1 Streak Freeze, 1 Deadline Extension Charge, and doubles your XP for 60 minutes. Level-ups are where both Streak Freezes and Extension Charges come from.'],
]

// The flow nobody could work out from the old one-clause mention.
const TEAM_STEPS = [
  ['Open a mission', 'On a district with a ReConnect goal, open a mission first. That alone does not team you up with anyone.'],
  ['Invite one agent', "You pick someone specific from the list of agents waiting for a partner — there is no automatic matching. They get a notification."],
  ['They accept', 'Only then are you a team. If someone invited YOU, accepting is your whole part of that step — you never need to send an invite of your own.'],
  ['Stream together', 'Both of you keep streaming toward the goal. The mission completes for both sides at once.'],
]

function sectionTitle(text) {
  return el('div', 'am-section-title', text)
}

export function agentManualSheet() {
  const sheet = el('div', 'sheet agent-manual')
  const content = el('div', 'am-scroll')
  content.appendChild(el('div', 'eyebrow', '📖 HOW TO PLAY'))
  content.appendChild(el('p', 'am-intro', 'Keep your ARMY Bomb charged. Complete assigned goals to restore districts and earn XP.'))

  const play = el('section', 'am-section')
  play.appendChild(sectionTitle('Keep the Bomb alive'))
  for (const [number, title, body] of STEPS) {
    play.appendChild(el('div', 'am-step', `
      <span class="am-step-number">${number}</span>
      <span><b>${title}</b><small>${body}</small></span>
    `))
  }
  content.appendChild(play)

  const xp = el('section', 'am-section')
  xp.appendChild(sectionTitle('How to earn XP'))
  for (const [icon, title, body] of XP_SOURCES) {
    xp.appendChild(el('div', 'am-xp-row', `
      <span class="am-xp-icon">${icon}</span>
      <span><b>${title}</b><small>${body}</small></span>
    `))
  }
  xp.appendChild(el('p', 'am-footnote', 'XP raises your Level and Rank. Your current progress is always shown at the top of the screen. Buying Wings in the Magic Shop is the one thing that spends XP.'))
  content.appendChild(xp)

  const team = el('section', 'am-section')
  team.appendChild(sectionTitle('Teaming up (ReConnect)'))
  team.appendChild(el('p', 'am-intro', 'Some districts need another agent before they will come back online.'))
  for (const [title, body] of TEAM_STEPS) {
    team.appendChild(el('div', 'am-step', `
      <span class="am-step-number">·</span>
      <span><b>${title}</b><small>${body}</small></span>
    `))
  }
  team.appendChild(el('p', 'am-footnote',
    'An invite nobody answers expires after a day, which frees both of you. '
    + "If a teammate goes quiet for a couple of days, or their own time on the district runs out, you can drop them and invite someone else — and you can leave a mission yourself at any point. Nobody can be removed while they are still streaming, however slowly."))
  content.appendChild(team)

  const shop = el('section', 'am-section')
  shop.appendChild(sectionTitle('Streaks, Wings and the Ticket'))
  shop.appendChild(el('p', '', 'Streaming on consecutive days builds a streak, with badges at 7, 30 and 100 days. A Streak Freeze covers one missed day automatically.'))
  shop.appendChild(el('p', '', 'The Magic Shop sells Wings — 3 a day, 1 XP each — which are spent generating Candy Star playlists. The Ticket unlocks once you reach Level 7, restore 3 districts and hold 50 XP; reaching that bar is its only cost.'))
  content.appendChild(shop)

  const dark = el('section', 'am-section am-charge-note')
  dark.appendChild(sectionTitle('If time runs out'))
  dark.appendChild(el('p', '', "Miss a district's 7-day timer and that attempt resets: its goal progress is cleared and the district goes back to available, so you can start it again whenever you like. Nothing you already earned is taken — XP, Charge Cells, merch and badges all stay."))
  dark.appendChild(el('p', '', "In the final 2 days, a '⏳ Extend deadline +3 days' button appears on the district board — spends one Deadline Extension Charge (earned from leveling up), once per attempt. Use it if you're close but the clock is about to beat you, especially if you're waiting on a ReConnect partner."))
  dark.appendChild(el('p', '', 'If the Bomb goes dark instead, a short blackout is only a warning. If it stays dark for 7 days, your active district resets. At 14 days, restored districts reset.'))
  dark.appendChild(el('p', '', 'Your XP, Level, Rank, badges, and merch remain safe. Each Streak Freeze is used automatically to cover one missed day and can delay a blackout reset.'))
  dark.appendChild(el('p', 'am-footnote',
    "That's about progress, not your account — a separate, stricter clock covers that. Go 7 days without personally tapping Feed the Bomb and you'll see a warning here; "
    + 'go 14 days and your agent file is permanently deleted, no recovery. Auto Feed spending your banked Charge Cells does not reset this clock — only tapping Feed yourself does.'))
  content.appendChild(dark)

  sheet.appendChild(content)

  const close = el('button', 'btn btn-ghost', 'Got it')
  close.onclick = hideOverlay
  sheet.appendChild(close)
  return sheet
}
