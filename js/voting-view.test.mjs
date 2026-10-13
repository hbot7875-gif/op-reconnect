import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  votingScreen, mnetUiState, xUiState, votingEventCard, errorText, dayLabel, kstStamp, countdown,
  battleLine, nextMilestone, teamChooser, rewardText, fmtCount, cityResultText, MNET_FAST_MS,
} from './voting-view.js'
import { cityBanner, CITY_NOW } from './voting-fixtures.js'
import { reviewCardHtml, noteText } from './voting-admin.js'
import { votingStatus, votingLocal, FIXTURE_NOW, SAMPLE_GIFT_REVEAL } from './voting-fixtures.js'

const render = (o = {}, l = {}) => votingScreen({ status: votingStatus(o), local: votingLocal({ ...o, ...l }), now: FIXTURE_NOW })
const card = (html, id) => html.match(new RegExp(`<article class="vt-card vt-mission" data-vt-mission="${id}"[\\s\\S]*?</article>`))[0]
const section = (html, id) => html.slice(html.indexOf(`id="${id}"`), html.indexOf('</section>', html.indexOf(`id="${id}"`)))

// ── Page structure and wording ───────────────────────────────────────

test('final page hierarchy, in order', () => {
  const html = render()
  const order = ['>Voting<', '>MAMA 2026<', "Fans&#39; Choice · Round 1", 'id="vt-h-battle"', 'id="vt-h-today"',
    'id="vt-h-missions"', 'id="vt-h-pulse"', 'id="vt-h-stats"', 'id="vt-h-gift"', 'id="vt-h-bgifts"',
    'id="vt-h-activity"', '<span class="vt-row-t">Voting guide</span>']
  let at = -1
  for (const s of order) {
    const i = html.indexOf(s, at + 1)
    assert.ok(i > at, `${s} in order`)
    at = i
  }
  assert.match(html, /Voting closes <b>Oct 22<\/b> · KST/)
})

test('player wording: no Campaign, no Supply Chest, no emoji', () => {
  for (const o of [{}, { gift: 'ready' }, { battle: 'reached' }, { pulse: 'stale' }]) {
    const html = render(o)
    assert.doesNotMatch(html, /campaign/i)
    assert.doesNotMatch(html, /supply chest/i)
    assert.doesNotMatch(html, /\p{Extended_Pictographic}/u)
  }
  assert.match(render(), /Voting Gift/)
})

// ── Team chooser ─────────────────────────────────────────────────────

test('team chooser: 7s and 3s countdown, two equal choices', () => {
  const s = votingStatus({ myTeam: null })
  for (const secs of [7, 3]) {
    const html = teamChooser({ status: s, local: votingLocal({ chooser: { secondsLeft: secs } }) })
    assert.match(html, new RegExp(`vt-chooser-num">${secs}<`))
    const buttons = html.match(/<button class="vt-chooser-team[^"]*"[^>]*>[^<]*<\/button>/g)
    assert.equal(buttons.length, 2)
    const shape = (b) => b.replace(/>[A-Z]+</, '><').replace(/data-vt-team="[a-z]+"/, '')
    assert.equal(shape(buttons[0]), shape(buttons[1]), 'identical markup for both sides')
    assert.match(html, />HOOLIGANS</)
    assert.match(html, />ALIENS</)
    assert.match(html, /role="dialog" aria-modal="true"/)
  }
})

