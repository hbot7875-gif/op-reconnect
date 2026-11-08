// The ReConnect quest lobby: seats, the picker, the banner, the status copy.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { lobbySeats, lobbySeatsHtml, spotsLeftLabel, newlyJoined, milestoneState, celebrateOnce, noteMissionOpen } from './reconnect-lobby.js'
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
