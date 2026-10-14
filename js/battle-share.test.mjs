// MAMA Battle share: rules, poster drawing, the share sheet, the public
// /battle page, and the public summary the last two read.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  battleView, styleWeights, pickStyle, nextStyle, shareText, kstClock, STYLES, STYLE_NAMES, LYRICS, BATTLE_URL,
} from './battle-share-rules.js'
import { drawPoster } from './battle-poster.js'
import { shareSheet, votingScreen } from './voting-view.js'
import { votingStatus, votingLocal, FIXTURE_NOW } from './voting-fixtures.js'
import { battlePageHtml, battleUnavailableHtml, JOIN_URL } from './battle-page-view.js'
import { checkLyric, cleanLyric, LYRIC_MAX } from './battle-lyric-filter.js'
import { getPublicBattle } from '../supabase/functions/op-reconnect/lib/vote-campaign-service.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const NOW = new Date('2026-10-14T12:40:00Z') // 21:40 KST, Oct 14
const MS = [200, 500, 900, 1400, 2200]
function summary(h, a, extra = {}) {
  const total = h + a
  const milestones = MS.map((t) => ({ target: t, reached: total >= t }))
  const next = milestones.find((m) => !m.reached)
  return {
    success: true, campaign: { id: 'mama_2026', title: 'MAMA 2026', roundLabel: "Fans' Choice · Round 1" }, phase: 'open',
    closesAt: '2026-10-22T23:59:59+09:00', freezeAt: '2026-10-23T12:00:00+09:00',
    teams: [{ id: 'hooligans', label: 'HOOLIGANS', points: h }, { id: 'aliens', label: 'ALIENS', points: a }],
    total, milestones, next: next ? { target: next.target, remaining: next.target - total } : null,
    winners: null, updatedAt: NOW.toISOString(), ...extra,
  }
}

// ── rules ─────────────────────────────────────────────────────────

test('view: one status line for lead, tie and winner; gift and footer', () => {
  const v = battleView(summary(652, 611), NOW)
  assert.equal(v.status, 'HOOLIGANS +41')
  assert.equal(v.leader, 'hooligans')
  assert.equal(v.gift, 'Next Battle Gift at 1,400 · 137 to go')
  assert.equal(v.footer, 'Live · 21:40 KST · hopetrackers.org/battle')
  assert.equal(v.cta, 'PICK A SIDE →')
  assert.equal(v.gapLine, '41 VOTES APART')
  assert.deepEqual(v.posterCta, ['PICK A SIDE.', 'VOTE FOR BTS.'])
  assert.equal(v.liveLine, 'LIVE · 21:40 KST')
  assert.equal(battleView(summary(612, 611), NOW).gapLine, '1 VOTE APART')
  assert.equal(battleView(summary(588, 641), NOW).status, 'ALIENS +53')
  const tie = battleView(summary(702, 702), NOW)
  assert.equal(tie.status, 'TIED AT 702')
  assert.equal(tie.leader, null)
  assert.deepEqual(tie.statusParts, ['TIED AT', '702'])
  assert.equal(tie.gapLine, 'TIED AT 702')
  const won = battleView(summary(1104, 1071, { phase: 'final', winners: ['hooligans'] }), NOW)
  assert.equal(won.status, 'HOOLIGANS WIN')
  assert.equal(won.cta, 'SEE THE BATTLE →')
  assert.equal(won.gapLine, 'HOOLIGANS WIN BY 33')
  assert.equal(won.liveLine, 'FINAL · 21:40 KST')
  assert.equal(battleView(summary(1300, 1000), NOW).gift, 'All Battle Gifts unlocked')
  assert.equal(kstClock('2026-10-13T15:00:00Z'), '00:00')
})

