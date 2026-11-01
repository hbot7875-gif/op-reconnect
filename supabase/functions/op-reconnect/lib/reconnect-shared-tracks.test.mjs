// Pooled multi-track ReConnect quests with hidden names (config.sharedTracks),
// first used by Angel 613 Bell Tower's "Surprise Songs for Brazil".
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  sharedTracksConfig, pooledTrackPlays, memberSharedPlays, sharedTracksView, sharedTracksDone, publicSharedTracks,
} from './reconnect-shared-tracks.js'
import { reconnectPlayerNext, sharedTracksPitch } from '../../../../js/reconnect-player-ui.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const cfg = {
  requiredAgents: 3,
  sharedTracks: {
    target: 30, hidden: true, noun: 'surprise songs', clue: 'BTS sang in Brazil on the ARIRANG tour',
    tracks: [
      { group: 'Day One', label: 'Black Swan', keys: ['black swan'] },
      { group: 'Day One', label: 'Baepsae / Silver Spoon', keys: ['silver spoon', 'baepsae'] },
      { group: 'Day Two', label: 'Airplane pt.2', keys: ['airplane pt2'] },
    ],
  },
}
const st = sharedTracksConfig(cfg)
const plays = (o) => new Map(Object.entries(o))

test('config: needs a target and tracks with keys', () => {
  assert.equal(st.target, 30)
  assert.equal(st.tracks.length, 3)
  assert.equal(sharedTracksConfig({}), null)
  assert.equal(sharedTracksConfig({ sharedTracks: { target: 0, tracks: cfg.sharedTracks.tracks } }), null)
  assert.equal(sharedTracksConfig({ sharedTracks: { target: 30, tracks: [{ label: 'x', keys: [] }] } }), null)
})

test('plays pool per track across members, every alias key counted', () => {
  const a = plays({ 'black swan': 12, 'silver spoon': 3 })
  const b = plays({ 'black swan': 25, baepsae: 2, 'airplane pt2': 1 })
  assert.deepEqual(pooledTrackPlays(st.tracks, [a, b]), [37, 5, 1])
  // A member's share caps each track at the target.
  assert.equal(memberSharedPlays(st.tracks, plays({ 'black swan': 99, 'airplane pt2': 4 }), 30), 34)
})

test('hidden: an unstreamed song has no name at all; a streamed one is revealed', () => {
  const v = sharedTracksView(st, [37, 0, 1])
  assert.deepEqual(v.tracks.map((t) => t.label), ['Black Swan', null, 'Airplane pt.2'])
  assert.deepEqual(v.tracks.map((t) => [t.progress, t.done]), [[30, true], [0, false], [1, false]])
  assert.deepEqual([v.found, v.cleared, v.progress, v.goal, v.total], [2, 1, 31, 90, 3])
  assert.equal(JSON.stringify(v).includes('Silver Spoon'), false, 'the hidden name never leaves the server')
  assert.equal(JSON.stringify(v).includes('baepsae'), false, 'nor its keys')
  assert.deepEqual(sharedTracksView(st, [37, 0, 1], { complete: true }).tracks.map((t) => t.label),
    ['Black Swan', 'Baepsae / Silver Spoon', 'Airplane pt.2'], 'all revealed once complete')
  const open = sharedTracksConfig({ sharedTracks: { ...cfg.sharedTracks, hidden: false } })
  assert.equal(sharedTracksView(open, [0, 0, 0]).tracks[1].label, 'Baepsae / Silver Spoon')
})

test('done only when every song reaches the target', () => {
  assert.equal(sharedTracksDone(st, [30, 30, 29]), false)
  assert.equal(sharedTracksDone(st, [31, 30, 30]), true)
})

test('the pre-mission config carries slots and days, never a hidden name or key', () => {
  const p = publicSharedTracks(cfg)
  assert.deepEqual(p, { target: 30, hidden: true, noun: 'surprise songs', clue: 'BTS sang in Brazil on the ARIRANG tour', total: 3, tracks: [
    { n: 1, group: 'Day One', label: null }, { n: 2, group: 'Day One', label: null }, { n: 3, group: 'Day Two', label: null }] })
  assert.equal(publicSharedTracks({}), null)
})

