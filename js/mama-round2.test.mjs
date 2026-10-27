// MAMA 2026 · Round 2 (the Daesang vote) and the battle's recruiting window:
// rules, recruit links and copy, the posters, the public recruit page, the
// in-game screens and the City banner, the invite mark, and the server paths
// that open before voting does. SQL rules are in vote-campaign-sql.test.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  inPromo, cityPhase, decideXProof, extraHashtags, reviewReason, campaignPhase,
} from '../supabase/functions/op-reconnect/lib/vote-campaign-rules.js'
import {
  battleView, recruitView, recruitText, shareText, recruitUrl, teamFromQuery, kstWhen, untilText, RECRUIT, BATTLE_URL,
} from './battle-share-rules.js'
import { drawPoster, drawRecruitPoster, W, H } from './battle-poster.js'
import { battlePageHtml, joinUrl } from './battle-page-view.js'
import { rememberInvite, readInvite, clearInvite } from './battle-invite.js'
import { votingScreen, votingEventCard, teamChooser, guideSheet, shareSheet } from './voting-view.js'
import { liveStrip } from './battle-hub-view.js'
import { mamaTeamPopupDue, mamaTeamPopupCopy } from './mama-team-popup-rules.js'
import { votingStatus, votingLocal } from './voting-fixtures.js'
import {
  getVotingStatus, getVotingBanner, getPublicBattle, startVotingTeamChoice, submitXProof,
} from '../supabase/functions/op-reconnect/lib/vote-campaign-service.js'
import { getBattleChat } from '../supabase/functions/op-reconnect/lib/battle-hub-service.js'

const PROMO_NOW = new Date('2026-10-26T09:00:00Z') // Oct 26, 18:00 KST — two days before voting
const OPEN_NOW = new Date('2026-10-30T03:00:00Z') // Oct 30, 12:00 KST

const R2 = {
  id: 'mama_2026_r2', title: 'MAMA 2026', round_label: 'Round 2 · Daesang', active: true,
  opens_at: '2026-10-28T18:00:00+09:00', closes_at: '2026-11-08T23:59:59+09:00',
  missions: [
    { id: 'mnet', kind: 'mnet_certificate', label: 'Mnet Vote', max_daily: 3, vote_url: 'https://mnetplus.world/event/2026-mama',
      category_label: "Fans' Choice 2nd Vote", rule: 'Vote all three: Male → BTS, Female → your pick, Of the Year with VISA → BTS. Then save the certificate.',
      guide: ['Vote in all three categories to finish one round.'], certificate: { category_keywords: ["fans' choice category 2nd vote"] } },
    { id: 'x', kind: 'x_post', label: 'X Vote', max_daily: 3, max_handles: 3, hashtags: ['2026MAMAVOTE', 'BTS'], exclusive_hashtags: true,
      require_handle_match: true, rule: 'Use only #2026MAMAVOTE and #BTS.', guide: ['Add no other artist hashtag.'] },
  ],
  rewards: { badge_template_id: 'event_mama_2026', badge_verified_days: 5, badge_scope: ['mama_2026'] },
  gift: { name: 'Voting Gift', fill_per_verified: 1, threshold: 5, daily_open_cap: 2, rolls: 3, pool: [{ kind: 'xp', weight: 1, amount: 10 }] },
  battle: { enabled: true, choose_seconds: 7, promo_from: '2026-10-26T00:00:00+09:00', carry_teams_from: 'mama_2026',
    freeze_at: '2026-11-09T12:00:00+09:00', final_visible_hours: 48,
    teams: [{ id: 'hooligans', label: 'HOOLIGANS' }, { id: 'aliens', label: 'ALIENS' }], milestones: [300, 750, 1350, 2100, 3000] },
  pulse: { enabled: false },
}
const R1 = { ...R2, id: 'mama_2026', round_label: "Fans' Choice · Round 1", opens_at: '2026-10-12T19:00:00+09:00', closes_at: '2026-10-22T23:59:59+09:00',
  battle: { ...R2.battle, promo_from: undefined, freeze_at: '2026-10-23T12:00:00+09:00' }, rewards: { badge_template_id: 'event_mama_2026', badge_verified_days: 5 } }

/** Public battle summary (getPublicBattle shape). */
function summary({ phase = 'soon', points = [0, 0], agents = [412, 398], recruits = [21, 37] } = {}) {
  return {
    success: true, campaign: { id: R2.id, title: 'MAMA 2026', roundLabel: R2.round_label }, roundLabel: R2.round_label, phase,
    opensAt: R2.opens_at, closesAt: R2.closes_at, freezeAt: R2.battle.freeze_at, recruitBonus: { per: 3, points: 1 },
    teams: [
      { id: 'hooligans', label: 'HOOLIGANS', points: points[0], agents: agents[0], recruits: recruits[0], qualified: 10, bonus: 3 },
      { id: 'aliens', label: 'ALIENS', points: points[1], agents: agents[1], recruits: recruits[1], qualified: 4, bonus: 1 },
    ],
    total: points[0] + points[1], milestones: [{ target: 300, reached: false }], next: { target: 300, remaining: 300 - points[0] - points[1] },
    winners: null, updatedAt: '2026-10-26T09:00:00Z',
  }
}