test('style weights: tied/close prefer A1/A2, large lead and final 24h prefer A3, normal is even', () => {
  assert.deepEqual(styleWeights(battleView(summary(702, 702), NOW)), { V1: 0.45, V2: 0.45, V3: 0.1 })
  assert.deepEqual(styleWeights(battleView(summary(655, 650), NOW)), { V1: 0.45, V2: 0.45, V3: 0.1 }, 'very close')
  assert.deepEqual(styleWeights(battleView(summary(800, 600), NOW)), { V1: 0.2, V2: 0.2, V3: 0.6 }, 'large lead')
  const last = battleView(summary(652, 611), new Date('2026-10-22T05:00:00Z'))
  assert.equal(last.finalHours, true)
  assert.deepEqual(styleWeights(last), { V1: 0.2, V2: 0.2, V3: 0.6 }, 'final 24 hours')
  const normal = styleWeights(battleView(summary(652, 611), NOW))
  assert.ok(STYLES.every((s) => Math.abs(normal[s] - 1 / 3) < 1e-9))
  for (const v of [battleView(summary(702, 702), NOW), battleView(summary(800, 600), NOW)]) {
    const sum = Object.values(styleWeights(v)).reduce((a, b) => a + b, 0)
    assert.ok(Math.abs(sum - 1) < 1e-9)
  }
})

test('first pick follows the weights; Try another style cycles every style', () => {
  const big = battleView(summary(800, 600), NOW)
  assert.equal(pickStyle(big, 0.1), 'V1')
  assert.equal(pickStyle(big, 0.3), 'V2')
  assert.equal(pickStyle(big, 0.41), 'V3')
  assert.equal(pickStyle(big, 0.999999), 'V3')
  assert.equal(pickStyle(battleView(summary(702, 702), NOW), 0.95), 'V3', 'V3 still reachable when tied')
  assert.deepEqual([nextStyle('V1'), nextStyle('V2'), nextStyle('V3')], ['V2', 'V3', 'V1'])
  assert.deepEqual(Object.keys(STYLE_NAMES), STYLES)
})

test('share text: approved copy, live scores, the public link only', () => {
  assert.equal(shareText(battleView(summary(652, 611), NOW)),
    'MAMA Battle is live 🔥\nHOOLIGANS 652 vs ALIENS 611\nPick a side. Vote for BTS. Move the score.\nhttps://hopetrackers.org/battle')
  assert.match(shareText(battleView(summary(1404, 1290), NOW)), /HOOLIGANS 1,404 vs ALIENS 1,290/)
  assert.equal(BATTLE_URL, 'https://hopetrackers.org/battle')
  assert.doesNotMatch(read('./battle-share-rules.js'), /agentNo|agent_no|handle|\?ref=|\?a=/, 'no personal data can reach the link')
})

// ── poster drawing (fake 2D context records every word and mark) ──

function fakeCtx() {
  const words = []
  const marks = { bezier: 0, stroke: 0, arc: 0 }
  let font = '10px x'
  return {
    words, marks, letterSpacing: '0px', fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', textAlign: '', textBaseline: '',
    set font(f) { font = f }, get font() { return font },
    measureText: (s) => ({ width: String(s).length * Number(/(\d+)px/.exec(font)?.[1] || 10) * 0.6 }),
    fillText(s, x, y) { words.push({ s, x, y, font }) },
    fillRect() {}, beginPath() {}, moveTo() {}, arcTo() {}, closePath() {}, fill() {}, save() {}, restore() {}, translate() {}, rotate() {},
    stroke() { marks.stroke++ }, arc() { marks.arc++ }, bezierCurveTo() { marks.bezier++ },
  }
}
const draw = (style, sum, lines = LYRICS) => { const ctx = fakeCtx(); drawPoster(ctx, style, battleView(sum, NOW), lines); return ctx }

