import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Rankings and "Now restoring", phases 2 and 3 of the visual polish. Visual
// only: these pin the look so it can't drift back, and pin the data path so
// a visual change can't quietly alter what the board shows.

// Line endings normalised: a Windows checkout has CRLF, the deploy build LF.
const read = (f) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const ranking = read('js/screen-ranking.js')
const css = read('css/reconnect.css')
const rankCss = css.slice(css.indexOf('/* ── Rankings ─'), css.indexOf('/* ── VMA Voting Mission'))
// The rule's own comment explains why gold is gone, so judge the declarations only.
const meter = css.match(/\.op-meter-fill \{[^}]*\}/)[0].replace(/\/\*[\s\S]*?\*\//g, '')

test('places are numbers, with the top three marked by class, not emoji medals', () => {
  assert.doesNotMatch(ranking, /🥇|🥈|🥉|MEDAL/)
  assert.match(ranking, /is-top is-p\$\{place\}/)
  assert.match(ranking, /<span class="rank-place"[^>]*>\$\{place\}<\/span>/)
})

test('the title uses the nav outline icon, not an emoji', () => {
  assert.match(ranking, /rank-title-icon" aria-hidden="true">\$\{navIcon\('ranks'\)\}/)
  assert.doesNotMatch(ranking, /🏆/)
})

test('"You" is its own chip, so a long codename cannot truncate it away', () => {
  assert.match(ranking, /<span class="rank-you">You<\/span>/)
  assert.doesNotMatch(rankCss, /content:\s*' · YOU'/)
  assert.match(rankCss, /\.rank-name \{ min-width: 0;[^}]*text-overflow: ellipsis/)
  assert.match(rankCss, /\.rank-you \{ flex: none;/)
})

test('no gradients anywhere on the board; gold only on medals', () => {
  assert.doesNotMatch(rankCss, /gradient\(/)
  for (const rule of rankCss.match(/\.rank-xp \{[^}]*\}/g)) assert.doesNotMatch(rule, /gold|217,\s*173,\s*95/)
  for (const n of [1, 2, 3]) assert.match(rankCss, new RegExp(`\\.rank-row\\.is-p${n} \\.rank-agent-icon \\{ border: 2px solid`))
})

test('the leaderboard data path is unchanged', () => {
  assert.match(ranking, /call\('getLeaderboard', \{ agentNo: getAgentNo\(\) \}\)/)
  assert.match(ranking, /const rows = activeTab === 'all' \? agents : agents\.filter\(\(a\) => a\.mode === activeTab\)/)
  assert.match(ranking, /rows\.forEach\(\(a, i\) => \{\n\s*const place = i \+ 1/)
})

test('"Now restoring" is flat purple with no glow', () => {
  assert.doesNotMatch(meter, /gradient\(|gold/)
  // --v-violet is the same #8b5cf6 as --purple, on the shared token set (phase 5A).
  assert.match(meter, /background: var\(--v-violet\); box-shadow: none;/)
})
