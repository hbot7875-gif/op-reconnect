import test from 'node:test'
import assert from 'node:assert/strict'
import {
  kstDayOf, nextKstMidnight, campaignPhase, daysLeft, parseXPostUrl, snowflakeTime, normalizeHandle,
  parseOembed, decideXProof, xComposeUrl, evaluateCertificateText, participationTime, sanitizeMnetChecks, sanitizeClientCertChecks,
  decideMnetChecks, votingStreak, missionStates, giftState, pulseView, pulseQuery, snowflakeAt,
  normalizeCertificateNumber, certificateNumberFromText, certificateNumberConsensus, participationMinuteKey, cityPhase,
} from './vote-campaign-rules.js'

const MAMA = {
  id: 'mama_2026', opens_at: '2026-10-13T00:00:00+09:00', closes_at: '2026-10-22T23:59:59+09:00',
  missions: [
    { id: 'mnet', kind: 'mnet_certificate', certificate: { title_keywords: ['voting certificate'], structure_keywords: ['participation date'],
      issuer_keywords: ['mnet plus', 'mnetplus'], category_keywords: ["fans' choice category 1st vote", 'fans choice category 1st vote'] } },
    { id: 'x', kind: 'x_post', hashtags: ['2026MAMAVOTE', 'BTS'], require_handle_match: true },
  ],
}

test('KST day turns over at 15:00 UTC', () => {
  assert.equal(kstDayOf(new Date('2026-10-13T14:59:59Z')), '2026-10-13')
  assert.equal(kstDayOf(new Date('2026-10-13T15:00:00Z')), '2026-10-14')
  assert.equal(nextKstMidnight(new Date('2026-10-13T03:00:00Z')).toISOString(), '2026-10-13T15:00:00.000Z')
})

test('campaign phase and days left are KST-based', () => {
  assert.equal(campaignPhase(MAMA, new Date('2026-10-12T14:59:00Z')), 'upcoming')
  assert.equal(campaignPhase(MAMA, new Date('2026-10-13T00:00:00Z')), 'open')
  assert.equal(campaignPhase(MAMA, new Date('2026-10-22T15:00:00Z')), 'closed')
  assert.equal(daysLeft(MAMA, new Date('2026-10-13T03:00:00Z')), 10)
  assert.equal(daysLeft(MAMA, new Date('2026-10-22T10:00:00Z')), 1)
})

test('X post links: accepted forms and refusals', () => {
  assert.deepEqual(parseXPostUrl('https://x.com/SomeOne/status/1846000000000000001?s=46&t=abc'),
    { postId: '1846000000000000001', urlHandle: 'someone', canonicalUrl: 'https://x.com/SomeOne/status/1846000000000000001' })
  assert.equal(parseXPostUrl('https://twitter.com/a_b/status/1846000000000000001').postId, '1846000000000000001')
  assert.equal(parseXPostUrl('https://mobile.twitter.com/a/status/1846000000000000001/photo/1').postId, '1846000000000000001')
  assert.equal(parseXPostUrl('https://x.com/i/status/1846000000000000001').urlHandle, null)
  for (const bad of ['https://x.com/someone', 'https://t.co/abc', 'https://evil.com/a/status/1846000000000000001',
    'javascript:alert(1)', 'https://x.com/a/status/abc', 'not a url', '']) {
    assert.equal(parseXPostUrl(bad), null, bad)
  }
})

test('snowflake time matches a real post date', () => {
  // The Ellen Show Oscars selfie, 2014-03-03 (US) — checked live via oEmbed.
  const at = snowflakeTime('440322224407314432')
  assert.equal(at.toISOString().slice(0, 10), '2014-03-03')
  assert.equal(snowflakeTime('20'), null, 'pre-snowflake ids are refused')
})

test('handles are normalised and validated', () => {
  assert.equal(normalizeHandle('@BTS_twt'), 'bts_twt')
  assert.equal(normalizeHandle('  someone '), 'someone')
  assert.equal(normalizeHandle('has space'), null)
  assert.equal(normalizeHandle('waytoolonghandle_x'), null)
})

// The shape returned live by publish.x.com/oembed (2026-10-13), trimmed.
const ELLEN = {
  url: 'https://x.com/TheEllenShow/status/440322224407314432', author_name: 'The Ellen Show',
  author_url: 'https://x.com/TheEllenShow',
  html: '<blockquote class="twitter-tweet" data-dnt="true"><p lang="en" dir="ltr">If only Bradley&#39;s arm was longer. Best photo ever. <a href="https://x.com/hashtag/oscars?src=hash&amp;ref_src=twsrc%5Etfw">#oscars</a> <a href="http://t.co/C9U5NOtGap">pic.twitter.com/C9U5NOtGap</a></p>&mdash; The Ellen Show (@TheEllenShow) <a href="https://x.com/TheEllenShow/status/440322224407314432?ref_src=twsrc%5Etfw">March 3, 2014</a></blockquote>\n\n',
}

