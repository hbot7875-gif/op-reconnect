// MAMA Battle share — the words and choices, no DOM, no canvas.
//
// Shared by the in-game share sheet (voting.js), the poster renderer
// (battle-poster.js) and the public /battle page (battle-page.js), so the
// poster, the share text and the page can never disagree about who leads.
//
// Input is the public battle summary (getPublicBattle): team totals and
// head counts, the community total, milestones, phase and timing. Nothing
// per-agent exists here, and nothing here ever adds an agent to a link — a
// recruit link names a TEAM (…/battle?team=aliens), never who shared it.

export const BATTLE_URL = 'https://hopetrackers.org/battle'
export const BATTLE_HOST_PATH = 'hopetrackers.org/battle'
export const TEAM_IDS = ['hooligans', 'aliens']

// Three colourways of one campaign-graphic structure (battle-poster.js).
export const STYLES = ['V1', 'V2', 'V3']
export const STYLE_NAMES = { V1: 'Black', V2: 'Cream', V3: 'Purple' }

// The default line per team. Players may swap in their own short text for
// one share session (battle-lyric-filter.js); it is never sent anywhere.
export const LYRICS = { hooligans: 'Watch this.', aliens: 'Yeah, we aliens.' }

// Recruiting, in each side's own voice. Modelled on how BTS voting
// fanbases post on X during MAMA (Oct 2026): "START LOCKING IN", "WHERE ARE
// YOU ARMY??", "PROTECT THE GAP", "daily voting is a MUST", "it only takes
// a few minutes" — direct, urgent, practical, never a slogan. The Daesang is
// Fans' Choice of the Year with VISA: BTS won it 2018–2023, so a win now is
// their 7th as a group (the line fan accounts are using); votes reset to
// zero for this round.
export const RECRUIT = {
  hooligans: {
    emoji: '🔥',
    shout: 'HOOLIGANS ARE RECRUITING',
    hype: ['HOOLIGANS, START LOCKING IN.', 'LET’S GET BTS THEIR 7TH DAESANG.'],
    behind: 'WE’RE BEHIND. HOOLIGANS, LOCK IN!',
    ahead: 'WE’RE AHEAD. PROTECT THE GAP!',
    pitch: '🚨 HOOLIGANS, start locking in! BTS won Fans’ Choice of the Year 6 times in a row, so this would be their 7th Daesang. Votes reset to zero, every day counts. Let’s make it happen 💜☝️',
  },
  aliens: {
    emoji: '👽',
    shout: 'ALIENS ARE RECRUITING',
    hype: ['ALIENS, WHERE ARE YOU??', 'BTS’S 7TH DAESANG STARTS DAY ONE.'],
    behind: 'WE’RE BEHIND. WHERE ARE YOU ALIENS??',
    ahead: 'WE’RE AHEAD. PROTECT THE GAP!',
    pitch: '🔔 ALIENS, we need every vote! If BTS win the Daesang it’s their 7th Fans’ Choice of the Year. It only takes a few minutes a day, so vote with us 🥹🙏',
  },
}

const KST_MS = 9 * 3600_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US')

/** "21:40" — the KST wall clock of an instant. */
export function kstClock(at) {
  return new Date(new Date(at).getTime() + KST_MS).toISOString().slice(11, 16)
}

/** "Oct 28, 18:00 KST" — a KST date and time. */
export function kstWhen(at) {
  const k = new Date(new Date(at).getTime() + KST_MS)
  return `${MONTHS[k.getUTCMonth()]} ${k.getUTCDate()}, ${k.toISOString().slice(11, 16)} KST`
}

/** The recruit link for one side. A team id, nothing else. */
export function recruitUrl(team) {
  return TEAM_IDS.includes(team) ? `${BATTLE_URL}?team=${team}` : BATTLE_URL
}

/** A ?team= value from a URL query, or null. */
export function teamFromQuery(search) {
  const t = new URLSearchParams(String(search || '')).get('team')
  return TEAM_IDS.includes(t) ? t : null
}

function leftText(ms) {
  if (ms <= 0) return null
  const h = Math.floor(ms / 3600_000)
  const d = Math.floor(h / 24)
  if (d >= 1) return `${d}d ${h % 24}h left`
  const m = Math.floor((ms % 3600_000) / 60_000)
  return h ? `${h}h ${m}m left` : `${Math.max(1, m)}m left`
}

/** The recruit bonus in one sentence, or null when the round has none.
 *  rb: { per, points } (battle.recruit_bonus). */
export function bonusRule(rb, teamLabel = null) {
  if (!rb?.per || !rb?.points) return null
  return `Every ${rb.per} new ARMY who join${teamLabel ? ` ${teamLabel}` : ''} and get a vote verified = +${rb.points} ${rb.points === 1 ? 'point' : 'points'}${teamLabel ? '' : ' for their side'}`
}

