// MAMA Event Hub — the paced battle moments, the Team and Chat markup, the
// server's shaping of what reaches a phone, and the wiring. The SQL side
// (own-team roster, slow mode, report thresholds, mutes) is
// supabase/functions/op-reconnect/lib/battle-hub-sql.test.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decideMoments, collapseMoments, instagramUrl, LEAD_HOLD_MS, LEAD_GAP_MS } from '../supabase/functions/op-reconnect/lib/battle-hub-rules.js'
import {
  teamPanel, chatPanel, chatFeed, chatMessageSheet, chatReportSheet, liveStrip, hubTabs, momentsCard, chatLock, chatErrorText, chatFab, chatSheet,
} from './battle-hub-view.js'
import {
  getBattleTeam, getBattleChat, sendBattleChat, reactBattleChat, reportBattleChat, muteBattleChat, setBattleInstagram,
} from '../supabase/functions/op-reconnect/lib/battle-hub-service.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const LABELS = { hooligans: 'HOOLIGANS', aliens: 'ALIENS' }
const teams = (h, a) => [{ id: 'hooligans', label: 'HOOLIGANS', points: h }, { id: 'aliens', label: 'ALIENS', points: a }]
const T0 = new Date('2026-10-16T05:00:00Z')
const at = (ms) => new Date(T0.getTime() + ms)
const CLOSES = '2026-10-22T14:59:59Z'

// ── Moments ──────────────────────────────────────────────────────────

test('moments: the first check records the leader without announcing it', () => {
  const r = decideMoments({}, { teams: teams(10, 5), total: 15, closesAt: CLOSES }, T0)
  assert.deepEqual(r.inserts, [])
  assert.equal(r.state.lead, 'hooligans')
})

test('moments: a new lead must hold 2 minutes, then announces once; flapping is quiet', () => {
  let s = decideMoments({}, { teams: teams(10, 5), total: 15, closesAt: CLOSES }, T0).state
  let r = decideMoments(s, { teams: teams(10, 12), total: 22, closesAt: CLOSES }, at(30_000))
  assert.deepEqual(r.inserts, [], 'just changed: wait')
  s = r.state
  r = decideMoments(s, { teams: teams(10, 13), total: 23, closesAt: CLOSES }, at(30_000 + LEAD_HOLD_MS - 1))
  assert.deepEqual(r.inserts, [], 'not held long enough')
  r = decideMoments(r.state, { teams: teams(10, 14), total: 24, closesAt: CLOSES }, at(30_000 + LEAD_HOLD_MS))
  assert.deepEqual(r.inserts, [{ key: `lead:aliens:${at(30_000).toISOString()}`, team: 'aliens', body: 'ALIENS TOOK THE LEAD' }])
  const again = decideMoments(r.state, { teams: teams(10, 15), total: 25, closesAt: CLOSES }, at(30_000 + LEAD_HOLD_MS + 60_000))
  assert.deepEqual(again.inserts, [], 'announced once')
  // Back to HOOLIGANS, held — but inside the 10-minute gap: wait for it.
  let s2 = decideMoments(again.state, { teams: teams(20, 15), total: 35, closesAt: CLOSES }, at(4 * 60_000)).state
  const early = decideMoments(s2, { teams: teams(21, 15), total: 36, closesAt: CLOSES }, at(7 * 60_000))
  assert.deepEqual(early.inserts, [], 'held, but too soon after the last announcement')
  const late = decideMoments(early.state, { teams: teams(22, 15), total: 37, closesAt: CLOSES }, at(30_000 + LEAD_HOLD_MS + LEAD_GAP_MS))
  assert.equal(late.inserts.length, 1)
  assert.equal(late.inserts[0].body, 'HOOLIGANS TOOK THE LEAD')
  s2 = late.state
  assert.equal(s2.lead, 'hooligans')
})

