// The landing ticker, checked as an artefact.
//
// Two classes of failure this guards:
//
// 1. A displayed total that overstates the real one. These numbers are a
//    public claim about how much a community has streamed, so the compact
//    formatting must floor — "441K" off 440,012 asserts a thousand streams
//    that have not happened.
// 2. The clarification line going missing. Nothing in this codebase knows
//    BTS's real Spotify or YouTube totals; every figure here is ReConnect's
//    own counted streams. Without "logged by agents on ReConnect" under
//    them, "440K ARIRANG STREAMS" on a public page could fairly be read as
//    a global count. That line is load-bearing and is asserted as such.
//
// It also pins the frontend side of the public-stats field removal: the
// markup and script must not reference districtsRestored, charge or their
// old element ids, which no longer exist in the API response.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { compact } from './compact-number.js'

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
const indexHtml = read('index.html')
const landingJs = read('js/landing.js')
const landingCss = read('css/landing.css')

/* ── Compact formatting ────────────────────────────────────────────────── */

test('compact floors and never overstates the real total', () => {
  assert.equal(compact(440012), '440K')
  assert.equal(compact(278428), '278K')
  // The boundary that matters: 440,999 must not become 441K.
  assert.equal(compact(440999), '440K')
  assert.equal(compact(440500), '440K')
})

test('compact handles the boundaries either side of each unit', () => {
  assert.equal(compact(0), '0')
  assert.equal(compact(999), '999')
  assert.equal(compact(1000), '1K')
  assert.equal(compact(1001), '1K')
  assert.equal(compact(999999), '999K')
  assert.equal(compact(1000000), '1M')
  assert.equal(compact(1284844), '1.2M')
  assert.equal(compact(1999999), '1.9M')
})

test('compact never returns a number the total has not reached', () => {
  for (const n of [1, 999, 1000, 12345, 99999, 440012, 999999, 1000000, 1284844, 9876543]) {
    const out = compact(n)
    const parsed = out.endsWith('M') ? parseFloat(out) * 1e6
      : out.endsWith('K') ? parseFloat(out) * 1000
      : Number(out)
    assert.ok(parsed <= n, `compact(${n}) = ${out} overstates the real total`)
  }
})

test('compact degrades to a dash rather than printing NaN', () => {
  for (const bad of [null, undefined, NaN, Infinity, -1]) {
    assert.equal(compact(bad), '—')
  }
})

/* ── Page structure ────────────────────────────────────────────────────── */

test('the landing page no longer mounts the dark-city map', () => {
  for (const gone of ['id="mapMount"', 'class="brief-map"', 'renderLandingMap']) {
    assert.ok(!indexHtml.includes(gone), `index.html still has ${gone}`)
  }
  assert.ok(!landingJs.includes('renderLandingMap'), 'landing.js still renders the landing map')
  // An actual import, not a mention — the file keeps a comment explaining
  // where the map went and why landing-map.js itself was left on disk.
  assert.doesNotMatch(landingJs, /^\s*import\s.*landing-map\.js/m, 'landing.js still imports the landing map')
})

test('the old brief section and its copy are gone', () => {
  assert.ok(!indexHtml.includes('id="brief"'))
  assert.ok(!indexHtml.includes('class="sec-lede"'))
  // The paragraph that explained the map went with it — the hero lede is the
  // only explanation the page needs, and nothing replaced this.
  assert.doesNotMatch(indexHtml, /Every district on this map went dark/)
  assert.doesNotMatch(indexHtml, /7 WARDS/i)
})

test('the hero scroll cue points at a section that actually exists', () => {
  // A dead anchor is the specific way removing a section breaks a page
  // quietly: the cue still animates, clicking it does nothing.
  const cue = indexHtml.match(/<a href="#([\w-]+)" class="scroll-cue"/)
  assert.ok(cue, 'the hero scroll cue is missing or no longer anchor-based')
  const target = cue[1]
  assert.notEqual(target, 'brief', 'the cue still points at the removed section')
  assert.ok(indexHtml.includes(`id="${target}"`), `#${target} does not exist on the page`)
})

test('the page below the hero is exactly activity, closing, footer', () => {
  const below = indexHtml.slice(indexHtml.indexOf('<main class="below">'))
  const sections = [...below.matchAll(/<(section|footer)\b[^>]*class="([^"]+)"/g)].map((m) => m[2])
  assert.deepEqual(sections, ['sec activity', 'sec closing', 'foot'])
})

/* ── The markup ────────────────────────────────────────────────────────── */

test('the ticker carries the three live stat slots', () => {
  for (const id of ['statAgents', 'statArirang', 'statRoad1B']) {
    assert.ok(indexHtml.includes(`id="${id}"`), `#${id} is missing from the ticker`)
  }
  assert.match(indexHtml, /ARIRANG STREAMS/)
  assert.match(indexHtml, /ROAD TO 1B STREAMS/)
})