/** One side's recruit bonus so far: { qualified, bonus, toNext } — toNext
 *  is how many more new voters until the next bonus point. */
export function bonusProgress(team, rb) {
  if (!rb?.per) return null
  const qualified = Number(team?.qualified) || 0
  return { qualified, bonus: Number(team?.bonus) || 0, toNext: rb.per - (qualified % rb.per) }
}

/** "2d 4h" / "5h 12m" / "8m" until an instant, or null once it passed. */
export function untilText(at, now = new Date()) {
  const t = leftText(new Date(at).getTime() - new Date(now).getTime())
  return t ? t.replace(' left', '') : null
}

/**
 * Everything the poster, the share text and the page show, from one summary.
 *   phase: 'soon' (recruiting, before voting opens) | 'open'
 *        | 'verifying' (voting closed, before the freeze) | 'final'
 */
export function battleView(summary, now = new Date()) {
  const team = (id) => summary.teams.find((t) => t.id === id) || { id, label: id.toUpperCase(), points: 0, agents: 0, recruits: 0 }
  const h = team('hooligans')
  const a = team('aliens')
  const phase = summary.phase
  const soon = phase === 'soon'
  const gap = Math.abs(h.points - a.points)
  const leader = soon || h.points === a.points ? null : h.points > a.points ? h : a
  const total = Number(summary.total) || h.points + a.points
  const next = summary.next || null
  const msLeft = new Date(summary.closesAt).getTime() - new Date(now).getTime()
  const winners = phase === 'final' ? summary.winners || null : null
  const finalHours = phase === 'open' && msLeft > 0 && msLeft <= 24 * 3600_000
  const opens = summary.opensAt ? kstWhen(summary.opensAt) : null
  const finalAt = kstWhen(summary.freezeAt || summary.closesAt)

  let status
  if (soon) status = opens ? `Voting opens ${opens}` : 'Voting opens soon'
  else if (winners?.length === 1) status = `${team(winners[0]).label} WIN`
  else if (!leader) status = `TIED AT ${fmt(h.points)}`
  else status = `${leader.label} +${fmt(gap)}`

  let gift
  if (phase === 'final') gift = `Final score · ${fmt(total)} community votes`
  else if (phase === 'verifying') gift = `Voting closed · final score ${finalAt}`
  else if (soon) gift = next ? `First Battle Gift at ${fmt(next.target)} votes` : 'Battle Gifts unlock as ARMY votes'
  else if (next) gift = `Next Battle Gift at ${fmt(next.target)} · ${fmt(next.remaining)} to go`
  else gift = 'All Battle Gifts unlocked'

  // The poster's big middle line: the gap is the urgency — or, before
  // voting opens, the start.
  let gapLine
  if (soon) gapLine = opens ? `OPENS ${opens.replace(' KST', '').toUpperCase()}` : 'OPENS SOON'
  else if (winners?.length === 1) gapLine = `${team(winners[0]).label} WIN BY ${fmt(gap)}`
  else if (!leader) gapLine = `TIED AT ${fmt(h.points)}`
  else gapLine = `${fmt(gap)} ${gap === 1 ? 'VOTE' : 'VOTES'} APART`

  const state = soon ? 'SOON' : phase === 'final' ? 'FINAL' : phase === 'verifying' ? 'CLOSED' : 'LIVE'
  return {
    phase, h, a, gap, total, next, finalHours, winners, gapLine, opens, finalAt,
    recruitBonus: summary.recruitBonus || null,
    // Before voting opens the big numbers are agents on each side.
    unit: soon ? 'AGENTS' : null,
    shown: (t) => (soon ? t.agents || 0 : t.points),
    posterCta: soon ? ['PICK A SIDE.', 'VOTE FOR BTS DAILY.'] : phase === 'open' ? ['PICK A SIDE.', 'VOTE FOR BTS.'] : ['EVERY VOTE', 'WENT TO BTS.'],
    liveLine: `${summary.roundLabel ? `${String(summary.roundLabel).toUpperCase()} · ` : ''}${state} · ${kstClock(summary.updatedAt || now)} KST`,
    leader: leader?.id || null,
    status,
    statusParts: soon ? ['OPENS', opens || 'SOON']
      : winners?.length === 1 ? [team(winners[0]).label, 'WIN'] : leader ? [leader.label, `+${fmt(gap)}`] : ['TIED AT', fmt(h.points)],
    gift,
    left: phase === 'open' ? leftText(msLeft) : null,
    startsIn: soon && summary.opensAt ? untilText(summary.opensAt, now) : null,
    cta: soon || phase === 'open' ? 'PICK A SIDE →' : 'SEE THE BATTLE →',
    clock: kstClock(summary.updatedAt || now),
    footer: `Live · ${kstClock(summary.updatedAt || now)} KST · ${BATTLE_HOST_PATH}`,
  }
}

