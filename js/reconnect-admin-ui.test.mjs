import assert from 'node:assert/strict'
import {
  canAutoFillReconnect,
  reconnectAdminAction,
  reconnectAdminBucket,
  reconnectBucketCounts,
  reconnectPlainReason,
  redZoneTargetOptions,
} from './reconnect-admin-ui.js'

const fillable = {
  kind: 'mission', flags: ['needs_people'], missingSeats: 1, requiredAgents: 2,
  suggestedAgentNos: ['AGENT001', 'AGENT002'],
}
assert.equal(canAutoFillReconnect(fillable), true)
assert.equal(reconnectAdminBucket(fillable), 'action')
assert.equal(reconnectPlainReason(fillable), 'Needs 1 teammate')
assert.deepEqual(reconnectAdminAction(fillable), { kind: 'autofill', label: 'AUTO-FILL BEST MATCH' })

assert.equal(reconnectAdminBucket({ ...fillable, suggestedAgentNos: [] }), 'watch')
assert.equal(reconnectAdminBucket({ flags: ['invite_pending'] }), 'watch')
assert.equal(reconnectAdminBucket({ flags: ['active'] }), 'fine')
assert.equal(reconnectAdminBucket({
  flags: ['active'],
  districtExpiresAt: new Date(Date.now() + 8 * 86400000).toISOString(),
}), 'fine')
assert.equal(reconnectAdminBucket({ flags: ['deadline_soon'] }), 'watch')
assert.equal(reconnectAdminBucket({ flags: ['puzzle_blocked'] }), 'action')
assert.equal(reconnectPlainReason({ flags: ['puzzle_blocked'] }), 'No puzzle attempts left')
assert.equal(reconnectPlainReason({ flags: ['deadline_soon', 'needs_people'], missingSeats: 2 }), 'Needs 2 teammates before the deadline')
assert.deepEqual(reconnectBucketCounts([
  fillable,
  { flags: ['invite_pending'] },
  { flags: ['active'] },
]), { action: 1, watch: 1, fine: 1 })

console.log('reconnect-admin-ui: all tests passed')

/* ── Red Zone "What counts" picker ─────────────────────────────────────── */
const rzOptions = redZoneTargetOptions([
  { id: 't1', kind: 'track', label: 'Haegeum', artist: 'Agust D' },
  { id: 'r1', kind: 'reconnect', label: 'Cipher', variant: 'cipher' },
  { id: 'a1', kind: 'album', label: 'ARIRANG', tracks: [{ label: 'One' }, { label: 'Two' }] },
  { id: 't2', kind: 'track', label: 'Dynamite', artist: null },
])
assert.deepEqual(rzOptions, [
  { value: '', label: 'Any BTS song', group: null },
  { value: 't1', label: 'Haegeum — Agust D', group: 'Tracks' },
  { value: 't2', label: 'Dynamite', group: 'Tracks' },
  { value: 'a1', label: 'ARIRANG (2 tracks)', group: 'Albums' },
])
// A puzzle goal can never be picked — it would count nothing and make the
// event unwinnable.
assert.equal(rzOptions.some((o) => o.value === 'r1'), false)
// No goals at all still leaves a usable picker, not an empty one.
assert.deepEqual(redZoneTargetOptions([]), [{ value: '', label: 'Any BTS song', group: null }])
assert.equal(redZoneTargetOptions().length, 1)
