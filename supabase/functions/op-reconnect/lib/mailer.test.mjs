// The inactivity reminder — the one email this system sends to people who are
// not looking at the game.
//
// It went out to three real players before it had a single test. The version
// they received named "Op: Reconnect · HQ" and nothing else, carried no link,
// and made "permanently deleted" the largest text on screen — an unfamiliar
// sender, no brand, and a deletion threat, which is the shape of a phishing
// email. These tests exist so the recognisability requirements cannot quietly
// regress the next time someone edits the copy.

import test from 'node:test'
import assert from 'node:assert/strict'

// mailer.ts reads Deno.env inside sendMail. bombReminderEmail does not, but the
// module is a Deno module, so give it something to find.
globalThis.Deno = globalThis.Deno || { env: { get: () => undefined } }
const { bombReminderEmail } = await import('./mailer.ts')

const RETURN_URL = 'https://hopetrackers.org/game?mode=signin'
const mail = (days = 2) => bombReminderEmail('AGENT071', 'thats._riaa', days)

test('the subject names HopeTrackers and OP: ReConnect before anything else', () => {
  const { subject } = mail()
  assert.ok(subject.startsWith('HopeTrackers · OP: ReConnect'), subject)
  // The days and the agent number both belong there too, but after the names —
  // a notification preview truncates, and the brand is what earns the open.
  assert.match(subject, /2 days left/)
  assert.match(subject, /AGENT071/)
})

test('every part carries both names', () => {
  const m = mail()
  for (const [part, body] of [['subject', m.subject], ['text', m.text], ['html', m.html]]) {
    assert.match(body, /HopeTrackers/, `${part} does not say HopeTrackers`)
    assert.match(body, /OP: ReConnect/, `${part} does not say OP: ReConnect`)
  }
})

test('the return link is the stable direct route, in both bodies', () => {
  const m = mail()
  assert.ok(m.text.includes(RETURN_URL), 'plain text has no return link')
  assert.ok(m.html.includes(`href="${RETURN_URL}"`), 'html button does not link to the return route')
  // /game.html 307-redirects to /game; a redirect in an email link is one more
  // thing between a lapsed player and coming back.
  assert.doesNotMatch(m.text, /game\.html/)
  assert.doesNotMatch(m.html, /game\.html/)
})

test('the reader can tell which account this is about', () => {
  const m = mail()
  for (const body of [m.text, m.html]) {
    assert.match(body, /AGENT071/)
    assert.match(body, /thats\._riaa/)
  }
})

test('one day is singular, everything else plural — in all three parts', () => {
  const one = mail(1)
  for (const body of [one.subject, one.text, one.html]) {
    assert.match(body, /1 day\b/, 'should read "1 day"')
    assert.doesNotMatch(body, /1 days/, 'should never read "1 days"')
  }
  const four = mail(4)
  for (const body of [four.subject, four.text, four.html]) assert.match(body, /4 days/)
})

test('the deletion is stated, but does not dominate', () => {
  const m = mail()
  // Still said plainly — people must not be surprised.
  assert.match(m.text, /the agent file and everything in it is\nremoved/)
  assert.match(m.html, /the agent file and everything in it is removed/)
  // But not in the subject, not in the heading, and not the loudest element.
  assert.doesNotMatch(m.subject, /delet|removed/i, 'the subject must not lead with the consequence')
  assert.doesNotMatch(m.html, /permanently deleted/, 'the old dominant phrasing is back')
  // The callout box should carry the ACTION, not the threat.
  assert.match(m.html, /to feed your Bomb and stay active/)
})

test('the alert box is no longer alarm-red', () => {
  // It was #dc2626 with a red fill, the largest thing in the email. The button
  // should now be the loudest element, not the countdown.
  const { html } = mail()
  assert.doesNotMatch(html, /#dc2626/, 'the red alert styling is back')
  assert.match(html, /background:#a78bfa/, 'the call-to-action button is missing')
})

test('the reassurance for people who are done is kept', () => {
  const m = mail()
  for (const body of [m.text, m.html]) {
    assert.match(body, /no action is needed/)
    assert.match(body, /didn't want it to be a surprise|didn't want it\nto be a surprise/)
  }
})

test('it signs off as HopeTrackers · OP: ReConnect', () => {
  const m = mail()
  assert.match(m.text, /— HopeTrackers · OP: ReConnect/)
  assert.match(m.html, /HopeTrackers &middot; OP: ReConnect/)
})

test('returning, not deleting, is what the email actually asks for', () => {
  const m = mail()
  for (const body of [m.text, m.html]) {
    assert.match(body, /Auto Feed/, 'does not explain that streaming keeps you active')
    assert.match(body, /stream BTS|stream\nBTS/, 'does not mention streaming')
  }
  assert.match(m.html, /Come back to the city/)
})

test('nothing in the template can send anything', () => {
  // It is a pure function returning three strings. Guards against someone
  // wiring a send into it later.
  const m = mail()
  assert.deepEqual(Object.keys(m).sort(), ['html', 'subject', 'text'])
  for (const v of Object.values(m)) assert.equal(typeof v, 'string')
})