test('team chooser: selected Hooligans / Aliens and timed-out auto-assignment', () => {
  const s = votingStatus({ myTeam: null })
  const picked = teamChooser({ status: s, local: votingLocal({ chooser: { secondsLeft: 4, picked: 'aliens' } }) })
  assert.match(picked, /vt-chooser-team is-picked" type="button" data-vt-act="team-pick" data-vt-team="aliens" disabled/)
  for (const team of ['hooligans', 'aliens']) {
    const html = teamChooser({ status: s, local: votingLocal({ chooser: { result: team, via: 'choice' } }) })
    assert.match(html, new RegExp(`You're on ${team.toUpperCase()}`))
    assert.match(html, /Locked for MAMA 2026/)
  }
  const timeout = teamChooser({ status: s, local: votingLocal({ chooser: { result: 'aliens', via: 'timeout' } }) })
  assert.match(timeout, /Time ran out, so you joined the smaller team/)
  assert.equal(teamChooser({ status: s, local: votingLocal() }), '', 'no chooser once assigned')
})

// ── MAMA Battle ──────────────────────────────────────────────────────

test('battle: tied, Hooligans leading, Aliens leading', () => {
  assert.match(section(render({ battle: 'tied' }), 'vt-h-battle'), /Tied at 120/)
  const h = section(render({ battle: 'hooligans', myTeam: 'hooligans' }), 'vt-h-battle')
  assert.match(h, /HOOLIGANS<\/span><span class="vt-team-you">Your team<\/span><span class="vt-team-pts">214/)
  assert.match(h, /Your team is leading by 16/)
  assert.match(section(render({ battle: 'aliens', myTeam: 'hooligans' }), 'vt-h-battle'), /Your team is 27 behind/)
  assert.match(section(render({ battle: 'aliens', myTeam: 'aliens' }), 'vt-h-battle'), /Your team is leading by 27/)
  const b = section(render(), 'vt-h-battle')
  assert.match(b, /Your contribution <b>9<\/b>/)
  assert.match(b, /Community total <b>412<\/b>/)
  assert.match(b, /8d 11h left/)
  assert.match(b, /every verified vote still supports BTS/)
})

test('battle: next milestone almost reached, and reached', () => {
  const almost = section(render({ battle: 'almost' }), 'vt-h-battle')
  assert.match(almost, /Next Battle Gift at <b>500<\/b> · 3 to go/)
  const reached = section(render({ battle: 'reached' }), 'vt-h-bgifts')
  assert.match(reached, /data-vt-bgift="ready"[\s\S]*Battle Gift 2 · 500 votes[\s\S]*data-vt-act="battle-claim" data-vt-index="1"/)
  assert.equal(nextMilestone(votingStatus({ battle: 'reached' }).battle).target, 900)
  assert.equal(battleLine({ teams: [{ id: 'a', label: 'A', points: 5 }, { id: 'b', label: 'B', points: 3 }], myTeam: null }), 'A lead by 2')
})

test('battle gifts: locked, ready, claimed, non-contributor; unset shows TBA', () => {
  const g = section(render({ battle: 'reached' }), 'vt-h-bgifts')
  assert.match(g, /data-vt-bgift="claimed"[\s\S]*Battle Gift 1/)
  assert.match(g, /data-vt-bgift="ready"/)
  assert.match(g, /data-vt-bgift="locked"[\s\S]*380 community votes to go/)
  const outsider = section(render({ battle: 'reached', contributor: false }), 'vt-h-bgifts')
  assert.match(outsider, /data-vt-bgift="not-contributor"/)
  assert.match(outsider, /verify 1 vote to claim/)
  assert.doesNotMatch(outsider, /data-vt-act="battle-claim"/)
  assert.match(section(render({ battle: 'unset' }), 'vt-h-bgifts'), /Announced soon/)
  assert.match(render(), /Everyone who verified at least one MAMA vote can claim — on either team\./)
  const claimedReveal = votingScreen({ status: votingStatus({ battle: 'reached' }), local: votingLocal({ battleReveal: { index: 0, rewards: [{ kind: 'extension', amount: 1 }] } }), now: FIXTURE_NOW })
  assert.match(section(claimedReveal, 'vt-h-bgifts'), /\+1 Extension/)
})

// ── Today's voting ───────────────────────────────────────────────────

test("Today's voting: 0/6 through 6/6 with Mnet/X breakdown and KST reset", () => {
  for (const [o, n] of [[{}, 0], [{ mnetCount: 1 }, 1], [{ mnet: 'verified' }, 3], [{ mnet: 'verified', x: 'verified' }, 6]]) {
    const html = render(o)
    assert.match(html, new RegExp(`vt-progress-val">${n} <small>/ 6`))
    assert.equal((html.match(/class="vt-seg[ "]/g) || []).length, 6)
  }
  assert.match(render({ mnetCount: 2, xCount: 1 }), /Mnet 2\/3 · X 1\/3/)
  assert.match(render({ mnet: 'review' }), /vt-seg is-pending/)
  assert.match(render(), /Resets in <span class="vt-mono" data-vt-reset>12:00:00/)
})

