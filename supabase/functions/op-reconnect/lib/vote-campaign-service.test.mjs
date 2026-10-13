import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  submitMnetProof, submitXProof, setXHandle, openVotingGift, getVotingStatus, getVotingBanner,
  adminListCampaignProofs, adminRecordCampaignChecks, adminReviewCampaignProof, oembedXVerifier, sha256Hex, PROOF_BUCKET,
  startVotingTeamChoice, chooseVotingTeam, claimBattleGift, claimBattleWinner, certFingerprint,
} from './vote-campaign-service.js'
import { createHash } from 'node:crypto'
import { normalizeCertificateNumber } from './vote-campaign-rules.js'
import { runVotePulse } from './vote-pulse-service.js'

const NOW = new Date('2026-10-14T03:00:00Z') // 12:00 KST, Oct 14
const CAMPAIGN = {
  id: 'mama_2026', title: 'MAMA 2026', round_label: "Fans' Choice · Round 1", active: true,
  opens_at: '2026-10-12T19:00:00+09:00', closes_at: '2026-10-22T23:59:59+09:00',
  missions: [
    { id: 'mnet', kind: 'mnet_certificate', label: 'Mnet Vote', max_daily: 3, vote_url: 'https://mnetplus.world/event/2026-mama',
      certificate: { title_keywords: ['voting certificate'], category_keywords: ["fans' choice category 1st vote"] } },
    { id: 'x', kind: 'x_post', label: 'X Vote', max_daily: 3, max_handles: 3, hashtags: ['2026MAMAVOTE', 'BTS'], require_handle_match: true },
  ],
  rewards: { badge_template_id: 'event_mama_2026', badge_verified_days: 5 },
  gift: { name: 'Voting Gift', fill_per_verified: 1, threshold: 5, daily_open_cap: 2, rolls: 3,
    pool: [{ kind: 'charge_cell', weight: 30, amount: 1 }, { kind: 'xp', weight: 20, amount: 10 }] },
  battle: { enabled: true, choose_seconds: 7, freeze_at: '2026-10-23T12:00:00+09:00', final_visible_hours: 48, teams: [{ id: 'hooligans', label: 'HOOLIGANS' }, { id: 'aliens', label: 'ALIENS' }],
    milestones: [200, 500, 900, 1400, 2200], gift: { pool: null } },
  pulse: { enabled: true, provider: 'apify', actor: 'xquik~x-tweet-scraper', price_per_1000_usd: 0.15,
    max_items_per_run: 600, budget_usd: 4, collect_until_hours_after_close: 12, exclude_retweets: false },
}

/** A minimal stand-in for the supabase-js client: records every call and
 *  answers reads from per-table handlers. */
function fakeDb({ tables = {}, rpc = {}, uploadError = null } = {}) {
  const calls = { rpc: [], upload: [], remove: [], signed: [], reads: [], writes: [] }
  const from = (table) => {
    const q = { table, filters: {}, op: 'select' }
    const resolve = () => {
      calls.reads.push(q)
      const h = tables[table]
      return h ? h(q) : { data: q.single ? null : [], count: 0 }
    }
    const api = {
      select(cols, o) { q.cols = cols; q.head = !!o?.head; return api },
      eq(k, v) { q.filters[k] = v; return api },
      in(k, v) { q.filters[k] = v; return api },
      order() { return api }, limit() { return api }, range() { return api },
      delete() { q.op = 'delete'; calls.writes.push(q); return api },
      upsert(row) { q.op = 'upsert'; q.row = row; calls.writes.push(q); return Promise.resolve(tables[`${table}:upsert`]?.(row) || { error: null }) },
      maybeSingle() { q.single = true; return Promise.resolve(resolve()) },
      then(ok, err) { return Promise.resolve(resolve()).then(ok, err) },
    }
    return api
  }
  return {
    calls, from,
    async rpc(name, args) {
      calls.rpc.push({ name, args })
      return rpc[name] ? rpc[name](args) : { data: { success: true, id: 7, status: args.p_status ?? args.p_to } }
    },
    storage: {
      from: (bucket) => ({
        async upload(path, bytes, opts) { calls.upload.push({ bucket, path, bytes, opts }); return { error: uploadError } },
        async remove(paths) { calls.remove.push({ bucket, paths }); return { error: null } },
        async createSignedUrl(path, ttl) { calls.signed.push({ bucket, path, ttl }); return { data: { signedUrl: `https://signed.example/${path}?ttl=${ttl}` } } },
      }),
    },
  }
}

const campaignTable = (q) => (q.single ? { data: q.filters.id === 'mama_2026' ? CAMPAIGN : null } : { data: [CAMPAIGN] })
const png = Buffer.from('fake-image-bytes').toString('base64')

test('Mnet: browser OCR cannot award credit — every upload is stored as verifying', async () => {
  const db = fakeDb({ tables: { rc_vote_campaigns: campaignTable } })
  const r = await submitMnetProof(db, {
    agentNo: 'agent001', campaignId: 'mama_2026', imageBase64: png, imageMime: 'image/jpeg', originalHash: 'a'.repeat(64),
    clientChecks: { certificate: true, category: true, date: true, bts: 'match', ocrText: 'VOTING CERTIFICATE kim@example.com No. 61013E8U3K4UIKYF' },
    ocrText: 'raw text must be ignored', status: 'verified',
  }, NOW)
  assert.equal(r.success, true)
  const call = db.calls.rpc.find((c) => c.name === 'rc_campaign_submit_proof')
  assert.equal(db.calls.rpc[0].name, 'rc_campaign_team_resolve', 'a timed-out team choice is settled before submitting')
  assert.equal(call.args.p_status, 'verifying')
  assert.deepEqual(call.args.p_checks, {})
  assert.deepEqual(call.args.p_client_checks, { certificate: true, category: true, date: true }, 'browser cannot claim the BTS image check')
  assert.equal(call.args.p_agent_no, 'AGENT001')
  assert.equal(call.args.p_vote_day, '2026-10-14')
  assert.equal(JSON.stringify(call.args).includes('example.com'), false, 'no account details stored')
  assert.equal(JSON.stringify(call.args).includes('61013E8U3K4UIKYF'), false, 'no certificate number stored')
  assert.equal(JSON.stringify(call.args).includes('raw text'), false, 'no raw OCR stored')
  assert.equal(call.args.p_image_hash, await sha256Hex(Buffer.from('fake-image-bytes')), 'hash computed by the server')
  assert.equal(call.args.p_original_hash, 'a'.repeat(64))
  const up = db.calls.upload[0]
  assert.equal(up.bucket, PROOF_BUCKET)
  assert.match(up.path, /^mama_2026\/AGENT001\/2026-10-14-mnet-[0-9a-f]{16}\.jpg$/)
  assert.equal(up.opts.upsert, false)
})