// ── rules ─────────────────────────────────────────────────────────────

test('promo window: from battle.promo_from until voting opens; City phase "soon"', () => {
  assert.equal(inPromo(R2, PROMO_NOW), true)
  assert.equal(cityPhase(R2, PROMO_NOW), 'soon')
  assert.equal(campaignPhase(R2, PROMO_NOW), 'upcoming', 'still upcoming for proofs')
  assert.equal(inPromo(R2, new Date('2026-10-25T14:59:00Z')), false, 'before promo_from')
  assert.equal(cityPhase(R2, new Date('2026-10-25T14:59:00Z')), null)
  assert.equal(inPromo(R2, OPEN_NOW), false)
  assert.equal(cityPhase(R2, OPEN_NOW), 'open')
  assert.equal(cityPhase(R1, new Date('2026-10-24T03:00:00Z')), 'final', 'Round 1 showed its result for 48h after its freeze')
  assert.equal(cityPhase(R1, PROMO_NOW), null, '…and is gone from the City by the promo, so only one MAMA banner shows')
  assert.equal(inPromo({ ...R2, battle: { ...R2.battle, enabled: false } }, PROMO_NOW), false, 'no battle, no promo')
  assert.equal(inPromo({ ...R2, battle: { enabled: true } }, PROMO_NOW), false, 'no promo_from, no promo')
})

test('X: with exclusive hashtags, any other tag goes to a reviewer — never an automatic rejection', () => {
  const base = { requiredHashtags: ['2026MAMAVOTE', 'BTS'], expectedHandle: 'me', requireHandleMatch: true, dateOk: true }
  const ok = decideXProof({ ...base, exclusiveHashtags: true, fetched: { ok: true, authorHandle: 'me', hashtags: ['2026mamavote', 'BTS'] } })
  assert.deepEqual([ok.status, ok.note, ok.checks.onlyTags], ['verified', 'all_checks_passed', true])
  const extra = decideXProof({ ...base, exclusiveHashtags: true, fetched: { ok: true, authorHandle: 'me', hashtags: ['2026mamavote', 'bts', 'blackpink'] } })
  assert.deepEqual([extra.status, extra.note, extra.checks.onlyTags], ['review', 'extra_hashtags', false])
  assert.equal(reviewReason({ verify_note: 'extra_hashtags' }, 'x_post'), 'x_hashtags')
  // Round 1 (no flag) behaves as before.
  const r1 = decideXProof({ ...base, fetched: { ok: true, authorHandle: 'me', hashtags: ['2026mamavote', 'bts', 'army'] } })
  assert.deepEqual([r1.status, 'onlyTags' in r1.checks], ['verified', false])
  assert.deepEqual(extraHashtags(['#BTS', 'bts', '2026MAMAVOTE', 'Daesang'], ['2026MAMAVOTE', 'BTS']), ['daesang'])
})

// ── recruit links and words ───────────────────────────────────────────

test('recruit links name a team and nothing else', () => {
  assert.equal(recruitUrl('aliens'), `${BATTLE_URL}?team=aliens`)
  assert.equal(recruitUrl('hooligans'), `${BATTLE_URL}?team=hooligans`)
  assert.equal(recruitUrl('AGENT001'), BATTLE_URL)
  assert.equal(teamFromQuery('?team=aliens&ref=x'), 'aliens')
  assert.equal(teamFromQuery('?team=../../x'), null)
  assert.equal(joinUrl('aliens'), '/game?screen=voting&team=aliens')
})

test('soon: head counts lead, the vote opening is the urgency, the Daesang is the goal', () => {
  const v = battleView(summary(), PROMO_NOW)
  assert.equal(v.phase, 'soon')
  assert.equal(v.leader, null, 'no leader before a single vote')
  assert.equal(v.unit, 'AGENTS')
  assert.deepEqual([v.shown(v.h), v.shown(v.a)], [412, 398])
  assert.equal(v.gapLine, 'OPENS OCT 28, 18:00')
  assert.equal(v.startsIn, '2d 0h')
  assert.deepEqual(v.posterCta, ['PICK A SIDE.', 'VOTE FOR BTS DAILY.'])
  assert.match(shareText(v), /HOOLIGANS 412 agents vs ALIENS 398 agents[\s\S]*Daesang vote opens Oct 28, 18:00 KST/)
  assert.equal(kstWhen('2026-11-09T12:00:00+09:00'), 'Nov 9, 12:00 KST')
  assert.equal(untilText(R2.opens_at, OPEN_NOW), null)
})

