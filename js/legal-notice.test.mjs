// The one-time "we published Privacy/Terms/Credits" notice.
//
// The failures worth protecting against are all about WHO sees it and how
// often: telling a brand-new agent that pages were "added" before they ever
// joined is wrong, and re-showing a dismissed notice every refresh is the
// kind of nag that makes people stop reading notices at all. It is also not
// a consent gate, so nothing here may block play or record an acceptance.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { shouldShowLegalNotice, withNoticeDismissed } from './legal-notice-rules.js'
import {
  legalInfoNoticeDue, LEGAL_INFO_NOTICE_ID, LEGAL_INFO_PUBLISHED_AT,
} from '../supabase/functions/op-reconnect/lib/broadcasts.ts'

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
const settings = read('js/screen-settings.js')
const broadcastsJs = read('js/broadcasts.js')
const world = read('js/screen-world.js')
const handlers = read('supabase/functions/op-reconnect/lib/handlers.ts')
/** Executable source only. These files document their own design in
 *  comments, so a bare substring check would fail on the explanation
 *  rather than on the behaviour. */
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
const broadcastsCode = code(broadcastsJs)

/* ── Who is eligible ───────────────────────────────────────────────────── */

// Derived from the constant, never hardcoded: the cutoff moves when a
// release is rescheduled, and a test that pins the old date would either
// break for the wrong reason or quietly stop testing the boundary.
const CUTOFF_MS = Date.parse(LEGAL_INFO_PUBLISHED_AT)
const at = (offsetMs) => new Date(CUTOFF_MS + offsetMs).toISOString()

test('an agent who registered before publication is eligible', () => {
  assert.equal(legalInfoNoticeDue('2026-08-07T10:00:00Z'), true)
  assert.equal(legalInfoNoticeDue(at(-86_400_000)), true, 'a day before')
})

test('an agent who registered after publication is NOT eligible', () => {
  // They have had the pages available since the moment they joined; being
  // told something was "added" would be a lie about their own history.
  assert.equal(legalInfoNoticeDue(at(86_400_000)), false, 'a day after')
  assert.equal(legalInfoNoticeDue('2026-12-15T09:00:00Z'), false)
})

test('one second before the cutoff is eligible', () => {
  assert.equal(legalInfoNoticeDue(at(-1000)), true)
})

test('exactly at the cutoff is NOT eligible', () => {
  // The cutoff is the publication instant itself: at that moment the pages
  // are live, so this agent is not someone the pages were "added" for.
  assert.equal(legalInfoNoticeDue(LEGAL_INFO_PUBLISHED_AT), false)
  assert.equal(legalInfoNoticeDue(at(0)), false)
})

test('one second after the cutoff is NOT eligible', () => {
  assert.equal(legalInfoNoticeDue(at(1000)), false)
})

test('the cutoff is a publication instant, not a calendar-day boundary', () => {
  // The bug this replaced: a midnight-UTC cutoff classified anyone who
  // joined earlier on release day as a post-publication agent, hours before
  // the pages actually went live.
  assert.notEqual(LEGAL_INFO_PUBLISHED_AT.slice(11), '00:00:00Z',
    'a midnight cutoff means "the date began", not "the pages went live"')
  const midnightOfSameDay = `${LEGAL_INFO_PUBLISHED_AT.slice(0, 10)}T00:00:00Z`
  assert.equal(legalInfoNoticeDue(midnightOfSameDay), true,
    'someone who joined at midnight on release day existed before publication')
})

test('a missing or unparseable timestamp is treated as not eligible', () => {
  // Fail closed: showing nothing is recoverable, showing a wrong historical
  // claim to someone is not.
  for (const bad of [null, undefined, '', 'not a date']) {
    assert.equal(legalInfoNoticeDue(bad), false)
  }
})

test('the cutoff is a fixed constant, never evaluated per request', () => {
  const src = read('supabase/functions/op-reconnect/lib/broadcasts.ts')
  // Just this function's body — the admin broadcast helpers further down
  // legitimately use Date.now() to compute an expiry.
  const from = src.indexOf('export function legalInfoNoticeDue')
  const fn = src.slice(from, src.indexOf('\n}', from) + 2)
  assert.ok(fn.includes('legalInfoNoticeDue'), 'could not isolate the function body')
  assert.doesNotMatch(fn, /Date\.now\(\)/, 'eligibility must not slide forward with the clock')
  assert.match(LEGAL_INFO_PUBLISHED_AT, /^\d{4}-\d{2}-\d{2}T/)
})

/* ── Showing and dismissing ────────────────────────────────────────────── */

test('an eligible agent on a fresh device sees the notice', () => {
  assert.equal(shouldShowLegalNotice({ legalNotice: LEGAL_INFO_NOTICE_ID }, []), true)
})

