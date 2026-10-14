// MAMA Battle share — the words and choices, no DOM, no canvas.
//
// Shared by the in-game share sheet (voting.js), the poster renderer
// (battle-poster.js) and the public /battle page (battle-page.js), so the
// poster, the share text and the page can never disagree about who leads.
//
// Input is the public battle summary (getPublicBattle): team totals, the
// community total, milestones, phase and timing. Nothing per-agent exists
// here, and nothing here ever adds an agent to a link.

export const BATTLE_URL = 'https://hopetrackers.org/battle'
export const BATTLE_HOST_PATH = 'hopetrackers.org/battle'

// Three colourways of one campaign-graphic structure (battle-poster.js).
export const STYLES = ['V1', 'V2', 'V3']
export const STYLE_NAMES = { V1: 'Black', V2: 'Cream', V3: 'Purple' }

// The default line per team. Players may swap in their own short text for
// one share session (battle-lyric-filter.js); it is never sent anywhere.
export const LYRICS = { hooligans: 'Watch this.', aliens: 'Yeah, we aliens.' }

const KST_MS = 9 * 3600_000
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US')

/** "21:40" — the KST wall clock of an instant. */
export function kstClock(at) {
  return new Date(new Date(at).getTime() + KST_MS).toISOString().slice(11, 16)
}

function leftText(ms) {
  if (ms <= 0) return null
  const h = Math.floor(ms / 3600_000)
  const d = Math.floor(h / 24)
  if (d >= 1) return `${d}d ${h % 24}h left`
  const m = Math.floor((ms % 3600_000) / 60_000)
  return h ? `${h}h ${m}m left` : `${Math.max(1, m)}m left`
}

/**
 * Everything the poster, the share text and the page show, from one summary.
 *   phase: 'open' | 'verifying' (voting closed, before the freeze) | 'final'
 */
export function battleView(summary, now = new Date()) {
  const team = (id) => summary.teams.find((t) => t.id === id) || { id, label: id.toUpperCase(), points: 0 }
  const h = team('hooligans')
  const a = team('aliens')
  const gap = Math.abs(h.points - a.points)
  const leader = h.points === a.points ? null : h.points > a.points ? h : a
  const total = Number(summary.total) || h.points + a.points
  const next = summary.next || null
  const msLeft = new Date(summary.closesAt).getTime() - new Date(now).getTime()
  const phase = summary.phase
  const winners = phase === 'final' ? summary.winners || null : null
  const finalHours = phase === 'open' && msLeft > 0 && msLeft <= 24 * 3600_000

  let status
  if (winners?.length === 1) status = `${team(winners[0]).label} WIN`
  else if (!leader) status = `TIED AT ${fmt(h.points)}`
  else status = `${leader.label} +${fmt(gap)}`

  let gift
  if (phase === 'final') gift = `Final score · ${fmt(total)} community votes`
  else if (phase === 'verifying') gift = 'Voting closed · final score Oct 23, 12:00 KST'
  else if (next) gift = `Next Battle Gift at ${fmt(next.target)} · ${fmt(next.remaining)} to go`
  else gift = 'All Battle Gifts unlocked'

  // The poster's big middle line: the gap is the urgency.
  let gapLine
  if (winners?.length === 1) gapLine = `${team(winners[0]).label} WIN BY ${fmt(gap)}`
  else if (!leader) gapLine = `TIED AT ${fmt(h.points)}`
  else gapLine = `${fmt(gap)} ${gap === 1 ? 'VOTE' : 'VOTES'} APART`

  return {
    phase, h, a, gap, total, next, finalHours, winners, gapLine,
    posterCta: phase === 'open' ? ['PICK A SIDE.', 'VOTE FOR BTS.'] : ['EVERY VOTE', 'WENT TO BTS.'],
    liveLine: `${phase === 'final' ? 'FINAL' : phase === 'verifying' ? 'CLOSED' : 'LIVE'} · ${kstClock(summary.updatedAt || now)} KST`,
    leader: leader?.id || null,
    status, statusParts: winners?.length === 1 ? [team(winners[0]).label, 'WIN'] : leader ? [leader.label, `+${fmt(gap)}`] : ['TIED AT', fmt(h.points)],
    gift,
    left: phase === 'open' ? leftText(msLeft) : null,
    cta: phase === 'open' ? 'PICK A SIDE →' : 'SEE THE BATTLE →',
    clock: kstClock(summary.updatedAt || now),
    footer: `Live · ${kstClock(summary.updatedAt || now)} KST · ${BATTLE_HOST_PATH}`,
  }
}

/** Visual-only weights for the first poster style. */
export function styleWeights(view) {
  const close = view.gap <= Math.min(10, Math.max(0, view.total * 0.02))
  const large = view.gap >= Math.max(60, view.total * 0.08)
  if (view.finalHours || (large && !close)) return { V1: 0.2, V2: 0.2, V3: 0.6 }
  if (close) return { V1: 0.45, V2: 0.45, V3: 0.1 }
  return { V1: 1 / 3, V2: 1 / 3, V3: 1 / 3 }
}

/** The first style, from the weights and one random number in [0, 1). */
export function pickStyle(view, rand = Math.random()) {
  const w = styleWeights(view)
  let acc = 0
  for (const s of STYLES) {
    acc += w[s]
    if (rand < acc) return s
  }
  return STYLES[STYLES.length - 1]
}

/** "Try another style": V1 → V2 → V3 → V1, so every style is reachable. */
export function nextStyle(style) {
  return STYLES[(STYLES.indexOf(style) + 1) % STYLES.length] || STYLES[0]
}

/** The text that travels with the poster. Live scores, the public link. */
export function shareText(view) {
  const score = `${view.h.label} ${fmt(view.h.points)} vs ${view.a.label} ${fmt(view.a.points)}`
  if (view.phase === 'final') return `MAMA Battle final score 🔥\n${score}\nEvery vote went to BTS.\n${BATTLE_URL}`
  if (view.phase === 'verifying') return `MAMA Battle · voting closed\n${score}\nFinal score Oct 23, 12:00 KST.\n${BATTLE_URL}`
  return `MAMA Battle is live 🔥\n${score}\nPick a side. Vote for BTS. Move the score.\n${BATTLE_URL}`
}
