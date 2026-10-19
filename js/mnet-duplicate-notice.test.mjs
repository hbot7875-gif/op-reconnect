// Duplicate-certificate outcomes, as the player sees them. The verification
// and crediting logic is unchanged (and covered in vote-campaign-sql.test.mjs:
// a duplicate certificate goes to review and is never credited twice).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { duplicateNotices } from '../supabase/functions/op-reconnect/lib/vote-campaign-rules.js'
import { votingScreen, errorText, DUPLICATE_TEXT } from './voting-view.js'
import { votingStatus, votingLocal, FIXTURE_NOW } from './voting-fixtures.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const CAMPAIGN = { missions: [{ id: 'mnet', kind: 'mnet_certificate' }, { id: 'x', kind: 'x_post' }] }
const DAY = '2026-10-14'
const row = (status, kind, at, extra = {}) => ({ mission_id: 'mnet', vote_day: DAY, status, duplicate_kind: kind, submitted_at: `2026-10-14T0${at}:00:00Z`, ...extra })

test('notices: the latest certificate decides; two plain words only', () => {
  assert.deepEqual(duplicateNotices(CAMPAIGN, [row('review', 'certificate', 2)], DAY), { mnet: 'duplicate' })
  assert.deepEqual(duplicateNotices(CAMPAIGN, [row('review', 'possible', 2)], DAY), { mnet: 'possible_duplicate' })
  assert.deepEqual(duplicateNotices(CAMPAIGN, [row('rejected', 'certificate', 2)], DAY), { mnet: 'duplicate' }, 'a reviewer rejecting it keeps the message')
  assert.deepEqual(duplicateNotices(CAMPAIGN, [row('verified', 'possible', 2)], DAY), {}, 'a reviewer verifying it clears it')
  assert.deepEqual(duplicateNotices(CAMPAIGN, [row('review', 'certificate', 1), row('verifying', null, 3)], DAY), {}, 'a newer certificate takes over')
  assert.deepEqual(duplicateNotices(CAMPAIGN, [row('review', 'certificate', 1, { vote_day: '2026-10-13' })], DAY), {}, 'only today')
  assert.deepEqual(duplicateNotices(CAMPAIGN, [{ ...row('review', 'certificate', 2), mission_id: 'x' }], DAY), {}, 'Mnet only')
})

const card = (html) => html.match(/<article class="vt-card vt-mission" data-vt-mission="mnet"[\s\S]*?<\/article>/)[0]
const screen = (mnet, notices) => card(votingScreen({ status: { ...votingStatus({ mnet }), notices }, local: votingLocal({}), now: FIXTURE_NOW }))

test('card: confirmed duplicate — Not counted, plain message, no "verifying"', () => {
  const c = screen('review', { mnet: 'duplicate' })
  assert.match(c, /Not counted/)
  assert.ok(c.includes(DUPLICATE_TEXT.duplicate))
  assert.equal(DUPLICATE_TEXT.duplicate, 'This certificate has already been submitted. Please upload a new voting certificate.')
  assert.doesNotMatch(c, /Verifying|In review|vt-spin/)
  assert.match(c, /Upload another certificate/, 'their other daily slots stay usable')
})

test('card: possible duplicate — In review with the review message', () => {
  const c = screen('review', { mnet: 'possible_duplicate' })
  assert.match(c, /In review/)
  assert.ok(c.includes(DUPLICATE_TEXT.possible_duplicate))
  assert.equal(DUPLICATE_TEXT.possible_duplicate, 'This certificate may have already been submitted. It’s been sent for review.')
  assert.doesNotMatch(c, /do not upload it again/)
})

test('card: rejected duplicate and plain review keep their own wording', () => {
  assert.ok(screen('rejected', { mnet: 'duplicate' }).includes(DUPLICATE_TEXT.duplicate))
  assert.match(screen('review', {}), /We couldn’t confidently read a couple of details, so it’s in review\. Your upload is safe\./)
  assert.match(screen('rejected', {}), /Today&#39;s earlier proof wasn&#39;t accepted|Today's earlier proof wasn't accepted/)
})

test('upload: the same screenshot again shows the confirmed-duplicate message; screen refreshes on notices', () => {
  assert.equal(errorText('duplicate_certificate'), DUPLICATE_TEXT.duplicate)
  const src = read('./voting.js')
  assert.match(src, /errorText\(r\?\.error === 'duplicate_proof' \? 'duplicate_certificate' : r\?\.error\)/)
  assert.match(src, /JSON\.stringify\(\[s\.states, s\.todayProgress, s\.notices\]\)/, 'a duplicate verdict repaints without a refresh')
})