test('an ineligible agent sees nothing, whatever the device remembers', () => {
  assert.equal(shouldShowLegalNotice({ legalNotice: null }, []), false)
  assert.equal(shouldShowLegalNotice({}, []), false)
  assert.equal(shouldShowLegalNotice(null, []), false)
})

test('"Got it" dismisses it and it does not come back', () => {
  const after = withNoticeDismissed([], LEGAL_INFO_NOTICE_ID)
  assert.deepEqual(after, [LEGAL_INFO_NOTICE_ID])
  assert.equal(shouldShowLegalNotice({ legalNotice: LEGAL_INFO_NOTICE_ID }, after), false)
})

test('dismissing twice cannot duplicate the record', () => {
  const once = withNoticeDismissed([], LEGAL_INFO_NOTICE_ID)
  assert.deepEqual(withNoticeDismissed(once, LEGAL_INFO_NOTICE_ID), once)
})

test('dismissal is keyed to this notice, not a generic "seen legal" flag', () => {
  // A later notice gets a new id and must still be able to appear.
  const after = withNoticeDismissed([], LEGAL_INFO_NOTICE_ID)
  assert.equal(shouldShowLegalNotice({ legalNotice: 'legal_info_2027_04' }, after), true)
})

test('dismissal is stored under its own key, away from the capped broadcast list', () => {
  // The broadcast list keeps only the last 50 ids; a notice evicted by that
  // cap would reappear from the dead.
  assert.match(broadcastsJs, /const NOTICE_KEY = 'rc_seen_notices'/)
  assert.match(broadcastsJs, /const SEEN_KEY = 'rc_seen_broadcasts'/)
})

/* ── What it must not do ───────────────────────────────────────────────── */

test('the notice never blocks gameplay', () => {
  // It is a card appended to the World screen's normal flow, not an overlay,
  // sheet or modal — so there is no focus trap, no Escape convention, and
  // nothing to dismiss before playing.
  assert.match(world, /legalNoticeCard\(state\)/)
  assert.doesNotMatch(broadcastsCode, /showOverlay|openSheet|dialog|aria-modal/)
})

test('the notice sends no email, push or broadcast', () => {
  for (const forbidden of ['mailer', 'sendMail', 'Notification', 'pushManager', 'rc_broadcasts']) {
    assert.ok(!broadcastsCode.includes(forbidden), `broadcasts.js reaches for ${forbidden}`)
  }
})

test('"View details" opens Settings and does NOT acknowledge', () => {
  assert.match(broadcastsJs, /data-act="details"\]'\)\.onclick = \(\) => goSettings/)
  const detailsHandler = broadcastsJs.slice(
    broadcastsJs.indexOf('data-act="details"'),
    broadcastsJs.indexOf('data-act="ok"'),
  )
  assert.doesNotMatch(detailsHandler, /markNoticeSeen/, 'reading the pages must not count as dismissal')
})

test('eligibility is decided server-side and no timestamp is sent to the client', () => {
  assert.match(handlers, /legalNotice: legalInfoNoticeDue\(player\.joined_at\) \? LEGAL_INFO_NOTICE_ID : null/)
  assert.doesNotMatch(broadcastsCode, /joined_at|joinedAt/, 'the client must never receive a registration time')
})

test('no consent record, age gate or new personal data', () => {
  for (const forbidden of ['consent', 'accepted_at', 'dob', 'birth', 'age_gate', 'checkbox']) {
    assert.ok(!broadcastsCode.toLowerCase().includes(forbidden), `broadcasts.js mentions ${forbidden}`)
  }
})

/* ── Settings carries the full information set ─────────────────────────── */

for (const [name, href] of [
  ['Privacy Policy', 'privacy.html'],
  ['Terms of Service', 'terms.html'],
  ['About', 'about.html'],
  ['Credits', 'credits.html'],
  ['Contact', 'contact.html'],
]) {
  test(`Settings links to ${name}`, () => {
    assert.ok(settings.includes(`name: '${name}'`), `Settings has no ${name} row`)
    assert.ok(settings.includes(`href: '${href}'`), `Settings does not point at ${href}`)
    // And the page it points at actually exists, so the link cannot 404.
    assert.doesNotThrow(() => read(href), `${href} does not exist`)
  })
}

test('the corrected retirement wording is unchanged', () => {
  assert.match(settings, /Three things do not go\./)
  assert.match(settings, /Missions you created stay, so the teammates who joined them keep their history, with your name removed\./)
})

/* ── Nothing else moved ────────────────────────────────────────────────── */

test('the public landing stats are untouched by this feature', () => {
  const pub = read('supabase/functions/op-reconnect/lib/public.ts')
  assert.doesNotMatch(pub, /legalNotice|legalInfo/)
  assert.deepEqual(
    [...pub.matchAll(/^\s+(agents|arirangStreams|roadTo1BStreams):/gm)].map((m) => m[1]),
    ['agents', 'arirangStreams', 'roadTo1BStreams'],
  )
})
