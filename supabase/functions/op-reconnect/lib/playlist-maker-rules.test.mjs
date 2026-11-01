import test from 'node:test'
import assert from 'node:assert/strict'
import {
  hubDistricts, districtGroups, districtOptionLabel, initialDistrict, looksLikePlaylistLink, HERE_NOW, MORE,
  playlistIdFromLink, neededDistricts, filterMine, mineDistricts, makerLabel, uploaderOptions,
} from './playlist-maker-rules.js'

test('uploader filter: options with you first, then by count; rows filtered by agent', () => {
  const rows = [
    { name: 'A', agent_no: 'AGENT061', created_at: '2026-11-01T10:00:00Z' },
    { name: 'B', agent_no: 'AGENT050', created_at: '2026-11-01T09:00:00Z' },
    { name: 'C', agent_no: 'AGENT050', created_at: '2026-10-01T09:00:00Z' },
    { name: 'D', agent_no: 'AGENT004', created_at: '2026-10-02T09:00:00Z' },
  ]
  const makers = { AGENT061: 'Alpaca', AGENT050: 'Mochi' }
  assert.deepEqual(uploaderOptions(rows, makers, 'agent004').map((o) => [o.id, o.label, o.count]), [
    ['AGENT004', 'You (AGENT004)', 1], ['AGENT050', 'Mochi (AGENT050)', 2], ['AGENT061', 'Alpaca (AGENT061)', 1],
  ])
  assert.deepEqual(filterMine(rows, { uploader: 'AGENT050' }).map((r) => r.name), ['B', 'C'])
  assert.equal(makerLabel('agent073', makers), 'AGENT073')
  assert.equal(makerLabel('', makers), 'Unknown')
})

test('playlist id from a link', () => {
  assert.equal(playlistIdFromLink('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=1'), '37i9dQZF1DXcBWIGoYBM5M')
  assert.equal(playlistIdFromLink('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'), '37i9dQZF1DXcBWIGoYBM5M')
  assert.equal(playlistIdFromLink('https://open.spotify.com/track/37i9dQZF1DXcBWIGoYBM5M'), '')
})

test('districts needing playlists: agents there, fewest playlists first', () => {
  const g = [{ kind: 'track', label: 'Dope' }]
  const list = [
    { id: 'a', agentsHere: 13, playlists: 3, goals: g }, { id: 'b', agentsHere: 38, playlists: 2, goals: g },
    { id: 'c', agentsHere: 4, playlists: 0, goals: g }, { id: 'd', agentsHere: 9, playlists: 21, goals: g },
    { id: 'e', agentsHere: 0, playlists: 0, goals: g }, { id: 'f', agentsHere: 20, playlists: 0, goals: [] },
  ]
  // f has agents but no goal songs, so it isn't asked for
  assert.deepEqual(neededDistricts(list).map((d) => d.id), ['c', 'b', 'a'])
  assert.deepEqual(neededDistricts(list, { limit: 1 }).map((d) => d.id), ['c'])
})

test('your playlists: search, district filter, sort, chips', () => {
  const rows = [
    { name: 'MIR × Golden', district_id: 'u', created_at: '2026-11-01T10:00:00Z', config: {} },
    { name: 'Stay Alive', district_id: 'm', created_at: '2026-11-01T09:00:00Z', config: { note: 'golden hour' } },
    { name: 'Winter Bear', district_id: 'n', created_at: '2026-09-30T09:00:00Z', config: {} },
    { name: 'Second U', district_id: 'u', created_at: '2026-10-05T09:00:00Z', config: {} },
  ]
  assert.deepEqual(filterMine(rows).map((r) => r.name), ['MIR × Golden', 'Stay Alive', 'Second U', 'Winter Bear'])
  assert.deepEqual(filterMine(rows, { sort: 'oldest' }).map((r) => r.name)[0], 'Winter Bear')
  assert.deepEqual(filterMine(rows, { q: 'golden' }).map((r) => r.name), ['MIR × Golden', 'Stay Alive'])
  assert.deepEqual(filterMine(rows, { district: 'u' }).map((r) => r.name), ['MIR × Golden', 'Second U'])
  const chips = mineDistricts(rows, [{ id: 'u', name: 'Urmi Terrace' }, { id: 'm', name: 'Minimin Court' }])
  assert.deepEqual(chips.map((c) => [c.name, c.count]), [['Urmi Terrace', 2], ['Minimin Court', 1], ['District removed', 1]])
})