test('oEmbed parsing reads author, text and hashtags from the post only', () => {
  const p = parseOembed(ELLEN)
  assert.equal(p.authorHandle, 'theellenshow')
  assert.deepEqual(p.hashtags, ['oscars'])
  assert.match(p.text, /Bradley's arm/)
  assert.doesNotMatch(p.text, /March 3/)
  assert.equal(parseOembed({ nope: 1 }), null)
})

const fetchedOk = (over = {}) => ({ ok: true, authorHandle: 'me', hashtags: ['2026mamavote', 'bts'], ...over })
const xArgs = (fetched, over = {}) => ({ fetched, requiredHashtags: ['2026MAMAVOTE', 'BTS'], expectedHandle: 'me', requireHandleMatch: true, dateOk: true, ...over })

test('X decision: confident pass verifies', () => {
  const d = decideXProof(xArgs(fetchedOk()))
  assert.equal(d.status, 'verified')
  assert.deepEqual(d.checks, { date: true, found: true, publicPost: true, hashtags: true, author: true })
})

test('X decision: anything unclear goes to review, never rejection', () => {
  assert.equal(decideXProof(xArgs({ ok: false, reason: 'unavailable' })).status, 'review')
  assert.equal(decideXProof(xArgs({ ok: false, reason: 'not_found' })).note, 'x_post_not_found')
  assert.equal(decideXProof(xArgs(fetchedOk({ hashtags: ['bts'] }))).note, 'missing_hashtags')
  assert.equal(decideXProof(xArgs(fetchedOk({ authorHandle: 'someone_else' }))).note, 'author_mismatch')
  assert.equal(decideXProof(xArgs(fetchedOk(), { expectedHandle: null })).status, 'review')
  for (const r of [decideXProof(xArgs(null)), decideXProof(xArgs(fetchedOk({ hashtags: [] })))]) {
    assert.notEqual(r.status, 'rejected')
  }
})

test('X compose link carries only the required hashtags', () => {
  assert.equal(xComposeUrl(['2026MAMAVOTE', '#BTS']), 'https://x.com/intent/post?text=%232026MAMAVOTE%20%23BTS')
})

// The real 2026 certificate's wording, as OCR returns it (line breaks and
// all). The certificate number is replaced with a dummy — no real one is kept.
const CERT_TEXT = `2026
MAMA
AWARDS
Presented by VISA
VOTING CERTIFICATE
Voting Certificate1
2026 MAMA AWARDS
FANS' CHOICE Category 1st
VOTE
Participation Date 2026.10.13 16:39
This Certificate verifies that it was
issued by Mnet Plus.
No. TEST00000000000`
const WINDOW = { opensAt: '2026-10-12T19:00:00+09:00', closesAt: '2026-10-22T23:59:59+09:00' }

test('certificate text: the real layout passes; "BTS" is not required', () => {
  const mnet = MAMA.missions[0]
  assert.deepEqual(evaluateCertificateText(CERT_TEXT, mnet, '2026-10-13', WINDOW), { certificate: true, category: true, date: true })
  assert.equal(CERT_TEXT.toLowerCase().includes('bts'), false)
  // Typical OCR slips: 1st read as "Ist", Mnet Plus run together.
  const slips = CERT_TEXT.replace('1st', 'Ist').replace('Mnet Plus', 'MnetPlus')
  assert.deepEqual(evaluateCertificateText(slips, mnet, '2026-10-13', WINDOW), { certificate: true, category: true, date: true })
})

test('certificate text: wrong category, missing structure, wrong day, outside the window', () => {
  const mnet = MAMA.missions[0]
  assert.equal(evaluateCertificateText(CERT_TEXT.replace("FANS' CHOICE", 'BEST MALE GROUP'), mnet, '2026-10-13', WINDOW).category, false)
  assert.equal(evaluateCertificateText(CERT_TEXT.replace('1st', '2nd'), mnet, '2026-10-13', WINDOW).category, false)
  assert.equal(evaluateCertificateText(CERT_TEXT.replace(/voting certificate/gi, 'SCREENSHOT'), mnet, '2026-10-13', WINDOW).certificate, false)
  assert.equal(evaluateCertificateText(CERT_TEXT.replace(/issued by Mnet Plus\./, ''), mnet, '2026-10-13', WINDOW).certificate, false)
  assert.equal(evaluateCertificateText(CERT_TEXT, mnet, '2026-10-14', WINDOW).date, false, 'credited to another day')
  // Oct 12 is a voting day only from 19:00 KST.
  assert.equal(evaluateCertificateText(CERT_TEXT.replace('2026.10.13 16:39', '2026.10.12 18:59'), mnet, '2026-10-12', WINDOW).date, false)
  assert.equal(evaluateCertificateText(CERT_TEXT.replace('2026.10.13 16:39', '2026.10.12 19:05'), mnet, '2026-10-12', WINDOW).date, true)
  assert.equal(evaluateCertificateText(CERT_TEXT.replace('2026.10.13 16:39', '2026.10.23 00:01'), mnet, '2026-10-23', WINDOW).date, false)
  assert.equal(evaluateCertificateText(CERT_TEXT.replace('Participation Date 2026.10.13 16:39', 'Participation Date'), mnet, '2026-10-13', WINDOW).date, false)
})

test('participation time is read as KST', () => {
  assert.equal(participationTime('Participation Date 2026.10.13 16:39').toISOString(), '2026-10-13T07:39:00.000Z')
  assert.equal(participationTime('2026. 10. 13 09:05').toISOString(), '2026-10-13T00:05:00.000Z')
  assert.equal(participationTime('no date here'), null)
})

test('checks crossing a trust boundary: booleans + image result only', () => {
  assert.deepEqual(sanitizeMnetChecks({ certificate: true, category: 'yes', date: true, bts: 'match', btsScore: 0.9512, text: 'raw', number: 'X1' }),
    { certificate: true, category: false, date: true, bts: 'match', btsScore: 0.951 })
  assert.equal(sanitizeMnetChecks({ bts: 'definitely' }).bts, 'unclear')
  assert.deepEqual(sanitizeClientCertChecks({ certificate: true, category: true, date: true, bts: 'match', text: 'raw' }),
    { certificate: true, category: true, date: true }, 'the browser cannot claim the image check')
})

test('Mnet decision: auto-verify only with all text checks and a BTS image match', () => {
  const ok = { certificate: true, category: true, date: true }
  assert.equal(decideMnetChecks({ ...ok, bts: 'match' }).status, 'verified')
  const unclear = decideMnetChecks({ ...ok, bts: 'unclear' })
  assert.deepEqual([unclear.status, unclear.note], ['review', 'unclear:bts'])
  const noMatch = decideMnetChecks({ ...ok, bts: 'no_match' })
  assert.deepEqual([noMatch.status, noMatch.note], ['review', 'unclear:bts_no_match'], 'a clear no_match goes to a reviewer, never auto-credit')
  assert.equal(decideMnetChecks({ ...ok, category: false, bts: 'match' }).note, 'unclear:category')
  assert.equal(decideMnetChecks({}).status, 'review')
  for (const c of [{}, { ...ok, bts: 'no_match' }]) assert.notEqual(decideMnetChecks(c).status, 'rejected')
})

test('voting streak counts consecutive verified KST days', () => {
  assert.equal(votingStreak(['2026-10-13', '2026-10-14', '2026-10-15'], '2026-10-15'), 3)
  assert.equal(votingStreak(['2026-10-13', '2026-10-14'], '2026-10-15'), 2, 'today not voted yet: streak holds')
  assert.equal(votingStreak(['2026-10-12', '2026-10-14'], '2026-10-15'), 1)
  assert.equal(votingStreak(['2026-10-12'], '2026-10-15'), 0)
  assert.equal(votingStreak([], '2026-10-15'), 0)
})

test('mission states for today', () => {
  const today = '2026-10-14'
  const s = missionStates(MAMA, [
    { mission_id: 'mnet', vote_day: today, status: 'rejected' },
    { mission_id: 'mnet', vote_day: today, status: 'review' },
    { mission_id: 'x', vote_day: '2026-10-13', status: 'verified' },
  ], today)
  assert.deepEqual(s, { mnet: 'review', x: 'todo' })
  assert.deepEqual(missionStates(MAMA, [{ mission_id: 'x', vote_day: today, status: 'rejected' }], today).x, 'rejected')
})

test('Voting Gift state: tba, filling, ready, capped (KST daily limit)', () => {
  assert.equal(giftState({ threshold: null, pool: [] }, 5, 0), 'tba')
  assert.equal(giftState({ threshold: 5, pool: [{ kind: 'xp', weight: 0 }] }, 5, 0), 'tba', 'a pool with no weight is not a gift')
  const g = { threshold: 5, daily_open_cap: 2, pool: [{ kind: 'xp', weight: 20, amount: 10 }] }
  assert.equal(giftState(g, 3, 0), 'filling')
  assert.equal(giftState(g, 5, 0), 'ready')
  assert.equal(giftState(g, 11, 1), 'ready')
  assert.equal(giftState(g, 6, 2), 'capped')
  assert.equal(giftState(g, 2, 2), 'filling')
})

test('Pulse query comes from the configured hashtag set, retweets excluded', () => {
  assert.equal(pulseQuery(['2026MAMAVOTE', '#BTS']), '#2026MAMAVOTE #BTS -filter:retweets')
  assert.equal(pulseQuery(['2026MAMAVOTE'], { excludeRetweets: false }), '#2026MAMAVOTE')
})

test('Pulse start cursor is the post id X would assign at voting open', () => {
  const id = snowflakeAt('2026-10-12T19:00:00+09:00')
  assert.equal(new Date(Number((BigInt(id) >> 22n) + 1288834974657n)).toISOString(), '2026-10-12T10:00:00.000Z')
})

test('Pulse view: never zero for unknown, keeps the last count when stale or failed', () => {
  const now = new Date('2026-10-14T03:30:00Z')
  const tags = ['2026MAMAVOTE', 'BTS']
  assert.deepEqual(pulseView(null, tags, now), { tags: ['#2026MAMAVOTE', '#BTS'], count: null, delta: null, lastUpdatedAt: null, stale: false })
  const fresh = { total_count: '12842', previous_count: '12414', last_success_at: '2026-10-14T03:00:00Z', last_status: 'ok' }
  assert.deepEqual([pulseView(fresh, tags, now).count, pulseView(fresh, tags, now).delta], [12842, 428])
  const failed = { ...fresh, last_status: 'failed' }
  assert.deepEqual([pulseView(failed, tags, now).count, pulseView(failed, tags, now).delta, pulseView(failed, tags, now).stale], [12842, null, true])
  const exhausted = { ...fresh, last_status: 'exhausted' }
  assert.equal(pulseView(exhausted, tags, now).count, 12842)
  const old = pulseView(fresh, tags, new Date('2026-10-14T12:00:00Z'))
  assert.deepEqual([old.stale, old.delta], [true, null])
  assert.equal(pulseView({ ...fresh, previous_count: '12842' }, tags, now).delta, null, 'no "+0"')
})

// A made-up certificate number in the real format (16 characters).
const NUM = '7A0B3E8U3K4UIKQZ'

test('certificate number: normalised so OCR look-alikes and re-screenshots agree', () => {
  assert.equal(normalizeCertificateNumber('7a0b3e8u3k4uikqz'), '7A0B3E8U3K4U1KQZ')
  assert.equal(normalizeCertificateNumber('7AOB3E8U3K4UlKQZ'), normalizeCertificateNumber(NUM), 'O/0 and I/l/1 fold together')
  assert.equal(certificateNumberFromText(`issued by Mnet Plus.
No. ${NUM}`), '7A0B3E8U3K4U1KQZ')
  assert.equal(certificateNumberFromText(`No. ${NUM}X`), null, 'wrong length is not a number')
  assert.equal(certificateNumberFromText('Participation Date 2026.10.13 16:39'), null)
})

test('certificate number: used only when two OCR passes agree — never a guess', () => {
  assert.equal(certificateNumberConsensus([NUM, NUM.toLowerCase(), null]), '7A0B3E8U3K4U1KQZ')
  assert.equal(certificateNumberConsensus([NUM, null, null]), null, 'one read is not enough')
  assert.equal(certificateNumberConsensus([NUM, '7A0B3ES8U3K4UIKQ']), null, 'two different reads: no agreement')
  assert.equal(certificateNumberConsensus([NUM, NUM, 'ZZZZZZZZZZZZZZZZ', 'ZZZZZZZZZZZZZZZZ']), null, 'a tie is not confidence')
  assert.equal(certificateNumberConsensus(['SHORT', 'SHORT']), null)
})

test('participation minute key is KST', () => {
  assert.equal(participationMinuteKey(new Date('2026-10-13T07:39:00Z')), '2026-10-13T16:39')
  assert.equal(participationMinuteKey('nonsense'), null)
})

test('City presence lifecycle: hidden before, live, verifying, 48h of final result, then gone', () => {
  const c = { opens_at: '2026-10-12T19:00:00+09:00', closes_at: '2026-10-22T23:59:59+09:00',
    battle: { freeze_at: '2026-10-23T12:00:00+09:00', final_visible_hours: 48 } }
  assert.equal(cityPhase(c, new Date('2026-10-12T18:59:00+09:00')), null)
  assert.equal(cityPhase(c, new Date('2026-10-12T19:00:00+09:00')), 'open')
  assert.equal(cityPhase(c, new Date('2026-10-23T00:30:00+09:00')), 'verifying')
  assert.equal(cityPhase(c, new Date('2026-10-23T12:01:00+09:00')), 'final')
  assert.equal(cityPhase(c, new Date('2026-10-25T11:59:00+09:00')), 'final')
  assert.equal(cityPhase(c, new Date('2026-10-25T12:01:00+09:00')), null)
})