test('Mnet: rejected submit removes the uploaded file; a retry keeps it', async () => {
  const dup = fakeDb({ tables: { rc_vote_campaigns: campaignTable }, rpc: { rc_campaign_submit_proof: () => ({ data: { success: false, error: 'duplicate_proof' } }) } })
  const r = await submitMnetProof(dup, { agentNo: 'AGENT001', campaignId: 'mama_2026', imageBase64: png, imageMime: 'image/png' }, NOW)
  assert.equal(r.error, 'duplicate_proof')
  assert.equal(dup.calls.remove.length, 1)

  const retry = fakeDb({ tables: { rc_vote_campaigns: campaignTable }, uploadError: { message: 'The resource already exists', statusCode: '409' },
    rpc: { rc_campaign_submit_proof: () => ({ data: { success: true, id: 3, status: 'verifying', retry: true } }) } })
  const again = await submitMnetProof(retry, { agentNo: 'AGENT001', campaignId: 'mama_2026', imageBase64: png, imageMime: 'image/png' }, NOW)
  assert.deepEqual([again.success, again.proofId], [true, 3])
  assert.equal(retry.calls.remove.length, 0)
})

test('Mnet: input validation', async () => {
  const db = fakeDb({ tables: { rc_vote_campaigns: campaignTable } })
  const base = { agentNo: 'AGENT001', campaignId: 'mama_2026', imageBase64: png, imageMime: 'image/jpeg' }
  assert.equal((await submitMnetProof(db, { ...base, imageMime: 'image/gif' }, NOW)).error, 'bad_image_type')
  assert.equal((await submitMnetProof(db, { ...base, imageBase64: '' }, NOW)).error, 'proof_required')
  assert.equal((await submitMnetProof(db, { ...base, originalHash: 'xyz' }, NOW)).error, 'bad_original_hash')
  assert.equal((await submitMnetProof(db, { ...base, missionId: 'x' }, NOW)).error, 'bad_mission')
  assert.equal((await submitMnetProof(db, base, new Date('2026-10-23T00:00:00Z'))).error, 'voting_closed')
  assert.equal((await submitMnetProof(db, { ...base, campaignId: 'vma_2026' }, NOW)).error, 'no_campaign')
  assert.equal(db.calls.rpc.length, 0)
})

function postIdAt(date) {
  return ((BigInt(date.getTime()) - 1288834974657n) << 22n).toString()
}
const handleTable = (h) => () => ({ data: h ? (Array.isArray(h) ? h : [h]).map((x_handle) => ({ x_handle })) : [] })
const verifier = (result) => ({ method: 'x_oembed', calls: 0, async verify() { this.calls++; return result } })

test('X: confident server-side check verifies', async () => {
  const db = fakeDb({ tables: { rc_vote_campaigns: campaignTable, rc_agent_x_handles: handleTable('me') } })
  const id = postIdAt(new Date('2026-10-14T01:00:00Z'))
  const v = verifier({ ok: true, authorHandle: 'me', hashtags: ['2026mamavote', 'bts'] })
  const r = await submitXProof(db, { agentNo: 'AGENT001', campaignId: 'mama_2026', postUrl: `https://x.com/me/status/${id}` }, { verifier: v, now: NOW })
  assert.equal(r.status, 'verified')
  const a = db.calls.rpc.find((c) => c.name === 'rc_campaign_submit_proof').args
  assert.deepEqual([a.p_status, a.p_post_id, a.p_post_author, a.p_vote_day], ['verified', id, 'me', '2026-10-14'])
})

test('X: verification failure goes to review, never rejection', async () => {
  const id = postIdAt(new Date('2026-10-14T01:00:00Z'))
  for (const result of [{ ok: false, reason: 'unavailable' }, { ok: false, reason: 'not_found' }, { ok: false, reason: 'forbidden' },
    { ok: true, authorHandle: 'me', hashtags: ['bts'] }, { ok: true, authorHandle: 'someone_else', hashtags: ['2026mamavote', 'bts'] }]) {
    const db = fakeDb({ tables: { rc_vote_campaigns: campaignTable, rc_agent_x_handles: handleTable('me') } })
    const r = await submitXProof(db, { agentNo: 'AGENT001', campaignId: 'mama_2026', postUrl: `https://x.com/me/status/${id}` }, { verifier: verifier(result), now: NOW })
    assert.equal(r.success, true, JSON.stringify(result))
    assert.equal(db.calls.rpc.find((c) => c.name === 'rc_campaign_submit_proof').args.p_status, 'review', JSON.stringify(result))
  }
})

