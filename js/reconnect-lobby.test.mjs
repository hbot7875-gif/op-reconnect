// The ReConnect quest lobby: seats, the picker, the banner, the status copy.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { lobbySeats, lobbySeatsHtml, spotsLeftLabel, seatNeeds, seatNeedsPhrase, newlyJoined, milestoneState, celebrateOnce, noteMissionOpen } from './reconnect-lobby.js'
import { reconnectPlayerNext } from './reconnect-player-ui.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const me = { agentNo: 'A1', codename: 'Runch', isMe: true, status: 'joined' }

test('seats: you first, then teammates, invited agents, then open spots', () => {
  const seats = lobbySeats([
    { agentNo: 'A3', codename: 'Rey', status: 'invited', removable: true },
    { agentNo: 'A4', codename: 'Old', status: 'invited', inviteExpired: true },
    { agentNo: 'A5', codename: 'Gone', status: 'joined', leftDistrict: true },
    { agentNo: 'A2', codename: 'Sami', status: 'joined', idle: true },
    me,
  ], 4)
  assert.deepEqual(seats.map((s) => [s.name, s.kind]), [['You', 'ready'], ['Sami', 'quiet'], ['Rey', 'invited'], ['Empty', 'empty']])
})

test('seat tiles: escaped names, cancel only where allowed, invite only when offered', () => {
  const seats = lobbySeats([me, { agentNo: 'A3', codename: '<b>R</b>', status: 'invited', removable: true }], 3)
  const html = lobbySeatsHtml(seats, { canInvite: true, canCancel: true })
  assert.match(html, /&lt;b&gt;R&lt;\/b&gt;/)
  assert.match(html, /data-seat-cancel="A3"/)
  assert.match(html, /data-seat-invite="2"/)
  const viewer = lobbySeatsHtml(seats)
  assert.doesNotMatch(viewer, /data-seat-cancel|data-seat-invite/)
  assert.doesNotMatch(html, /A1/, 'your own agent number is never rendered')
  assert.equal(spotsLeftLabel(2), '2 spots open')
  assert.equal(spotsLeftLabel(2, 1), '1 invited · 1 spot open')
  assert.equal(spotsLeftLabel(1, 1), '1 invited')
  assert.equal(spotsLeftLabel(1), '1 spot open')
  assert.equal(spotsLeftLabel(0), 'Team full')
})

test('status never says "waiting" while a spot is still uninvited', () => {
  assert.equal(reconnectPlayerNext({ need: 2, pendingNames: ['Rey'] }).title, 'Invite one more teammate')
  assert.equal(reconnectPlayerNext({ need: 1, pendingNames: ['Rey'] }).title, 'Waiting for Rey')
})

