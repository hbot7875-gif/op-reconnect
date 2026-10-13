// Automatic Mnet verification: the worker's queue pass (scripts/
// mnet-verify-worker.mjs), the shared trusted check (mnet-trusted-check.js)
// and the wiring around them. The database side — row lock, `verifying`-only
// transition, credit applied once — is covered by vote-campaign-sql.test.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { verifyPending } from '../scripts/mnet-verify-worker.mjs'
import { trustedCheckWith, ocrPassesWith } from './mnet-trusted-check.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const PASS = { certificate: true, category: true, date: true, bts: 'match', btsScore: 0.97 }
const NUMBER = '61013E8U3K4U1KYF'

function proof(id, extra = {}) {
  return { id, kind: 'mnet_certificate', proofUrl: `https://signed/${id}`, vote_day: '2026-10-14',
    certificate: { number_length: 16 }, window: {}, submitted_at: new Date().toISOString(), ...extra }
}

/** A fake op-reconnect: a queue of proofs and the database's decision rule. */
function fakeServer(proofs, { decide = () => 'verified' } = {}) {
  const status = new Map(proofs.map((p) => [p.id, 'verifying']))
  const calls = []
  const call = async (action, params) => {
    calls.push([action, params])
    if (action === 'adminListCampaignProofs') {
      return { success: true, proofs: proofs.filter((p) => status.get(p.id) === 'verifying') }
    }
    if (action === 'adminRecordCampaignChecks') {
      if (status.get(params.proofId) !== 'verifying') return { success: false, error: 'status_changed', status: status.get(params.proofId) }
      status.set(params.proofId, decide(params))
      return { success: true, status: status.get(params.proofId) }
    }
    if (action === 'adminReviewCampaignProof') { status.set(params.proofId, 'review'); return { success: true, status: 'review' } }
    return { success: false, error: 'unknown_action' }
  }
  return { call, calls, status }
}

const quiet = () => {}

test('clear pass → verified; unclear → In review; each proof reported once', async () => {
  const s = fakeServer([proof(1), proof(2)], { decide: (p) => (p.checks.bts === 'match' ? 'verified' : 'review') })
  const check = async (buf) => (String(buf) === 'img-1' ? { checks: PASS, certificateNumber: NUMBER, participationAt: '2026-10-14T01:21:00.000Z' }
    : { checks: { ...PASS, bts: 'unclear' }, certificateNumber: null, participationAt: null })
  const out = await verifyPending({ call: s.call, check, download: async (u) => Buffer.from(`img-${u.split('/').pop()}`), log: quiet })
  assert.deepEqual(out, { checked: 2, verified: 1, review: 1, skipped: 0, failed: 0 })
  assert.equal(s.status.get(1), 'verified')
  assert.equal(s.status.get(2), 'review')
  const records = s.calls.filter(([a]) => a === 'adminRecordCampaignChecks').map(([, p]) => p)
  assert.equal(records.length, 2)
  assert.deepEqual(records[0], { proofId: 1, checks: PASS, certificateNumber: NUMBER, participationAt: '2026-10-14T01:21:00.000Z', admin: 'auto-check' })
})

test('runs twice / overlaps: the second report changes nothing', async () => {
  const s = fakeServer([proof(7)])
  const check = async () => ({ checks: PASS, certificateNumber: null, participationAt: null })
  const download = async () => Buffer.from('x')
  // Two workers that both listed the proof before either recorded it.
  const listed = await s.call('adminListCampaignProofs', {})
  const stale = async (action, params) => (action === 'adminListCampaignProofs' ? listed : s.call(action, params))
  const [a, b] = await Promise.all([verifyPending({ call: stale, check, download, log: quiet }), verifyPending({ call: stale, check, download, log: quiet })])
  assert.equal(a.verified + b.verified, 1, 'credited exactly once')
  assert.equal(a.skipped + b.skipped, 1, 'the other run sees status_changed')
  // And a later run finds nothing to do.
  const again = await verifyPending({ call: s.call, check, download, log: quiet })
  assert.deepEqual(again, { checked: 0, verified: 0, review: 0, skipped: 0, failed: 0 })
})

test('a failing proof stays verifying for the next run; others still go through', async () => {
  const s = fakeServer([proof(1), proof(2)])
  const check = async (buf) => { if (String(buf) === 'bad') throw new Error('tesseract crashed'); return { checks: PASS, certificateNumber: null, participationAt: null } }
  const download = async (u) => Buffer.from(u.endsWith('/1') ? 'bad' : 'ok')
  const out = await verifyPending({ call: s.call, check, download, log: quiet })
  assert.equal(out.failed, 1)
  assert.equal(out.verified, 1)
  assert.equal(s.status.get(1), 'verifying', 'retried next run, not dropped')
})

test('still failing 30 minutes after upload → handed to a reviewer, no credit', async () => {
  const old = new Date(Date.now() - 31 * 60_000).toISOString()
  const s = fakeServer([proof(3, { submitted_at: old })])
  const out = await verifyPending({ call: s.call, check: async () => { throw new Error('unreadable') }, download: async () => Buffer.from('x'), log: quiet })
  assert.equal(out.review, 1)
  assert.equal(s.status.get(3), 'review')
  const [, p] = s.calls.find(([a]) => a === 'adminReviewCampaignProof')
  assert.deepEqual(p, { proofId: 3, decision: 'keep', note: 'auto_check_failed', admin: 'auto-check' })
  assert.ok(!s.calls.some(([a]) => a === 'adminRecordCampaignChecks'))
})