// ── Missions ─────────────────────────────────────────────────────────

test('Mnet: not started, upload needed, verifying, in review, complete', () => {
  const todo = card(render({ mnet: 'todo' }), 'mnet')
  assert.match(todo, /data-vt-state="todo"[\s\S]*Mnet votes · 0\/3[\s\S]*Vote on Mnet/)
  const upload = card(render({ mnet: 'upload' }), 'mnet')
  assert.match(upload, /data-vt-state="upload"[\s\S]*Upload certificate/)
  assert.match(upload, /aria-current="step"><span class="vt-dot">2<\/span>Upload/)
  assert.match(upload, /The certificate number and account details are not stored/)
  // Verifying: uploading → "Verifying…" for the first minutes → a calm
  // "running" state. Never an endless spinner.
  const local = votingLocal({ mnet: 'verifying' })
  const mnetAt = (mnet, extra) => card(votingScreen({ status: votingStatus({ mnet }), local: { ...local, mnet: { ...local.mnet, ...extra } }, now: FIXTURE_NOW }), 'mnet')
  const uploading = mnetAt('upload', { uploading: true })
  assert.match(uploading, /data-vt-state="verifying"[\s\S]*vt-spin[\s\S]*Uploading certificate…/)
  assert.doesNotMatch(uploading, /Upload another|Verifying certificate|verification is running/)
  const fresh = mnetAt('verifying', { sentAt: FIXTURE_NOW.getTime() - 60_000 })
  assert.match(fresh, /data-vt-state="verifying"[\s\S]*vt-spin[\s\S]*Verifying certificate…/)
  assert.match(fresh, /Checked automatically — no need to upload it again\. You can add another distinct certificate\./)
  assert.match(fresh, /Upload another/)
  const later = mnetAt('verifying', { sentAt: FIXTURE_NOW.getTime() - MNET_FAST_MS - 1 })
  for (const running of [later, card(render({ mnet: 'verifying' }), 'mnet')]) { // a reload has no upload time
    assert.match(running, /data-vt-state="verifying"[\s\S]*Received — verification is running/)
    assert.match(running, /You can leave this page\. No need to upload again\./)
    assert.match(running, /Upload another/)
    assert.doesNotMatch(running, /vt-spin/, 'no spinner once the quick window has passed')
    assert.doesNotMatch(running, /Checking certificate|Verifying certificate|admin/i)
  }
  const review = card(render({ mnet: 'review' }), 'mnet')
  assert.match(review, /In review[\s\S]*This certificate needs review — do not upload it again\./)
  const done = card(render({ mnet: 'verified' }), 'mnet')
  assert.match(done, /data-vt-state="done"[\s\S]*Verified/)
  for (const chip of ['Certificate', "Fans&#39; Choice 1st Vote", 'Oct 14', 'BTS selected']) assert.ok(done.includes(chip) || done.includes(chip.replace('&#39;', "'")), chip)
  assert.match(review, /is-unclear[^"]*">[\s\S]*?BTS selected/, 'an unclear image check shows as being checked')
  assert.doesNotMatch(review, /0\.\d{2,}|score|similar/i, 'no similarity internals for players')
  assert.match(todo, /href="https:\/\/mnetplus\.world\/event\/2026-mama\?deeplink=/, 'Vote CTA goes to the official Round 1 vote')
})

test('X: not started, link needed, verifying, in review, complete', () => {
  const todo = card(render({ x: 'todo' }), 'x')
  assert.match(todo, /X accounts · 1\/3 · one vote per account daily/)
  assert.match(todo, /x\.com\/intent\/post\?text=%232026MAMAVOTE%20%23BTS/)
  assert.ok(todo.indexOf('Create vote post') < todo.indexOf('Add link'), 'Create vote post is the primary action')
  const link = card(render({ x: 'link' }), 'x')
  assert.match(link, /data-vt-state="link"[\s\S]*Posted — link needed/)
  assert.match(link, /aria-current="step"><span class="vt-dot">2<\/span>Add link/)
  assert.match(card(render({ x: 'submitting' }), 'x'), /Checking your post/)
  assert.match(card(render({ x: 'review' }), 'x'), /This post needs review — do not submit it again\./)
  assert.match(card(render({ x: 'verified' }), 'x'), /Both hashtags/)
})

test('state helpers', () => {
  assert.equal(mnetUiState('todo', {}), 'todo')
  assert.equal(mnetUiState('todo', { voted: true }), 'upload')
  assert.equal(mnetUiState('rejected', {}), 'upload')
  assert.equal(mnetUiState('review', { voted: true }), 'review')
  assert.equal(xUiState('todo', { composed: true }), 'link')
  assert.equal(xUiState('todo', { submitting: true, composed: true }), 'verifying')
  assert.equal(xUiState('verified', { composed: true }), 'done')
})

// ── Vote Pulse ───────────────────────────────────────────────────────

test('Pulse: healthy, stale, provider unavailable — never a zero', () => {
  const healthy = section(render({ pulse: 'healthy' }), 'vt-h-pulse')
  assert.match(healthy, /12,842\+<\/span><span class="vt-pulse-unit">tracked posts/)
  assert.match(healthy, /\+428 since last update/)
  assert.match(healthy, /Tracked public #2026MAMAVOTE \+ #BTS posts/)
  assert.match(healthy, /Tracked public posts · unofficial estimate/)
  assert.match(healthy, /Last updated <span class="vt-mono">Oct 14 · 12:00 KST/)
  const stale = section(render({ pulse: 'stale' }), 'vt-h-pulse')
  assert.match(stale, /12,414\+/)
  assert.doesNotMatch(stale, /since last update/)
  assert.match(stale, /is-stale/)
  const none = section(render({ pulse: 'unavailable' }), 'vt-h-pulse')
  assert.match(none, /Collecting the first count/)
  assert.doesNotMatch(none, />0\+?</)
  for (const h of [healthy, stale, none]) assert.doesNotMatch(h, /rank/i)
})

// ── Your voting ──────────────────────────────────────────────────────

test('Your voting: four compact stats incl. voting days toward the badge', () => {
  const html = section(render({ badgeDays: 3 }), 'vt-h-stats')
  for (const k of ['Verified votes', 'Voting days', "Today's votes", 'Next reward']) assert.ok(html.includes(k), k)
  assert.equal((html.match(/class="vt-card vt-stat"/g) || []).length, 4)
  assert.match(html, /3 <small>\/ 5 for MAMA badge/)
  assert.match(section(render({ badgeDays: 5 }), 'vt-h-stats'), /MAMA badge earned/)
})

// ── Voting Gift ──────────────────────────────────────────────────────

test('Voting Gift: TBA, filling, ready, daily capped, opened reveal', () => {
  const gift = (o, l) => section(votingScreen({ status: votingStatus(o), local: votingLocal(l), now: FIXTURE_NOW }), 'vt-h-gift')
  assert.match(gift({ gift: 'tba' }), /Rewards announced soon[\s\S]*>TBA</)
  const filling = gift({ gift: 'filling' })
  assert.match(filling, /3 of 5/)
  assert.match(filling, />Filling</)
  assert.match(filling, /Can hold Charge Cell · XP · Streak Freeze · Extension · Wings · Backup Pass/)
  assert.match(filling, /up to 2 opens a day/)
  assert.match(filling, /Last fill: Mnet Vote · Oct 13/)
  const ready = gift({ gift: 'ready' })
  assert.match(ready, /data-vt-act="gift-open"/)
  assert.match(ready, /\+1 saved toward the next one/)
  assert.match(gift({ gift: 'capped' }), /Daily limit reached[\s\S]*opened 2 today\. More at 00:00 KST/)
  const opened = gift({ gift: 'filling' }, { giftReveal: SAMPLE_GIFT_REVEAL })
  assert.match(opened, /data-vt-gift="opened"/)
  assert.match(opened, /\+1 Charge Cell[\s\S]*\+10 XP[\s\S]*\+1 Wings/)
  assert.equal(rewardText({ kind: 'backup_pass', amount: 1 }), '+1 Backup Pass')
})

test('rewards stay secondary: gift sections come after missions, pulse and stats', () => {
  const html = render({ gift: 'ready' })
  assert.ok(html.indexOf('id="vt-h-gift"') > html.indexOf('id="vt-h-stats"'))
  assert.ok(html.indexOf('id="vt-h-missions"') < html.indexOf('id="vt-h-gift"'))
})

// ── Activity, guide, sheets ──────────────────────────────────────────

test('Voting activity: verified, verifying, in review and rejected badges', () => {
  const list = section(render({ mnet: 'verifying', x: 'review' }), 'vt-h-activity')
  for (const b of ['Verifying', 'In review', 'Verified', 'Rejected']) assert.ok(list.includes(b), b)
  assert.match(list, /Oct 14 · 09:41 KST/)
})

test('Voting guide sheet: four sections, closed by default, dialog semantics', () => {
  const html = render()
  const sheet = html.match(/<div class="vt-sheet" role="dialog" aria-modal="true" aria-labelledby="vt-g-title" data-vt-sheet="guide" hidden>[\s\S]*?<\/div>\s*<\/div>/)[0]
  for (const s of ['Mnet rules', 'X rules', 'Proof requirements', 'Privacy and safety']) assert.ok(sheet.includes(s), s)
  assert.match(sheet, /Oct 12 19:00 – Oct 22 23:59 KST/)
})

test('X link sheet explains why the handle is collected and never asks for a password', () => {
  const s = votingStatus()
  s.xHandleLinked = false
  s.xHandle = null
  s.xHandles = []
  const html = votingScreen({ status: s, local: votingLocal(), now: FIXTURE_NOW })
  assert.match(html, /X accounts stay linked for this event\. Maximum 3\./)
  assert.doesNotMatch(html, /type="password"/)
})

test('everything player-supplied is escaped', () => {
  const s = votingStatus()
  s.xHandle = '<img src=x onerror=alert(1)>'
  s.xHandles = ['<img src=x onerror=alert(1)>']
  s.campaign.title = '<script>alert(1)</script>'
  s.battle.teams[0].label = '<b>x</b>'
  const html = votingScreen({ status: s, local: { ...votingLocal(), error: { mission: 'mnet', text: '<b>y</b>' } }, now: FIXTURE_NOW })
  assert.doesNotMatch(html, /<script>alert|<img src=x|<b>x<\/b>|<b>y<\/b>/)
})

test('World entry card and small helpers', () => {
  assert.equal(votingEventCard(null), '')
  assert.equal(dayLabel('2026-10-14'), 'Oct 14')
  assert.equal(kstStamp('2026-10-14T15:30:00Z'), 'Oct 15 · 00:30 KST')
  assert.equal(countdown(3_723_000), '01:02:03')
  assert.equal(fmtCount(12842), '12,842')
  assert.equal(errorText('post_wrong_day', { postDay: '2026-10-12' }), 'That post is from Oct 12 KST. Post a new one today.')
  assert.equal(errorText('not_contributor'), 'Verify at least one MAMA vote to claim Battle Gifts.')
  assert.equal(errorText('anything_else'), 'Something went wrong. Try again.')
})

// ── Admin ────────────────────────────────────────────────────────────

test('admin review card: only what deciding needs, readable notes', () => {
  const html = reviewCardHtml({
    id: 9, kind: 'mnet_certificate', missionLabel: 'Mnet Vote', agent_no: 'AGENT012', vote_day: '2026-10-14', status: 'review',
    checks: { certificate: true, category: true, date: true, bts: 'unclear', btsScore: 0.78 }, client_checks: { certificate: true, category: true, date: true },
    verify_note: 'unclear:bts', proofUrl: 'https://signed.example/p.jpg?token=abc', submitted_at: '2026-10-14T00:41:00Z',
  })
  assert.match(html, /AGENT012/)
  assert.match(html, /Oct 14 KST/)
  assert.match(html, /In review/)
  for (const label of ['Certificate valid', 'Fans&#39; Choice 1st Vote', 'Correct voting date']) assert.ok(html.includes(label), label)
  assert.match(html, /name="certificate" checked>/)
  assert.match(html, /BTS selected · image check: Unclear \(0\.78\)/)
  assert.match(html, /value="match"> Matched[\s\S]*value="unclear" checked> Unclear[\s\S]*value="no_match"> No match/, 'reviewer can confirm or correct')
  assert.match(html, /Browser pre-check \(not trusted\)/)
  assert.match(html, /Unclear: BTS selected \(image unclear\)/)
  assert.equal(noteText('unclear:bts_no_match'), 'Unclear: BTS selected (image did not match)')
  assert.match(html, /data-vta="verify"[\s\S]*data-vta="keep"[\s\S]*data-vta="reject"/)
  assert.equal(noteText('missing_hashtags'), 'Hashtags missing')
  assert.equal(noteText('x_unreachable'), "X couldn't be reached")
  const closed = reviewCardHtml({ id: 1, kind: 'x_post', missionLabel: 'X Vote', agent_no: 'A', vote_day: '2026-10-14', status: 'verified', checks: {}, post_author: 'me', expectedHandle: 'me', post_url: 'https://x.com/me/status/1' })
  assert.doesNotMatch(closed, /data-vta="verify"/)
})

test('stylesheet: scoped, one accent, no glow or purple dashboard', () => {
  const css = readFileSync(new URL('../css/voting.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  assert.doesNotMatch(css, /:root/)
  assert.doesNotMatch(css, /#8b5cf6|#a78bfa|purple/i)
  assert.doesNotMatch(css, /text-shadow|drop-shadow|box-shadow:[^;]*\d{2,}px/, 'no glow')
  assert.doesNotMatch(css, /text-transform:\s*uppercase/)
  const selectors = css.match(/(^|})\s*([^{@}]+)\{/g) || []
  for (const s of selectors) {
    const sel = s.replace(/^}?\s*/, '').replace(/\{$/, '').trim()
    if (/^(from|to|\d+%)$/.test(sel)) continue
    for (const part of sel.split(',')) assert.match(part.trim(), /^\.vt|^@/, `unscoped selector: ${part.trim()}`)
  }
  // Both teams share one bar colour; only "your team" is tinted.
  assert.doesNotMatch(css, /data-vt-team="hooligans"|data-vt-team="aliens"|\.is-hooligans|\.is-aliens/)
})

test('battle after the freeze: final result, winner reward states, tie', () => {
  const won = section(render({ battle: 'final', myTeam: 'hooligans' }), 'vt-h-battle')
  assert.match(won, /Final score/)
  assert.match(won, /Final: HOOLIGANS win — your team won/)
  const lostGifts = section(render({ battle: 'final', myTeam: 'aliens' }), 'vt-h-bgifts')
  assert.match(lostGifts, /data-vt-winner="not_winner"[\s\S]*Your Battle Gifts stay yours/)
  const wonGifts = section(render({ battle: 'final', myTeam: 'hooligans' }), 'vt-h-bgifts')
  assert.match(wonGifts, /data-vt-winner="claimable"[\s\S]*20 XP \+ 1 Charge Cell[\s\S]*data-vt-act="winner-claim"/)
  const tie = render({ battle: 'finalTie', myTeam: 'aliens' })
  assert.match(section(tie, 'vt-h-battle'), /Final: tied at 1,100 — both teams win/)
  assert.match(section(tie, 'vt-h-bgifts'), /data-vt-winner="claimable"/)
  const before = section(render({ battle: 'hooligans' }), 'vt-h-bgifts')
  assert.match(before, /data-vt-winner="pending"[\s\S]*final score Oct 23 12:00 KST/)
  assert.match(section(render({ battle: 'hooligans' }), 'vt-h-battle'), /Final score at 12:00 KST on Oct 23\./)
  assert.match(section(render({ battle: 'final', contributor: false }), 'vt-h-bgifts'), /data-vt-winner="not_contributor"/)
})

// ── City banner ──────────────────────────────────────────────────────

test('City banner: live with no team, team assigned (leading / behind / tied)', () => {
  const noTeam = votingEventCard(cityBanner({ myTeam: null }), CITY_NOW)
  assert.match(noTeam, /data-vt-city="no-team"/)
  assert.match(noTeam, /MAMA 2026 <span class="vt-city-vs">HOOLIGANS vs ALIENS/)
  assert.match(noTeam, />Choose your team</)
  const lead = votingEventCard(cityBanner({ myTeam: 'hooligans', scores: [214, 198] }), CITY_NOW)
  assert.match(lead, /data-vt-city="live"[\s\S]*HOOLIGANS <b>214<\/b>[\s\S]*ALIENS <b>198<\/b>/)
  assert.match(lead, /Your team is leading by 16 · 1\/6 votes verified today · Next Gift 500 · 8d 11h left/)
  assert.match(lead, />Open MAMA Battle</)
  assert.match(votingEventCard(cityBanner({ myTeam: 'hooligans', scores: [176, 203] }), CITY_NOW), /Your team is 27 behind/)
  assert.match(votingEventCard(cityBanner({ myTeam: 'aliens', scores: [176, 203] }), CITY_NOW), /Your team is leading by 27/)
  assert.match(votingEventCard(cityBanner({ myTeam: 'aliens', scores: [120, 120] }), CITY_NOW), /Tied at 120/)
  assert.match(votingEventCard(cityBanner({ myTeam: 'aliens', done: 6 }), CITY_NOW), /Today&#39;s votes done|Today's votes done/)
})

test('City banner: voting closed and verifying, then the final result', () => {
  const closed = votingEventCard(cityBanner({ phase: 'verifying' }), CITY_NOW)
  assert.match(closed, /data-vt-city="verifying"[\s\S]*Voting closed · Final result after verification/)
  assert.match(votingEventCard(cityBanner({ phase: 'final', winners: ['hooligans'] }), CITY_NOW), /HOOLIGANS WIN/)
  assert.match(votingEventCard(cityBanner({ phase: 'final', winners: ['aliens'] }), CITY_NOW), /ALIENS WIN/)
  assert.match(votingEventCard(cityBanner({ phase: 'final', winners: ['aliens', 'hooligans'] }), CITY_NOW), /Battle Draw/)
  // A freshly frozen battle whose cached score hasn't caught up yet: still "verifying", never a wrong winner.
  assert.match(votingEventCard(cityBanner({ phase: 'final', winners: null }), CITY_NOW), /data-vt-city="verifying"/)
  assert.equal(cityResultText({ teams: [], winners: [] }), null)
})

test('City banner: no emoji, no Campaign wording, scores never computed in the browser', () => {
  for (const o of [{}, { myTeam: null }, { phase: 'verifying' }, { phase: 'final', winners: ['aliens'] }]) {
    const html = votingEventCard(cityBanner(o), CITY_NOW)
    assert.doesNotMatch(html, /\p{Extended_Pictographic}/u)
    assert.doesNotMatch(html, /campaign/i)
  }
  const src = readFileSync(new URL('./voting-view.js', import.meta.url), 'utf8')
  const card = src.slice(src.indexOf('export function votingEventCard'))
  assert.doesNotMatch(card, /reduce\(|\.points \+/, 'banner only displays the server totals')
  assert.doesNotMatch(card, /\b(?:40|100|180|280|400)\b/, 'City banner has no legacy milestone constants')
  assert.match(card, /nextMilestone\(b\)/, 'City banner reads the next target from server-provided milestone state')
})