test('wiring: picker sheet, one Find teammates action, More options, banner hidden on the quest', () => {
  const sd = read('./screen-district.js')
  assert.match(sd, /el\('button', 'btn btn-primary reconnect-find-btn', 'Find teammates'\)/)
  assert.match(sd, /function teammatePicker\(d, res, res2, \{ open, pendingNames = \[\], onInvited \}\)/)
  assert.doesNotMatch(sd, /'See other agents'|reconnect-best-invite|Team signal|ARMY here/, 'old inline list and dashboard labels are gone')
  // Team Chat and Options are buttons that open sheets, not collapsible sections.
  assert.match(sd, /chatBtn\.onclick = \(\) => openMissionChat\(box\)/)
  assert.match(sd, /optionsBtn\.onclick = \(\) => openMissionOptions\(box, detailsBody\)/)
  assert.doesNotMatch(sd, /reconnectDisclosure\('More options'|reconnect-chat-disclosure/)
  // The chat keeps its unread badge and marks messages read when opened.
  assert.match(sd, /function openMissionChat\(box\) \{[\s\S]{0,600}markReconnectChatSeen\(m\.id, m\.messageCount\)/)
  assert.match(sd, /reconnect-chat-badge/)
  // Options: How to play, Manage invites (only when there is something to manage), Leave Quest as a plain row.
  assert.match(sd, /optionSection\('How to play', howNodes, 'book'\)/)
  // Lucide line icons, decorative only, never emoji in labels.
  assert.match(sd, /import \{ rcIcon \} from '\.\/reconnect-icons\.js'/)
  assert.match(read('./reconnect-icons.js'), /aria-hidden="true"/)
  assert.doesNotMatch(sd.slice(sd.indexOf('function teammatePicker'), sd.indexOf('function refreshMountedMissionDeadline')), /[\u{1F300}-\u{1FAFF}]/u, 'no emoji in the sheets')
  assert.match(sd, /canManage \? 'Manage invites' : 'Team checklists'/)
  assert.match(sd, /const leave = el\('div', 'rl-opt-leave'\)/)
  // Quick replies, arrow send, bottom sheets, once-only effects.
  assert.match(sd, /quickReplies: QUICK_REPLIES,\s+sendIcon: true,/)
  assert.match(sd, /return asBottomSheet\(sheet, hideOverlay\)/)
  assert.match(sd, /showOverlay\(asBottomSheet\(sheet, hideOverlay\)\)/)
  assert.doesNotMatch(sd.slice(sd.indexOf('function teammatePicker'), sd.indexOf('function refreshMountedMissionDeadline')), /'Close'/, 'no big Close buttons: the × closes')
  assert.match(sd, /share\.onclick = \(\) => showOverlay\(questShareSheet\(d\.id\)\)/)
  assert.match(sd, /decline\.classList\.add\('reconnect-decline'\)\s+primaryHost\.appendChild\(decline\)/, 'Decline sits under Accept')
  // The server still decides who can be invited and removed.
  assert.match(sd, /call\('inviteReconnectMission'/)
  assert.match(sd, /call\('removeReconnectParticipant'/)
  assert.match(read('../css/reconnect.css'), /#hud:has\(~ #scene \.reconnect-card\) #hudReconnectStatus \{ display: none; \}/)
})

const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) } }

test('a teammate joining pops once; a first look celebrates nothing', () => {
  const st = memStore()
  assert.deepEqual(newlyJoined('m1', ['A2'], st), [], 'first look: already there')
  assert.deepEqual(newlyJoined('m1', ['A2'], st), [])
  assert.deepEqual(newlyJoined('m1', ['A2', 'A3'], st), ['A3'], 'a new teammate')
  assert.deepEqual(newlyJoined('m1', ['A2', 'A3'], st), [], 'and only once')
})

test('milestones: lit when reached, a pulse only when newly crossed', () => {
  const st = memStore()
  assert.deepEqual(milestoneState('m1', 30, st), { hit: [25], fresh: [] }, 'first look')
  assert.deepEqual(milestoneState('m1', 55, st), { hit: [25, 50], fresh: [50] })
  assert.deepEqual(milestoneState('m1', 60, st), { hit: [25, 50], fresh: [] })
  assert.deepEqual(milestoneState('m1', 100, st), { hit: [25, 50, 75], fresh: [75] })
})

test('the win celebrates once, and only for a quest this device saw open', () => {
  const st = memStore()
  assert.equal(celebrateOnce('old', st), false, 'never seen open: an old completion')
  noteMissionOpen('m1', st)
  assert.equal(celebrateOnce('m1', st), true)
  assert.equal(celebrateOnce('m1', st), false, 'not again')
})

test('effects respect reduced motion; bottom sheets only for ReConnect popups', () => {
  const css = read('../css/reconnect.css')
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s+\.pbar-tick\.is-new, \.rl-seat\.is-new, \.rl-seat\.is-new \.rl-avatar, #overlay > \.sheet\.rl-bottom \{ animation: none; \}/)
  assert.doesNotMatch(css + read('./screen-district.js'), /rl-confetti/, 'no confetti')
  assert.match(css, /#overlay:has\(> \.sheet\.rl-bottom\) \{ align-items: flex-end; padding: 0; \}/)
  assert.match(read('./chat-thread.js'), /opts\.sendIcon \? SEND_ICON : 'Send'/, 'ARMY Comms keeps its Send button')
})

test('Urmi Terrace: two seats from here, one from Home Base, labelled and counted', () => {
  const seats = { local: 2, helper: 1, helperFrom: 'Home Base' }
  const me2 = { ...me, helper: false }
  // You (local) + one invited Home Base agent: the open spot is local.
  let list = lobbySeats([me2, { agentNo: 'A3', codename: 'Rey', status: 'invited', helper: true }], 3, seats)
  assert.deepEqual(list.map((s) => [s.name, s.kind, s.helper]), [['You', 'ready', false], ['Rey', 'invited', true], ['Empty', 'empty', false]])
  // Only you: one local spot and the Home Base spot are open.
  list = lobbySeats([me2], 3, seats)
  assert.deepEqual(list.map((s) => s.helper), [false, false, true])
  const html = lobbySeatsHtml(list, { canInvite: true, localName: 'Urmi Terrace', helperFrom: 'Home Base' })
  assert.match(html, /<em class="rl-from">Urmi Terrace<\/em>/)
  assert.match(html, /<em class="rl-from is-helper">Home Base<\/em>/)
  // Who is still needed counts joined teammates only.
  assert.deepEqual(seatNeeds([me2], seats), { local: 1, helper: 1 })
  assert.equal(seatNeedsPhrase({ local: 1, helper: 1 }, 'Urmi Terrace', 'Home Base'), '1 more ARMY from Urmi Terrace and 1 from Home Base')
  assert.equal(seatNeedsPhrase({ local: 0, helper: 1 }, 'Urmi Terrace', 'Home Base'), '1 more ARMY from Home Base')
  assert.equal(seatNeeds([me], seats), null, 'an older server that sends no seat flags: plain wording')
  assert.equal(lobbySeats([me], 3, seats).some((s) => 'helper' in s), false)
})

test('wiring: the server tags seats on mixed teams; the sticky banner is gone', () => {
  const rm = read('../supabase/functions/op-reconnect/lib/reconnect-missions.ts')
  assert.match(rm, /async function markSeats\(supabase: SupabaseDB, shaped: any, config: Record<string, any>\) \{\s+if \(!shaped \|\| !seatRule\(config\)\) return shaped/)
  assert.equal((rm.match(/await markSeats\(supabase, await shapeWithMessages\(/g) || []).length, 2, 'the quest panel and the recruit view')
  const hud = read('./ui-hud.js')
  assert.doesNotMatch(hud, /id="hudReconnectStatus"|reconnectHudStatus/, 'no ReConnect banner in the HUD')
})

test('unread Team Chat counts on the bell and opens the quest; reading it clears both', () => {
  const hud = read('./ui-hud.js')
  assert.match(hud, /const signalCount = invites\.length \+ reconnectAlerts\.length \+ unreadTotal \+ backupSignal \+ chestSignal \+ \(teamChat\?\.unread \|\| 0\)/)
  assert.match(hud, /reconnectChatUnreadCount\(mission\.messageCount, getReconnectChatSeen\(mission\.id\)\)/, 'same seen count as the Team Chat badge')
  assert.match(hud, /open\.onclick = \(\) => \{ hideOverlay\(\); goDistrict\(teamChat\.district\.wardId, teamChat\.district\.id\) \}/)
  const sd = read('./screen-district.js')
  assert.match(sd, /markReconnectChatSeen\(m\.id, m\.messageCount\)\s+paintChatButton\(box\)\s+\/\/ The bell counts unread Team Chat too; repaint it so it drops now\.\s+const hud = document\.getElementById\('hud'\)\s+if \(hud && getState\(\)\) renderHud\(hud, getState\(\)\)/)
})

test('every quest says the rules players need to finish it', async () => {
  const { questRuleNotes } = await import('./reconnect-player-ui.js')
  const album = { sharedTrack: { label: 'Indigo', target: 200, keys: ['yun', 'still life', 'all day', 'forgtful', 'closer', 'change pt2'] }, cipherCount: 3 }
  assert.equal(questRuleNotes(album), 'Any song from the Indigo album counts. Then crack 3 codes together in Team Chat.')
  assert.equal(questRuleNotes({ sharedTrack: { label: 'D-DAY album', keys: ['d day', 'haegeum'] } }), 'Any song from the D-DAY album counts.')
  assert.equal(questRuleNotes({ sharedTrack: { label: "I'm Fine + Come Over", keys: ['im fine', 'come over'] } }), 'Plays of either song add to the same total.')
  assert.equal(questRuleNotes({ sharedTrack: { label: 'My You / Still With You', keys: ['my you', 'still with you'] } }), 'Plays of either song add to the same total.')
  assert.equal(questRuleNotes({ sharedTrack: { label: 'Haegeum', keys: ['haegeum', '해금', '해금 haegeum'] }, openTo: 'any district' }), 'Agents from any district can join your team too.', 'aliases of one song are not "either song"')
  assert.equal(questRuleNotes({ teamBoost: { maxPicks: 3 } }), 'Each teammate streams at least one of their own district goals after joining. Finishing unlocks a Team Boost for the team.')
  assert.equal(questRuleNotes({ checklist: { tracks: [] } }), '', 'checklist and surprise-song quests already explain themselves')
  const rm = read('../supabase/functions/op-reconnect/lib/reconnect-missions.ts')
  assert.equal((rm.match(/cipherCount: Array\.isArray\(/g) || []).length, 2, 'the quest panel and the recruit view send the code count')
  assert.match(rm, /function openToInfo\(config: Record<string, any>, content: any\): string \| null \{\s+if \(seatRule\(config\)\) return null/)
  assert.doesNotMatch(rm, /cipherCount: [^,\n]*answerKeys|ciphers: config\.ciphers,/, 'only the count leaves the server, never the codes')
  const sd = read('./screen-district.js')
  assert.match(sd, /const preNotes = questRuleNotes\(res\.config\)/)
  assert.match(sd, /const ruleNotes = questRuleNotes\(res\.config\)/)
})
