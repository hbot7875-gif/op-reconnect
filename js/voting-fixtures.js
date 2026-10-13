// View-model fixtures for the Voting screen: every state the release brief
// lists, used by voting-view.test.mjs and by the screenshot harness. Shapes
// match getVotingStatus (vote-campaign-service.js). Battle milestone values
// here are illustrative only — the real ones are pending approval.

export const FIXTURE_NOW = new Date('2026-10-14T03:00:00Z') // 12:00 KST

const POOL = ['charge_cell', 'xp', 'streak_freeze', 'extension', 'wings', 'backup_pass']
  .map((kind) => ({ kind, amount: kind === 'xp' ? 10 : 1 }))

function battleFixture(kind, contributor, myTeam) {
  if (kind === 'none') return null
  const scores = {
    tied: [120, 120], hooligans: [214, 198], aliens: [176, 203], almost: [252, 245], reached: [265, 255],
    final: [1200, 1100], finalTie: [1100, 1100],
  }[kind] || [214, 198]
  const frozen = kind === 'final' || kind === 'finalTie'
  const winners = kind === 'final' ? ['hooligans'] : kind === 'finalTie' ? ['aliens', 'hooligans'] : null
  const total = scores[0] + scores[1]
  const targets = [200, 500, 900, 1400, 2200]
  const claimed = kind === 'reached' ? new Set([0]) : new Set([0, 1])
  return {
    teams: [
      { id: 'hooligans', label: 'HOOLIGANS', points: scores[0], size: 21 },
      { id: 'aliens', label: 'ALIENS', points: scores[1], size: 20 },
    ],
    myTeam, assignedVia: myTeam ? 'choice' : null,
    myPoints: contributor ? 9 : 0,
    total,
    closesAt: '2026-10-22T23:59:59+09:00',
    milestones: kind === 'unset' ? null : targets.map((target, index) => ({
      index, target, reached: total >= target,
      claimed: contributor && total >= target && claimed.has(index),
      claimable: contributor && total >= target && !claimed.has(index),
    })),
    giftPool: POOL,
    contributor,
    freezeAt: '2026-10-23T12:00:00+09:00',
    frozen,
    winners,
    winnerReward: {
      rewards: [{ kind: 'xp', amount: 20 }, { kind: 'charge_cell', amount: 1 }],
      state: !frozen ? 'pending' : !contributor ? 'not_contributor' : winners.includes(myTeam) ? 'claimable' : 'not_winner',
    },
  }
}

function pulseFixture(kind) {
  if (kind === 'healthy') return { tags: ['#2026MAMAVOTE', '#BTS'], count: 12842, delta: 428, lastUpdatedAt: '2026-10-14T03:00:00Z', stale: false }
  if (kind === 'stale') return { tags: ['#2026MAMAVOTE', '#BTS'], count: 12414, delta: null, lastUpdatedAt: '2026-10-13T15:00:00Z', stale: true }
  if (kind === 'unavailable') return { tags: ['#2026MAMAVOTE', '#BTS'], count: null, delta: null, lastUpdatedAt: null, stale: false }
  return null
}

