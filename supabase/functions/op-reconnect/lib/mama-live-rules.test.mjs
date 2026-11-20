// MAMA 2026 live voting banner + popup (mama-live-rules.js and its wiring).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MAMA_LIVE_URL, normalizeMamaLive, nextMamaLive, kstToIso, zoneLabel, localStart,
  mamaBannerCopy, MAMA_POPUP_COPY, mamaPopupDue, markMamaPopupSeen,
} from './mama-live-rules.js'

// A sample ceremony: 6 PM KST on a Saturday.
const START = kstToIso('2026-11-28', '18:00')
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) } }

test('the official link', () => {
  assert.equal(MAMA_LIVE_URL, 'https://www.mnetplus.world/event/en/2026-mama')
  assert.equal(MAMA_POPUP_COPY.url, MAMA_LIVE_URL)
})

test('6 PM KST is 09:00 UTC, every day of the year (no daylight saving)', () => {
  assert.equal(START, '2026-11-28T09:00:00.000Z')
  assert.equal(kstToIso('2026-07-01', '18:00'), '2026-07-01T09:00:00.000Z')
  assert.equal(kstToIso('2026-11-28', '6pm'), null)
  assert.equal(kstToIso('', '18:00'), null)
})

test('anything unknown is hidden; liveSince only exists while live', () => {
  assert.deepEqual(normalizeMamaLive(null), { state: 'hidden', startsAt: null, liveSince: null })
  assert.equal(normalizeMamaLive({ state: 'LIVE' }).state, 'hidden')
  assert.equal(normalizeMamaLive({ state: 'upcoming', liveSince: '2026-11-28T09:30:00Z' }).liveSince, null)
})

test('admin changes: Live stamps liveSince once, staying Live keeps it, Hidden clears it', () => {
  const t1 = new Date('2026-11-28T09:40:00Z'), t2 = new Date('2026-11-28T10:10:00Z')
  const up = nextMamaLive(null, { state: 'upcoming', startsAt: START }, t1).value
  assert.deepEqual(up, { state: 'upcoming', startsAt: START, liveSince: null })
  const live = nextMamaLive(up, { state: 'live' }, t1).value
  assert.equal(live.liveSince, t1.toISOString())
  assert.equal(live.startsAt, START, 'start kept when not sent')
  assert.equal(nextMamaLive(live, { state: 'live' }, t2).value.liveSince, t1.toISOString(), 'saving Live again does not re-show the popup')
  const hidden = nextMamaLive(live, { state: 'hidden' }, t2).value
  assert.equal(hidden.liveSince, null)
  assert.equal(nextMamaLive(hidden, { state: 'live' }, t2).value.liveSince, t2.toISOString(), 'a new Live session')
  assert.deepEqual(nextMamaLive(null, { state: 'open' }), { error: 'bad_state' })
  assert.deepEqual(nextMamaLive(null, { state: 'upcoming', startsAt: 'soon' }), { error: 'bad_start' })
})

test('India sees 2:30 PM IST, whatever the phone language', () => {
  for (const locale of ['en-IN', 'en-US', 'en-GB']) {
    const s = localStart(START, { timeZone: 'Asia/Kolkata', locale, now: new Date('2026-11-28T03:00:00Z') })
    assert.equal(s.text, 'Nov 28, 2:30 PM IST', locale)
    assert.equal(s.zone, 'IST')
    assert.equal(s.when, 'today')
  }
})

test('other visitors see their own date, time and zone', () => {
  const now = new Date('2026-11-28T03:00:00Z')
  const seoul = localStart(START, { timeZone: 'Asia/Seoul', locale: 'en-US', now })
  assert.match(seoul.time, /^6:00\s?PM$/)
  const ny = localStart(START, { timeZone: 'America/New_York', locale: 'en-US', now })
  assert.match(ny.time, /^4:00\s?AM$/)
  assert.equal(ny.zone, 'EST')
  assert.equal(ny.date, 'Nov 28')
  const la = localStart(START, { timeZone: 'America/Los_Angeles', locale: 'en-US', now: new Date('2026-11-27T20:00:00Z') })
  assert.match(la.time, /^1:00\s?AM$/)
  assert.equal(la.when, 'tomorrow')
  assert.equal(localStart('nope', { timeZone: 'Asia/Kolkata' }), null)
  assert.equal(zoneLabel('Asia/Calcutta', 'en-US'), 'IST')
})

