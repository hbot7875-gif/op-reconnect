// BTS's MAMA ranks from Mnet Plus: parsing fails closed, the card shows ranks
// only (never vote counts or percentages), and the 15-minute check is wired.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseMamaRanks, mamaRankUrl, mamaRankView, mamaRankMoves, hourStart, canSeeMamaRank, MAMA_RANK_STALE_MS } from './mama-rank-rules.js'
import { mamaRankCard, istStamp } from '../../../../js/voting-view.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const opt = (rank, title) => ({ rank, title, artistId: `a${rank}${title}`, optionId: `o${rank}`, isEnabled: true, order: rank })
const group = (groupName, titles) => ({ groupName, options: titles.map((t, i) => opt(i + 1, t)) })
const sample = () => ({
  updatedAt: '2026-11-02T16:17:51.859Z',
  groups: [
    group("FANS' CHOICE MALE", ['BTS', 'Group B', 'Group C']),
    group("FANS' CHOICE FEMALE", ['Group F', 'Group G']),
    group("FANS' CHOICE OF THE YEAR with VISA", ['Group H', 'Group B', 'BTS', 'Group F']),
  ],
})

test('reads BTS in Male and VISA, not Female', () => {
  const p = parseMamaRanks(sample())
  assert.deepEqual(p.ranks, { male: { rank: 1, of: 3 }, visa: { rank: 3, of: 4 } })
  assert.deepEqual(p.standings.male, [{ rank: 1, title: 'BTS' }, { rank: 2, title: 'Group B' }, { rank: 3, title: 'Group C' }])
  assert.deepEqual(p.standings.visa.map((s) => s.title), ['Group H', 'Group B', 'BTS', 'Group F'])
  assert.equal(p.standings.female, undefined, 'Female is not tracked')
})

test('fails closed: never guesses a rank', () => {
  assert.deepEqual(parseMamaRanks(null), { ok: false, error: 'shape' })
  const noVisa = sample(); noVisa.groups.pop()
  assert.deepEqual(parseMamaRanks(noVisa), { ok: false, error: 'missing_visa' })
  const noBts = sample(); noBts.groups[0].options.shift()
  assert.deepEqual(parseMamaRanks(noBts), { ok: false, error: 'artist_missing_male' })
  const bad = sample(); bad.groups[2].options[2].rank = 0
  assert.deepEqual(parseMamaRanks(bad), { ok: false, error: 'bad_rank_visa' })
  const tooBig = sample(); tooBig.groups[0].options[0].rank = 9
  assert.deepEqual(parseMamaRanks(tooBig), { ok: false, error: 'bad_rank_male' })
  const off = sample(); off.groups[0].options[0].isEnabled = false
  assert.deepEqual(parseMamaRanks(off), { ok: false, error: 'artist_missing_male' }, 'a disabled entry is not a rank')
})

test('the endpoint is Mnet Plus, and only for a real vote ID', () => {
  assert.equal(mamaRankUrl('6acecda6f3778e1b06f5170b'),
    'https://api.mnetplus.world/vote/v1/public/guest/votes/6acecda6f3778e1b06f5170b/options?sort=RANKED')
  assert.throws(() => mamaRankUrl('../x'), /bad_vote_id/)
  assert.equal(hourStart('2026-11-02T16:47:12.5Z'), '2026-11-02T16:00:00.000Z')
})

const NOW = new Date('2026-11-02T16:20:00Z')
const latest = { checkedAt: '2026-11-02T16:15:03Z', ranks: { male: { rank: 1, of: 20 }, visa: { rank: 3, of: 40 } },
  standings: { male: [{ rank: 1, title: 'BTS' }, { rank: 2, title: 'ENHYPEN' }], visa: [{ rank: 1, title: 'Hearts2Hearts' }, { rank: 2, title: '<b>X</b>' }, { rank: 3, title: 'BTS' }] } }
