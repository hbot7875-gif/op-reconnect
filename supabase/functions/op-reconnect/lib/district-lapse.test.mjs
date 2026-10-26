import assert from 'node:assert/strict'
import test from 'node:test'
import { buildLapseSummary, lapseView, latestLapsesByDistrict } from './district-lapse.js'
import { lastAttemptHtml } from '../../../../js/last-attempt.js'

// Shaped like AGENT027's Lowkey Kavs Alley, 2026-10: every solo goal full,
// the 300-play team quest at 240 when the deadline passed.
const progress = {
  trackGoals: [
    { label: 'DNA', artist: 'BTS', progress: 52, target: 52, done: true },
    { label: 'Wild Flower', artist: 'RM', progress: 40, target: 65, done: false },
  ],
  albums: [
    { label: 'Keep Swimming', passesDone: 5, target: 7, done: false, nextPassTracks: [{ label: 'SWIM with Jin', have: 5, need: 2 }] },
    { label: 'D-DAY', passesDone: 4, target: 4, done: true, nextPassTracks: [] },
  ],
}
const reconnect = { done: false, restorationProgress: { progress: 240, target: 300 } }
const row = (summary, extra = {}) => ({
  district_id: 'mono-lowkey-kavs-alley', activated_at: '2026-10-09T07:04:00Z',
  deadline_at: '2026-10-16T07:04:00Z', lapsed_at: '2026-10-19T07:10:00Z', reason: 'deadline', summary, ...extra,
})

test('snapshot keeps goal shape and the live meter percent', () => {
  const s = buildLapseSummary(progress, reconnect, { label: 'ReConnect Quest', trackLabel: 'Normal & Come Over' })
  assert.equal(s.trackGoals.length, 2)
  assert.deepEqual(s.albums[0].shortTracks, [{ label: 'SWIM with Jin', have: 5, need: 2 }])
  assert.deepEqual(s.reconnect, { label: 'ReConnect Quest', trackLabel: 'Normal & Come Over', done: false, progress: 240, target: 300 })
  // (52 + 40 + 5 + 4 + 240) / (52 + 65 + 7 + 4 + 300) = 341/428
  assert.equal(s.percent, 80)
})

test('a district with no team quest has none in the snapshot', () => {
  const s = buildLapseSummary(progress, null)
  assert.equal(s.reconnect, null)
})

test('the view lists exactly what was not achieved', () => {
  const view = lapseView(row(buildLapseSummary(progress, reconnect, { trackLabel: 'Normal & Come Over' })))
  assert.deepEqual(view.missed.map((m) => [m.kind, m.label, m.progress, m.target]), [
    ['track', 'Wild Flower', 40, 65],
    ['album', 'Keep Swimming', 5, 7],
    ['team', 'Normal & Come Over', 240, 300],
  ])
  assert.deepEqual(view.done, { tracks: 1, tracksTotal: 2, albums: 1, albumsTotal: 2, team: false })
  assert.equal(view.deadlineAt, '2026-10-16T07:04:00Z')
})

test('only the newest lapse per district, and never one the agent is back on', () => {
  const summary = buildLapseSummary(progress, reconnect)
  const rows = [
    row(summary, { lapsed_at: '2026-10-01T00:00:00Z', reason: 'blackout' }),
    row(summary),
    row(summary, { district_id: 'mono-tae-pier' }),
  ]
  const out = latestLapsesByDistrict(rows, new Set(['mono-tae-pier']))
  assert.deepEqual(Object.keys(out), ['mono-lowkey-kavs-alley'])
  assert.equal(out['mono-lowkey-kavs-alley'].reason, 'deadline')
})

test('the card names the deadline, the percent and each missed goal', () => {
  const html = lastAttemptHtml(lapseView(row(buildLapseSummary(progress, reconnect, { trackLabel: 'Normal & Come Over' }))))
  assert.match(html, /reached <b>80%<\/b>/)
  assert.match(html, /Deadline <b>/)
  assert.match(html, /The deadline passed before every goal was finished/)
  assert.match(html, /<b>Wild Flower<\/b> — 40\/65 plays/)
  assert.match(html, /<b>Keep Swimming<\/b> album — 5\/7 passes<small>SWIM with Jin needed 2 more<\/small>/)
  assert.match(html, /ReConnect team quest<\/b> \(Normal &amp; Come Over\) — 240\/300 pooled/)
  assert.match(html, /team quest ✗/)
  assert.equal(lastAttemptHtml(null), '')
})

test('labels are escaped', () => {
  const html = lastAttemptHtml({ percent: 1, missed: [{ kind: 'track', label: '<img>', progress: 0, target: 1 }], done: {} })
  assert.ok(!html.includes('<img>'))
})
