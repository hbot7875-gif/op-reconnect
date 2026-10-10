import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Rankings typography, phase 4 of the visual polish. Orbitron keeps the
// screen title; every other piece of text on the board is the body sans in
// sentence case, untracked, 11px or larger. These pin that so tracked mono
// metadata can't creep back, and pin the data path so a type change can't
// alter what the board shows.

const read = (f) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const css = read('css/reconnect.css')
const ranking = read('js/screen-ranking.js')
const block = css.slice(css.indexOf('/* ── Rankings ─'), css.indexOf('/* ── VMA Voting Mission'))
  .replace(/\/\*[\s\S]*?\*\//g, '')
// every declaration block, with its selector, inside the Rankings section
const rules = [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }))
const isTitle = (sel) => /\.pack-eyebrow|\.pack-name/.test(sel)

test('Rankings text never uses the mono face', () => {
  for (const r of rules) assert.doesNotMatch(r.body, /var\(--mono\)/, r.sel)
})

test('no uppercase or tracked metadata outside the Orbitron title', () => {
  for (const r of rules) {
    if (isTitle(r.sel)) continue
    assert.doesNotMatch(r.body, /text-transform:\s*uppercase/, r.sel)
    for (const m of r.body.matchAll(/letter-spacing:\s*([0-9.]+)(px|em)?/g)) {
      assert.ok(Number(m[1]) === 0, `${r.sel} letter-spacing ${m[0]}`)
    }
  }
})

test('nothing on the board is set below 11px', () => {
  for (const r of rules) {
    for (const m of r.body.matchAll(/font-size:\s*([0-9.]+)px/g)) {
      assert.ok(Number(m[1]) >= 11, `${r.sel} font-size ${m[1]}px`)
    }
  }
})

test('tabs, names, levels, places and XP are the body sans; numbers are tabular', () => {
  const body = (sel) => rules.filter((r) => r.sel === sel).map((r) => r.body).join(';')
  assert.match(body('.rank-tab'), /font-family: var\(--body\)/)
  assert.match(body('.rank-place'), /font-family: var\(--body\)[^;]*;[\s\S]*tabular-nums/)
  assert.match(body('.rank-xp'), /font-family: var\(--body\)[\s\S]*tabular-nums/)
  assert.match(body('.rank-xp-unit'), /font-size: 11px[\s\S]*text-transform: none/)
  assert.match(body('.rank-you'), /var\(--body\)/)
  assert.match(body('.rank-name'), /font-weight: 600/)
  assert.match(body('.rank-sub'), /font-size: 13px/)
  assert.match(ranking, /<span class="rank-xp-unit">total XP<\/span>/)
})

test('the title stays Orbitron', () => {
  const title = rules.find((r) => r.sel === '.rank-screen .pack-eyebrow')
  assert.ok(title, 'mobile title rule missing')
  assert.match(title.body, /font-family: var\(--disp\)/)
})

test('the leaderboard data path is unchanged', () => {
  assert.match(ranking, /call\('getLeaderboard', \{ agentNo: getAgentNo\(\) \}\)/)
  assert.match(ranking, /const rows = activeTab === 'all' \? agents : agents\.filter\(\(a\) => a\.mode === activeTab\)/)
  assert.match(ranking, /<span class="rank-xp">\$\{a\.xp\.toLocaleString\(\)\} <span class="rank-xp-unit">total XP<\/span><\/span>/)
})