export function votingStatus({
  mnet = 'todo', x = 'todo', gift = 'filling', battle = 'hooligans', contributor = true, myTeam = 'hooligans',
  pulse = 'healthy', badgeDays = 3, activity = true, mnetCount = null, xCount = null,
} = {}) {
  const today = '2026-10-14'
  const proofs = []
  const mnetChecks = mnet === 'review' ? { certificate: true, category: true, date: true, bts: 'unclear' }
    : mnet === 'verified' ? { certificate: true, category: true, date: true, bts: 'match' } : {}
  const xChecks = x === 'review' ? { date: true, found: true, publicPost: true, hashtags: false, author: true } : x === 'verified' ? { date: true, found: true, publicPost: true, hashtags: true, author: true } : {}
  if (['verifying', 'review', 'verified'].includes(mnet)) proofs.push({ missionId: 'mnet', status: mnet, checks: mnetChecks })
  if (['verifying', 'review', 'verified'].includes(x)) proofs.push({ missionId: 'x', status: x, checks: xChecks })
  const gifts = {
    tba: { threshold: null, fill: 2, state: 'tba', pool: [] },
    filling: { threshold: 5, fill: 3, state: 'filling', pool: POOL },
    ready: { threshold: 5, fill: 6, state: 'ready', pool: POOL },
    capped: { threshold: 5, fill: 5, state: 'capped', pool: POOL, opensToday: 2 },
  }
  const serverMnet = mnet === 'upload' ? 'todo' : mnet
  const serverX = x === 'link' || x === 'submitting' ? 'todo' : x
  const mv = mnetCount ?? (mnet === 'verified' ? 3 : 0)
  const xv = xCount ?? (x === 'verified' ? 3 : 0)
  return {
    success: true,
    campaign: {
      id: 'mama_2026', title: 'MAMA 2026', roundLabel: "Fans' Choice · Round 1",
      opensAt: '2026-10-12T19:00:00+09:00', closesAt: '2026-10-22T23:59:59+09:00', phase: 'open',
      missions: [
        { id: 'mnet', kind: 'mnet_certificate', label: 'Mnet Vote', maxDaily: 3, maxHandles: 1, hashtags: [], requireHandleMatch: false,
          voteUrl: 'https://mnetplus.world/event/2026-mama?deeplink=mnetplus%3A%2F%2Fvote%2Ftemplates%2Fmama-fans-choice-vote-r1%2F6ab09532c314bb17315adc4e%3Furl_fallback_type%3Dupdate&missionType=MAMA_2026_FANS_CHOICE_VOTE_1ST_SHARE&refererCode=',
          certificate: { title_keywords: ['voting certificate'], structure_keywords: ['participation date'], issuer_keywords: ['mnet plus', 'mnetplus'], category_keywords: ["fans' choice category 1st vote"] } },
        { id: 'x', kind: 'x_post', label: 'X Vote', maxDaily: 3, maxHandles: 3, voteUrl: null, hashtags: ['2026MAMAVOTE', 'BTS'], requireHandleMatch: true },
      ],
    },
    today,
    states: { mnet: serverMnet, x: serverX },
    todayProgress: {
      mnet: { verified: mv, pending: ['verifying', 'review'].includes(mnet) ? 1 : 0, used: mv + (['verifying', 'review'].includes(mnet) ? 1 : 0), remaining: Math.max(0, 3 - mv - (['verifying', 'review'].includes(mnet) ? 1 : 0)), max: 3 },
      x: { verified: xv, pending: ['verifying', 'review'].includes(x) ? 1 : 0, used: xv + (['verifying', 'review'].includes(x) ? 1 : 0), remaining: Math.max(0, 3 - xv - (['verifying', 'review'].includes(x) ? 1 : 0)), max: 3 },
    },
    todayProofs: proofs,
    stats: { verifiedVotes: 7 + (mnet === 'verified' ? 1 : 0) + (x === 'verified' ? 1 : 0), votingDays: badgeDays, streak: 2 },
    activity: activity ? [
      ...(['verified', 'review', 'verifying'].includes(mnet) ? [{ missionId: 'mnet', voteDay: today, status: mnet, at: '2026-10-14T00:41:00Z' }] : []),
      ...(['verified', 'review'].includes(x) ? [{ missionId: 'x', voteDay: today, status: x, at: '2026-10-14T01:12:00Z' }] : []),
      { missionId: 'x', voteDay: '2026-10-13', status: 'verified', at: '2026-10-13T13:05:00Z' },
      { missionId: 'mnet', voteDay: '2026-10-13', status: 'verified', at: '2026-10-12T23:17:00Z' },
      { missionId: 'mnet', voteDay: '2026-10-13', status: 'rejected', at: '2026-10-12T23:02:00Z' },
    ] : [],
    xHandleLinked: true,
    xHandle: 'army_agent',
    xHandles: ['army_agent'],
    gift: {
      name: 'Voting Gift', dailyCap: 2, opensToday: 0, ...gifts[gift],
      contributions: [{ missionId: 'mnet', voteDay: '2026-10-13', amount: 1 }],
    },
    badge: { templateId: 'event_mama_2026', verifiedDays: 5, daysDone: badgeDays, earned: badgeDays >= 5 },
    battle: battleFixture(battle, contributor, myTeam),
    pulse: pulseFixture(pulse),
  }
}

/** Device-only state the controller keeps, per state. */
export function votingLocal({ mnet = 'todo', x = 'todo', chooser = null, giftReveal = null, battleReveal = null } = {}) {
  return {
    mnet: { voted: mnet === 'upload', uploading: false },
    x: { submitting: x === 'submitting', composed: x === 'link' },
    error: null, editHandle: false,
    giftBusy: false, giftReveal, giftRequest: null,
    battleBusy: false, battleReveal, battleRequests: {},
    chooser,
  }
}

export const SAMPLE_GIFT_REVEAL = [{ kind: 'charge_cell', amount: 1 }, { kind: 'xp', amount: 10 }, { kind: 'wings', amount: 1 }]

/** City banner summary (getVotingBanner shape). */
export const CITY_NOW = new Date('2026-10-14T03:00:00Z')
export function cityBanner({ phase = 'open', myTeam = 'hooligans', scores = [214, 198], winners = null, done = 1 } = {}) {
  const total = scores[0] + scores[1]
  return {
    campaignId: 'mama_2026', title: 'MAMA 2026', roundLabel: "Fans' Choice · Round 1", phase,
    closesAt: '2026-10-22T23:59:59+09:00', freezeAt: '2026-10-23T12:00:00+09:00', done, total: 6,
    battle: {
      myTeam,
      teams: [{ id: 'hooligans', label: 'HOOLIGANS', points: scores[0] }, { id: 'aliens', label: 'ALIENS', points: scores[1] }],
      total,
      milestones: [200, 500, 900, 1400, 2200].map((target) => ({ target, reached: total >= target })),
      winners,
    },
  }
}
