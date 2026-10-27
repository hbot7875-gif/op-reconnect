// The MAMA City banner's countdown and lifecycle (voting-city-clock.js),
// and the banner markup that carries it (votingEventCard).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cityCountdown, cityBannerState, tickCityClocks, LIVE_NOW_MS } from './voting-city-clock.js'
import { votingEventCard } from './voting-view.js'

const OPENS = Date.parse('2026-10-28T18:00:00+09:00')
const CLOSES = Date.parse('2026-11-08T23:59:59+09:00')
const S = 1000
const H = 3600 * S
const banner = (o = {}) => ({
  campaignId: 'mama_2026_r2', title: 'MAMA 2026', roundLabel: "Round 2 · Fans' Choice", phase: 'soon',
  opensAt: '2026-10-28T18:00:00+09:00', closesAt: '2026-11-08T23:59:59+09:00', done: 0, total: 6,
  battle: { myTeam: 'aliens', teams: [{ id: 'hooligans', label: 'HOOLIGANS', points: 0, agents: 54 }, { id: 'aliens', label: 'ALIENS', points: 0, agents: 49 }], total: 0, milestones: [], winners: null },
  ...o,
})

// ── the format ───────────────────────────────────────────────────────

test('more than 24 hours: days and hours', () => {
  assert.equal(cityCountdown(28 * H), '1d 4h')
  assert.equal(cityCountdown(2 * 24 * H + 59 * 60 * S), '2d 0h')
  assert.equal(cityCountdown(24 * H + S), '1d 0h')
})

test('1–24 hours: HH:MM:SS, zero-padded', () => {
  assert.equal(cityCountdown(24 * H), '24:00:00')
  assert.equal(cityCountdown(5 * H + 4 * 60 * S), '05:04:00')
  assert.equal(cityCountdown(H), '01:00:00')
})

test('under 1 hour: MM:SS; the final ten seconds count down to 00:01', () => {
  assert.equal(cityCountdown(H - S), '59:59')
  assert.equal(cityCountdown(4 * 60 * S + 3 * S), '04:03')
  const last = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => cityCountdown(n * S))
  assert.deepEqual(last, ['00:10', '00:09', '00:08', '00:07', '00:06', '00:05', '00:04', '00:03', '00:02', '00:01'])
  assert.equal(cityCountdown(1), '00:01', 'part of a second still shows a second, never 00:00 early')
})

test('at or past zero there is no time — never a negative value', () => {
  for (const ms of [0, -1, -5 * S, -H, NaN]) assert.equal(cityCountdown(ms), null)
})

// ── the lifecycle ────────────────────────────────────────────────────

test('before voting: "Voting opens in", counting to the real opening time', () => {
  const s = cityBannerState(banner(), OPENS - 28 * H)
  assert.deepEqual([s.state, s.label, s.value, s.live], ['soon', 'Voting opens in', '1d 4h', false])
  assert.equal(cityBannerState(banner(), OPENS - 5 * S).value, '00:05')
})

test('opening moves to LIVE by itself: LIVE NOW, then "Voting closes in" to the real close', () => {
  const at = cityBannerState(banner(), OPENS)
  assert.deepEqual([at.state, at.value, at.live], ['live', 'LIVE NOW', true], 'server still says soon; the clock moves it')
  assert.equal(cityBannerState(banner(), OPENS + LIVE_NOW_MS - 1).value, 'LIVE NOW')
  const after = cityBannerState(banner({ phase: 'open' }), OPENS + LIVE_NOW_MS)
  assert.deepEqual([after.label, after.live], ['Voting closes in', true])
  assert.equal(after.value, cityCountdown(CLOSES - (OPENS + LIVE_NOW_MS)))
  assert.equal(cityBannerState(banner({ phase: 'open' }), CLOSES - 3 * H).value, '03:00:00')
  assert.equal(cityBannerState(banner({ phase: 'open' }), CLOSES - 61 * S).value, '01:01')
})