test('each figure is grouped with the thing it counts so it cannot wrap away', () => {
  // Measured before this existed: at 400–480px "278K ROAD TO 1B STREAMS"
  // broke across a line, leaving a stranded "STREAMS" under the number. Each
  // segment is a nowrap unit; the LINE still reflows between segments.
  const items = indexHtml.match(/class="ticker-item"/g) || []
  assert.equal(items.length, 3, 'every ticker segment must be its own nowrap unit')
  assert.match(landingCss, /\.ticker-item\s*\{[^}]*white-space:\s*nowrap/)
  // Each stat id sits inside one of those units, not loose in the line.
  for (const id of ['statAgents', 'statArirang', 'statRoad1B']) {
    assert.match(indexHtml, new RegExp(`class="ticker-item">[^<]*<span id="${id}"`))
  }
})

test('the clarification line is present and says these are ReConnect streams', () => {
  assert.match(indexHtml, /class="ticker-note"/)
  assert.match(indexHtml, /logged by agents on ReConnect/)
  // And it is styled — a class with no rule would render as body text.
  assert.match(landingCss, /\.ticker-note\s*\{/)
})

test('no ticker number is hard-coded into the markup', () => {
  // The example values from the design (101 / 440K / 278K) describe one
  // moment of production state. Any of them appearing as literal text would
  // mean the page had stopped reporting and started asserting.
  const ticker = indexHtml.slice(indexHtml.indexOf('<div class="ticker">'), indexHtml.indexOf('</section>', indexHtml.indexOf('<div class="ticker">')))
  assert.doesNotMatch(ticker, /\b\d{2,}K\b/, 'a compacted figure is hard-coded in the ticker')
  assert.doesNotMatch(ticker, />\s*\d{2,}\s*</, 'a raw count is hard-coded in the ticker')
})

test('the CSS highlights the current stat ids, not the removed ones', () => {
  assert.match(landingCss, /#statArirang/)
  assert.match(landingCss, /#statRoad1B/)
  for (const gone of ['#statDistricts', '#statDistrictsTotal', '#statCharge']) {
    assert.ok(!landingCss.includes(gone), `${gone} still has a style rule`)
  }
})

test('the figures outrank their labels without becoming headings', () => {
  // The hierarchy is carried by size + colour only: no box, no border, no
  // icon, no second accent. If someone later drops the font-size, the totals
  // go back to reading exactly as weakly as the words next to them.
  const rule = landingCss.match(/\.ticker #statAgents[^}]*\}/)
  assert.ok(rule, 'the ticker figure rule is gone')
  const figure = parseFloat(rule[0].match(/font-size:\s*([\d.]+)px/)?.[1])
  const base = parseFloat(landingCss.match(/\.ticker \{[^}]*font-size:\s*([\d.]+)px/)?.[1])
  assert.ok(figure > base, `figures (${figure}px) must be larger than labels (${base}px)`)
  // Restraint: a status line, not a headline. Anything past ~1.35x is a
  // different design than the one that was approved.
  assert.ok(figure / base <= 1.35, `figures are ${(figure / base).toFixed(2)}x the label size — too loud`)
  assert.match(rule[0], /color:\s*var\(--text\)/)
  assert.doesNotMatch(rule[0], /border|box-shadow|background/)
})

test('the two remaining sections are spaced as one composed block', () => {
  // Removing the map left the activity readout and the call to action as the
  // only things below the hero. At the shared .sec padding plus a rule they
  // read as two unrelated slabs, so the gap closes and the divider goes.
  assert.match(landingCss, /\.sec\.activity\s*\{[^}]*padding-top/)
  assert.match(landingCss, /\.sec\.closing\s*\{[^}]*padding-top/)
  assert.match(landingCss, /\.sec\.activity\s*\+\s*\.sec\.closing\s*\{[^}]*border-top:\s*0/)
})

/* ── The removed public-stats fields ───────────────────────────────────── */

test('the landing page no longer references any removed public-stats field', () => {
  for (const gone of ['districtsRestored', 'districtsTotal', 's.charge', 's.multiplier', 's.wards']) {
    assert.ok(!landingJs.includes(gone), `landing.js still reads ${gone}`)
  }
  for (const gone of ['statDistricts', 'statDistrictsTotal', 'statCharge']) {
    assert.ok(!landingJs.includes(gone), `landing.js still references #${gone}`)
    assert.ok(!indexHtml.includes(gone), `index.html still has #${gone}`)
  }
})

test('landing.js reads the two campaign totals separately and never sums them', () => {
  assert.ok(landingJs.includes('arirangStreams'))
  assert.ok(landingJs.includes('roadTo1BStreams'))
  // SWIM is in both campaign totals, so adding them double-counts it by six
  // figures. There must be no combined figure anywhere in the render path.
  assert.doesNotMatch(landingJs, /arirangStreams\s*\+\s*s?\.?roadTo1BStreams/)
  assert.doesNotMatch(landingJs, /roadTo1BStreams\s*\+\s*s?\.?arirangStreams/)
})