test('each side recruits in its own voice and with its own link', () => {
  for (const id of ['hooligans', 'aliens']) {
    const rv = recruitView(summary(), id, PROMO_NOW)
    assert.equal(rv.team.id, id)
    assert.equal(rv.url, recruitUrl(id))
    assert.equal(rv.shout, RECRUIT[id].shout)
    const text = recruitText(rv)
    assert.ok(text.endsWith(`\n${recruitUrl(id)}`), 'ends with that side\'s link')
    assert.match(text, /Daesang/)
    assert.match(text, /Every 3 new ARMY who join (HOOLIGANS|ALIENS) and get a vote verified = \+1 point\./)
  }
  const a = recruitView(summary(), 'aliens', PROMO_NOW)
  assert.deepEqual([a.agentsLine, a.recruitsLine], ['398 AGENTS READY', '+37 JOINED THIS ROUND'])
  // Once voting runs: the score and where the side stands.
  const live = recruitView(summary({ phase: 'open', points: [120, 98] }), 'aliens', OPEN_NOW)
  assert.equal(live.shout, 'ALIENS NEED YOU')
  assert.equal(live.standing, '22 VOTES BEHIND')
  assert.equal(live.hype[0], RECRUIT.aliens.behind)
  assert.match(recruitText(live), /ALIENS 98 vs HOOLIGANS 120 \(22 votes behind\)/)
  const ahead = recruitView(summary({ phase: 'open', points: [120, 98] }), 'hooligans', OPEN_NOW)
  assert.deepEqual([ahead.standing, ahead.hype[0]], ['22 VOTES AHEAD', RECRUIT.hooligans.ahead])
})

test('promo texts carry no vote hashtags, so a share is never mistaken for a vote post', () => {
  const texts = [shareText(battleView(summary(), PROMO_NOW)), ...['hooligans', 'aliens'].flatMap((id) => [
    recruitText(recruitView(summary(), id, PROMO_NOW)), recruitText(recruitView(summary({ phase: 'open', points: [5, 9] }), id, OPEN_NOW)),
  ])]
  for (const t of texts) assert.doesNotMatch(t, /#\w/, t)
})

// ── posters ──────────────────────────────────────────────────────────

/** A fake 2D context that records text and measures ~0.6em per char. */
function fakeCtx() {
  const words = []
  const ctx = {
    words, font: '', fillStyle: '', textAlign: '', textBaseline: '', letterSpacing: '0px', lineWidth: 1, lineCap: '', strokeStyle: '',
    measureText(s) { return { width: String(s).length * Number(/(\d+)px/.exec(this.font)?.[1] || 10) * 0.6 } },
    fillText(s, x, y) { words.push({ s, x, y, font: this.font, w: this.measureText(s).width }) },
    fillRect() {}, beginPath() {}, moveTo() {}, arcTo() {}, closePath() {}, fill() {}, arc() {}, bezierCurveTo() {}, stroke() {},
    save() {}, restore() {}, translate() {}, rotate() {},
  }
  return ctx
}

test('recruit poster: the side, its numbers, the opening and its own link — all inside the margins', () => {
  for (const style of ['V1', 'V2', 'V3']) {
    for (const [id, s, now] of [['aliens', summary(), PROMO_NOW], ['hooligans', summary({ phase: 'open', points: [1234, 1190], agents: [1412, 1398] }), OPEN_NOW]]) {
      const ctx = fakeCtx()
      const rv = recruitView(s, id, now)
      drawRecruitPoster(ctx, style, rv, 'Yeah, we aliens.')
      const all = ctx.words.map((w) => w.s).join(' | ')
      assert.match(all, new RegExp(rv.team.label))
      assert.match(all, /MAMA VOTING BATTLE · ROUND 2/)
      assert.ok(ctx.words.some((w) => w.s === `hopetrackers.org/battle?team=${id}`), `${style} ${id}: own link`)
      assert.match(all, rv.phase === 'soon' ? /VOTING OPENS OCT 28, 18:00 KST/ : /EVERY VOTE COUNTS/)
      assert.match(all, new RegExp(`JOIN ${rv.team.label}\\.`))
      for (const w of ctx.words) {
        assert.ok(w.y > 0 && w.y < H, `${style}: "${w.s}" on the poster`)
        if (w.s.length > 3) assert.ok(w.w <= W - 60, `${style} ${id}: "${w.s}" fits (${Math.round(w.w)}px)`)
      }
    }
  }
})

test('battle poster before voting opens: agents per side, the opening, no fake leader', () => {
  const ctx = fakeCtx()
  drawPoster(ctx, 'V1', battleView(summary(), PROMO_NOW), { hooligans: 'Watch this.', aliens: 'Yeah, we aliens.' })
  const s = ctx.words.map((w) => w.s)
  assert.ok(s.includes('HOOLIGANS · AGENTS') && s.includes('ALIENS · AGENTS'))
  assert.ok(s.includes('412') && s.includes('398'))
  assert.ok(s.includes('OPENS OCT 28, 18:00'))
  assert.ok(s.includes('VOTE FOR BTS DAILY.'))
  assert.ok(ctx.words.every((w) => w.w <= W - 60 || w.s.length <= 3), 'every line fits')
})

// ── public page ──────────────────────────────────────────────────────

test('public page before voting: recruiting, agents per side, a Join button for each side', () => {
  const html = battlePageHtml(summary(), PROMO_NOW)
  assert.match(html, /The MAMA Battle is back/)
  assert.match(html, /RECRUITING · 18:00 KST/)
  assert.match(html, /data-bp-score="hooligans">412<small>agents<\/small>/)
  assert.match(html, /\+37 NEW/)
  assert.match(html, /Voting opens in<b>2d 0h<\/b>/)
  assert.match(html, /href="\/game\?screen=voting&team=hooligans"[\s\S]*Join HOOLIGANS[\s\S]*href="\/game\?screen=voting&team=aliens"[\s\S]*Join ALIENS/)
  assert.match(html, /Voting opens Oct 28, 18:00 KST\./)
})

test('recruit page (?team=): that side leads, joins that side, links back to the whole battle', () => {
  const html = battlePageHtml(summary(), PROMO_NOW, 'aliens')
  assert.match(html, /<span class="bp-tname">ALIENS<\/span>are recruiting/)
  assert.match(html, /398<small>agents ready<\/small>/)
  assert.match(html, /\+37 joined this round · vs HOOLIGANS 412/)
  assert.match(html, /href="\/game\?screen=voting&team=aliens"[^>]*>[\s\S]*Join ALIENS/)
  assert.doesNotMatch(html, /team=hooligans/, 'one side only')
  assert.match(html, /href="\/battle">See the whole battle/)
  const live = battlePageHtml(summary({ phase: 'open', points: [40, 52] }), OPEN_NOW, 'hooligans')
  assert.match(live, /HOOLIGANS<\/span>need you/)
  assert.match(live, /12 votes behind · vs ALIENS 52/)
  for (const h of [html, live]) assert.doesNotMatch(h, /AGENT\d|agent_no|codename/)
})

// ── invite mark ──────────────────────────────────────────────────────

function store() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
}