const history = [
  { category: 'visa', hour: '2026-11-02T14:00:00Z', last_rank: 2, best_rank: 2, worst_rank: 2 },
  { category: 'visa', hour: '2026-11-02T15:00:00Z', last_rank: 2, best_rank: 2, worst_rank: 3 },
  { category: 'visa', hour: '2026-11-02T16:00:00Z', last_rank: 3, best_rank: 3, worst_rank: 3 },
  { category: 'male', hour: '2026-11-02T15:00:00Z', last_rank: 1, best_rank: 1, worst_rank: 1 },
  { category: 'male', hour: '2026-11-01T10:00:00Z', last_rank: 4, best_rank: 4, worst_rank: 4 },
]

test('view: latest ranks, move against the previous hour, last 24 h only, stale after 50 min', () => {
  const v = mamaRankView(latest, history, NOW)
  assert.equal(v.stale, false)
  const [male, visa] = v.categories
  assert.deepEqual([male.id, male.rank, male.of, male.move, male.series.length], ['male', 1, 20, 0, 1], 'the 30-hour-old row is dropped')
  assert.deepEqual([visa.id, visa.rank, visa.of, visa.move], ['visa', 3, 40, -1], '#2 last hour, #3 now')
  assert.equal(mamaRankView(latest, history, new Date(Date.parse(latest.checkedAt) + MAMA_RANK_STALE_MS + 1)).stale, true)
  assert.equal(mamaRankView(null), null)
})