test('moments: a held tie, gift countdown bands, final hours — each once by key', () => {
  let s = decideMoments({}, { teams: teams(10, 5), total: 15, closesAt: CLOSES }, T0).state
  s = decideMoments(s, { teams: teams(9, 9), total: 18, closesAt: CLOSES }, at(1000)).state
  const tie = decideMoments(s, { teams: teams(9, 9), total: 18, closesAt: CLOSES }, at(1000 + LEAD_HOLD_MS))
  assert.equal(tie.inserts[0].body, 'THE BATTLE IS TIED')
  assert.match(tie.inserts[0].key, /^tie:/)
  const gift = (remaining) => decideMoments({ init: true, lead: 'hooligans', cand: 'hooligans', candSince: T0.toISOString() },
    { teams: teams(10, 5), total: 15, next: { target: 2200, remaining }, closesAt: CLOSES }, T0).inserts
  assert.deepEqual(gift(26), [])
  assert.deepEqual(gift(25), [{ key: 'gift:2200:25', team: null, body: '25 VOTES TO THE NEXT BATTLE GIFT' }])
  assert.deepEqual(gift(5), [{ key: 'gift:2200:5', team: null, body: '5 VOTES TO THE NEXT BATTLE GIFT' }])
  assert.equal(gift(1)[0].body, '1 VOTE TO THE NEXT BATTLE GIFT')
  const fin = (hoursLeft) => decideMoments({}, { teams: [], total: 0, closesAt: new Date(T0.getTime() + hoursLeft * 3600_000).toISOString() }, T0).inserts
  assert.deepEqual(fin(25), [])
  assert.deepEqual(fin(23).map((x) => x.key), ['final:24'])
  assert.deepEqual(fin(2.5).map((x) => [x.key, x.body]), [['final:3', 'FINAL 3 HOURS OF VOTING']])
  assert.deepEqual(fin(0.5).map((x) => x.body), ['FINAL HOUR OF VOTING'])
  assert.deepEqual(fin(-1), [], 'nothing after voting closes')
})

test('Chat never shows two moments in a row; Instagram links only for real usernames', () => {
  const m = (id, kind) => ({ id, kind })
  assert.deepEqual(collapseMoments([m(1, 'player'), m(2, 'system'), m(3, 'system'), m(4, 'player'), m(5, 'system')]).map((x) => x.id), [1, 3, 4, 5])
  assert.equal(instagramUrl('gold_jk'), 'https://instagram.com/gold_jk')
  assert.equal(instagramUrl('@moon.child'), 'https://instagram.com/moon.child')
  for (const bad of ['', null, 'a b', 'x/../y', 'javascript:alert(1)', 'a'.repeat(31)]) assert.equal(instagramUrl(bad), null, String(bad))
})

// ── Team view ────────────────────────────────────────────────────────

const TEAM = {
  success: true, team: 'hooligans', showIg: false, count: 34, online: 9,
  members: [
    { codename: 'Moonchild', ig: null, today: 4, me: true },
    { codename: 'Dalmajung', ig: null, today: 0, me: false },
    { codename: 'Golden Hour', ig: 'goldenhour_jk', today: 6, me: false },
  ],
}