test('every colourway carries exactly the approved structure — and no Battle Gift', () => {
  for (const s of STYLES) {
    for (const sum of [summary(652, 611), summary(702, 702), summary(1104, 1071)]) {
      const ctx = draw(s, sum)
      const v = battleView(sum, NOW)
      const all = ctx.words.map((w) => w.s).join(' | ')
      for (const need of ['MAMA BATTLE', 'HOOLIGANS', 'ALIENS', v.gapLine, 'PICK A SIDE.', 'VOTE FOR BTS.', 'hopetrackers.org/battle', 'LIVE · 21:40 KST',
        `“${LYRICS.hooligans}”`, `“${LYRICS.aliens}”`]) assert.ok(all.includes(need), `${s}: ${need}`)
      assert.ok(all.includes(v.h.points.toLocaleString('en-US')) && all.includes(v.a.points.toLocaleString('en-US')), `${s}: scores`)
      assert.doesNotMatch(all, /Battle Gift|Next|Unofficial|agent|AGENT\d/i, `${s}: nothing extra on the poster`)
      for (const w of ctx.words) assert.ok(w.x >= 0 && w.y > 0 && w.y < 1350, `${s}: '${w.s}' inside the canvas`)
    }
  }
})

test('one handmade touch per colourway; the leader star disappears when tied', () => {
  assert.ok(draw('V1', summary(652, 611)).marks.bezier > 0, 'V1 star on the leader')
  assert.equal(draw('V1', summary(702, 702)).marks.bezier, 0, 'tied: no leader star')
  assert.equal(draw('V1', summary(1104, 1071, { phase: 'final', winners: ['hooligans'] })).marks.bezier, 0)
  const v2 = draw('V2', summary(652, 611))
  assert.equal(v2.marks.stroke, 1, 'V2: one scribble under the gap')
  assert.equal(draw('V2', summary(702, 702)).marks.stroke, 1, 'V2 scribble is not about the leader, so it stays')
  const v3 = draw('V3', summary(702, 702))
  assert.ok(v3.words.some((w) => w.s === 'LIVE'), 'V3: the LIVE sticker')
  assert.equal(v3.marks.bezier + v3.marks.stroke, 0, 'V3: nothing else hand-drawn')
})

test('custom team lines: drawn as typed, one line or two, never more', () => {
  const short = draw('V1', summary(652, 611), { hooligans: 'Lets go!', aliens: 'We landed.' })
  assert.ok(short.words.some((w) => w.s === '“Lets go!”  ·  “We landed.”'), 'short lines share one line')
  const long = draw('V2', summary(652, 611), { hooligans: 'x'.repeat(40), aliens: 'y'.repeat(40) })
  const lineWords = long.words.filter((w) => w.s.startsWith('“'))
  assert.equal(lineWords.length, 2, 'two long lines: one line each')
  assert.ok(lineWords.every((w) => w.y > 980 && w.y < 1100), 'and they stay between the gap and the call to action')
})

// ── share sheet markup ────────────────────────────────────────────

const vm = (share) => ({ status: votingStatus({ battle: 'hooligans' }), local: { ...votingLocal({}), share }, now: FIXTURE_NOW })
const ready = { style: 'A2', styleName: 'Fan edit', styleIndex: 2, clock: '21:40', url: 'blob:poster', alt: 'MAMA Battle poster', canFiles: true }

test('battle section has Share battle; the sheet is exactly the approved layout', () => {
  const screen = votingScreen(vm(null))
  assert.match(screen, /data-vt-act="battle-share"[^>]*>[\s\S]*?Share battle/)
  const html = shareSheet(vm(ready))
  assert.match(html, /role="dialog" aria-modal="true"[^>]*data-vt-sheet="share"/)
  assert.match(html, /A snapshot of the score at 21:40 KST\. The link always shows the live score\./)
  assert.match(html, /<img class="vt-share-img" src="blob:poster"/)
  assert.match(html, /<b>Fan edit<\/b><span>Style 2 of 3<\/span>/)
  assert.match(html, /data-vt-act="share-go"[^>]*>[\s\S]*?Share poster/)
  assert.match(html, /data-vt-act="share-style"[^>]*>[\s\S]*?Try another style/)
  const row = html.slice(html.indexOf('vt-share-row'))
  assert.deepEqual([...row.matchAll(/data-vt-act="(share-[a-z]+)"/g)].map((m) => m[1]), ['share-save', 'share-link', 'share-text'])
  assert.match(row, /Save poster[\s\S]*Copy link[\s\S]*Copy text/)
  assert.doesNotMatch(html, /isn’t available/, 'no fallback line when images can be shared')
})