/**
 * One side's recruiting view — the per-team poster, share text and the
 * /battle?team= page. Rivalry sells: it leads with this side's head count,
 * how many joined this round and, once voting is open, where the side stands.
 */
export function recruitView(summary, teamId, now = new Date()) {
  const v = battleView(summary, now)
  const me = teamId === 'aliens' ? v.a : v.h
  const rival = teamId === 'aliens' ? v.h : v.a
  const words = RECRUIT[me.id] || RECRUIT.hooligans
  const live = v.phase === 'open'
  let standing = null
  if (live && !v.leader) standing = `TIED AT ${fmt(me.points)}`
  else if (live && v.leader === me.id) standing = `${fmt(v.gap)} ${v.gap === 1 ? 'VOTE' : 'VOTES'} AHEAD`
  else if (live) standing = `${fmt(v.gap)} ${v.gap === 1 ? 'VOTE' : 'VOTES'} BEHIND`
  const ahead = live && v.leader === me.id
  return {
    ...v,
    team: me,
    rival,
    words,
    url: recruitUrl(me.id),
    hostPath: `${BATTLE_HOST_PATH}?team=${me.id}`,
    shout: live ? `${me.label} NEED YOU` : words.shout,
    agentsLine: `${fmt(me.agents)} ${me.agents === 1 ? 'AGENT' : 'AGENTS'} READY`,
    recruitsLine: me.recruits ? `+${fmt(me.recruits)} JOINED THIS ROUND` : 'BE THE FIRST NEW RECRUIT',
    standing,
    hype: live ? [ahead ? words.ahead : words.behind, `DAILY VOTING UNTIL ${kstWhen(summary.closesAt).split(',')[0].toUpperCase()}. NO LAST-MINUTE.`] : words.hype,
    teamCta: [`JOIN ${me.label}.`, 'VOTE FOR BTS.'],
    bonusLine: bonusRule(v.recruitBonus, me.label),
    // The poster's short form of the same rule.
    bonusShort: v.recruitBonus?.per && v.recruitBonus?.points
      ? `EVERY ${v.recruitBonus.per} NEW ARMY WHO VOTE = +${v.recruitBonus.points} ${v.recruitBonus.points === 1 ? 'POINT' : 'POINTS'}` : null,
    bonus: bonusProgress(me, v.recruitBonus),
  }
}

/** Visual-only weights for the first poster style. */
export function styleWeights(view) {
  if (view.phase === 'soon') return { V1: 0.4, V2: 0.2, V3: 0.4 }
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

/** The text that travels with the poster. Live scores, the public link.
 *  No vote hashtags on purpose: a promo post must never be mistaken for —
 *  or spoil — someone's one counted vote post of the day. */
export function shareText(view) {
  const score = `${view.h.label} ${fmt(view.h.points)} vs ${view.a.label} ${fmt(view.a.points)}`
  if (view.phase === 'soon') {
    return `MAMA Battle · Round 2 is coming 🔥👽\n${view.h.label} ${fmt(view.h.agents)} agents vs ${view.a.label} ${fmt(view.a.agents)} agents\nThe Daesang vote opens ${view.opens || 'soon'}. Pick a side before it starts.\n${BATTLE_URL}`
  }
  if (view.phase === 'final') return `MAMA Battle final score 🔥\n${score}\nEvery vote went to BTS.\n${BATTLE_URL}`
  if (view.phase === 'verifying') return `MAMA Battle · voting closed\n${score}\nFinal score ${view.finalAt}.\n${BATTLE_URL}`
  return `MAMA Battle is live 🔥\n${score}\nPick a side. Vote for BTS. Move the score.\n${BATTLE_URL}`
}

/** One side's recruiting text, ending with that side's link. */
export function recruitText(rv) {
  const w = rv.words
  if (rv.phase === 'soon') {
    return `${w.emoji} ${rv.team.label} ARE RECRUITING · MAMA Battle Round 2\n${w.pitch}\nDaesang voting opens ${rv.opens || 'soon'} · ${fmt(rv.team.agents)} agents ready${rv.team.recruits ? `, +${fmt(rv.team.recruits)} new this round` : ''}${rv.bonusLine ? `\n${rv.bonusLine}.` : ''}\n${rv.url}`
  }
  if (rv.phase === 'open') {
    return `${w.emoji} ${rv.team.label} NEED YOU · MAMA Battle Round 2\n${rv.team.label} ${fmt(rv.team.points)} vs ${rv.rival.label} ${fmt(rv.rival.points)} (${rv.standing.toLowerCase()})\nEvery verified vote moves the score and goes to BTS. The Daesang is on the line.${rv.bonusLine ? `\n${rv.bonusLine}.` : ''}\n${rv.url}`
  }
  return `${shareText(rv).replace(`\n${BATTLE_URL}`, '')}\n${rv.url}`
}