test('Team: codename, opt-in Instagram link, votes today (4/6), and only counts at the top', () => {
  const html = teamPanel(TEAM, { labels: LABELS })
  assert.match(html, /Only HOOLIGANS can see this/)
  assert.match(html, /<b>34<\/b> members<\/span><span><b>9<\/b> online now/)
  assert.match(html, /HOOLIGANS only · this event · on by default/, 'compact switch, on by default')
  assert.match(html, /Moonchild<span class="vt-mem-you">YOU<\/span>/)
  assert.match(html, /<a class="vt-mem-ig" href="https:\/\/instagram\.com\/goldenhour_jk" target="_blank" rel="noopener noreferrer">/)
  assert.equal((html.match(/vt-mem-ig/g) || []).length, 1, 'no link for members who did not opt in')
  assert.match(html, /<span class="vt-mem-score" aria-label="4 of 6 verified votes today">4<small>\/6<\/small><\/span>/)
  assert.match(html, /<span class="vt-mem-score is-zero" aria-label="0 of 6 verified votes today">0<small>\/6<\/small>/)
  assert.match(teamPanel(TEAM, { labels: LABELS, max: 4 }), />6<small>\/4<\/small>/, 'the maximum comes from the day’s missions')
  assert.doesNotMatch(html, /Voted today/)
  assert.match(html, /role="switch" data-vt-act="team-ig">/, 'unchecked when the server says off')
  assert.match(teamPanel({ ...TEAM, showIg: true }, { labels: LABELS }), /data-vt-act="team-ig" checked/)
  assert.match(html, /Show my Instagram username to my team/)
  assert.doesNotMatch(html, /AGENT\d|%|rank|#\d|online-dot|vt-on\b/i, 'no agent numbers, percentages, ranks or per-member online dots')
  assert.doesNotMatch(html, /ALIENS/, 'nothing about the other team')
})

test('Team: loading, no side yet, alone, and error states', () => {
  assert.match(teamPanel({ loading: true }, { labels: LABELS }), /aria-busy="true"[\s\S]*Loading your team/)
  assert.match(teamPanel({ error: 'team_required' }, { labels: LABELS }), /Pick your side first[\s\S]*data-vt-act="team-choose"/)
  assert.match(teamPanel({ error: 'failed' }, { labels: LABELS }), /Couldn&#39;t load your team[\s\S]*data-vt-act="team-retry"/)
  assert.match(teamPanel({ ...TEAM, count: 1, members: [TEAM.members[0]] }, { labels: LABELS }), /You're the first HOOLIGANS here/)
})

// ── Chat view ────────────────────────────────────────────────────────

const MSGS = [
  { id: 1, kind: 'system', sys: 'tie', team: null, body: 'THE BATTLE IS TIED', at: '2026-10-16T04:21:00Z' },
  { id: 2, kind: 'player', team: 'aliens', codename: 'Koya', memberKey: '11111111-2222-3333-4444-555555555555', body: 'aliens never sleep', status: 'visible', mine: false, at: '2026-10-16T04:22:00Z', replyTo: null, reactions: { '🔥': 4 }, myReactions: ['🔥'] },
  { id: 3, kind: 'player', team: 'hooligans', codename: 'Moonchild', memberKey: null, body: 'neither do we', status: 'visible', mine: true, at: '2026-10-16T04:23:00Z', replyTo: { id: 2, team: 'aliens', codename: 'Koya', body: 'aliens never sleep' }, reactions: {}, myReactions: [] },
  { id: 4, kind: 'player', team: 'aliens', codename: 'Mochi', memberKey: '21111111-2222-3333-4444-555555555555', body: null, status: 'auto_hidden', mine: false, at: '2026-10-16T04:24:00Z', replyTo: null, reactions: {}, myReactions: [] },
  { id: 5, kind: 'system', sys: 'lead', team: 'hooligans', body: 'HOOLIGANS TOOK THE LEAD', at: '2026-10-16T04:25:00Z' },
]
const CHAT = { success: true, team: 'hooligans', open: true, paused: false, timeoutUntil: null, presence: { hooligans: 21, aliens: 17 }, messages: MSGS, moments: [], muted: [] }
const NOW = new Date('2026-10-16T04:30:00Z')

test('Chat: codename, team label and rail, time, replies, reactions, hidden text, moments', () => {
  const html = chatPanel(CHAT, {}, LABELS, NOW)
  assert.match(html, /data-team="hooligans"><i aria-hidden="true"><\/i>21 HOOLIGANS here/)
  assert.match(html, /class="vt-msg" data-team="aliens" data-vt-msg="2">[\s\S]*<strong>Koya<\/strong><span class="vt-msg-tag">ALIENS<\/span><time/)
  assert.match(html, /class="vt-msg is-mine" data-team="hooligans"[\s\S]*class="vt-msg-q" data-team="aliens">[\s\S]*<b>Koya<\/b> aliens never sleep/)
  assert.match(html, /aria-pressed="true" aria-label="🔥 4, yours">🔥<b>4<\/b>/)
  assert.match(html, /Message hidden after reports/)
  assert.match(html, /class="vt-moment" data-sys="lead" data-team="hooligans"[\s\S]*HOOLIGANS TOOK THE LEAD/)
  assert.match(html, /maxlength="200"/)
  assert.match(html, /Both teams see this · no links or @usernames/)
  assert.doesNotMatch(html, /AGENT\d|11111111-2222/, 'no agent numbers; member keys stay in data, not markup')
  assert.doesNotMatch(html, /type="file"|<img/i, 'no image uploads')
})

test('Chat: locked composer for timeouts, closed or paused rooms; empty, loading and error states', () => {
  assert.match(chatLock({ ...CHAT, timeoutUntil: '2026-10-16T09:40:00Z' }, NOW), /can't post until \d\d:\d\d/)
  assert.equal(chatLock({ ...CHAT, open: false }, NOW), 'Voting has closed. Chat is read-only now. GG, both sides.')
  assert.equal(chatLock({ ...CHAT, paused: true }, NOW), 'Chat is paused for a moment.')
  assert.equal(chatLock(CHAT, NOW), null)
  assert.doesNotMatch(chatPanel({ ...CHAT, open: false }, {}, LABELS, NOW), /data-vt-form="chat"/)
  assert.match(chatFeed({ ...CHAT, messages: [] }, LABELS), /No messages yet/)
  assert.match(chatPanel({ loading: true }, {}, LABELS, NOW), /Loading Chat/)
  assert.match(chatPanel({ error: 'team_required' }, {}, LABELS, NOW), /Pick your side first/)
  assert.match(chatPanel({ error: 'x' }, {}, LABELS, NOW), /Can&#39;t reach Chat/)
  const slow = chatPanel(CHAT, { waitUntil: NOW.getTime() + 4000, draft: 'hi' }, LABELS, NOW)
  assert.match(slow, /aria-label="Send in 4 seconds" disabled>/)
  assert.match(slow, /value="hi"/)
  assert.match(chatPanel(CHAT, { replyTo: { id: 2, codename: 'Koya', team: 'aliens', body: 'aliens never sleep' } }, LABELS, NOW), /Replying to <b>Koya<\/b>/)
  assert.equal(chatErrorText('chat_text', 'link'), 'Links, @usernames and hashtags aren’t allowed in Chat.')
  assert.equal(chatErrorText('slow_down'), 'Slow mode is on. Try again in a moment.')
})

test('message options: react, reply, mute and report — no mute or report on your own', () => {
  const other = chatMessageSheet(MSGS[1], LABELS)
  for (const s of ['data-vt-act="chat-react"', 'data-vt-act="chat-reply"', 'data-vt-act="chat-mute" data-vt-key="11111111', 'data-vt-act="chat-report-open"']) assert.ok(other.includes(s), s)
  assert.equal((other.match(/data-vt-act="chat-react"/g) || []).length, 6)
  const mine = chatMessageSheet(MSGS[2], LABELS)
  assert.doesNotMatch(mine, /chat-mute|chat-report-open/)
  const report = chatReportSheet(MSGS[1], LABELS)
  for (const r of ['harassment', 'hate', 'sexual', 'personal_info', 'spam', 'other']) assert.ok(report.includes(`value="${r}"`), r)
  assert.match(report, /They won't know who reported it/)
})

test('live strip, tabs and moments card', () => {
  const b = { teams: teams(1060, 1054), closesAt: '2026-10-22T14:59:59Z', frozen: false }
  const strip = liveStrip(b, NOW)
  assert.match(strip, /data-vt-live="live"[\s\S]*LIVE[\s\S]*6d \d+h left/)
  assert.match(strip, /<b>1,060<\/b>[\s\S]*<b>1,054<\/b>/)
  assert.match(liveStrip({ ...b, frozen: true }, NOW), /FINAL/)
  assert.doesNotMatch(liveStrip(b, NOW, { score: false }), /vt-ls-score/, 'Battle shows the matchup itself; the strip skips the score')
  const tabs = hubTabs('team', { done: 1, total: 6 })
  assert.deepEqual([...tabs.matchAll(/data-vt-tab="(\w+)">(\w+)/g)].map((m) => m[2]), ['Battle', 'Team', 'Voting'])
  assert.match(tabs, /aria-selected="true" tabindex="0" data-vt-act="hub-tab" data-vt-tab="team"/)
  assert.match(tabs, /Voting<small class="vt-tab-n">1\/6<\/small>/)
  assert.doesNotMatch(tabs, /Team HQ|Comms|Chat/)
  assert.match(momentsCard([{ id: 5, sys: 'lead', team: 'aliens', body: 'ALIENS TOOK THE LEAD', at: MSGS[4].at }], LABELS), /<b class="vt-tm-tx" data-team="aliens">ALIENS<\/b> took the lead/)
  assert.match(momentsCard([], LABELS), /class="vt-moments-empty"[\s\S]*show up here/)
})

test('floating Chat: a dot for new messages, never a count; opens a sheet with the room', () => {
  assert.match(chatFab({}), /class="vt-chat-fab"[^>]*data-vt-act="chat-open"[^>]*aria-label="Open MAMA Chat"/)
  assert.doesNotMatch(chatFab({}), /vt-fab-dot/)
  const unread = chatFab({ unread: true })
  assert.match(unread, /aria-label="Open MAMA Chat, new messages"[\s\S]*vt-fab-dot/)
  assert.doesNotMatch(unread, />\d+</, 'no unread number')
  const sheet = chatSheet(CHAT, {}, LABELS, NOW)
  assert.match(sheet, /data-vt-sheet="chat" role="dialog" aria-modal="true"[\s\S]*MAMA Chat[\s\S]*HOOLIGANS × ALIENS[\s\S]*data-vt-form="chat"/)
  assert.match(sheet, /class="vt-moment" data-sys="lead" data-team="hooligans"/)
})

// ── Service: what reaches a phone ────────────────────────────────────

/** Just enough of supabase-js: per-table rows, recorded writes, rpc answers. */
function fakeDb({ rpc = {}, cache = null } = {}) {
  const writes = []
  const calls = []
  const campaign = { id: 'mama_2026', opens_at: '2026-10-12T10:00:00Z', closes_at: '2026-10-22T14:59:59Z', battle: { enabled: true, teams: [], milestones: [200, 2200] } }
  const db = {
    writes, calls,
    rpc: async (fn, args) => { calls.push([fn, args]); return typeof rpc[fn] === 'function' ? rpc[fn](args) : { data: rpc[fn] ?? null, error: null } },
    from(table) {
      const q = { table, op: 'select' }
      const b = {
        select: () => b, eq: () => b, order: () => b, limit: () => b, not: () => b, is: () => b, in: () => b, neq: () => b,
        update: (v) => { q.op = 'update'; q.value = v; return b },
        upsert: (v, o) => { writes.push({ table, op: 'upsert', value: v, opts: o }); return Promise.resolve({ error: null }) },
        maybeSingle: () => Promise.resolve({ data: table === 'rc_cache' ? cache : null, error: null }),
        then: (res, rej) => {
          if (q.op === 'update') writes.push({ table, op: 'update', value: q.value })
          const data = table === 'rc_vote_campaigns' ? [campaign] : table === 'rc_campaign_teams' && q.op === 'update' ? [{ team: 'aliens' }] : []
          return Promise.resolve({ data, error: null }).then(res, rej)
        },
      }
      return b
    },
  }
  return db
}
const NOW_OPEN = new Date('2026-10-16T05:00:00Z')

test('getBattleTeam passes on only codename, Instagram, voted-today and me', async () => {
  const db = fakeDb({ rpc: { rc_battle_team_roster: { team: 'aliens', showIg: true, count: 2, online: 1,
    members: [{ codename: 'Koya', ig: 'koya.nav', today: 3, me: true, agent_no: 'AGENT001', member_key: 'k', score: 9 }] } } })
  const r = await getBattleTeam(db, { agentNo: 'agent001' }, NOW_OPEN)
  assert.deepEqual(r.members, [{ codename: 'Koya', ig: 'koya.nav', today: 3, me: true }])
  assert.deepEqual(db.calls[0], ['rc_battle_team_roster', { p_campaign_id: 'mama_2026', p_agent_no: 'AGENT001', p_day: '2026-10-16' }])
  assert.equal((await getBattleTeam(fakeDb({ rpc: { rc_battle_team_roster: { team: null } } }), { agentNo: 'AGENT9' }, NOW_OPEN)).error, 'team_required')
})

test('setBattleInstagram stores an explicit, timestamped choice', async () => {
  const db = fakeDb()
  assert.deepEqual(await setBattleInstagram(db, { agentNo: 'AGENT001', on: true }, NOW_OPEN), { success: true, showIg: true })
  assert.deepEqual(db.writes[0].value, { show_ig: true, show_ig_at: NOW_OPEN.toISOString() })
  await setBattleInstagram(db, { agentNo: 'AGENT001', on: 'yes' }, NOW_OPEN)
  assert.equal(db.writes[1].value.show_ig, false, 'only a real true turns it on')
})

test('getBattleChat: no member key on your own messages, and moments posted with unique keys', async () => {
  const db = fakeDb({ rpc: { rc_battle_chat_feed: { team: 'hooligans', presence: { hooligans: 2 }, muted: [], moments: [],
    messages: [{ id: 1, kind: 'player', team: 'hooligans', codename: 'Me', memberKey: 'mk', body: 'hi', status: 'visible', mine: true, at: 'x', reactions: {}, myReactions: [], agent_no: 'AGENT001' }] } } })
  // getPublicBattle reads rc_vote_campaigns via the same fake; scores via rpc.
  db.rpc = ((orig) => async (fn, args) => (fn === 'rc_campaign_battle_state' ? { data: { teams: { hooligans: 0, aliens: 0 }, total: 2190 } } : orig(fn, args)))(db.rpc)
  const r = await getBattleChat(db, { agentNo: 'AGENT001' }, new Date('2026-10-22T13:30:00Z'))
  assert.equal(r.messages[0].memberKey, null)
  assert.ok(!('agent_no' in r.messages[0]))
  assert.equal(r.open, true)
  const posted = db.writes.find((w) => w.table === 'rc_battle_chat')
  assert.deepEqual(posted.opts, { onConflict: 'campaign_id,system_key', ignoreDuplicates: true })
  assert.deepEqual(posted.value.map((v) => v.system_key), ['gift:2200:25', 'final:3'])
  assert.ok(db.writes.some((w) => w.table === 'rc_cache'), 'state kept for pacing')
  // A recent check: no second battle read.
  const db2 = fakeDb({ cache: { value: { checkedAt: new Date('2026-10-22T13:29:50Z').toISOString() } }, rpc: { rc_battle_chat_feed: { team: 'aliens', messages: [] } } })
  await getBattleChat(db2, { agentNo: 'AGENT001' }, new Date('2026-10-22T13:30:00Z'))
  assert.ok(!db2.calls.some(([fn]) => fn === 'rc_campaign_battle_state'))
})

test('send/react/report/mute validate before touching the database', async () => {
  const db = fakeDb({ rpc: { rc_battle_chat_send: { ok: false, error: 'slow_down', wait: 4 } } })
  assert.deepEqual(await sendBattleChat(db, { agentNo: 'A', message: 'see https://x.com' }, NOW_OPEN), { success: false, error: 'chat_text', reason: 'link' })
  assert.deepEqual(await sendBattleChat(db, { agentNo: 'A', message: 'my number is AGENT045' }, NOW_OPEN), { success: false, error: 'chat_text', reason: 'agent_number' })
  assert.equal(db.calls.length, 0)
  assert.deepEqual(await sendBattleChat(db, { agentNo: 'A', message: '  go   hooligans ', replyTo: '7' }, NOW_OPEN), { success: false, error: 'slow_down', wait: 4 })
  assert.deepEqual(db.calls[0][1], { p_campaign_id: 'mama_2026', p_agent_no: 'A', p_body: 'go hooligans', p_reply_to: 7 })
  assert.equal((await reactBattleChat(db, { agentNo: 'A', messageId: 1, emoji: '💩' }, NOW_OPEN)).error, 'bad_request')
  assert.equal((await reportBattleChat(db, { agentNo: 'A', messageId: 1, reason: 'boring' }, NOW_OPEN)).error, 'bad_request')
  assert.equal((await muteBattleChat(db, { agentNo: 'A', memberKey: 'AGENT001' }, NOW_OPEN)).error, 'bad_request', 'mute takes a member key, never an agent number')
})

// ── Wiring ───────────────────────────────────────────────────────────

test('routes: Team and Chat are agent routes, moderation is admin-only; tables closed to clients', () => {
  const idx = read('../supabase/functions/op-reconnect/index.ts')
  for (const r of ['getBattleTeam', 'setBattleInstagram', 'getBattleChat', 'sendBattleChat', 'reactBattleChat', 'reportBattleChat', 'muteBattleChat'])
    assert.match(idx, new RegExp(`${r}: \\{ auth: 'agent'`), r)
  for (const r of ['adminListBattleChat', 'adminModerateBattleChat']) assert.match(idx, new RegExp(`${r}: \\{ auth: 'admin'`), r)
  const sql = read('../supabase/migrations/20261015150000_rc_battle_hub.sql')
  for (const t of ['rc_battle_chat', 'rc_battle_chat_reactions', 'rc_battle_chat_reports', 'rc_battle_chat_mutes']) assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`), t)
  assert.match(sql, /revoke all on public\.rc_battle_chat, public\.rc_battle_chat_reactions, public\.rc_battle_chat_reports, public\.rc_battle_chat_mutes\s+from anon, authenticated/)
  assert.match(sql, /add column if not exists show_ig boolean not null default false/)
})

test('switching tabs never repaints (drafts survive); polling stops off-screen', () => {
  const src = read('./voting.js')
  const sw = src.slice(src.indexOf('function switchTab'), src.indexOf('// ── Team ──'))
  assert.doesNotMatch(sw, /paint\(\)/)
  assert.match(sw, /p\.hidden = p\.dataset\.vtPanel !== tab/)
  assert.match(src, /if \(!document\.hidden\)/)
  assert.match(src, /else if \(act === 'chat-open'\) openChat\(\)/)
  assert.match(src, /hubTimer = setTimeout\(hubTick, local\.hub\.chatOpen \? CHAT_FAST_MS : HUB_SLOW_MS\)/)
  assert.match(src, /else if \(closing\.startsWith\('chat'\) && local\.hub\.chatOpen\) \{ showSheet\('chat', false\); return \}/)
  assert.match(src, /if \(!root\?\.isConnected \|\| !status\?\.battle\) return/)
})

test('privacy page explains Team, Instagram opt-in and Chat', () => {
  const html = read('../privacy.html')
  assert.match(html, /MAMA Battle Team and Chat/)
  assert.match(html, /This is on by default for this event, and you can switch it off at any time in Team\./)
  assert.doesNotMatch(html, /off unless you switch it on/)
})

test('admin: Chat report card escapes text and offers restore, remove and timeouts', async () => {
  const { chatCardHtml } = await import('./voting-admin.js')
  const html = chatCardHtml({ id: 4, agentNo: 'AGENT012', codename: 'Koya', team: 'aliens', body: '<b>x</b>', status: 'auto_hidden', at: '2026-10-15T04:00:00Z', reports: 3, ownTeamReports: 1, reasons: ['spam'], timeoutUntil: null })
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/)
  assert.match(html, /3 reports \(1 from their own team\)/)
  for (const a of ['data-vta-chat="restore"', 'data-vta-chat="remove"', 'data-vta-min="60"', 'data-vta-min="1440"', 'data-vta-min="event"']) assert.ok(html.includes(a), a)
  assert.doesNotMatch(html, /Lift timeout/)
  const admin = read('./voting-admin.js')
  assert.match(admin, /data-vta-filter="chat"/)
  assert.match(admin, /call\('adminModerateBattleChat'/)
})
