// Rap Line to 1B card: the labels players read. The card header and both
// sheets take a report's age from freshness(), so they must agree with each
// other and with the date shown; abbreviations must never round a total up
// past what Spotify reported in a way that changes its meaning.

import test from 'node:test'
import assert from 'node:assert/strict'

// state.js wires a document listener at import; nothing here touches it.
globalThis.document ??= { addEventListener() {} }
const { abbreviate, freshness, gainLabel, shortDate } = await import('./rapline-tracker.js')

test('abbreviate: compact totals for the City card', () => {
  assert.equal(abbreviate(874_058_865), '874.1M')
  assert.equal(abbreviate(458_468_618), '458.5M')
  assert.equal(abbreviate(365_215_555), '365.2M')
  assert.equal(abbreviate(1_009_292_521), '1.01B')
  assert.equal(abbreviate(308_007), '308K')
  assert.equal(abbreviate(950), '950')
})

test('freshness: age from the reported UTC date, the same everywhere', () => {
  const at = (iso) => Date.parse(iso)
  assert.deepEqual(freshness('2026-10-27', at('2026-10-27T00:05:00Z')), { ageDays: 0, stale: false, label: '0 days old' })
  assert.equal(freshness('2026-10-27', at('2026-10-27T23:59:00Z')).ageDays, 0)
  assert.equal(freshness('2026-10-27', at('2026-10-28T00:00:00Z')).label, '1 day old')
  assert.equal(freshness('2026-10-23', at('2026-10-27T12:00:00Z')).stale, false)  // 4 days: one cycle
  const old = freshness('2026-10-20', at('2026-10-27T12:00:00Z'))
  assert.deepEqual(old, { ageDays: 7, stale: true, label: '7 days old' })
  assert.equal(freshness(null), null)
})

test('gainLabel: dated only when the gain is older than the report', () => {
  const base = { asOf: '2026-10-27', days: [{ day: '2026-10-27', kind: 'gain' }] }
  assert.equal(gainLabel({ ...base, latestGain: { day: '2026-10-27', streams: 308_007 } }, true), '+308K / day')
  assert.equal(gainLabel({ ...base, latestGain: { day: '2026-10-27', streams: 308_007 } }), '+308,007 / day')
  assert.equal(gainLabel({ asOf: '2026-10-27', days: [{ day: '2026-10-27', kind: 'spans_repeat' }], latestGain: { day: '2026-10-23', streams: 254_843 } }, true), '+255K on Oct 23')
  assert.equal(gainLabel({ asOf: '2026-10-27', days: [{ day: '2026-10-27', kind: 'correction' }], latestGain: null }), 'Spotify correction')
  assert.equal(gainLabel({ asOf: '2026-10-27', days: [{ day: '2026-10-27', kind: 'gap' }], latestGain: null }), 'Daily gain —')
})

test('shortDate', () => {
  assert.equal(shortDate('2026-10-27'), 'Oct 27')
  assert.equal(shortDate(''), '')
})
