import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { moonReviewCount } from './moon-review-rules.js'
import { NAV_ICON_PATHS } from './nav-icons.js'

// Bottom navigation, phase 1 of the visual polish: one outline icon set, a
// still Moon tab, and a crimson dot that only this page load's own check can
// turn on. botz.html carries a hand copy of the bar and of the review rule,
// so most of what follows is about keeping the two copies honest.

const hud = readFileSync('js/ui-hud.js', 'utf8')
const css = readFileSync('css/reconnect.css', 'utf8')
const botz = readFileSync('botz.html', 'utf8')
const dot = readFileSync('js/moon-review-dot.js', 'utf8')

const ok = { success: true, partialHistory: false, trackCount: 40, flaggedCount: 0, excessStreamDays: [], possibleAlts: [] }
const CASES = [
  [null, 0],
  [{ success: false, error: 'Network error' }, 0],
  [{ ...ok }, 0],
  [{ ...ok, flaggedCount: 3 }, 3],
  [{ ...ok, flaggedCount: 3, partialHistory: true }, 0],
  [{ ...ok, flaggedCount: 2, trackCount: 0 }, 0],
  [{ ...ok, excessStreamDays: [{ date: '2026-10-09', streams: 900 }] }, 1],
  [{ ...ok, excessStreamDays: [{ date: '2026-10-09', streams: 900 }], partialHistory: true }, 0],
  [{ ...ok, possibleAlts: [{ via: 'Spotify', agentNo: 'AGENT118' }] }, 1],
  [{ ...ok, possibleAlts: [{ via: 'Spotify', agentNo: 'AGENT118' }], partialHistory: true }, 1],
  [{ ...ok, flaggedCount: 1, excessStreamDays: [{}], possibleAlts: [{}] }, 3],
  [{ ...ok, flaggedCount: 'not a number' }, 0],
  [{ ...ok, connection: 'failing' }, 0],
]

test('the review count follows what Moon Station marks for review, and nothing else', () => {
  for (const [res, want] of CASES) assert.equal(moonReviewCount(res), want, JSON.stringify(res))
})

test("botz.html's copy of the review rule gives the same answers", () => {
  const src = botz.match(/\/\* moon-review-rule:start \*\/([\s\S]*?)\/\* moon-review-rule:end \*\//)
  assert.ok(src, 'botz.html lost its marked copy of moonReviewCount')
  const ctx = {}
  vm.runInNewContext(`${src[1]}; this.moonReviewCount = moonReviewCount`, ctx)
  for (const [res, want] of CASES) assert.equal(ctx.moonReviewCount(res), want, JSON.stringify(res))
})

test('the dot is one background read per page load: no storage, no polling', () => {
  assert.doesNotMatch(dot, /localStorage|sessionStorage|indexedDB/, 'a remembered result must never be shown as current')
  assert.doesNotMatch(dot, /setInterval/)
  assert.match(dot, /requestIdleCallback/)
  assert.equal((dot.match(/call\('getMySelfCheck'/g) || []).length, 1)
  const botzScript = botz.slice(botz.indexOf('moon-review-rule:end'))
  assert.doesNotMatch(botzScript.slice(0, 1500), /localStorage|sessionStorage|setInterval/)
})

test('all seven tabs keep their destinations, with outline icons instead of emoji', () => {
  const tabs = hud.slice(hud.indexOf('const TABS = ['), hud.indexOf(']\n', hud.indexOf('const TABS = [')))
  for (const key of ['network', 'resources', 'candystar', 'botz', 'moonstation', 'ranking', 'settings']) {
    assert.match(tabs, new RegExp(`key: '${key}'`))
  }
  for (const icon of tabs.matchAll(/icon: '([^']*)'/g)) {
    assert.ok(NAV_ICON_PATHS[icon[1]], `no outline icon named ${icon[1]}`)
  }
  assert.doesNotMatch(tabs, /\p{Extended_Pictographic}/u)
})

test('Moon no longer pulses; labels never hide', () => {
  assert.doesNotMatch(hud, /hud-tab-beacon/)
  assert.doesNotMatch(css, /hud-tab-beacon|hudBeaconPulse/)
  assert.doesNotMatch(css, /\.hud-tab-lbl\s*\{\s*display:\s*none/)
  assert.doesNotMatch(css, /\.hud-tab-ico\s*\{[^}]*grayscale/)
  assert.doesNotMatch(botz, /\.botz-tab-lbl\s*\{\s*display:\s*none/)
})

test("botz.html's bar uses the same icons and the same seven destinations", () => {
  const bar = botz.slice(botz.indexOf('<div class="botz-tabs">'), botz.indexOf('</div>', botz.indexOf('<div class="botz-tabs">')))
  const svgs = [...bar.matchAll(/<svg[^>]*>([\s\S]*?)<\/svg>/g)].map((m) => m[1])
  assert.deepEqual(svgs, ['city', 'pack', 'candy', 'botz', 'moon', 'ranks', 'settings'].map((k) => NAV_ICON_PATHS[k]))
  for (const screen of ['world', 'resources', 'candystar', 'moon', 'ranking', 'settings']) {
    assert.match(bar, new RegExp(`href="game\\.html\\?screen=${screen}"`))
  }
  assert.doesNotMatch(bar, /\p{Extended_Pictographic}/u)
})