test('invite: kept from ?team= through sign-in, valid teams only, expires, cleared once a side is chosen', () => {
  const s = store()
  assert.equal(rememberInvite('?screen=voting', s), null)
  assert.equal(readInvite(s), null)
  assert.equal(rememberInvite('?screen=voting&team=aliens', s, 1000), 'aliens')
  assert.equal(readInvite(s, 2000), 'aliens')
  assert.equal(readInvite(s, 1000 + 15 * 86_400_000), null, 'two weeks on, forgotten')
  assert.equal(rememberInvite('?team=<script>', s), null)
  clearInvite(s)
  assert.equal(readInvite(s), null)
  const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }
  assert.equal(rememberInvite('?team=aliens', broken), 'aliens')
  assert.equal(readInvite(broken), null)
  clearInvite(broken)
})

// ── in-game screens ──────────────────────────────────────────────────

/** Voting status during the promo (getVotingStatus shape). */
function promoStatus({ myTeam = 'aliens' } = {}) {
  const s = votingStatus({ myTeam })
  s.campaign = {
    ...s.campaign, id: R2.id, roundLabel: R2.round_label, opensAt: R2.opens_at, closesAt: R2.closes_at, phase: 'upcoming', promo: true,
    freezeAt: R2.battle.freeze_at,
    missions: [
      { ...s.campaign.missions[0], categoryLabel: "Fans' Choice 2nd Vote", rule: R2.missions[0].rule, guide: R2.missions[0].guide },
      { ...s.campaign.missions[1], exclusiveHashtags: true, rule: R2.missions[1].rule, guide: R2.missions[1].guide },
    ],
  }
  s.battle = {
    ...s.battle, myTeam, total: 0, myPoints: 0, opensAt: R2.opens_at, closesAt: R2.closes_at, freezeAt: R2.battle.freeze_at,
    teams: [{ id: 'hooligans', label: 'HOOLIGANS', points: 0, size: 412, recruits: 21 }, { id: 'aliens', label: 'ALIENS', points: 0, size: 398, recruits: 37 }],
  }
  return s
}
const screen = (status, tab = 'battle', local = {}) => votingScreen({ status, local: { ...votingLocal(), tab, hub: {}, ...local }, now: PROMO_NOW, hub: { team: { loading: true }, chat: { loading: true } } })