test('closing stops at zero: "Voting closed · Results pending", never negative', () => {
  for (const at of [CLOSES, CLOSES + S, CLOSES + 3 * H]) {
    const s = cityBannerState(banner({ phase: 'open' }), at)
    assert.deepEqual([s.state, s.label, s.value, s.live], ['closed', 'Voting closed', 'Results pending', false])
  }
  assert.equal(cityBannerState(banner({ phase: 'verifying' }), CLOSES + H).state, 'closed')
})

test('"Battle ended" comes only from the server: final phase with a known result', () => {
  const final = cityBannerState(banner({ phase: 'final' }), CLOSES + 40 * H, 'ALIENS WIN')
  assert.deepEqual([final.state, final.label, final.value], ['final', 'Battle ended', 'View results'])
  // The clock alone never finalizes: long after close, still pending.
  assert.equal(cityBannerState(banner({ phase: 'open' }), CLOSES + 99 * H).state, 'closed')
  assert.equal(cityBannerState(banner({ phase: 'verifying' }), CLOSES + 99 * H, 'ALIENS WIN').state, 'closed')
  // Final but no winner yet in the cached score: still pending, never a guess.
  assert.equal(cityBannerState(banner({ phase: 'final' }), CLOSES + 40 * H, null).state, 'closed')
})

// ── the banner ───────────────────────────────────────────────────────