test('the server never sends the raw frozen config to a player', () => {
  const src = read('./reconnect-missions.ts')
  assert.doesNotMatch(src, /config: reconnect\.config,/, 'the waiver path used to send it verbatim')
  assert.equal((src.match(/sharedTracks: publicSharedTracks\(/g) || []).length, 3, 'panel, waiver and recruit views')
  assert.match(src, /sharedTracks: m\.sharedTracksProgress \|\| null/)
  assert.match(read('./candy-star.ts'), /sharedTracks: publicSharedTracks\(cfg\)/)
  assert.match(read('./districts.ts'), /sharedTracks: cfg\.sharedTracks \|\| null/, 'frozen at district start')
})

test('next step: find the hidden songs first, then finish the plays', () => {
  const base = { variant: 'connect', need: 0 }
  const view = sharedTracksView(st, [5, 0, 0])
  assert.deepEqual(reconnectPlayerNext({ ...base, sharedTracks: view }), {
    title: 'Find 2 more surprise songs',
    body: 'A song\'s name appears once any teammate streams it. Up to 30 plays each count.',
  })
  const found = sharedTracksView(st, [30, 10, 2])
  assert.deepEqual(reconnectPlayerNext({ ...base, sharedTracks: found }), {
    title: 'Stream 48 more times together', body: 'Every song needs 30 plays between you.',
  })
})

test('Angel 613 Bell Tower: the goals and the Brazil quest', () => {
  const sql = read('../../../migrations/20261101120000_rc_angel_613_bell_tower_goals.sql')
  for (const id of ['minimin-swim', 'minimin-haegeum', 'minimin-wild-flower', 'minimin-killin-it-girl',
    'psov-running-wild', 'exb-dna', 'hopesize-normal', 'zeal-come-over', 'psov-spring-day',
    'minimin-arirang', 'minimin-keep-swimming', 'zeal-album-happy', 'hopesize-album-hots', 'minimin-indigo',
    'psov-album-persona', 'psov-album-proof', 'mos7-album-love-yourself-tear']) assert.match(sql, new RegExp(`'${id}'`), id)
  assert.match(sql, /'angel-yours',\s+'track', 'Yours',\s+'Jin',\s+'\[\]'::jsonb, 30/)
  assert.match(sql, /'angel-yes-or-no', 'track', 'Yes or No', 'Jung Kook', '\[\]'::jsonb, 30/)
  assert.match(sql, /'requiredAgents', 3/)
  assert.match(sql, /'target', 30,\s+'hidden', true/)
  for (const key of ['black swan', 'silver spoon', 'airplane pt2', 'i need u', 'ddaeng', 'bts cypher pt3 killer']) assert.match(sql, new RegExp(`'${key}'`), key)
  assert.match(sql, /normalize\('뱁새', NFKD\)/, 'Hangul keys go through NFKD like normalizeKey')
  assert.doesNotMatch(sql, /crossDistrict/, 'three Bell Tower agents, no recruits')
})

test('quiz song (not on Spotify): counts the full target only once guessed; hint shows, answer never does', async () => {
  const { solvedSet, quizAnswerMatches } = await import('./reconnect-shared-tracks.js')
  const q = sharedTracksConfig({ sharedTracks: { target: 30, hidden: true, tracks: [
    { group: 'Day Three', label: 'BTS Cypher Pt.3: Killer', keys: ['bts cypher pt3 killer'] },
    { group: 'Day Three', label: 'DDAENG', quiz: { hint: 'Not on Spotify — guess it.', answerKeys: ['ddaeng', 'ttaeng'] } },
  ] } })
  assert.equal(q.tracks.length, 2, 'a quiz needs no stream keys')
  const member = plays({ 'bts cypher pt3 killer': 4, ddaeng: 50 })
  assert.deepEqual(pooledTrackPlays(q.tracks, [member], solvedSet([]), 30), [4, 0], 'streaming a quiz song does nothing')
  assert.deepEqual(pooledTrackPlays(q.tracks, [member], solvedSet([{ n: 2, by: 'Mochi' }]), 30), [4, 30])
  assert.equal(memberSharedPlays(q.tracks, member, 30), 4)
  assert.equal(quizAnswerMatches(q, 2, 'ttaeng'), true)
  assert.equal(quizAnswerMatches(q, 2, 'black swan'), false)
  assert.equal(quizAnswerMatches(q, 1, 'bts cypher pt3 killer'), false, 'only quiz tracks take answers')

  const before = sharedTracksView(q, [4, 0])
  assert.deepEqual(before.tracks[1], { n: 2, group: 'Day Three', label: null, revealed: false, progress: 0, done: false, quiz: true, hint: 'Not on Spotify — guess it.', solvedBy: null })
  assert.equal(JSON.stringify(before).includes('DDAENG') || JSON.stringify(before).includes('ttaeng'), false)
  const after = sharedTracksView(q, [4, 30], { solvedTracks: [{ n: 2, by: 'Mochi' }] })
  assert.deepEqual([after.tracks[1].label, after.tracks[1].done, after.tracks[1].solvedBy], ['DDAENG', true, 'Mochi'])
  assert.deepEqual(publicSharedTracks({ sharedTracks: q }).tracks[1], { n: 2, group: 'Day Three', label: null, quiz: true, hint: 'Not on Spotify — guess it.' })

  assert.deepEqual(reconnectPlayerNext({ variant: 'connect', need: 0, sharedTracks: sharedTracksView(q, [30, 0]) }),
    { title: 'Guess the last song', body: 'It isn’t on Spotify — read the hint and type your guess.' })
})

test('the guess endpoint: joined members only, server-side check, settles the mission', () => {
  const src = read('./reconnect-missions.ts')
  const fn = src.slice(src.indexOf('export async function answerReconnectSharedTrack'), src.indexOf('/** The mission creator frees up'))
  assert.match(fn, /me\?\.status !== 'joined'/)
  assert.match(fn, /quizAnswerMatches\(st, n, normKeyFull\(answer\)\)/)
  assert.match(fn, /update\(\{ solved_tracks: solved \}\)/)
  assert.match(fn, /refreshMission\(/)
  assert.doesNotMatch(fn, /agent_no: agentNo, at/, 'stores a codename, not an agent number')
  assert.match(read('../index.ts'), /answerReconnectSharedTrack: \{ auth: 'agent'/)
  const sql = read('../../../migrations/20261101120000_rc_angel_613_bell_tower_goals.sql')
  assert.match(sql, /add column if not exists solved_tracks jsonb not null default '\[\]'::jsonb/)
  assert.match(sql, /'label', 'DDAENG',\s+'quiz', jsonb_build_object\(/)
})

test('a hidden-songs quest carries its name (the clue); other quests keep the generic title', () => {
  const src = read('./reconnect-goal.ts')
  assert.match(src, /if \(frozenReconnect\.config\?\.sharedTracks\) \{\s+const label = content\.goals\.find/)
})

test('the quest says plainly what to find: surprise songs from the Brazil shows', () => {
  const v = sharedTracksView(st, [0, 0, 0])
  assert.equal(sharedTracksPitch(v), "Find out the 3 surprise songs BTS sang in Brazil on the ARIRANG tour and stream each one 30 times as a team. A song's name appears here the first time one of you streams it.")
  assert.equal(sharedTracksPitch(publicSharedTracks(cfg)), sharedTracksPitch(v), 'same words before a mission exists')
  assert.deepEqual(reconnectPlayerNext({ variant: 'connect', need: 0, sharedTracks: sharedTracksView(st, [30, 0, 4]) }).title, 'Find 1 more surprise song')
  assert.equal(sharedTracksPitch({ total: 2, target: 10, hidden: false }), 'Stream the 2 songs 10 times each as a team.')
  const sql = read('../../../migrations/20261101120000_rc_angel_613_bell_tower_goals.sql')
  assert.match(sql, /'noun', 'surprise songs',\s+'clue', 'BTS sang in Brazil on the ARIRANG tour'/)
  for (const f of ['../../../../js/screen-district.js', '../../../../js/reconnect-player-ui.js', '../../../../js/ui-hud.js', '../../../../js/candy-star.js'])
    assert.doesNotMatch(read(f), /secret song/i, f)
})
