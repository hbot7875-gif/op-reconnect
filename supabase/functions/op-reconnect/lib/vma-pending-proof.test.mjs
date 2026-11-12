// The VMA review queue signs a URL per pending screenshot. Once retention has
// deleted a file it clears proof_path (20261112130000), so a row may have no
// screenshot left: it must show "no image", not fail the whole queue.
import test from 'node:test'
import assert from 'node:assert/strict'
import { adminListVmaPending } from './vma-voting.ts'

function fakeDb(pending) {
  const signed = []
  return {
    signed,
    from() {
      const q = { head: false }
      const chain = {
        select(_cols, opts) { q.head = !!opts?.head; return chain },
        eq() { return chain }, order() { return chain }, range() { return chain },
        then(resolve) { return resolve(q.head ? { count: pending.length, error: null } : { data: pending.map((r) => ({ ...r })), error: null }) },
      }
      return chain
    },
    storage: {
      from() {
        return {
          async createSignedUrl(path) {
            if (typeof path !== 'string') throw new TypeError('path must be a string')
            signed.push(path)
            return { data: { signedUrl: `https://signed/${path}` }, error: null }
          },
        }
      },
    },
  }
}

const content = { config: { vma_2026: { daily_cap_per_category: 10, category_keywords: { best_kpop: ['bts'] } } } }
const row = (id, proof_path) => ({ id, agent_no: 'AGENT001', category: 'best_kpop', vote_day: '2026-09-01', displayed_total: 0, ocr_text: null,
  expected_code: 'X', watermark_ok: false, verify_note: null, voted_at: '2026-09-01T00:00:00Z', proof_path, is_double_day: false, is_power_hour: false })

test('a pending vote whose screenshot retention removed shows no image; the others still sign', async () => {
  const db = fakeDb([row(1, 'AGENT001/1.jpg'), row(2, null)])
  const res = await adminListVmaPending(db, content, {})
  assert.equal(res.success, true)
  assert.deepEqual(res.pending.map((p) => [p.id, p.proofUrl]), [[1, 'https://signed/AGENT001/1.jpg'], [2, null]])
  assert.deepEqual(db.signed, ['AGENT001/1.jpg'], 'no signing attempt for a cleared path')
  assert.ok(res.pending.every((p) => !('proof_path' in p)), 'the raw path is never handed to the browser')
})