test('Upcoming banner: "Today" only when it really is today for the visitor', () => {
  const opts = { timeZone: 'Asia/Kolkata', locale: 'en-IN' }
  const today = mamaBannerCopy({ state: 'upcoming', startsAt: START }, { ...opts, now: new Date('2026-11-28T03:00:00Z') })
  assert.equal(today.heading, 'MAMA Live Voting · Today 💜')
  assert.equal(today.text, 'Get ready to vote for BTS! Live voting opens during the MAMA Awards broadcast.')
  assert.equal(today.startLine, 'Show starts · Nov 28, 2:30 PM IST', 'the show start, no "your time"')
  assert.equal(today.reminder, 'Update Mnet Plus and sign in before voting begins.')
  assert.equal(today.button, 'Open Mnet Plus')
  assert.equal(today.url, MAMA_LIVE_URL)
  const eve = mamaBannerCopy({ state: 'upcoming', startsAt: START }, { ...opts, now: new Date('2026-11-27T03:00:00Z') })
  assert.equal(eve.heading, 'MAMA Live Voting · Tomorrow 💜')
  const early = mamaBannerCopy({ state: 'upcoming', startsAt: START }, { ...opts, now: new Date('2026-11-24T03:00:00Z') })
  assert.equal(early.heading, 'MAMA Live Voting · Nov 28 💜')
  assert.equal(mamaBannerCopy({ state: 'upcoming' }, opts).startLine, null, 'no start set: no time line')
})

test('Live banner and popup copy; Hidden shows nothing; no multi-device claims', () => {
  const live = mamaBannerCopy({ state: 'live', liveSince: '2026-11-28T09:40:00Z' })
  assert.equal(live.heading, 'LIVE NOW · Vote for BTS 💜')
  assert.equal(live.text, "Open Mnet Plus → 2026 MAMA AWARDS → LIVE VOTE → Fans' Choice of the Year with VISA → BTS.")
  assert.equal(live.reminder, 'Complete all required steps and check your vote confirmation.')
  assert.equal(live.button, 'Vote on Mnet Plus')
  assert.equal(mamaBannerCopy({ state: 'hidden' }), null)
  assert.equal(MAMA_POPUP_COPY.heading, 'LIVE NOW · Vote for BTS 💜')
  assert.equal(MAMA_POPUP_COPY.text, "MAMA live voting is open! Head to Mnet Plus and vote for BTS in Fans' Choice of the Year (Daesang).")
  assert.equal(MAMA_POPUP_COPY.button, 'VOTE NOW')
  const all = JSON.stringify([live, MAMA_POPUP_COPY, mamaBannerCopy({ state: 'upcoming', startsAt: START }, { timeZone: 'UTC' })])
  assert.doesNotMatch(all, /device[s]? to vote|multiple devices|second device|screenshot|XP|points/i)
})

test('popup: only while Live, once per visitor per Live session; broken storage = never', () => {
  const s = memory()
  const live = { state: 'live', liveSince: '2026-11-28T09:40:00Z' }
  assert.equal(mamaPopupDue({ state: 'upcoming', startsAt: START }, s), false, 'no popup before voting opens')
  assert.equal(mamaPopupDue(live, s), true)
  markMamaPopupSeen(live, s)
  assert.equal(mamaPopupDue(live, s), false)
  assert.equal(mamaPopupDue({ state: 'live', liveSince: '2026-11-28T11:00:00Z' }, s), true, 'a later Live session asks again')
  assert.equal(mamaPopupDue({ state: 'hidden' }, s), false)
  const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  assert.equal(mamaPopupDue(live, broken), false)
  assert.doesNotThrow(() => markMamaPopupSeen(live, broken))
})

// ── Wiring ──
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

test('routes: public read, admin-only write; game state carries the state only', () => {
  const index = read('../index.ts')
  assert.match(index, /getMamaLive: \{ auth: 'public'/)
  assert.match(index, /adminSetMamaLive: \{ auth: 'admin'/)
  assert.match(read('./handlers.ts'), /mamaLive: normalizeMamaLive\(content\.config\.mama_live\)/)
  assert.doesNotMatch(read('./mama-live.ts'), /setInterval|setTimeout|Date\.now\(\) >=|cron/i, 'nothing switches by itself')
})

test('homepage: banner right under the hero; game popup only on the City screen', () => {
  const html = read('../../../../index.html')
  const hero = html.indexOf('</header>'), below = html.indexOf('<main class="below">'), banner = html.indexOf('id="mamaLive"'), activity = html.indexOf('id="activity"')
  assert.ok(hero < below && below < banner && banner < activity, 'first thing below the hero')
  assert.match(html, /<section class="mama-live" id="mamaLive" hidden/)
  const popup = read('../../../../js/mama-live-popup.js')
  assert.match(popup, /getScreen\(\)\?\.name !== 'world'\) return/)
  assert.match(popup, /overlay && !overlay\.hidden\) return/)
  const landing = read('../../../../js/mama-live-banner.js')
  assert.match(landing, /aria-label="Close">×</)
  assert.doesNotMatch(landing + popup, /Maybe later|Get Ready.*button|Dismiss/i)
})

test('game popup: heading, text and VOTE NOW only — no icon, no second button', () => {
  const popup = read('../../../../js/mama-live-popup.js')
  assert.doesNotMatch(popup, /vt-pop-ico|is-quiet|data-vp="secondary"/)
  assert.equal((popup.match(/<button/g) || []).length, 1)
  const css = read('../../../../css/landing.css')
  const block = css.slice(css.indexOf('/* ── Temporary: MAMA 2026')).replace(/\/\*[\s\S]*?\*\//g, '')
  assert.doesNotMatch(block, /gradient|animation|@keyframes/, 'flat: no gradients or animation')
})