test('sheet: in-app fallback is one neutral line and Share link; hold-to-save; loading and error', () => {
  const fb = shareSheet(vm({ ...ready, canFiles: false }))
  assert.match(fb, /class="vt-share-note">[\s\S]*Image sharing isn’t available in this browser\.<\/p>/)
  assert.match(fb, /data-vt-act="share-go"[^>]*>[\s\S]*?Share link/)
  assert.doesNotMatch(fb, /is-err|is-warn/, 'neutral, not a warning')
  assert.match(shareSheet(vm({ ...ready, canFiles: false, hold: true })), /Press and hold the poster to save it\./)
  const loading = shareSheet(vm({ loading: true }))
  assert.match(loading, /vt-spin/)
  assert.match(loading, /data-vt-act="share-go" disabled/)
  assert.doesNotMatch(loading, /data-vt-act="share-link" disabled/, 'Copy link works even before the poster')
  assert.match(shareSheet(vm({ error: true })), /Couldn't load the battle score/)
})

test('share flow: snapshot per opening, style changes never refetch, only the public link', () => {
  const src = read('./voting.js')
  const open = src.slice(src.indexOf('async function openShare'), src.indexOf('async function showStyle'))
  const style = src.slice(src.indexOf('async function showStyle'), src.indexOf('async function shareGo'))
  assert.match(open, /call\('getPublicBattle'\)/)
  assert.doesNotMatch(style, /call\(/, 'Try another style only redraws the snapshot')
  const flow = read('./battle-share-flow.js')
  assert.match(flow, /navigator\.share\(\{ files: \[file\], title: 'MAMA Battle', text \}\)/)
  assert.match(flow, /url: BATTLE_URL/)
  assert.match(flow, /return \(await copyText\(BATTLE_URL\)\) \? 'copied' : 'failed'/, 'no share at all → copy the link')
})

// ── public page ───────────────────────────────────────────────────

test('public page: scores, leader, gap, total, next gift, time left, Join the Battle', () => {
  const html = battlePageHtml(summary(652, 611), NOW)
  assert.match(html, /HOOLIGANS<span class="bp-badge">LEADS \+41<\/span>[\s\S]*data-bp-score="hooligans">652</)
  assert.match(html, /data-bp-score="aliens">611</)
  assert.match(html, /Community votes<b>1,263<\/b>/)
  assert.match(html, /Time left<b>8d 2h<\/b>/)
  assert.match(html, /Next Battle Gift · 1,400 <span>137 to go<\/span>/)
  assert.match(html, new RegExp(`href="${JOIN_URL.replace('?', '\\?')}"[^>]*>[\\s\\S]*?Join the Battle`))
  assert.equal(JOIN_URL, '/game?screen=voting', 'onboarding keeps ?screen=voting, then the 7-second chooser runs')
  assert.match(html, /Unofficial ARMY fan project · Scores are verified ReConnect votes/)
  assert.match(battlePageHtml(summary(702, 702), NOW), /TIED AT 702/)
  assert.match(battlePageHtml(summary(1104, 1071, { phase: 'final', winners: ['hooligans'] }), NOW), /WINNER/)
  assert.match(battleUnavailableHtml('none'), /no MAMA Battle running/)
  assert.match(read('../battle.html'), /<link rel="canonical" href="https:\/\/hopetrackers\.org\/battle">/)
  assert.match(read('../vite.config.js'), /battle: resolve\(__dirname, 'battle\.html'\)/)
})

test('voting deep link is still honoured by the router', () => {
  assert.match(read('./router.js'), /DEEP_LINKABLE = new Set\(\[[^\]]*'voting'/)
  assert.match(read('./api.js'), /'getPublicBattle'/, 'callable without a session')
})

// ── public summary: privacy and the shared cache ──────────────────

const CAMPAIGN = {
  id: 'mama_2026', title: 'MAMA 2026', round_label: "Fans' Choice · Round 1", opens_at: '2026-10-12T10:00:00Z', closes_at: '2026-10-22T14:59:59Z',
  battle: { enabled: true, freeze_at: '2026-10-23T12:00:00+09:00', teams: [{ id: 'hooligans', label: 'HOOLIGANS' }, { id: 'aliens', label: 'ALIENS' }], milestones: MS },
}
function db(rpcCalls) {
  const q = { select: () => q, eq: () => q, order: () => q, limit: () => Promise.resolve({ data: [CAMPAIGN] }) }
  return {
    from: () => q,
    rpc: async (name, args) => { rpcCalls.push([name, args]); return { data: { teams: { hooligans: 652, aliens: 611 }, total: 1263, frozen: false, teamSizes: { hooligans: 40, aliens: 39 }, mine: 9 } } },
  }
}

test('getPublicBattle: team totals from the shared cache, nothing about any agent', async () => {
  const calls = []
  const keys = []
  const cache = async (key, ttl, f) => { keys.push([key, ttl]); return f() }
  const r = await getPublicBattle(db(calls), NOW, { cache })
  assert.deepEqual(keys, [['vote_battle:mama_2026', 60000]], 'same cache row as the City banner')
  assert.deepEqual(calls[0], ['rc_campaign_battle_state', { p_campaign_id: 'mama_2026', p_agent_no: '' }])
  assert.deepEqual(Object.keys(r).sort(), ['campaign', 'closesAt', 'freezeAt', 'milestones', 'next', 'phase', 'success', 'teams', 'total', 'updatedAt', 'winners'])
  assert.deepEqual(r.teams, [{ id: 'hooligans', label: 'HOOLIGANS', points: 652 }, { id: 'aliens', label: 'ALIENS', points: 611 }])
  assert.deepEqual(r.next, { target: 1400, remaining: 137 })
  assert.equal(r.winners, null)
  const json = JSON.stringify(r)
  for (const banned of ['teamSizes', 'mine', 'agent', 'AGENT', 'handle', 'proof', 'certificate']) assert.ok(!json.includes(banned), banned)
  const hit = await getPublicBattle(db([]), NOW, { cache: async () => ({ teams: { hooligans: 1, aliens: 2 }, total: 3, frozen: false, at: '2026-10-14T12:39:00Z' }) })
  assert.equal(hit.updatedAt, '2026-10-14T12:39:00Z', 'the cached score time is shown, not the request time')
  assert.match(read('../supabase/functions/op-reconnect/index.ts'), /getPublicBattle: \{ auth: 'public'/)
})

// ── custom team lines: safety filter ──────────────────────────────

test('team lines: friendly text and playful banter pass, cleaned to one line', () => {
  for (const ok of ['Watch this.', 'Yeah, we aliens.', 'Lets gooo hooligans!!', 'ALIENS landed 🛸', 'For BTS, every day', 'Jimin would vote twice', 'ARMY bomb up 💜',
    'ride or die', 'aliens are trash', 'hooligans who? losers', 'stupid fast voting', 'we are killing it', 'I hate losing', 'kill the vote count', 'my therapist votes too', 'torpedo energy'])
    assert.equal(checkLyric(ok).ok, true, ok)
  assert.equal(cleanLyric('  two' + String.fromCharCode(10) + 'lines' + String.fromCharCode(0x200b) + ' here  '), 'two lines here')
  assert.deepEqual(checkLyric(''), { ok: true, value: '' }, 'empty means the default line')
  assert.equal(checkLyric('a'.repeat(LYRIC_MAX)).ok, true)
  assert.equal(checkLyric('a'.repeat(LYRIC_MAX + 1)).reason, 'too_long')
})

test('team lines: no links, @handles or hashtags', () => {
  for (const bad of ['go to bit.ly/abc', 'https://x.com', 'www.site.com', 'vote at example.com', 'follow @someone', '#2026MAMAVOTE', 'hey＠you'])
    assert.equal(checkLyric(bad).reason, 'link', bad)
})

test('team lines: slurs, explicit sexual content and serious threats are refused, l33t too', () => {
  for (const bad of ['tranny', 'f4gg0t', 'heil hitler', 'n*gg', 'nudes', 'p0rn', 'send nudes', 'horny',
    'kill them', 'kill yourself', 'kys', 'go die', 'aliens should die', 'i will hurt', 'death to hooligans', 'bomb them'])
    assert.equal(checkLyric(bad).reason, 'blocked', bad)
})

test('team lines: nothing that pretends to come from BTS, HYBE, Mnet or HopeTrackers', () => {
  for (const bad of ['Official BTS message', 'from HYBE', 'Mnet says vote', "I'm Jimin, vote!", 'This is RM', 'BTS here: vote hooligans', 'HopeTrackers announcement', 'love, Jungkook'])
    assert.equal(checkLyric(bad).reason, 'impersonation', bad)
})

// ── custom team lines: the sheet ──────────────────────────────────

test('sheet: two line fields with live counters and Reset to default', () => {
  const html = shareSheet(vm({ ...ready, drafts: { hooligans: 'Lets go!', aliens: '' }, errors: { aliens: 'link' } }))
  assert.match(html, /data-vt-lyric="hooligans" maxlength="40" value="Lets go!" placeholder="Watch this\."/)
  assert.match(html, /data-vt-lyric="aliens" maxlength="40" value="" placeholder="Yeah, we aliens\."/)
  assert.match(html, /data-vt-count="hooligans"[^>]*>8\/40</)
  assert.match(html, /data-vt-count="aliens"[^>]*>0\/40</)
  assert.match(html, /vt-share-field is-err[\s\S]*Links, @handles and hashtags can’t go on the poster\./)
  assert.match(html, /data-vt-act="share-lines-reset"[^>]*>Reset to default</)
  assert.doesNotMatch(shareSheet(vm({ loading: true })), /data-vt-lyric=/, 'fields only once a poster exists')
})

test('flow: typing redraws the preview only — no fetch, no server, kept across styles', () => {
  const src = read('./voting.js')
  const typing = src.slice(src.indexOf('function onLineInput'), src.indexOf('function resetLines'))
  assert.doesNotMatch(typing, /call\(/, 'never refetches')
  assert.doesNotMatch(typing, /paint\(\)/, 'no full repaint while typing (the caret stays)')
  assert.match(typing, /checkLyric\(input\.value\)/)
  assert.match(src, /const posterKey = \(style, lines\) => `\$\{style\}\|\$\{lines\.hooligans\}\|\$\{lines\.aliens\}`/, 'posters cached per style + lines')
  assert.match(src, /lines: \{ hooligans: '', aliens: '' \}, drafts:/, 'lines live in the share snapshot, which closing the sheet throws away')
  assert.doesNotMatch(read('./battle-share-flow.js') + read('./battle-share-rules.js'), /hooligans:.*draft|lines\./, 'custom lines never reach the share text or link')
})

test('voting inputs (X post link, handle, team lines) are 16px so iOS never zooms', () => {
  const css = read('../css/voting.css')
  assert.match(css, /\.vt-screen \.vt-input \{ font-size: 16px; \}/)
  assert.ok(css.indexOf('.vt-screen .vt-input { font-size: 16px; }') > css.indexOf('.vt-screen button, .vt-screen input { font: inherit;'), 'declared after the inherit rule')
})
