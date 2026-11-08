// War of Cards: leaderboard ranking, the unlock pop-up, the badge template,
// and the wiring between them. What counts as a win is tested against real
// Postgres in war-of-cards-sql.test.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  weekStartKst, winPct, rankWar, boardWithMe, warUnlockDue, WAR_PCT_MIN_GAMES, WAR_CHAMPION_BADGE,
} from './war-of-cards-rules.js'
import { boardHtml } from '../../../../js/war-leaderboard-view.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const row = (agentNo, played, wins, currentStreak = 0, bestStreak = 0) => ({ agentNo, played, wins, currentStreak, bestStreak })

test('the week starts Monday 00:00 KST', () => {
  assert.equal(weekStartKst(new Date('2026-11-07T10:00:00Z')), '2026-11-01T15:00:00.000Z', 'Sat → Mon Nov 2 KST')
  assert.equal(weekStartKst(new Date('2026-11-01T16:00:00Z')), '2026-11-01T15:00:00.000Z', 'Mon 01:00 KST')
  assert.equal(weekStartKst(new Date('2026-11-01T14:59:00Z')), '2026-10-25T15:00:00.000Z', 'Sun 23:59 KST is last week')
})

test('ranked by wins by default; equal records share a place', () => {
  const ranked = rankWar([row('A', 10, 6), row('B', 4, 6), row('C', 8, 3), row('D', 4, 6)], 'wins', (a) => a)
  assert.deepEqual(ranked.map((r) => [r.agentNo, r.position, r.pct]), [['B', 1, 150], ['D', 1, 150], ['A', 3, 60], ['C', 4, 38]].map(([a, p]) => [a, p, ranked.find((r) => r.agentNo === a).pct]))
  assert.deepEqual(ranked.map((r) => r.position), [1, 1, 3, 4])
  assert.equal(winPct(2, 3), 67)
  assert.equal(winPct(0, 0), null)
})

test(`win % ranks only agents with ${WAR_PCT_MIN_GAMES}+ games`, () => {
  const ranked = rankWar([row('A', 9, 9), row('B', 10, 7), row('C', 20, 15), row('D', 12, 9)], 'pct', (a) => a)
  assert.deepEqual(ranked.map((r) => [r.agentNo, r.pct, r.position]), [['C', 75, 1], ['D', 75, 2], ['B', 70, 3]])
})

test('the viewer sees their own row when they are below the top', () => {
  const ranked = rankWar(Array.from({ length: 25 }, (_, i) => row(`A${i}`, 30, 30 - i)), 'wins', (a) => a)
  const low = boardWithMe(ranked, 'A23')
  assert.equal(low.top.length, 20)
  assert.equal(low.me.position, 24)
  assert.equal(boardWithMe(ranked, 'A3').me, null, 'already shown')
  assert.equal(boardWithMe(ranked, 'NOBODY').me, null)
})

test('unlock pop-up: full album, not a tester, not seen yet', () => {
  assert.equal(warUnlockDue({ albumComplete: true, tester: false, seen: false }), true)
  assert.equal(warUnlockDue({ albumComplete: true, tester: true, seen: false }), false)
  assert.equal(warUnlockDue({ albumComplete: true, tester: false, seen: true }), false)
  assert.equal(warUnlockDue({ albumComplete: false, tester: false, seen: false }), false)
  assert.equal(warUnlockDue({ albumComplete: false, tester: true, seen: false, owner: true }), true, 'the owner, once')
  assert.equal(warUnlockDue({ albumComplete: true, tester: true, seen: true, owner: true }), false, 'and only once')
})

test('leaderboard table: names escaped, champion mark, your row, empty states', () => {
  const r = (o) => ({ position: 1, codename: 'Mochi', isMe: false, played: 12, wins: 9, pct: 75, currentStreak: 2, bestStreak: 5, champion: false, championArt: null, ...o })
  const html = boardHtml({ period: 'all', sort: 'wins', rows: [r({ codename: '<b>x</b>', champion: true, championArt: 'https://cdn/x.webp' }), r({ position: 2, codename: 'Koya', champion: true })], me: r({ position: 31, codename: 'You', isMe: true, pct: null }) })
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/)
  assert.match(html, /<img class="wl-champ" src="https:\/\/cdn\/x\.webp" alt="Card Champion"/)
  assert.match(html, /role="img" aria-label="Card Champion"/, 'a mark even before art is uploaded')
  assert.doesNotMatch(html, /Streak|win<\/small>|%/, 'casual board: no streaks or win %')
  assert.match(html, /aria-label="Your rank"/)
  assert.match(html, /class="wl-row is-top-1"/)
  assert.match(html, /aria-label="Rank 1">🥇/)
  assert.match(html, /class="wl-row is-me"/)
  assert.doesNotMatch(html, /XP|level|wings|coins/i)
  assert.match(boardHtml({ period: 'week', rows: [] }), /No wins this week yet/)
  assert.doesNotMatch(read('../../../../js/war-leaderboard.js'), /wl-rules|data-wl-sort/, 'no rules paragraph or Win % toggle')
})