test('X: day, handle and URL rules are checked before anything is fetched', async () => {
  const v = verifier({ ok: true, authorHandle: 'me', hashtags: ['2026mamavote', 'bts'] })
  const db = fakeDb({ tables: { rc_vote_campaigns: campaignTable, rc_agent_x_handles: handleTable('me') } })
  // Oct 12 18:00 KST: the right KST day for the window, but before 19:00.
  const early = postIdAt(new Date('2026-10-12T09:00:00Z'))
  assert.equal((await submitXProof(db, { agentNo: 'AGENT001', campaignId: 'mama_2026', postUrl: `https://x.com/me/status/${early}` }, { verifier: v, now: NOW })).error, 'post_before_open')
  const old = postIdAt(new Date('2026-10-12T11:00:00Z'))
  const r = await submitXProof(db, { agentNo: 'AGENT001', campaignId: 'mama_2026', postUrl: `https://x.com/me/status/${old}` }, { verifier: v, now: NOW })
  assert.deepEqual([r.error, r.postDay], ['post_wrong_day', '2026-10-12'])
  // Just before 00:00 KST yesterday still counts — for yesterday.
  const late = postIdAt(new Date('2026-10-13T14:58:00Z'))
  const y = await submitXProof(db, { agentNo: 'AGENT001', campaignId: 'mama_2026', postUrl: `https://x.com/me/status/${late}` }, { verifier: v, now: NOW })
  assert.equal(y.voteDay, '2026-10-13')
  assert.equal((await submitXProof(db, { agentNo: 'AGENT001', campaignId: 'mama_2026', postUrl: 'https://x.com/me' }, { verifier: v, now: NOW })).error, 'bad_url')
  const noHandle = fakeDb({ tables: { rc_vote_campaigns: campaignTable, rc_agent_x_handles: handleTable(null) } })
  const today = postIdAt(new Date('2026-10-14T01:00:00Z'))
  assert.equal((await submitXProof(noHandle, { agentNo: 'AGENT001', campaignId: 'mama_2026', postUrl: `https://x.com/me/status/${today}` }, { verifier: v, now: NOW })).error, 'x_handle_required')
  assert.equal(v.calls, 1, 'only the valid-day post was fetched')
})

test('oEmbed verifier: status mapping and id check', async () => {
  const res = (status, body) => async () => ({ status, ok: status === 200, json: async () => body })
  const ok = { url: 'https://x.com/Me/status/123456789', author_url: 'https://x.com/Me',
    html: '<blockquote><p>vote <a href="https://x.com/hashtag/2026MAMAVOTE?src=hash">#2026MAMAVOTE</a> <a href="https://x.com/hashtag/BTS?src=hash">#BTS</a></p>&mdash; Me</blockquote>' }
  assert.deepEqual(await oembedXVerifier(res(200, ok)).verify({ postId: '123456789' }), { ok: true, authorHandle: 'me', hashtags: ['2026mamavote', 'bts'] })
  assert.equal((await oembedXVerifier(res(200, ok)).verify({ postId: '999999999' })).ok, false, 'answer for another post is not trusted')
  assert.equal((await oembedXVerifier(res(404)).verify({ postId: '1' })).reason, 'not_found')
  assert.equal((await oembedXVerifier(res(403)).verify({ postId: '1' })).reason, 'forbidden')
  assert.equal((await oembedXVerifier(res(500)).verify({ postId: '1' })).reason, 'unavailable')
  assert.equal((await oembedXVerifier(async () => { throw new Error('network') }).verify({ postId: '1' })).reason, 'unavailable')
  let asked = ''
  await oembedXVerifier(async (url) => { asked = url; return { status: 404 } }).verify({ postId: '42' })
  assert.equal(asked, 'https://publish.x.com/oembed?omit_script=1&dnt=true&url=https%3A%2F%2Fx.com%2Fi%2Fstatus%2F42')
})

test('X handle: normalised, and a taken handle is reported', async () => {
  const db = fakeDb()
  assert.deepEqual(await setXHandle(db, { agentNo: 'AGENT001', campaignId: 'mama_2026', xHandle: '@Some_One' }), { success: true, xHandle: 'some_one', replay: false })
  assert.equal((await setXHandle(db, { agentNo: 'AGENT001', xHandle: 'bad handle!' })).error, 'bad_handle')
  const taken = fakeDb({ rpc: { rc_campaign_register_x_handle: () => ({ data: { success: false, error: 'x_handle_taken' } }) } })
  assert.equal((await setXHandle(taken, { agentNo: 'AGENT002', campaignId: 'mama_2026', xHandle: 'some_one' })).error, 'x_handle_taken')
})

test('reviewer OCR reports booleans; the server decides', async () => {
  const proofs = (q) => ({ data: { id: 5, campaign_id: 'mama_2026', mission_id: q.filters.id === 6 ? 'x' : 'mnet', status: 'verifying' } })
  const db = fakeDb({ tables: { rc_vote_campaigns: campaignTable, rc_campaign_proofs: proofs } })
  const ok = { certificate: true, category: true, date: true }
  await adminRecordCampaignChecks(db, { proofId: 5, checks: { ...ok, bts: 'match', btsScore: 0.97 } })
  await adminRecordCampaignChecks(db, { proofId: 5, checks: { ...ok, bts: 'unclear', status: 'verified' } })
  await adminRecordCampaignChecks(db, { proofId: 5, checks: { ...ok, bts: 'no_match' } })
  assert.deepEqual(db.calls.rpc.map((c) => [c.name, c.args.p_status, c.args.p_note]),
    [['rc_campaign_record_trusted_checks', 'verified', 'all_checks_passed'], ['rc_campaign_record_trusted_checks', 'review', 'unclear:bts'],
      ['rc_campaign_record_trusted_checks', 'review', 'unclear:bts_no_match']])
  assert.deepEqual(db.calls.rpc[0].args.p_checks, { ...ok, bts: 'match', btsScore: 0.97 })
  assert.equal((await adminRecordCampaignChecks(db, { proofId: 6, checks: {} })).error, 'bad_mission')
})

test('admin decisions map to guarded transitions with audit fields', async () => {
  const db = fakeDb({ tables: { rc_vote_campaigns: campaignTable, rc_campaign_proofs: () => ({ data: { id: 5, campaign_id: 'mama_2026', mission_id: 'mnet', status: 'review' } }) } })
  await adminReviewCampaignProof(db, { proofId: 5, decision: 'verify', checks: { certificate: true, category: true, date: true, bts: 'match', extra: 1 }, admin: 'HT', note: 'clear' })
  await adminReviewCampaignProof(db, { proofId: 5, decision: 'reject', admin: 'HT' })
  await adminReviewCampaignProof(db, { proofId: 5, decision: 'keep', checks: { date: false } })
  const [v, r, k] = db.calls.rpc.map((c) => c.args)
  assert.deepEqual([v.p_to, v.p_method, v.p_actor, v.p_note], ['verified', 'admin', 'HT', 'clear'])
  assert.deepEqual(v.p_checks, { certificate: true, category: true, date: true, bts: 'match' }, 'reviewer confirmed BTS selected')
  assert.deepEqual([r.p_to, r.p_from], ['rejected', ['verifying', 'review']])
  assert.equal(k.p_to, 'review')
  assert.equal((await adminReviewCampaignProof(db, { proofId: 5, decision: 'approve-all' })).error, 'bad_params')
})

