// MAMA proof feedback: problems a player can fix are named, with the action
// right there — duplicate certificates and posts, unlinked or private X
// accounts, missing hashtags, unreadable screenshots — and the X account
// manager keeps its limits. The server side (what is refused, rejected or
// still reviewed) is vote-campaign-service.test.mjs and vote-campaign-sql.test.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  votingScreen, errorText, linkSheet, DUPLICATE_TEXT, UNREADABLE_TEXT, SMALL_IMAGE_TEXT, replaceSheetBody, REPLACE_REASONS,
} from './voting-view.js'
import { votingStatus, votingLocal, FIXTURE_NOW } from './voting-fixtures.js'
import { trustedCheckWith } from './mnet-trusted-check.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const card = (html, id) => {
  const i = html.indexOf(`data-vt-mission="${id}"`)
  return html.slice(i, html.indexOf('</article>', i))
}
const screen = (status, local) => votingScreen({ status, local, now: FIXTURE_NOW, hub: {} })
const plain = (s) => s.replace(/&#39;/g, "'").replace(/&amp;/g, '&')

test('messages say what went wrong and what to do', () => {
  assert.equal(errorText('duplicate_certificate'), 'This certificate has already been submitted. Please upload a new voting certificate.')
  assert.equal(errorText('x_duplicate_post'), 'This X post has already been submitted. Please submit a different voting post.')
  assert.match(errorText('x_post_private'), /account is private\. Make the account public on X, then add the link again\./)
  assert.match(errorText('x_post_not_found'), /couldn’t find this post on X\. It may have been deleted\./)
  assert.equal(errorText('x_missing_hashtags', { missing: ['#2026MAMAVOTE'] }), 'Your post is missing #2026MAMAVOTE. Post again with both hashtags, then add the new link.')
  assert.equal(errorText('x_handle_taken', { author: 'theirs' }), 'This post was made from @theirs, which is linked to another agent file. Post from one of your own linked accounts.')
  assert.equal(errorText('x_handle_has_votes'), 'This account already has votes counted, so only an admin can remove it.')
  assert.equal(DUPLICATE_TEXT.duplicate, errorText('duplicate_certificate'))
})

test('unlinked X account: named, with Link this account / Choose another account / Cancel', () => {
  const status = votingStatus({ x: 'link' })
  const html = linkSheet({ status, local: { ...votingLocal({ x: 'link' }), xUnlinked: { author: 'alt_acct', canLink: true, url: 'u' } } })
  assert.match(html, /This post was made from <b>@alt_acct<\/b>, but that account isn’t linked\./)
  assert.match(html, /data-vt-act="x-link-author" data-vt-author="alt_acct"[^>]*>[\s\S]*?Link this account/)
  assert.match(html, /data-vt-act="x-choose-other">Choose another account/)
  assert.match(html, /data-vt-act="sheet-close">Cancel/)
  // At the limit: no link offer, and how to make room.
  const full = { ...status, xHandles: ['a', 'b', 'c'] }
  const atLimit = linkSheet({ status: full, local: { ...votingLocal({ x: 'link' }), xUnlinked: { author: 'alt_acct', canLink: false, url: 'u' } } })
  assert.doesNotMatch(atLimit, /x-link-author/)
  assert.match(atLimit, /You already have 3 X accounts linked — remove one without votes below, or post from a linked account\./)
})

test('X accounts: each listed; an account with votes can only be replaced (or is admin-only); remove takes two taps', () => {
  const status = { ...votingStatus({ x: 'link' }), xHandles: ['main', 'spare'], xHandleLocked: ['main'] }
  const html = linkSheet({ status, local: votingLocal({ x: 'link' }) })
  assert.match(html, /Your X accounts · 2\/3/)
  assert.match(html, /<b>@main<\/b><span class="vt-xacc-lock">Has votes<\/span><button type="button" class="vt-link" data-vt-act="x-replace-open" data-vt-handle="main">Request replacement<\/button>/)
  const used = linkSheet({ status: { ...status, xReplacementsLeft: 0 }, local: votingLocal({ x: 'link' }) })
  assert.match(used, /<b>@main<\/b><span class="vt-xacc-lock">Has votes · admin only<\/span>/, 'no replacements left')
  assert.match(html, /<b>@spare<\/b><button type="button" class="vt-link" data-vt-act="x-remove-handle" data-vt-handle="spare">Remove<\/button>/)
  assert.doesNotMatch(html, /data-vt-act="x-remove-handle" data-vt-handle="main"/, 'no remove for a credited account')
  assert.match(html, /data-vt-act="x-edit-handle">Add account/)
  const confirm = linkSheet({ status, local: { ...votingLocal({ x: 'link' }), xRemoveConfirm: 'spare' } })
  assert.match(confirm, /class="vt-link is-danger" data-vt-act="x-remove-handle" data-vt-handle="spare">Tap again to remove/)
})

test('Mnet: an unreadable certificate asks for the original, with Upload new certificate', () => {
  const status = votingStatus({ mnet: 'review' })
  status.todayProofs = [{ missionId: 'mnet', status: 'review', checks: { certificate: false, category: true }, hint: 'unreadable' }]
  const c = plain(card(screen(status, votingLocal({ mnet: 'review' })), 'mnet'))
  assert.ok(c.includes(UNREADABLE_TEXT), 'unreadable message')
  assert.match(c, /Upload new certificate/)
  // Without the hint: the calm review message as before.
  const ok = plain(card(screen(votingStatus({ mnet: 'review' }), votingLocal({ mnet: 'review' })), 'mnet'))
  assert.doesNotMatch(ok, /couldn’t read your certificate clearly/)
})

test('Mnet: a very small image is flagged before upload — never blocked', () => {
  const local = votingLocal({ mnet: 'upload' })
  local.mnet.smallWarn = true
  const c = plain(card(screen(votingStatus({ mnet: 'upload' }), local), 'mnet'))
  assert.ok(c.includes(SMALL_IMAGE_TEXT))
  assert.match(c, /data-vt-act="mnet-small-cancel">Choose another image/)
  assert.match(c, /data-vt-act="mnet-small-continue">Upload anyway/)
  const src = read('./voting.js')
  assert.match(src, /if \(w && w < SMALL_IMAGE_PX\) \{ local\.mnet\.smallWarn = true/)
  assert.match(src, /act === 'mnet-small-continue'[\s\S]*?sendCertificate\(f, \{ force: true \}\)/, 'upload anyway really uploads')
})

test('X review from an unlinked account: says which, with Link / Manage', () => {
  const status = votingStatus({ x: 'review' })
  status.todayProofs = [{ missionId: 'x', status: 'review', checks: { author: false }, hint: 'unlinked_account', author: 'alt_acct' }]
  const c = card(screen(status, votingLocal({ x: 'review' })), 'x')
  assert.match(c, /This post was made from <b>@alt_acct<\/b>, but that account isn’t linked\./)
  assert.match(c, /data-vt-act="x-link-author" data-vt-author="alt_acct"/)
  assert.match(c, /data-vt-act="x-manage">Manage X accounts/)
})

test('controller: an unlinked author becomes a choice, linking resends the same post, duplicates are named', () => {
  const src = read('./voting.js')
  assert.match(src, /if \(r\?\.error === 'x_account_not_linked'\) \{[\s\S]*?local\.xUnlinked = \{ author: r\.author, canLink: !!r\.canLink, url \}/)
  assert.match(src, /if \(pending\) return sendXPost\(pending, null\)/)
  assert.match(src, /if \(r\?\.error === 'duplicate_proof'\) throw Object\.assign\(new Error\('x_duplicate_post'\)/)
  assert.match(src, /call\('removeXHandle'/)
})

test('trusted check: a small screenshot gets one enlarged read — same rules, only when something is missing', async () => {
  const CERT = { certificate: { title_keywords: ['voting certificate'], structure_keywords: ['participation date'], issuer_keywords: ['mnet plus'], category_keywords: ["fans' choice category 1st vote"] } }
  const SMALL = "VOTING CERTIFICATE\nFANS' CHOICE Category 1st VOTE\n2026.10.14 10:21" // small print lost
  const FULL = "VOTING CERTIFICATE\nMnet Plus\nFANS' CHOICE Category 1st VOTE\nParticipation Date 2026.10.14 10:21"
  const blank = { width: 40, height: 40, data: new Uint8ClampedArray(40 * 40 * 4).fill(255) }
  let enlarged = 0
  const io = (bigText) => ({
    ocr: async (s) => (s === 'big' || s === 'big-c' ? bigText : SMALL), contrast: async (s) => (s === 'big' ? 'big-c' : 'c'),
    pixels: async () => ({ img: blank }), enlarge: async () => { enlarged++; return 'big' },
  })
  const win = { opensAt: '2026-10-12T10:00:00Z', closesAt: '2026-10-22T14:59:59Z', submittedAt: '2026-10-14T05:00:00Z', utcOffsetMinutes: 330 }
  const r = await trustedCheckWith(io(FULL), 'orig', CERT, '2026-10-14', win)
  assert.deepEqual([r.checks.certificate, r.checks.category, r.checks.date], [true, true, true])
  assert.equal(enlarged, 1)
  // Enlarging can't invent words that aren't there.
  const still = await trustedCheckWith(io(SMALL), 'orig', CERT, '2026-10-14', win)
  assert.equal(still.checks.certificate, false)
  // Nothing missing → no extra read.
  enlarged = 0
  await trustedCheckWith({ ...io(FULL), ocr: async () => FULL }, 'orig', CERT, '2026-10-14', win)
  assert.equal(enlarged, 0)
  assert.match(read('../scripts/mnet-verify-worker.mjs'), /if \(!width \|\| width >= 1000\) return null/)
})

// ── X account replacement ────────────────────────────────────────────

test('X card: Manage X accounts is one tap away, in every state', () => {
  for (const x of ['todo', 'link', 'review', 'done']) {
    const c = card(screen(votingStatus({ x }), votingLocal({ x })), 'x')
    assert.match(c, /data-vt-act="x-manage">Manage X accounts</, x)
  }
  const st = { ...votingStatus({ x: 'todo' }), xReplacements: [{ id: 1, oldHandle: 'old', newHandle: 'new', reason: 'suspended', status: 'pending' }] }
  assert.match(card(screen(st, votingLocal({ x: 'todo' })), 'x'), /Manage X accounts · replacement pending/)
  const src = read('./voting.js')
  assert.match(src, /act === 'x-manage'\) \{[^}]*local\.xManage = true; paint\(\); showSheet\('link'\)/)
  assert.match(linkSheet({ status: votingStatus({ x: 'link' }), local: { ...votingLocal({ x: 'link' }), xManage: true } }), /<h2 id="vt-l-title">Manage X accounts<\/h2>/)
})

test('replacement form: reason, new account, optional note — and never a password', () => {
  const status = { ...votingStatus({ x: 'link' }), xHandles: ['main', 'spare'], xHandleLocked: ['main'] }
  const html = plain(linkSheet({ status, local: { ...votingLocal({ x: 'link' }), xReplace: 'main' } }))
  assert.match(html, /<h2 id="vt-l-title">Replace @main<\/h2>/)
  assert.doesNotMatch(html, /data-vt-form="x"/, 'the post form steps aside')
  assert.deepEqual(REPLACE_REASONS.map(([v]) => v), ['suspended', 'deleted', 'locked', 'other'])
  for (const [v] of REPLACE_REASONS) assert.match(html, new RegExp(`name="xr-reason" value="${v}"`))
  assert.match(html, /name="xr-new"/)
  assert.match(html, /name="xr-note"[^>]*maxlength="200"/)
  assert.match(html, /Votes it already earned stay counted\. Once an admin approves, the new account takes its place and <b>@main<\/b> stops earning new votes\./)
  assert.match(html, /We’ll never ask for your password, login codes or other private details\./)
  assert.doesNotMatch(html, /type="password"|name="(password|code|otp|email)"/i)
  assert.match(html, /data-vt-act="x-replace-send">Send request[\s\S]*data-vt-act="x-replace-cancel">Cancel/)
  const src = read('./voting.js')
  assert.match(src, /call\('requestXReplacement', \{ agentNo: getAgentNo\(\), campaignId: status\.campaign\.id,\s+oldHandle: panel\.dataset\.vtXrepl, newHandle, reason, note: extra \}\)/)
})

test('replacement status: Pending approval, Approved or Rejected; one request at a time', () => {
  const reqs = [
    { id: 3, oldHandle: 'spare', newHandle: 'spare2', reason: 'locked', status: 'pending' },
    { id: 2, oldHandle: 'gone', newHandle: 'main', reason: 'suspended', status: 'approved' },
    { id: 1, oldHandle: 'spare', newHandle: 'typo', reason: 'other', status: 'rejected' },
  ]
  const status = { ...votingStatus({ x: 'link' }), xHandles: ['main', 'spare'], xHandleLocked: ['main', 'spare'], xReplacements: reqs, xReplacementsLeft: 1 }
  const html = linkSheet({ status, local: votingLocal({ x: 'link' }) })
  assert.match(html, /@spare → <b>@spare2<\/b><\/span><span class="vt-badge is-warn">[\s\S]*?Pending approval/)
  assert.match(html, /@gone → <b>@main<\/b><\/span><span class="vt-badge is-ok">[\s\S]*?Approved/)
  assert.match(html, /@typo<\/b><\/span><span class="vt-badge is-err">[\s\S]*?Rejected/)
  assert.match(html, /<b>@spare<\/b><span class="vt-xacc-lock">Replacement pending approval<\/span>/)
  assert.doesNotMatch(html, /x-replace-open/, 'no second request while one waits')
  assert.equal(errorText('x_handle_retired', { author: 'gone' }), '@gone was replaced on your file, so it can’t earn new votes. Post from one of your linked accounts.')
  assert.match(errorText('x_replacement_limit'), /already replaced an X account/)
})