test('hub before voting: SOON strip, agents per side, recruit for your side, your link', () => {
  const html = screen(promoStatus())
  assert.match(html, /data-vt-live="soon"/)
  assert.match(html, /opens in 2d 0h/)
  assert.match(html, /data-vt-battle="soon"/)
  assert.match(html, /<span class="vt-vs-pts">412<\/span>/)
  assert.match(html, /data-vt-act="battle-share" data-vt-mode="recruit"[^>]*>[\s\S]*?Recruit for ALIENS/)
  assert.match(html, /data-vt-act="share-link" data-vt-team="aliens"/)
  assert.match(html, /data-vt-clock>[\s\S]*Voting opens in <b>2d 0h<\/b>[\s\S]*Oct 28, 18:00 KST/)
  assert.match(html, /Agents on each side · votes start at 0/)
  assert.match(html, /class="vt-split" role="img" aria-label="HOOLIGANS 412 agents, ALIENS 398 agents"/)
  const none = screen(promoStatus({ myTeam: null }))
  assert.match(none, /data-vt-act="team-choose"[^>]*>[\s\S]*?Choose your team/)
  assert.doesNotMatch(none, /Recruit for/)
})

test('voting tab before voting: what to do on day one, no upload or post buttons', () => {
  const html = screen(promoStatus(), 'voting')
  const panel = html.slice(html.indexOf('data-vt-panel="voting"'))
  assert.match(panel, /Round 2 · Daesang opens/)
  assert.match(panel, /How to vote on day one/)
  assert.match(panel, /Male → BTS, Female → your pick, Of the Year with VISA → BTS/)
  assert.match(panel, /Use only #2026MAMAVOTE and #BTS\./)
  assert.doesNotMatch(panel, /data-vt-act="mnet-file"|data-vt-act="x-compose"/)
})

test('guide and cards use this round\'s words and dates, not Round 1\'s', () => {
  const s = promoStatus()
  const g = guideSheet({ status: s, local: votingLocal(), now: PROMO_NOW })
  assert.match(g, /Round 2 · Daesang · Oct 28 18:00 – Nov 8 23:59 KST/)
  assert.match(g, /Vote in all three categories/)
  assert.match(g, /Add no other artist hashtag/)
  assert.doesNotMatch(g, /Oct 12|Oct 22/)
  const open = { ...s, campaign: { ...s.campaign, phase: 'open', promo: false } }
  const html = screen(open, 'voting')
  const done = { ...open, states: { ...open.states, mnet: 'verified' }, todayProofs: [{ missionId: 'mnet', status: 'verified', checks: {} }] }
  assert.match(screen(done, 'voting'), /Fans&#39; Choice 2nd Vote/)
  assert.match(html, /Use only #2026MAMAVOTE and #BTS\./)
  assert.doesNotMatch(html, /1st Vote/)
  // The extra-hashtag review explains itself.
  const review = { ...open, states: { ...open.states, x: 'review' }, todayProofs: [{ missionId: 'x', status: 'review', checks: {}, hint: 'extra_hashtags' }] }
  assert.match(screen(review, 'voting'), /second artist hashtag, so a reviewer will check it/)
})

test('chooser: a carried side says so; an invite marks its button, still the agent\'s tap', () => {
  const vm = (chooser) => ({ status: promoStatus(), local: { ...votingLocal(), chooser }, now: PROMO_NOW })
  assert.match(teamChooser(vm({ result: 'aliens', via: 'carried' })), /Your Round 1 side carries over\./)
  const pick = teamChooser(vm({ secondsLeft: 7, picked: null, result: null, invite: 'aliens' }))
  assert.match(pick, /is-invited" type="button" data-vt-act="team-pick" data-vt-team="aliens"[^>]*>ALIENS<small>Your invite<\/small>/)
  assert.match(pick, /data-vt-team="hooligans"[^>]*>HOOLIGANS<\/button>/, 'both sides stay pickable')
})

test('share sheet: recruit or battle poster, your side\'s line only, the link explained', () => {
  const s = { url: 'blob:x', style: 'V1', styleName: 'Black', styleIndex: 1, mode: 'recruit', team: 'aliens', link: recruitUrl('aliens'), drafts: {}, errors: {} }
  const html = shareSheet({ status: promoStatus(), local: { ...votingLocal(), share: s }, now: PROMO_NOW })
  assert.match(html, /Recruit for your team/)
  assert.match(html, /data-vt-mode="recruit" aria-pressed="true"/)
  assert.match(html, /hopetrackers\.org\/battle\?team=aliens/)
  assert.match(html, /names the team, never you/)
  assert.match(html, /data-vt-lyric="aliens"/)
  assert.doesNotMatch(html, /data-vt-lyric="hooligans"/)
  const both = shareSheet({ status: promoStatus(), local: { ...votingLocal(), share: { ...s, mode: 'battle' } }, now: PROMO_NOW })
  assert.match(both, /data-vt-lyric="hooligans"[\s\S]*data-vt-lyric="aliens"/)
})

test('live strip before voting: SOON and head counts, never a live score', () => {
  const b = promoStatus().battle
  const html = liveStrip(b, PROMO_NOW, { promo: true })
  assert.match(html, /data-vt-live="soon"/)
  assert.match(html, /aria-label="HOOLIGANS 412, ALIENS 398 agents"/)
  assert.doesNotMatch(html, /LIVE/)
})

// ── City banner and popup ────────────────────────────────────────────

const soonBanner = (myTeam) => ({
  campaignId: R2.id, title: 'MAMA 2026', roundLabel: R2.round_label, phase: 'soon', opensAt: R2.opens_at, closesAt: R2.closes_at, done: 0, total: 6,
  battle: { myTeam, teams: [{ id: 'hooligans', label: 'HOOLIGANS', points: 0, agents: 412 }, { id: 'aliens', label: 'ALIENS', points: 0, agents: 398 }], total: 0, milestones: [], winners: null },
})

test('City banner before voting: agents per side, the countdown, recruit or choose', () => {
  const mine = votingEventCard(soonBanner('aliens'), PROMO_NOW)
  assert.match(mine, /data-vt-city="soon"/)
  assert.match(mine, /HOOLIGANS <b>412<\/b>[\s\S]*class="is-mine">ALIENS <b>398<\/b>[\s\S]*<small>agents<\/small>/)
  assert.match(mine, /Round 2 · Daesang · voting opens in 2d 0h/)
  assert.match(mine, /Recruit for ALIENS/)
  assert.match(votingEventCard(soonBanner(null), PROMO_NOW), /Choose your team/)
})

test('team popup asks during the promo too, once a day, with the invite\'s side first', () => {
  const s = store()
  assert.equal(mamaTeamPopupDue(soonBanner(null), { agentNo: 'AGENT001', now: PROMO_NOW, storage: s, screen: 'world' }), true)
  assert.equal(mamaTeamPopupDue(soonBanner('aliens'), { agentNo: 'AGENT001', now: PROMO_NOW, storage: s, screen: 'world' }), false)
  const c = mamaTeamPopupCopy(soonBanner(null), 'aliens')
  assert.equal(c.title, 'ALIENS want you')
  assert.match(c.body, /Daesang/)
  assert.equal(mamaTeamPopupCopy(soonBanner(null)).title, 'The battle is back')
})

// ── server: the promo, the rounds, the hashtag rule ──────────────────

function fakeDb({ campaigns = [R2, R1], tables = {}, rpc = {} } = {}) {
  const calls = { rpc: [] }
  const from = (table) => {
    const q = { table, filters: {} }
    const resolve = () => {
      if (table === 'rc_vote_campaigns') {
        const rows = campaigns.filter((c) => (q.filters.id ? c.id === q.filters.id : true))
        return q.single ? { data: rows[0] || null } : { data: rows }
      }
      const h = tables[table]
      return h ? h(q) : { data: q.single ? null : [], count: 0 }
    }
    const api = {
      select() { return api }, eq(k, v) { q.filters[k] = v; return api }, in(k, v) { q.filters[k] = v; return api },
      gte() { return api }, is() { return api }, not() { return api }, order() { return api }, limit() { return api },
      update() { return api }, upsert() { return Promise.resolve({ error: null }) },
      maybeSingle() { q.single = true; return Promise.resolve(resolve()) },
      then(ok, err) { return Promise.resolve(resolve()).then(ok, err) },
    }
    return api
  }
  return {
    calls, from,
    async rpc(name, args) { calls.rpc.push({ name, args }); return rpc[name] ? rpc[name](args) : { data: { success: true, id: 7, status: args.p_status } } },
  }
}
const battleState = { data: { teams: { hooligans: 0, aliens: 0 }, total: 0, frozen: false, teamSizes: { hooligans: 412, aliens: 398 }, recruits: { hooligans: 21, aliens: 37 }, mine: 0 } }

test('player status during the promo: Round 2, recruiting, badge days across rounds', async () => {
  const db = fakeDb({
    rpc: { rc_campaign_battle_state: () => battleState, rc_campaign_team_resolve: () => ({ data: { team: 'aliens', via: 'carried' } }) },
    tables: { rc_campaign_proofs: (q) => ({ data: Array.isArray(q.filters.campaign_id) ? [{ vote_day: '2026-10-13' }, { vote_day: '2026-10-15' }, { vote_day: '2026-10-13' }] : [] }) },
  })
  const s = await getVotingStatus(db, { agentNo: 'AGENT001' }, PROMO_NOW)
  assert.equal(s.campaign.id, 'mama_2026_r2', 'the recruiting round, not Round 1\'s closed page')
  assert.deepEqual([s.campaign.phase, s.campaign.promo], ['upcoming', true])
  assert.equal(s.campaign.missions[0].categoryLabel, "Fans' Choice 2nd Vote")
  assert.equal(s.campaign.missions[1].exclusiveHashtags, true)
  assert.deepEqual(s.campaign.missions[1].guide, ['Add no other artist hashtag.'])
  assert.deepEqual([s.battle.myTeam, s.battle.assignedVia], ['aliens', 'carried'])
  assert.deepEqual(s.battle.teams.map((t) => [t.id, t.size, t.recruits]), [['hooligans', 412, 21], ['aliens', 398, 37]])
  assert.deepEqual([s.badge.daysDone, s.badge.acrossRounds], [2, true], 'distinct days over both rounds')
  assert.deepEqual(s.extraBadges, [], 'no extra badge configured in this fixture')
})

test('City banner and public page during the promo: phase soon, head counts from the shared cache', async () => {
  const db = fakeDb({ rpc: { rc_campaign_battle_state: () => battleState } })
  const keys = []
  const cache = async (key, ttl, f) => { keys.push(key); return f() }
  const b = await getVotingBanner(db, 'AGENT001', PROMO_NOW, { cache })
  assert.deepEqual([b.campaignId, b.phase, b.opensAt], ['mama_2026_r2', 'soon', R2.opens_at])
  assert.deepEqual(b.battle.teams.map((t) => [t.agents, t.recruits]), [[412, 21], [398, 37]])
  const p = await getPublicBattle(db, PROMO_NOW, { cache })
  assert.deepEqual([p.phase, p.opensAt, p.teams[1].agents], ['soon', R2.opens_at, 398])
  assert.deepEqual(keys, ['vote_battle:mama_2026_r2', 'vote_battle:mama_2026_r2'])
})

test('sides open with the promo; before it, and for a round without one, they do not', async () => {
  const db = fakeDb({ rpc: { rc_campaign_team_start: () => ({ data: { team: null, startedAt: PROMO_NOW.toISOString(), deadline: new Date(PROMO_NOW.getTime() + 7000).toISOString() } }) } })
  const ok = await startVotingTeamChoice(db, { agentNo: 'AGENT009', campaignId: R2.id }, PROMO_NOW)
  assert.deepEqual([ok.success, ok.secondsLeft], [true, 7])
  const early = await startVotingTeamChoice(db, { agentNo: 'AGENT009', campaignId: R2.id }, new Date('2026-10-25T10:00:00Z'))
  assert.equal(early.error, 'voting_not_open')
})

test('X proofs: none before voting opens; once open, an extra hashtag goes to review', async () => {
  const id = (d) => ((BigInt(d.getTime()) - 1288834974657n) << 22n).toString()
  const verifier = (hashtags) => ({ method: 'x_oembed', async verify() { return { ok: true, authorHandle: 'me', hashtags } } })
  const handles = () => ({ data: [{ x_handle: 'me', agent_no: 'AGENT001' }] })
  const early = await submitXProof(fakeDb({ tables: { rc_agent_x_handles: handles } }),
    { agentNo: 'AGENT001', campaignId: R2.id, postUrl: `https://x.com/me/status/${id(PROMO_NOW)}` }, { verifier: verifier(['2026mamavote', 'bts']), now: PROMO_NOW })
  assert.equal(early.error, 'voting_not_open')
  const db = fakeDb({ tables: { rc_agent_x_handles: handles } })
  const r = await submitXProof(db, { agentNo: 'AGENT001', campaignId: R2.id, postUrl: `https://x.com/me/status/${id(new Date(OPEN_NOW.getTime() - 3600_000))}` },
    { verifier: verifier(['2026mamavote', 'bts', 'seventeen']), now: OPEN_NOW })
  assert.equal(r.success, true)
  const a = db.calls.rpc.find((c) => c.name === 'rc_campaign_submit_proof').args
  assert.deepEqual([a.p_status, a.p_note], ['review', 'extra_hashtags'])
})

test('team chat is open during the promo', async () => {
  const db = fakeDb({ rpc: { rc_battle_chat_feed: () => ({ data: { team: 'aliens', messages: [], moments: [], muted: [] } }) } })
  const r = await getBattleChat(db, { agentNo: 'AGENT001' }, PROMO_NOW, {})
  assert.deepEqual([r.success, r.open], [true, true])
})

// ── recruit bonus (shown to players) ─────────────────────────────────

test('recruit bonus: the rule, each side so far, and how many more your side needs', async () => {
  const { recruitBonusCard } = await import('./voting-view.js')
  const { bonusRule, bonusProgress } = await import('./battle-share-rules.js')
  const rb = { per: 3, points: 1 }
  assert.equal(bonusRule(rb), 'Every 3 new ARMY who join and get a vote verified = +1 point for their side')
  assert.equal(bonusRule(rb, 'ALIENS'), 'Every 3 new ARMY who join ALIENS and get a vote verified = +1 point')
  assert.equal(bonusRule(null), null)
  assert.deepEqual(bonusProgress({ qualified: 10, bonus: 3 }, rb), { qualified: 10, bonus: 3, toNext: 2 })
  assert.deepEqual(bonusProgress({ qualified: 0 }, rb), { qualified: 0, bonus: 0, toNext: 3 })
  const b = { ...promoStatus().battle, recruitBonus: rb }
  b.teams = b.teams.map((t) => ({ ...t, qualified: t.id === 'aliens' ? 4 : 10, bonus: t.id === 'aliens' ? 1 : 3 }))
  const card = recruitBonusCard(b)
  assert.match(card, /Recruit bonus<\/b> · Every 3 new ARMY who join and get a vote verified = \+1 point for their side/)
  assert.match(card, /HOOLIGANS <b>\+3<\/b> <small>10 new voters<\/small>[\s\S]*ALIENS <b>\+1<\/b> <small>4 new voters<\/small>/)
  assert.match(card, /ALIENS need 2 more new voters for the next \+1\. Share your team link\./)
  assert.equal(recruitBonusCard({ ...b, recruitBonus: null }), '', 'Round 1: no card')
  assert.match(screen({ ...promoStatus(), battle: b }), /data-vt-bonus/, 'on the Battle tab before voting opens')
})

test('recruit bonus on the public pages, posters and share text', () => {
  const page = battlePageHtml(summary({ phase: 'open', points: [120, 98] }), OPEN_NOW)
  assert.match(page, /\+3 RECRUIT BONUS/)
  assert.match(page, /Recruit bonus: Every 3 new ARMY who join and get a vote verified = \+1 point for their side\./)
  const rec = battlePageHtml(summary(), PROMO_NOW, 'aliens')
  assert.match(rec, /Every 3 new ARMY who join ALIENS and get a vote verified = \+1 point\. ALIENS have earned \+1 so far\. 2 more for the next point\./)
  const ctx = fakeCtx()
  drawRecruitPoster(ctx, 'V1', recruitView(summary(), 'hooligans', PROMO_NOW), 'Watch this.')
  assert.ok(ctx.words.some((w) => w.s === '★ EVERY 3 NEW ARMY WHO VOTE = +1 POINT' && w.w <= W - 60), 'on the poster, inside the margins')
})

test('MAMA 2026 · Daesang badge: its own progress row, this round\'s days only', async () => {
  const R2B = { ...R2, rewards: { ...R2.rewards, extra_badges: [{ template_id: 'event_mama_2026_daesang', name: 'MAMA 2026 · Daesang', verified_days: 7 }] } }
  const db = fakeDb({
    campaigns: [R2B, R1],
    rpc: { rc_campaign_battle_state: () => battleState, rc_campaign_team_resolve: () => ({ data: { team: 'aliens', via: 'carried' } }) },
    tables: {
      rc_campaign_proofs: (q) => ({ data: q.filters.campaign_id === R2.id ? [{ vote_day: '2026-10-28' }, { vote_day: '2026-10-29' }, { vote_day: '2026-10-29' }] : [] }),
      rc_badges: (q) => ({ data: Array.isArray(q.filters.badge_id) ? [] : null }),
    },
  })
  const s = await getVotingStatus(db, { agentNo: 'AGENT001' }, OPEN_NOW)
  assert.deepEqual(s.extraBadges, [{ templateId: 'event_mama_2026_daesang', name: 'MAMA 2026 · Daesang', verifiedDays: 7, daysDone: 2, earned: false }])
  const st = promoStatus()
  st.extraBadges = s.extraBadges
  const html = screen(st, 'voting')
  assert.match(html, /data-vt-xbadge="progress"[\s\S]*MAMA 2026 · Daesang[\s\S]*2 <small>\/ 7 voting days this round<\/small>/)
  st.extraBadges = [{ ...s.extraBadges[0], earned: true }]
  assert.match(screen(st, 'voting'), /data-vt-xbadge="earned"[\s\S]*Badge earned/)
})