test('card: ranks and the last update time; no vote counts or percentages', () => {
  const html = mamaRankCard(mamaRankView(latest, history, NOW))
  assert.match(html, /BTS on Mnet right now/)
  assert.match(html, /Fans’ Choice Male|Fans&#39;|Fans' Choice Male/)
  assert.match(html, /#1<small> of 20<\/small>/)
  assert.match(html, /#3<small> of 40<\/small>/)
  assert.match(html, /▼ 1 since last hour/)
  assert.match(html, /Last updated <span class="vt-mono">Nov 3 · 01:15 KST<\/span>/)
  assert.match(html, /best #2 · lowest #3/)
  assert.doesNotMatch(html, /%|votes? (ahead|behind)|vote count/i)
  assert.match(html, /data-vt-rank="fresh"/)
  assert.equal(mamaRankCard(null), '', 'nothing until the first successful read')
  assert.match(html, /See all 2 ranks/)
  assert.match(html, /See all 3 ranks/)
  assert.match(html, /<li class="vt-stand is-me" aria-current="true"><span class="vt-stand-n">3<\/span><span class="vt-stand-t">BTS<\/span><\/li>/)
  assert.match(html, /<span class="vt-stand-t">Hearts2Hearts<\/span>/)
  assert.match(html, /&lt;b&gt;X&lt;\/b&gt;/, 'names from Mnet are escaped')
  assert.doesNotMatch(mamaRankCard(mamaRankView({ ...latest, standings: null }, [], NOW)), /See all/, 'no list without standings')
  const stale = mamaRankCard(mamaRankView(latest, history, new Date('2026-11-02T18:00:00Z')))
  assert.match(stale, /data-vt-rank="stale"/)
  assert.match(stale, /No new reading from Mnet since then/)
})

test('wiring: public read, cron route, 15-minute schedule, card on the Voting tab', () => {
  const idx = read('../index.ts')
  assert.match(idx, /getMamaRanking: \{ auth: 'agent', handler: \(sb, p\) => getMamaRanking\(sb, p\)/)
  assert.match(idx, /cronMamaRankCheck: \{ auth: 'cron'/)
  assert.doesNotMatch(read('../../../../js/api.js'), /'getMamaRanking'/, 'not a public action: it needs the session')
  const sched = read('../../../migrations/20261102120500_rc_mama_rank_schedule.sql')
  assert.match(sched, /cron\.schedule\('rc-mama-rank-check', '\*\/15 \* \* \* \*'/)
  assert.match(sched, /now\(\) <= c\.closes_at \+ interval '1 hour'/, 'stops after the round')
  assert.match(read('../../../../js/voting-view.js'), /<div class="vt-rank-slot" data-vt-rank-slot>\$\{mamaRankCard\(vm\.hub\?\.rank\)\}<\/div>/)
  const v = read('../../../../js/voting.js')
  assert.match(v, /const RANK_POLL_MS = 5 \* 60_000/)
  assert.match(v, /slot\.innerHTML = mamaRankCard\(hubData\.rank\)/, 'swaps only the card')
  const srv = read('./mama-rank.ts')
  assert.doesNotMatch(srv, /bora|github/i, 'our own collection')
})

test('only AGENT000 sees the ranks for now, checked on the server', () => {
  assert.equal(canSeeMamaRank('AGENT000'), true)
  assert.equal(canSeeMamaRank('agent000 '), true)
  for (const a of ['AGENT001', '', null, undefined]) assert.equal(canSeeMamaRank(a), false, String(a))
  const srv = read('./mama-rank.ts')
  assert.match(srv, /if \(!canSeeMamaRank\(params\.agentNo\)\) return \{ success: true, ranking: null \}/)
  assert.match(read('../../../../js/voting.js'), /if \(!root\?\.isConnected \|\| !canSeeMamaRank\(getAgentNo\(\)\)\) return/, 'no request from anyone else')
})

test('latest moves: rank-number changes, newest first, in IST', () => {
  const at = (h, visa) => ({ checkedAt: `2026-11-05T${h}:00:00Z`, standings: { visa, male: [{ rank: 1, title: 'BTS' }] } })
  const checks = [
    at('09', [{ rank: 7, title: 'SEVENTEEN' }, { rank: 8, title: 'BIGBANG' }, { rank: 37, title: 'Lee Young Ji' }]),
    at('10', [{ rank: 7, title: 'SEVENTEEN' }, { rank: 8, title: 'BIGBANG' }, { rank: 37, title: 'LEE YOUNGJI' }]),
    { checkedAt: '2026-11-05T10:15:00Z', standings: null },
    at('11', [{ rank: 7, title: 'BIGBANG' }, { rank: 7, title: 'SEVENTEEN' }, { rank: 37, title: 'LEE YOUNGJI' }]),
    at('12', [{ rank: 6, title: 'BIGBANG' }, { rank: 8, title: 'SEVENTEEN' }, { rank: 37, title: 'LEE YOUNGJI' }]),
  ]
  assert.deepEqual(mamaRankMoves(checks, 'visa'), [
    { at: '2026-11-05T12:00:00Z', moves: [{ title: 'BIGBANG', from: 7, to: 6 }, { title: 'SEVENTEEN', from: 7, to: 8 }] },
    { at: '2026-11-05T11:00:00Z', moves: [{ title: 'BIGBANG', from: 8, to: 7 }] },
  ], 'a respelled name or a missing check is not a move')
  assert.deepEqual(mamaRankMoves(checks, 'male'), [], 'nothing moved')
  assert.equal(mamaRankMoves(checks, 'visa', 1).length, 1)
  assert.deepEqual(mamaRankMoves([], 'visa'), [])
  assert.equal(istStamp('2026-11-05T09:15:00Z'), 'Nov 5 · 14:45 IST')
  assert.equal(istStamp('2026-11-05T19:00:00Z'), 'Nov 6 · 00:30 IST', 'rolls over at IST midnight')

  const html = mamaRankCard(mamaRankView(latest, history, NOW, checks))
  assert.match(html, /Latest moves \(IST\)/)
  assert.match(html, /Nov 5 · 17:30 IST/)
  assert.match(html, /BIGBANG #7/)
  assert.doesNotMatch(mamaRankCard(mamaRankView(latest, history, NOW)), /Latest moves/, 'no list without moves')
  assert.match(read('../../../../js/voting.js'), /d\.open = open\.includes\(d\.dataset\.vtRankFold\)/, 'a refresh keeps an open list open')
  assert.match(read('./mama-rank.ts'), /if \(!canSeeMamaRank\(params\.agentNo\)\) return \{ success: true, ranking: null \}/, 'still AGENT000 only')
})