const wards = [{ id: 'relay-zero', name: 'Relay Zero' }, { id: 'mono', name: 'Mono Ward' }, { id: 'happy', name: 'Happy Ward' }]
const districts = [
  { id: 'relay-zero-hq', name: 'Relay Zero', ward_id: 'relay-zero' },
  { id: 'mono-urmi', name: 'Urmi Terrace', ward_id: 'mono' },
  { id: 'mono-tae', name: 'Tae Pier', ward_id: 'mono' },
  { id: 'happy-lido', name: 'Keep Swimming Lido', ward_id: 'happy' },
  { id: 'mono-angel', name: 'Angel 613 Bell Tower', ward_id: 'mono' },
]
const hub = hubDistricts({
  districts, wards,
  goals: [
    { district_id: 'mono-urmi', kind: 'track', label: 'Dope' },
    { district_id: 'mono-urmi', kind: 'album', label: 'Dark & Wild' },
    { district_id: 'mono-urmi', kind: 'reconnect', label: 'Team' },
    { district_id: 'relay-zero-hq', kind: 'track', label: 'Haegeum' },
    { district_id: 'mono-tae', kind: 'track', label: 'Butter' },
    { district_id: 'mono-angel', kind: 'album', label: 'BE' },
    { district_id: 'happy-lido', kind: 'reconnect', label: 'Team only' },
    { district_id: null, kind: 'track', label: 'Loose' },
  ],
  agentRows: [{ district_id: 'mono-urmi' }, { district_id: 'mono-urmi' }, { district_id: 'relay-zero-hq' }],
  playlistRows: [{ district_id: 'mono-tae' }, { district_id: 'mono-tae' }, { district_id: 'mono-urmi' }],
})

test('server rows: game names, counts, goal songs only', () => {
  const urmi = hub.find((d) => d.id === 'mono-urmi')
  assert.deepEqual(urmi, {
    id: 'mono-urmi', name: 'Urmi Terrace', wardId: 'mono', wardName: 'Mono Ward', agentsHere: 2, playlists: 1,
    goals: [{ kind: 'track', label: 'Dope' }, { kind: 'album', label: 'Dark & Wild' }],
  })
  const home = hub.find((d) => d.id === 'relay-zero-hq')
  assert.equal(home.name, 'Home Base')
  assert.equal(home.wardName, 'Home Base')
  assert.equal(hub.find((d) => d.id === 'mono-tae').agentsHere, 0)
})

test('groups: only districts with goal songs; agents-here first, then the rest A–Z', () => {
  const groups = districtGroups(hub)
  assert.deepEqual(groups.map((g) => g.label), [HERE_NOW, MORE])
  assert.deepEqual(groups[0].items.map((d) => d.id), ['mono-urmi', 'relay-zero-hq'])
  assert.deepEqual(groups[1].items.map((d) => d.name), ['Angel 613 Bell Tower', 'Tae Pier'])
  const ids = groups.flatMap((g) => g.items.map((d) => d.id))
  assert.equal(new Set(ids).size, ids.length)
  // Keep Swimming Lido only has a team goal, no songs: left out
  assert.ok(!ids.includes('happy-lido'))
})

test('nobody anywhere: one group', () => {
  const quiet = hub.map((d) => ({ ...d, agentsHere: 0 }))
  assert.deepEqual(districtGroups(quiet).map((g) => g.label), [MORE])
})

test('labels', () => {
  assert.equal(districtOptionLabel(hub.find((d) => d.id === 'mono-urmi')), 'Urmi Terrace · 2 agents · 1 playlist')
  assert.equal(districtOptionLabel(hub.find((d) => d.id === 'mono-tae')), 'Tae Pier · 2 playlists')
  assert.equal(districtOptionLabel({ name: 'Old' }), 'Old')
})

test('preselect: link, then last used, then busiest; unknown ids ignored', () => {
  assert.equal(initialDistrict(hub, { requested: 'mono-tae', last: 'mono-angel' }), 'mono-tae')
  assert.equal(initialDistrict(hub, { requested: 'nope', last: 'mono-angel' }), 'mono-angel')
  // a district with no goal songs isn't in the picker, so it isn't preselected
  assert.equal(initialDistrict(hub, { requested: 'happy-lido', last: '' }), 'mono-urmi')
  assert.equal(initialDistrict(hub, { requested: '', last: 'gone' }), 'mono-urmi')
  assert.equal(initialDistrict([], {}), '')
})

test('playlist link check', () => {
  assert.equal(looksLikePlaylistLink('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=x'), true)
  assert.equal(looksLikePlaylistLink(' https://open.spotify.com/intl-de/playlist/37i9dQZF1DXcBWIGoYBM5M '), true)
  assert.equal(looksLikePlaylistLink('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'), true)
  assert.equal(looksLikePlaylistLink('https://open.spotify.com/track/37i9dQZF1DXcBWIGoYBM5M'), false)
  assert.equal(looksLikePlaylistLink('hello'), false)
})