test('dry run records nothing; logs never contain the number, time or OCR text', async () => {
  const s = fakeServer([proof(1)])
  const lines = []
  await verifyPending({ call: s.call, check: async () => ({ checks: PASS, certificateNumber: NUMBER, participationAt: '2026-10-14T01:21:00.000Z' }),
    download: async () => Buffer.from('x'), dryRun: true, log: (l) => lines.push(l) })
  assert.equal(s.status.get(1), 'verifying')
  assert.ok(!s.calls.some(([a]) => a !== 'adminListCampaignProofs'))
  const all = lines.join('\n')
  assert.match(all, /number=read time=read/)
  assert.doesNotMatch(all, new RegExp(NUMBER))
  assert.doesNotMatch(all, /2026-10-14T01:21/)
})

test('no campaign is a quiet no-op; other list errors fail the run', async () => {
  assert.equal((await verifyPending({ call: async () => ({ success: false, error: 'no_campaign' }), check: null, log: quiet })).checked, 0)
  await assert.rejects(verifyPending({ call: async () => ({ success: false, error: 'unauthorized' }), check: null, log: quiet }), /list_failed:unauthorized/)
})

test('X proofs and proofs without a stored image are left alone', async () => {
  const s = fakeServer([proof(1, { kind: 'x_post' }), proof(2, { proofUrl: null })])
  const out = await verifyPending({ call: s.call, check: async () => { throw new Error('should not run') }, log: quiet })
  assert.deepEqual(out, { checked: 0, verified: 0, review: 0, skipped: 1, failed: 0 })
  assert.equal(s.status.get(1), 'verifying')
})

// ── The shared trusted check, through a fake io ─────────────────────

const CERT = { certificate: { title_keywords: ['voting certificate'], structure_keywords: ['participation date'], issuer_keywords: ['mnet plus'], category_keywords: ["fans' choice category 1st vote"] } }
const GOOD = `VOTING CERTIFICATE\nMnet Plus\nFANS' CHOICE Category 1st VOTE\nParticipation Date 2026.10.14 10:21\nNo. ${NUMBER}`

test('shared check: one OCR pass when everything reads; contrast pass only when needed', async () => {
  const seen = []
  const io = { ocr: async (s) => { seen.push(s); return s === 'contrast' ? GOOD : 'blurry' }, contrast: async () => 'contrast' }
  const r = await ocrPassesWith(io, 'orig', CERT, '2026-10-14', {})
  assert.deepEqual(seen, ['orig', 'contrast'])
  assert.deepEqual(r.checks, { certificate: true, category: true, date: true })
  const once = []
  await ocrPassesWith({ ocr: async (s) => { once.push(s); return GOOD }, contrast: async () => 'c' }, 'orig', CERT, '2026-10-14', {})
  assert.deepEqual(once, ['orig'])
})

test('shared check: no BTS tile → no card crop, image result passed through, no number guess from one read', async () => {
  const blank = { width: 40, height: 40, data: new Uint8ClampedArray(40 * 40 * 4).fill(255) }
  let cropped = false
  const io = { ocr: async () => GOOD, contrast: async () => 'c', pixels: async () => ({ img: blank }), crop: async () => { cropped = true } }
  const r = await trustedCheckWith(io, 'orig', CERT, '2026-10-14', {})
  assert.equal(cropped, false)
  assert.notEqual(r.checks.bts, 'match')
  assert.equal(r.certificateNumber, null, 'a single pass is never enough for the number')
  assert.equal(r.participationAt, '2026-10-14T01:21:00.000Z')
})

// ── Wiring ──────────────────────────────────────────────────────────

test('browser and worker run the same trusted check', () => {
  assert.match(read('./voting-proof.js'), /trustedCheckWith\(browserIo,/)
  assert.match(read('../scripts/mnet-verify-worker.mjs'), /trustedCheckWith\(io, buf,/)
  assert.doesNotMatch(read('./voting-proof.js'), /certificateNumberConsensus|matchBtsTile\(/, 'no second copy of the decision steps')
})

test('workflow: on-demand + 5-minute schedule, one run at a time, existing admin secret only', () => {
  const y = read('../.github/workflows/mnet-auto-verify.yml')
  assert.match(y, /workflow_dispatch:/)
  assert.doesNotMatch(y, /repository_dispatch/, 'starting it needs only Actions: write, not Contents: write')
  assert.match(y, /cron: '\*\/5 \* \* \* \*'/)
  assert.match(y, /concurrency:\s*\n\s*group: mnet-auto-verify\s*\n\s*cancel-in-progress: false/)
  assert.match(y, /ADMIN_KEY: \$\{\{ secrets\.SYNC_ADMIN_KEY \}\}/)
  assert.match(y, /node scripts\/mnet-verify-worker\.mjs/)
})

test('upload wakes the checker without ever waiting on it', () => {
  const ts = read('../supabase/functions/op-reconnect/lib/vote-campaign.ts')
  assert.match(ts, /actions\/workflows\/mnet-auto-verify\.yml\/dispatches/)
  assert.match(ts, /body: JSON\.stringify\(\{ ref: 'master' \}\)/)
  assert.match(ts, /if \(!token\) return/, 'no token → schedule only')
  assert.match(ts, /\.catch\(\(\) => undefined\)/)
  assert.match(ts, /if \(\(r as \{ success\?: boolean \}\)\?\.success\) wakeChecker\(\)\s*\n\s*return r/)
})

test('player screen polls while a proof is verifying', () => {
  const src = read('./voting.js')
  assert.match(src, /includes\('verifying'\)/)
  assert.match(src, /local\.mnet\.sentAt = Date\.now\(\)/)
  assert.match(src, /refreshGameState\(\) \/\/ XP/)
})