test('wiring: routes, state flag, Run ARMY entry, pop-up guards, badge template and award', () => {
  const idx = read('../index.ts')
  assert.match(idx, /getWarLeaderboard: \{ auth: 'agent'/)
  assert.match(idx, /markWarUnlockSeen: \{ auth: 'agent'/)
  assert.match(idx, /markWarUnlockAction: \{ auth: 'agent'/)
  const srv = read('./war-of-cards.ts')
  assert.match(srv, /const UNLOCK_ACTIONS = new Set\(\['go', 'later', 'closed'\]\)/)
  assert.match(srv, /\.eq\('agent_no', agentNo\)\.is\('action', null\)/, 'first answer only')
  const mig = read('../../../migrations/20261108120000_rc_war_unlock_action.sql')
  assert.match(mig, /check \(action is null or action in \('go', 'later', 'closed'\)\)/)
  const h = read('./handlers.ts')
  assert.match(h, /const warUnlockDue = await warUnlockForState\(supabase, player\.agent_no, album, runAmiTester\)/)
  assert.match(read('../../../../js/main.js'), /checkForWarUnlock\(state\)/)
  const pop = read('../../../../js/war-unlock.js')
  assert.match(pop, /document\.body\.classList\.contains\('ra-playing'\) \|\| getScreen\(\)\?\.name === 'runami'/, 'never interrupts a game')
  assert.match(pop, /if \(overlay && !overlay\.hidden\) return/)
  assert.match(pop, /call\('markWarUnlockSeen'/)
  assert.match(pop, /go\.onclick = \(\) => \{ answer\('go'\)/)
  assert.match(pop, /later\.onclick = \(\) => \{ answer\('later'\)/)
  assert.match(pop, /answer\('closed'\)/)
  // The device note only bridges the save; the server record is what keeps it to once.
  assert.match(pop, /const LOCAL_HOLD_MS = 10 \* 60_000/)
  assert.match(pop, /if \(shownAt && Date\.now\(\) - shownAt < LOCAL_HOLD_MS\)/)
  for (const line of ['MISSION', 'SUCCESS!', '15/15', 'ALBUM COMPLETE', 'WAR OF CARDS', 'UNLOCKED!', "LET'S GO!", 'Later']) assert.ok(pop.includes(line), line)
  assert.equal((pop.match(/LET'S GO!/g) || []).length, 1, "LET'S GO! only on the button")
  assert.match(pop, /const FLASH = \[/, 'covers flash past before the last card')
  const css = read('../../../../css/run-ami.css')
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.wu-stamp, \.wu-count, \.wu-flip, \.wu-title, \.wu-sheet > \.btn \{ animation: none; \}/)
  assert.match(css, /\.wu-flash \{ display: none; \}/)
  assert.match(read('../../../../js/run-army.js'), /openWarLeaderboard\(\)/)
  // The badge reveal (any badge) waits for a match to end before showing.
  assert.match(read('../../../../js/badge-reveal.js'), /\(overlay && !overlay\.hidden\) \|\| document\.body\.classList\.contains\('ra-playing'\)/)
  // Card Champion is an active template, so the live list the reveal reads includes it.
  assert.match(h, /supabase\.from\('rc_badge_catalog'\)\.select\('id'\)\.eq\('active', true\)/)
  const tpl = read('../../../migrations/20261107115000_rc_card_champion_badge_template.sql')
  assert.match(tpl, /'achievement_card_champion', 'achievement', 'rare', 'War of Cards — Card Champion'/)
  assert.doesNotMatch(tpl, /rc_award_badge|create (or replace )?function/i, 'the template migration is the template only')
  const stats = read('../../../migrations/20261107120000_rc_war_of_cards_stats.sql')
  assert.match(stats, new RegExp(`rc_award_badge\\(new\\.agent_no, '${WAR_CHAMPION_BADGE}', \\(v_m \\* 10\\)::text\\)`), 'one copy per 10 wins, by template id')
  assert.match(stats, /for v_m in 1 \.\. \(v_wins \/ 10\) loop/)
  assert.match(stats, /exception when others then\s+raise warning/, 'a badge problem never blocks a result')
  assert.doesNotMatch(stats, /create or replace function public\.rc_run_ami_commit|alter table public\.rc_run_ami_(matches|match_players) /, 'match mechanics untouched')
  assert.doesNotMatch(stats, /xp|wings|charge_cells|rc_agent_charge/i, 'no XP or currency')
})