test('admin queue: private proof links only, short-lived, no storage paths', async () => {
  const rows = [{ id: 1, mission_id: 'mnet', agent_no: 'AGENT001', vote_day: '2026-10-14', status: 'review', checks: {}, client_checks: {}, proof_path: 'mama_2026/AGENT001/a.jpg' },
    { id: 2, mission_id: 'x', agent_no: 'AGENT002', vote_day: '2026-10-14', status: 'review', checks: {}, client_checks: {}, proof_path: null, post_url: 'https://x.com/a/status/1', post_author: 'a' }]
  const db = fakeDb({ tables: {
    rc_vote_campaigns: campaignTable,
    rc_campaign_proofs: (q) => (q.head ? { count: 2 } : { data: rows }),
    rc_agent_x_handles: () => ({ data: [{ agent_no: 'AGENT002', x_handle: 'a' }] }),
  } })
  const r = await adminListCampaignProofs(db, { campaignId: 'mama_2026', status: 'review' })
  assert.equal(r.proofs.length, 2)
  assert.equal(r.proofs[0].proof_path, undefined)
  assert.match(r.proofs[0].proofUrl, /^https:\/\/signed\.example\/mama_2026\/AGENT001\/a\.jpg\?ttl=600$/)
  assert.deepEqual(db.calls.signed.map((s) => [s.bucket, s.ttl]), [[PROOF_BUCKET, 600]])
  assert.equal(r.proofs[1].expectedHandle, 'a')
  assert.equal(r.proofs[1].proofUrl, null)
})

test('player status never carries paths, hashes or other agents', async () => {
  const db = fakeDb({ rpc: {
    rc_campaign_team_resolve: () => ({ data: { team: 'aliens', via: 'timeout' } }),
    rc_campaign_battle_state: () => ({ data: { total: 41, teams: { hooligans: 22, aliens: 19 }, teamSizes: { hooligans: 3, aliens: 3 }, mine: 2 } }),
  }, tables: {
    rc_vote_campaigns: campaignTable,
    rc_campaign_proofs: (q) => ({ data: q.filters.status === 'verified'
      ? [{ vote_day: '2026-10-13' }, { vote_day: '2026-10-14' }]
      : [{ id: 1, mission_id: 'mnet', vote_day: '2026-10-14', status: 'verified', checks: { artist: true, category: true, date: true }, submitted_at: '2026-10-14T01:00:00Z' }] }),
  } })
  const s = await getVotingStatus(db, { agentNo: 'agent001' }, NOW)
  assert.equal(s.success, true)
  assert.deepEqual(s.states, { mnet: 'todo', x: 'todo' }, 'one verified Mnet certificate leaves two daily slots')
  assert.deepEqual(s.todayProgress.mnet, { verified: 1, pending: 0, used: 1, remaining: 2, max: 3 })
  assert.deepEqual(s.stats, { verifiedVotes: 2, votingDays: 2, streak: 2 })
  assert.deepEqual([s.gift.name, s.gift.state, s.gift.threshold, s.gift.dailyCap], ['Voting Gift', 'filling', 5, 2])
  assert.deepEqual(s.gift.pool, [{ kind: 'charge_cell', amount: 1 }, { kind: 'xp', amount: 10 }], 'kinds and amounts, no weights')
  assert.deepEqual(s.badge, { templateId: 'event_mama_2026', verifiedDays: 5, daysDone: 2, earned: false })
  assert.deepEqual([s.battle.myTeam, s.battle.total, s.battle.myPoints, s.battle.milestones], ['aliens', 41, 2, null])
  assert.deepEqual(s.battle.teams.map((t) => [t.label, t.points]), [['HOOLIGANS', 22], ['ALIENS', 19]])
  assert.equal(s.pulse.count, null, 'no snapshot yet: collecting, not zero')
  const text = JSON.stringify(s)
  for (const banned of ['proof_path', 'image_hash', 'original_hash', 'client_checks', 'Supply Chest', 'vma', 'weight', 'spent_usd', 'cursor']) {
    assert.equal(text.includes(banned), false, banned)
  }
  // rc_vote_pulse is the one shared snapshot (aggregates only), not per agent.
  for (const read of db.calls.reads.filter((q) => q.table !== 'rc_vote_campaigns' && q.table !== 'rc_vote_pulse')) {
    assert.equal(read.filters.agent_no, 'AGENT001', `${read.table} read is scoped to the caller`)
  }
})

test('World banner: null outside the window, counts verified missions only', async () => {
  const db = fakeDb({ tables: { rc_vote_campaigns: campaignTable,
    rc_campaign_proofs: () => ({ data: [{ mission_id: 'mnet', vote_day: '2026-10-14', status: 'verified' }, { mission_id: 'x', vote_day: '2026-10-14', status: 'review' }] }) } })
  const b = await getVotingBanner(db, 'AGENT001', NOW)
  assert.deepEqual([b.title, b.done, b.total], ['MAMA 2026', 1, 6])
  assert.equal(await getVotingBanner(db, 'AGENT001', new Date('2026-11-01T00:00:00Z')), null)
})

test('Voting Gift open: request id required; client reward values are ignored', async () => {
  const db = fakeDb({ tables: { rc_vote_campaigns: campaignTable }, rpc: { rc_vote_gift_open: () => ({ data: { success: true, rewards: [] } }) } })
  assert.equal((await openVotingGift(db, { agentNo: 'AGENT001', campaignId: 'mama_2026', requestId: 'nope' })).error, 'bad_request')
  await openVotingGift(db, { agentNo: 'AGENT001', campaignId: 'mama_2026', requestId: '11111111-1111-4111-8111-111111111111', rewards: [{ kind: 'wings', amount: 999 }], threshold: 0 })
  assert.deepEqual(Object.keys(db.calls.rpc[0].args).sort(), ['p_agent_no', 'p_campaign_id', 'p_request_id'])
})