test('banner: title, matchup, round, countdown and a chevron — no scores, counts or buttons inside', () => {
  const html = votingEventCard(banner(), new Date(OPENS - 28 * H))
  assert.match(html, /^<button class="vt-entry vt-city" type="button" data-vt-open data-vt-city="soon" data-vt-cd/)
  assert.match(html, /<span class="vt-city-t">MAMA 2026<span class="vt-city-live" hidden>/)
  assert.match(html, /<span class="vt-city-vs">HOOLIGANS vs ALIENS<\/span>/)
  assert.match(html, /<span class="vt-city-round">Round 2 · Fans&#39; Choice<\/span>/)
  assert.match(html, /<span class="vt-city-cl">Voting opens in<\/span><span class="vt-city-cv">1d 4h<\/span>/)
  assert.match(html, /class="vt-city-go" aria-hidden="true"><svg/)
  assert.equal((html.match(/<button/g) || []).length, 1, 'the whole card is the one button')
  assert.doesNotMatch(html, /\b54\b|\b49\b|agents|Recruit|Choose your team|Copy link/, 'no team counts, no recruit button')
  assert.match(html, /aria-label="MAMA 2026, HOOLIGANS vs ALIENS, Round 2 · Fans&#39; Choice\. Voting opens in 1d 4h\. Open the event\."/)
  assert.match(html, /data-opens="2026-10-28T18:00:00\+09:00" data-closes="2026-11-08T23:59:59\+09:00"/, 'the real timestamps ride along')
  for (const [o, now, state, live] of [
    [{ phase: 'open' }, OPENS + 3 * H, 'live', true],
    [{ phase: 'verifying' }, CLOSES + H, 'closed', false],
    [{ phase: 'final', battle: { ...banner().battle, winners: ['aliens'] } }, CLOSES + 40 * H, 'final', false],
  ]) {
    const h = votingEventCard(banner(o), new Date(now))
    assert.match(h, new RegExp(`data-vt-city="${state}"`), state)
    assert.equal(/class="vt-city-live" hidden/.test(h), !live, `${state}: LIVE badge`)
    assert.doesNotMatch(h, /\p{Extended_Pictographic}/u)
  }
  assert.match(votingEventCard(banner({ phase: 'final', battle: { ...banner().battle, winners: ['aliens'] } }), new Date(CLOSES + 40 * H)), /Battle ended<\/span><span class="vt-city-cv is-word">View results/)
  assert.match(votingEventCard(banner({ phase: 'verifying' }), new Date(CLOSES + H)), /Voting closed<\/span><span class="vt-city-cv is-word">Results pending/)
  assert.equal(votingEventCard(null), '')
})

// ── the ticker ───────────────────────────────────────────────────────

/** A banner as the browser holds it: only the pieces the ticker touches. */
function fakeCard(html) {
  const attr = (n) => (html.match(new RegExp(`${n}="([^"]*)"`)) || [])[1]?.replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  const el = (text, hidden = false) => ({ textContent: text, hidden, classes: new Set(), classList: { toggle(c, on) { on ? this.owner.classes.add(c) : this.owner.classes.delete(c) } } })
  const live = el('LIVE', /vt-city-live" hidden/.test(html))
  const cl = el((html.match(/vt-city-cl">([^<]*)/) || [])[1])
  const cv = el((html.match(/vt-city-cv[^>]*>([^<]*)/) || [])[1])
  cv.classList.owner = cv
  const card = {
    dataset: { vtCity: attr('data-vt-city'), phase: attr('data-phase'), opens: attr('data-opens'), closes: attr('data-closes'), result: attr('data-result'), title: attr('data-title') },
    aria: attr('aria-label'), sets: 0,
    getAttribute() { return this.aria },
    setAttribute(_, v) { this.aria = v; this.sets++ },
    querySelector(sel) { return { '.vt-city-live': live, '.vt-city-cl': cl, '.vt-city-cv': cv }[sel] },
  }
  return { card, live, cl, cv, root: { querySelectorAll: () => [card] } }
}

test('ticker: recomputes from the clock each time, moving through every state in place', () => {
  const { card, live, cl, cv, root } = fakeCard(votingEventCard(banner(), new Date(OPENS - 28 * H)))
  const at = (ms) => { tickCityClocks(root, ms); return [card.dataset.vtCity, cl.textContent, cv.textContent, live.hidden] }
  assert.deepEqual(at(OPENS - 28 * H), ['soon', 'Voting opens in', '1d 4h', true])
  assert.deepEqual(at(OPENS - 5 * H - 4 * 60 * S), ['soon', 'Voting opens in', '05:04:00', true])
  assert.deepEqual(at(OPENS - 10 * S), ['soon', 'Voting opens in', '00:10', true])
  // A suspended phone waking hours later lands on the right value — no
  // counter was decremented while it slept.
  assert.deepEqual(at(OPENS), ['live', 'Voting is open', 'LIVE NOW', false])
  assert.deepEqual(at(CLOSES - 4 * 60 * S - 3 * S), ['live', 'Voting closes in', '04:03', false])
  assert.deepEqual(at(CLOSES + S), ['closed', 'Voting closed', 'Results pending', true])
  assert.ok(cv.classes.has('is-word'), 'words get the word style')
  assert.equal(card.aria, "MAMA 2026, HOOLIGANS vs ALIENS, Round 2 · Fans' Choice. Voting closed Results pending. Open the event.")
  const before = card.sets
  tickCityClocks(root, CLOSES + 2 * S)
  assert.equal(card.sets, before, 'nothing is rewritten when nothing changed')
  assert.equal(tickCityClocks({ querySelectorAll: () => [] }, OPENS), 0, 'no banner on screen: the ticker stops')
})

test('ticker source: second-aligned, catches up on return, starts from the City only', () => {
  const src = readFileSync(new URL('./voting-city-clock.js', import.meta.url), 'utf8')
  assert.match(src, /setTimeout\(run, 1000 - \(Date\.now\(\) % 1000\) \+ 15\)/, 'aligned to the second, no drift')
  assert.match(src, /visibilitychange[\s\S]*tickCityClocks\(\)/, 'back from the background: correct at once')
  assert.doesNotMatch(src, /--|-= 1|secondsLeft/, 'never a decremented counter')
  const world = readFileSync(new URL('./screen-world.js', import.meta.url), 'utf8')
  assert.match(world, /entry\.onclick = \(e\) => goVoting\(\{ x: e\.clientX, y: e\.clientY \}\)\s*\n\s*wrap\.appendChild\(entry\)\s*\n\s*startCityClock\(\)/)
  const css = readFileSync(new URL('../css/voting.css', import.meta.url), 'utf8')
  assert.match(css, /\.vt-city-cv \{ min-width: 8ch;[^}]*font-variant-numeric: tabular-nums/, 'fixed-width digits: no layout jump')
  assert.doesNotMatch(css, /\.vt-city-(cta|score|bottom)/, 'the old CTA and score rows are gone')
})
