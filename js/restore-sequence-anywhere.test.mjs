// The restore moment plays on the district page itself (no pop-up), the
// first time the page is opened after the district finished — wherever the
// player was when the server reported it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8').split('\r\n').join('\n')
const main = read('./main.js')
const celebrate = read('./celebrate.js')
const district = read('./screen-district.js')

// restore-pending.js reads localStorage; give it an in-memory one.
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}
const { savePendingRestore, peekPendingRestore, clearPendingRestore, restoreCounts } = await import('./restore-pending.js')

test('main.js keeps the moment before painting, and offers a notice off the page', () => {
  assert.match(main, /const restoredNow = takeRestorationDue\(state\)\n\s+if \(restoredNow\) savePendingRestore\(getAgentNo\(\), restoredNow, state\.bomb\?\.charge\)\n\s+show\('game'\)/)
  const sub = main.slice(main.indexOf('subscribe((state) => {'))
  assert.ok(sub.indexOf('savePendingRestore(getAgentNo()') < sub.indexOf('  renderScreen(state)'))
  assert.match(main, /if \(restoredNow && !onRestoredPage\) restoredNotice\(restoredNow\)/)
  assert.match(main, /goDistrict\(d\.wardId, d\.id\)/)
})

test('no pop-up: the overlay sequence is no longer triggered', () => {
  assert.doesNotMatch(main, /maybePlayRestoration|playRestoration\(/)
  assert.doesNotMatch(district, /playRestoration\(/)
})

test('the district page plays it in place once, then keeps the card on re-render', () => {
  assert.match(district, /playRestorationInline\(pendingRestore, ward, container,/)
  assert.match(district, /clearPendingRestore\(getAgentNo\(\), districtId\)/)
  assert.match(district, /board\.append\(inlineRestore\.node, shelf\(state, mapD\)\)/)
  assert.match(district, /\(\) => fractionOverride \?\? \(isLiveActive/)
})

test('takeRestorationDue reports each district once', () => {
  const fn = celebrate.slice(celebrate.indexOf('export function takeRestorationDue'), celebrate.indexOf('export function playRestorationInline'))
  assert.match(fn, /if \(!d\?\.restoredNow \|\| d\.id === celebratedRestoreFor\) return null/)
})

test('a saved moment waits per agent and district until cleared', () => {
  const d = { id: 'mono-7', name: 'Zeal Arcade', wardId: 'mono', xpAwarded: 25, itemDropped: { name: 'Mug' }, trackGoals: [{ progress: 30, target: 20 }] }
  savePendingRestore('agent001', d, 0.62)
  const got = peekPendingRestore('AGENT001', 'mono-7')
  assert.equal(got.xpAwarded, 25)
  assert.equal(got.bombCharge, 0.62)
  assert.equal(got.itemDropped.name, 'Mug')
  assert.equal(peekPendingRestore('AGENT002', 'mono-7'), null)
  // A second report keeps the first copy's numbers.
  savePendingRestore('AGENT001', { ...d, xpAwarded: 0 }, 0.1)
  assert.equal(peekPendingRestore('AGENT001', 'mono-7').xpAwarded, 25)
  clearPendingRestore('AGENT001', 'mono-7')
  assert.equal(peekPendingRestore('AGENT001', 'mono-7'), null)
})

test('Your Contributions sits inside the card: after the rewards, before the collectible', () => {
  const fn = celebrate.slice(celebrate.indexOf('export function playRestorationInline'))
  const rewardsAt = fn.indexOf('body.appendChild(rewards(snap')
  const contribAt = fn.indexOf("contributionsSection(snap.id, districtDisplayName(snap), { compact: true })")
  const dropAt = fn.indexOf('const drop = snap.itemDropped')
  assert.ok(rewardsAt > 0 && rewardsAt < contribAt && contribAt < dropAt)
})

test('one quiet line when every category is empty', () => {
  const contrib = read('./district-contributions.js')
  assert.match(contrib, /if \(!tracks\.length && !albums\.length && \(!r \|\| r\.state === 'none'\)\) \{\s+body\.appendChild\(el\('p', 'yc-note yc-empty'/)
})

test('the summary counts completed goals, not streams', () => {
  assert.doesNotMatch(celebrate, /streams routed/)
  const d = {
    trackGoals: [{ progress: 14, target: 14, done: true }, { progress: 30, target: 10, done: true }, { progress: 2, target: 10, done: false }],
    albums: [{ done: true }, { done: false }],
    reconnect: { done: true, skipped: false },
  }
  assert.deepEqual(restoreCounts(d), { tracks: 2, hasTracks: true, albums: 1, hasAlbums: true, reconnect: 'completed' })
  assert.equal(restoreCounts({ ...d, reconnect: { done: true, skipped: true } }).reconnect, 'skipped')
  assert.equal(restoreCounts({ trackGoals: [] }).reconnect, null)
  // A snapshot without done flags falls back to progress vs target.
  assert.equal(restoreCounts({ trackGoals: [{ progress: 5, target: 5, done: null }, { progress: 1, target: 5, done: null }] }).tracks, 1)
  // The saved moment keeps what the summary needs.
  savePendingRestore('A9', { id: 'x-1', ...d }, 0.5)
  const snap = peekPendingRestore('A9', 'x-1')
  assert.deepEqual(restoreCounts(snap), restoreCounts(d))
})

test('Your Contributions: one request per district, cached, and opening a row never fetches', () => {
  const c = read('./district-contributions.js')
  assert.match(c, /if \(!pending\.has\(districtId\)\) \{/)
  assert.match(c, /if \(hit\) \{ cache\.set\(districtId, hit\); return hit \}/)
  assert.match(c, /head\.onclick = \(\) => setOpen\(more\.hidden\)/)
  assert.match(c, /<div class="yc-body">\$\{LOADING\}<\/div>/)
})