test('MAMA code is isolated from VMA: no VMA ids, tables or defaults', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
  for (const f of ['./vote-campaign-service.js', './vote-campaign-rules.js', './vote-campaign.ts', './vote-pulse-service.js',
    '../../../../js/voting.js', '../../../../js/voting-view.js']) {
    const src = read(f)
    for (const banned of ['vma_2026', 'rc_vma_votes', 'supply_chest', 'event_vma', 'rc_config']) {
      assert.equal(src.includes(banned), false, `${f} mentions ${banned}`)
    }
  }
})

test('VMA retention statements are carried over byte-for-byte', () => {
  const read = (p) => readFileSync(new URL(`../../../migrations/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const original = read('20260928060000_rc_privacy_retention.sql')
  const next = read('20261013150000_rc_vote_campaigns.sql')
  const vmaInsert = original.match(/  insert into rc_storage_deletion_queue \(bucket, path, reason\)\n  select distinct 'vma-vote-proofs', v\.proof_path, 'agent_purged'[\s\S]*?on conflict \(bucket, path\) do nothing;/)[0]
  const vmaClear = original.match(/  with gone as \(\n    select q\.path[\s\S]*?where q\.bucket = 'vma-vote-proofs'[\s\S]*?where v\.proof_path = gone\.path;/)[0]
  assert.ok(next.includes(vmaInsert), 'agent purge queueing for VMA unchanged')
  assert.ok(next.includes(vmaClear), 'VMA reference clearing unchanged')
  assert.equal(/\b(update|delete from|insert into)\s+rc_vma_votes\b/i.test(next.replace(vmaClear, '')), false, 'no other VMA writes')
})

// ── Team battle routes ────────────────────────────────────────────────

test('team routes: server clock decides seconds left; invalid team refused before the database', async () => {
  const start = fakeDb({ tables: { rc_vote_campaigns: campaignTable },
    rpc: { rc_campaign_team_start: () => ({ data: { team: null, startedAt: '2026-10-14T03:00:00Z', deadline: '2026-10-14T03:00:07Z' } }) } })
  const r = await startVotingTeamChoice(start, { agentNo: 'agent001', campaignId: 'mama_2026' }, new Date('2026-10-14T03:00:03Z'))
  assert.deepEqual([r.team, r.secondsLeft], [null, 4])
  assert.deepEqual(r.teams.map((t) => t.label), ['HOOLIGANS', 'ALIENS'])
  assert.equal(start.calls.rpc[0].args.p_agent_no, 'AGENT001')
  const choose = fakeDb({ tables: { rc_vote_campaigns: campaignTable } })
  assert.equal((await chooseVotingTeam(choose, { agentNo: 'A', campaignId: 'mama_2026', team: 'martians' })).error, 'team_invalid')
  assert.equal(choose.calls.rpc.length, 0)
  const before = await startVotingTeamChoice(start, { agentNo: 'A', campaignId: 'mama_2026' }, new Date('2026-10-12T09:00:00Z'))
  assert.equal(before.error, 'voting_not_open')
})

test('Battle Gift claim: request id and milestone validated; client reward values ignored', async () => {
  const db = fakeDb({ tables: { rc_vote_campaigns: campaignTable }, rpc: { rc_battle_gift_claim: () => ({ data: { success: true, rewards: [] } }) } })
  assert.equal((await claimBattleGift(db, { agentNo: 'A', campaignId: 'mama_2026', milestoneIndex: 0, requestId: 'x' })).error, 'bad_request')
  assert.equal((await claimBattleGift(db, { agentNo: 'A', campaignId: 'mama_2026', milestoneIndex: -1, requestId: '11111111-1111-4111-8111-111111111111' })).error, 'bad_request')
  await claimBattleGift(db, { agentNo: 'A', campaignId: 'mama_2026', milestoneIndex: 2, requestId: '11111111-1111-4111-8111-111111111111', rewards: [{ kind: 'backup_pass', amount: 99 }], points: 500 })
  assert.deepEqual(Object.keys(db.calls.rpc[0].args).sort(), ['p_agent_no', 'p_campaign_id', 'p_milestone_index', 'p_request_id'])
})

// ── BTS X Vote Pulse collector ────────────────────────────────────────

function apifyFake(routes) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.authorization })
    for (const [re, fn] of routes) if (re.test(url)) return fn(url, init)
    return { status: 404, ok: false, json: async () => ({}) }
  }
  return { calls, fetchImpl }
}
const ok = (body) => ({ status: 200, ok: true, json: async () => body })
const pulseState = (row) => (q) => ({ data: q.single ? row : [] })

test('Pulse collector: starts the first run from voting open, with the configured query and caps', async () => {
  const db = fakeDb({ tables: { rc_vote_campaigns: () => ({ data: [CAMPAIGN] }), rc_vote_pulse: pulseState(null) },
    rpc: { rc_vote_pulse_begin: () => ({ data: { success: true } }) } })
  const api = apifyFake([[/\/acts\/xquik~x-tweet-scraper\/runs/, () => ok({ data: { id: 'run-1' } })]])
  const r = await runVotePulse(db, { fetchImpl: api.fetchImpl, token: 'tok', now: NOW })
  assert.equal(r.results[0].started, 'run-1')
  const start = api.calls[0]
  assert.equal(start.method, 'POST')
  assert.equal(start.auth, 'Bearer tok', 'token in a header, never the URL')
  assert.doesNotMatch(start.url, /tok/)
  assert.match(start.url, /maxItems=600&maxTotalChargeUsd=0\.0900/)
  // Reposts and quote posts count as a vote in MAMA's X rules, so they are not filtered out.
  assert.deepEqual(start.body, { twitterContent: '#2026MAMAVOTE #BTS', queryType: 'Latest', maxItems: 600,
    since_id: ((BigInt(Date.parse('2026-10-12T10:00:00Z')) - 1288834974657n) << 22n).toString() })
  assert.deepEqual(db.calls.rpc.map((c) => c.name), ['rc_vote_pulse_begin'])
})

test('Pulse collector: collects only ids newer than the cursor, then starts the next run', async () => {
  const state = { pending_run_id: 'run-1', pending_started_at: '2026-10-14T02:00:00Z', cursor_post_id: '1000000000000000100', spent_usd: 0.05 }
  // Like the real rc_vote_pulse_finish, finishing clears the pending run.
  let finished = false
  const db = fakeDb({ tables: { rc_vote_campaigns: () => ({ data: [CAMPAIGN] }),
    rc_vote_pulse: (q) => ({ data: finished ? { ...state, pending_run_id: null, cursor_post_id: '1000000000000000105' } : state }) },
  rpc: { rc_vote_pulse_finish: () => { finished = true; return { data: { success: true } } }, rc_vote_pulse_begin: () => ({ data: { success: true } }) } })
  const api = apifyFake([
    [/\/actor-runs\/run-1$/, () => ok({ data: { status: 'SUCCEEDED', defaultDatasetId: 'ds1', usageTotalUsd: 0.02 } })],
    [/\/datasets\/ds1\/items/, () => ok([{ id: '1000000000000000099' }, { id: '1000000000000000101' }, { id: '1000000000000000105' }, { id: '1000000000000000105' }])],
    [/\/acts\/.*\/runs/, () => ok({ data: { id: 'run-2' } })],
  ])
  const r = await runVotePulse(db, { fetchImpl: api.fetchImpl, token: 'tok', now: NOW })
  const fin = db.calls.rpc.find((c) => c.name === 'rc_vote_pulse_finish').args
  assert.deepEqual([fin.p_run_ref, fin.p_status, fin.p_counted, fin.p_newest_post_id, fin.p_complete, fin.p_cost_usd],
    ['run-1', 'ok', 2, '1000000000000000105', true, 0.02], 'older and duplicate ids are not counted')
  assert.match(api.calls.find((c) => /datasets/.test(c.url)).url, /fields=id&/, 'only ids are read back — no usernames')
  assert.equal(r.results[0].started, 'run-2')
  assert.equal(api.calls.at(-1).body.since_id, '1000000000000000105', 'next run asks only for newer posts')
})

test('Pulse collector: a capped run is partial; a failed run keeps the count; still-running waits', async () => {
  const state = { pending_run_id: 'run-1', pending_started_at: '2026-10-14T02:30:00Z', cursor_post_id: '1', spent_usd: 0 }
  const mk = (runStatus, items = []) => {
    const db = fakeDb({ tables: { rc_vote_campaigns: () => ({ data: [CAMPAIGN] }), rc_vote_pulse: pulseState(state) },
      rpc: { rc_vote_pulse_finish: () => ({ data: { success: true } }), rc_vote_pulse_begin: () => ({ data: { success: true } }) } })
    const api = apifyFake([
      [/\/actor-runs\/run-1$/, () => ok({ data: { status: runStatus, defaultDatasetId: 'ds', usageTotalUsd: 0.09 } })],
      [/\/datasets\/ds\/items/, (url) => ok(/offset=0/.test(url) ? items : [])],
      [/\/acts\/.*\/runs/, () => ok({ data: { id: 'run-2' } })],
    ])
    return { db, api }
  }
  const full = mk('SUCCEEDED', Array.from({ length: 600 }, (_, i) => ({ id: String(1000000000000000000n + BigInt(i)) })))
  await runVotePulse(full.db, { fetchImpl: full.api.fetchImpl, token: 'tok', now: NOW })
  const f = full.db.calls.rpc.find((c) => c.name === 'rc_vote_pulse_finish').args
  assert.deepEqual([f.p_status, f.p_counted, f.p_complete], ['partial', 600, false])
  const failed = mk('FAILED')
  await runVotePulse(failed.db, { fetchImpl: failed.api.fetchImpl, token: 'tok', now: NOW })
  const ff = failed.db.calls.rpc.find((c) => c.name === 'rc_vote_pulse_finish').args
  assert.deepEqual([ff.p_status, ff.p_counted], ['failed', 0])
  const running = mk('RUNNING')
  const rr = await runVotePulse(running.db, { fetchImpl: running.api.fetchImpl, token: 'tok', now: NOW })
  assert.equal(rr.results[0].waiting, 'run-1')
  assert.equal(running.db.calls.rpc.length, 0)
})

test('Pulse collector: free budget and credit exhaustion stop new runs; no token or outside window does nothing', async () => {
  const over = fakeDb({ tables: { rc_vote_campaigns: () => ({ data: [CAMPAIGN] }), rc_vote_pulse: pulseState({ spent_usd: 3.95 }) },
    rpc: { rc_vote_pulse_finish: () => ({ data: { success: true } }) } })
  const api = apifyFake([])
  const r = await runVotePulse(over, { fetchImpl: api.fetchImpl, token: 'tok', now: NOW })
  assert.equal(r.results[0].reason, 'budget_reached')
  assert.equal(api.calls.length, 0, 'never calls the provider past the budget')
  assert.equal(over.calls.rpc[0].args.p_status, 'exhausted')
  const broke = fakeDb({ tables: { rc_vote_campaigns: () => ({ data: [CAMPAIGN] }), rc_vote_pulse: pulseState(null) },
    rpc: { rc_vote_pulse_finish: () => ({ data: { success: true } }) } })
  const apiBroke = apifyFake([[/\/runs/, () => ({ status: 402, ok: false, json: async () => ({ error: { type: 'not-enough-usage-to-run-paid-actor' } }) })]])
  await runVotePulse(broke, { fetchImpl: apiBroke.fetchImpl, token: 'tok', now: NOW })
  assert.equal(broke.calls.rpc[0].args.p_status, 'exhausted')
  const none = fakeDb({ tables: { rc_vote_campaigns: () => ({ data: [CAMPAIGN] }) } })
  assert.equal((await runVotePulse(none, { token: '', now: NOW })).results[0].skipped, 'no_token')
  assert.equal((await runVotePulse(none, { token: 'tok', now: new Date('2026-11-01T00:00:00Z') })).results[0].skipped, 'outside_window')
})

test('Pulse collector never touches proofs, teams, gifts, XP or badges', async () => {
  const db = fakeDb({ tables: { rc_vote_campaigns: () => ({ data: [CAMPAIGN] }), rc_vote_pulse: pulseState(null) },
    rpc: { rc_vote_pulse_begin: () => ({ data: { success: true } }) } })
  const api = apifyFake([[/\/runs/, () => ok({ data: { id: 'r' } })]])
  await runVotePulse(db, { fetchImpl: api.fetchImpl, token: 'tok', now: NOW })
  for (const q of [...db.calls.reads, ...db.calls.writes]) assert.ok(['rc_vote_campaigns', 'rc_vote_pulse'].includes(q.table), q.table)
  for (const c of db.calls.rpc) assert.match(c.name, /^rc_vote_pulse_/)
})

test('winner reward claim: request id validated; no client values reach the database', async () => {
  const db = fakeDb({ tables: { rc_vote_campaigns: campaignTable }, rpc: { rc_battle_winner_claim: () => ({ data: { success: true, rewards: [] } }) } })
  assert.equal((await claimBattleWinner(db, { agentNo: 'A', campaignId: 'mama_2026', requestId: 'nope' })).error, 'bad_request')
  await claimBattleWinner(db, { agentNo: 'a', campaignId: 'mama_2026', requestId: '44444444-4444-4444-8444-444444444444', team: 'hooligans', rewards: [{ kind: 'backup_pass' }] })
  assert.deepEqual(db.calls.rpc[0].args, { p_campaign_id: 'mama_2026', p_agent_no: 'A', p_request_id: '44444444-4444-4444-8444-444444444444' })
})

test('status: Battle Gift eligibility = any verified mission; winner reward needs a point for the winning team', async () => {
  const camp = { ...CAMPAIGN, battle: { ...CAMPAIGN.battle, milestones: [1], gift: { pool: [{ kind: 'xp', weight: 1, amount: 10 }] },
    winner_reward: [{ kind: 'xp', amount: 20 }, { kind: 'charge_cell', amount: 1 }] } }
  const mk = (battleState, team) => fakeDb({ rpc: {
    rc_campaign_team_resolve: () => ({ data: { team } }),
    rc_campaign_battle_state: () => ({ data: battleState }),
  }, tables: {
    rc_vote_campaigns: (q) => (q.single ? { data: camp } : { data: [camp] }),
    rc_campaign_proofs: (q) => ({ data: q.filters.status === 'verified' ? [{ vote_day: '2026-10-14' }] : [] }),
  } })
  // Verified before joining a team: no point, still a Battle Gift contributor.
  const early = await getVotingStatus(mk({ total: 3, teams: { hooligans: 2, aliens: 1 }, mine: 0, frozen: false }, 'aliens'), { agentNo: 'A' }, NOW)
  assert.deepEqual([early.battle.contributor, early.battle.milestones[0].claimable, early.battle.winnerReward.state], [true, true, 'pending'])
  const lost = await getVotingStatus(mk({ total: 3, teams: { hooligans: 2, aliens: 1 }, mine: 1, frozen: true, winners: ['hooligans'] }, 'aliens'), { agentNo: 'A' }, NOW)
  assert.deepEqual([lost.battle.frozen, lost.battle.winners, lost.battle.winnerReward.state], [true, ['hooligans'], 'not_winner'])
  const won = await getVotingStatus(mk({ total: 3, teams: { hooligans: 2, aliens: 1 }, mine: 2, frozen: true, winners: ['hooligans'] }, 'hooligans'), { agentNo: 'A' }, NOW)
  assert.equal(won.battle.winnerReward.state, 'claimable')
  assert.deepEqual(won.battle.winnerReward.rewards, [{ kind: 'xp', amount: 20 }, { kind: 'charge_cell', amount: 1 }])
})

test('team safeguard: no MAMA team, no proof — and the upload is cleaned up', async () => {
  const db = fakeDb({ tables: { rc_vote_campaigns: campaignTable },
    rpc: { rc_campaign_team_resolve: () => ({ data: { team: null } }), rc_campaign_submit_proof: () => ({ data: { success: false, error: 'team_required' } }) } })
  const r = await submitMnetProof(db, { agentNo: 'AGENT001', campaignId: 'mama_2026', imageBase64: png, imageMime: 'image/jpeg' }, NOW)
  assert.equal(r.error, 'team_required')
  assert.equal(db.calls.remove.length, 1, 'no orphaned proof file')
  const x = fakeDb({ tables: { rc_vote_campaigns: campaignTable, rc_agent_x_handles: handleTable('me') },
    rpc: { rc_campaign_submit_proof: () => ({ data: { success: false, error: 'team_required' } }) } })
  const id = postIdAt(new Date('2026-10-14T01:00:00Z'))
  const rx = await submitXProof(x, { agentNo: 'AGENT001', campaignId: 'mama_2026', postUrl: `https://x.com/me/status/${id}` },
    { verifier: verifier({ ok: true, authorHandle: 'me', hashtags: ['2026mamavote', 'bts'] }), now: NOW })
  assert.equal(rx.error, 'team_required')
  assert.deepEqual(x.calls.rpc.map((c) => c.name), ['rc_campaign_team_resolve', 'rc_campaign_submit_proof'])
})

test('X hashtags come from config and match case-insensitively; both are required', async () => {
  const id = postIdAt(new Date('2026-10-14T01:00:00Z'))
  for (const [tags, want] of [[['2026mamavote', 'bts'], 'verified'], [['2026MamaVote', 'BTS'], 'verified'], [['2026mamavote'], 'review'], [['bts'], 'review']]) {
    const db = fakeDb({ tables: { rc_vote_campaigns: campaignTable, rc_agent_x_handles: handleTable('me') } })
    await submitXProof(db, { agentNo: 'AGENT001', campaignId: 'mama_2026', postUrl: `https://x.com/me/status/${id}` },
      { verifier: verifier({ ok: true, authorHandle: 'me', hashtags: tags.map((t) => t.toLowerCase()) }), now: NOW })
    assert.equal(db.calls.rpc.find((c) => c.name === 'rc_campaign_submit_proof').args.p_status, want, tags.join(','))
  }
})

// ── Duplicate-certificate fingerprints ─────────────────────────────────

const KEY = 'test-only-fingerprint-key'
const CERT_NO = '7A0B3E8U3K4UIKQZ' // made up, real format
const mnetProofDb = () => fakeDb({ tables: { rc_vote_campaigns: campaignTable,
  rc_campaign_proofs: () => ({ data: { id: 5, campaign_id: 'mama_2026', mission_id: 'mnet', status: 'verifying' } }) } })
const passChecks = { certificate: true, category: true, date: true, bts: 'match', btsScore: 0.97 }

test('trusted check: number and minute become HMAC fingerprints; the raw values never reach the database', async () => {
  const db = mnetProofDb()
  const r = await adminRecordCampaignChecks(db, { proofId: 5, checks: passChecks, certificateNumber: CERT_NO, participationAt: '2026-10-13T07:39:00Z' }, { fingerprintKey: KEY })
  const call = db.calls.rpc[0]
  assert.equal(call.name, 'rc_campaign_record_trusted_checks')
  assert.match(call.args.p_cert_fp, /^[0-9a-f]{64}$/)
  assert.match(call.args.p_time_fp, /^[0-9a-f]{64}$/)
  const sent = JSON.stringify(call.args)
  for (const raw of [CERT_NO, '7A0B3E8U3K4U1KQZ', '2026-10-13T16:39', '16:39']) assert.equal(sent.includes(raw), false, `raw ${raw} not sent`)
  assert.equal(JSON.stringify(r).includes(CERT_NO), false, 'and never returned')
  assert.deepEqual(r.fingerprinted, { number: true, time: true })
})

test('fingerprint: same certificate (any case, O/0, I/1) → same; different number → different', async () => {
  const fp = async (num) => {
    const db = mnetProofDb()
    await adminRecordCampaignChecks(db, { proofId: 5, checks: passChecks, certificateNumber: num }, { fingerprintKey: KEY })
    return db.calls.rpc[0].args.p_cert_fp
  }
  const a = await fp(CERT_NO)
  assert.equal(await fp(CERT_NO.toLowerCase()), a, 're-screenshot / OCR case')
  assert.equal(await fp('7AOB3E8U3K4UlKQZ'), a, 'O/0 and I/l/1 look-alikes')
  assert.notEqual(await fp('7A0B3E8U3K4UIKQY'), a, 'different certificate')
  assert.equal(await fp('TOO-SHORT'), null, 'an unreadable number is not fingerprinted')
})

test('fingerprint cannot be reversed or checked against a guess without the server key', async () => {
  const fp = await certFingerprint(KEY, 'mama_2026', 'number', normalizeCertificateNumber(CERT_NO))
  const sha = (s) => createHash('sha256').update(s).digest('hex')
  for (const plain of [CERT_NO, normalizeCertificateNumber(CERT_NO), `mama_2026|number|${normalizeCertificateNumber(CERT_NO)}`]) {
    assert.notEqual(fp, sha(plain), 'not a plain hash anyone could recompute')
  }
  assert.notEqual(await certFingerprint('another-key', 'mama_2026', 'number', normalizeCertificateNumber(CERT_NO)), fp,
    'knowing the number but not the key does not reproduce the stored fingerprint')
  assert.notEqual(await certFingerprint(KEY, 'other_event', 'number', normalizeCertificateNumber(CERT_NO)), fp, 'scoped per event')
})

test('no key configured: no fingerprints, existing checks stand', async () => {
  const db = mnetProofDb()
  const r = await adminRecordCampaignChecks(db, { proofId: 5, checks: passChecks, certificateNumber: CERT_NO, participationAt: '2026-10-13T07:39:00Z' })
  assert.deepEqual([db.calls.rpc[0].args.p_cert_fp, db.calls.rpc[0].args.p_time_fp, r.fingerprinted], [null, null, { number: false, time: false }])
  assert.equal(db.calls.rpc[0].args.p_status, 'verified')
})

test('City summary: team scores come from the shared cache; phases follow the event lifecycle', async () => {
  const mk = () => fakeDb({ tables: { rc_vote_campaigns: campaignTable,
    rc_campaign_teams: () => ({ data: { team: 'aliens' } }),
    rc_campaign_proofs: () => ({ data: [{ mission_id: 'mnet', vote_day: '2026-10-14', status: 'verified' }] }) },
  rpc: { rc_campaign_battle_state: () => ({ data: { teams: { hooligans: 214, aliens: 198 }, total: 412, frozen: false } }) } })
  const keys = []
  const cache = async (key, ttl, compute) => { keys.push([key, ttl]); return compute() }
  const db = mk()
  const b = await getVotingBanner(db, 'AGENT001', NOW, { cache })
  assert.deepEqual(keys, [['vote_battle:mama_2026', 60000]], 'one shared, cached score read')
  assert.deepEqual([b.phase, b.done, b.battle.myTeam, b.battle.teams.map((t) => t.points), b.battle.winners], ['open', 1, 'aliens', [214, 198], null])
  assert.deepEqual(b.battle.milestones, [
    { target: 200, reached: true }, { target: 500, reached: false }, { target: 900, reached: false },
    { target: 1400, reached: false }, { target: 2200, reached: false },
  ], 'City receives its next milestone from campaign config')
  // A cache hit means no aggregate at all.
  const hit = mk()
  await getVotingBanner(hit, 'AGENT001', NOW, { cache: async () => ({ teams: { hooligans: 1, aliens: 2 }, total: 3, frozen: false }) })
  assert.equal(hit.calls.rpc.length, 0)
  const closed = await getVotingBanner(mk(), 'AGENT001', new Date('2026-10-23T01:00:00Z'), { cache })
  assert.equal(closed.phase, 'verifying')
  assert.equal(await getVotingBanner(mk(), 'AGENT001', new Date('2026-10-12T09:00:00Z')), null, 'hidden before voting opens')
  const finalDb = fakeDb({ tables: { rc_vote_campaigns: () => ({ data: [{ ...CAMPAIGN, battle: { ...CAMPAIGN.battle, freeze_at: '2026-10-23T12:00:00+09:00', final_visible_hours: 48 } }] }),
    rc_campaign_teams: () => ({ data: { team: 'aliens' } }) },
  rpc: { rc_campaign_battle_state: () => ({ data: { teams: { hooligans: 300, aliens: 310 }, total: 610, frozen: true, winners: ['aliens'] } }) } })
  const fin = await getVotingBanner(finalDb, 'AGENT001', new Date('2026-10-24T00:00:00Z'))
  assert.deepEqual([fin.phase, fin.battle.winners], ['final', ['aliens']])
  assert.equal(await getVotingBanner(finalDb, 'AGENT001', new Date('2026-10-26T00:00:00Z')), null, 'gone after the 48h final window')
})
