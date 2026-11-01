import test from 'node:test'
import assert from 'node:assert/strict'
import {
  hubDistricts, districtGroups, districtOptionLabel, initialDistrict, looksLikePlaylistLink, HERE_NOW,
  playlistIdFromLink, neededDistricts, filterMine, mineDistricts,
} from './playlist-maker-rules.js'

test('playlist id from a link', () => {
  assert.equal(playlistIdFromLink('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=1'), '37i9dQZF1DXcBWIGoYBM5M')
  assert.equal(playlistIdFromLink('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'), '37i9dQZF1DXcBWIGoYBM5M')
  assert.equal(playlistIdFromLink('https://open.spotify.com/track/37i9dQZF1DXcBWIGoYBM5M'), '')
})

test('districts needing playlists: agents there, fewest playlists first', () => {
  const list = [
    { id: 'a', agentsHere: 13, playlists: 3 }, { id: 'b', agentsHere: 38, playlists: 2 },
    { id: 'c', agentsHere: 4, playlists: 0 }, { id: 'd', agentsHere: 9, playlists: 21 }, { id: 'e', agentsHere: 0, playlists: 0 },
  ]
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

test('groups: agents-here first by count, then wards A–Z, each district once', () => {
  const groups = districtGroups(hub)
  assert.deepEqual(groups.map((g) => g.label), [HERE_NOW, 'Happy Ward', 'Mono Ward'])
  assert.deepEqual(groups[0].items.map((d) => d.id), ['mono-urmi', 'relay-zero-hq'])
  assert.deepEqual(groups[2].items.map((d) => d.name), ['Angel 613 Bell Tower', 'Tae Pier'])
  const ids = groups.flatMap((g) => g.items.map((d) => d.id))
  assert.equal(new Set(ids).size, districts.length)
})

test('Home Base ward leads when nobody is there', () => {
  const quiet = hub.map((d) => ({ ...d, agentsHere: 0 }))
  assert.equal(districtGroups(quiet)[0].label, 'Home Base')
})

test('labels', () => {
  assert.equal(districtOptionLabel(hub.find((d) => d.id === 'mono-urmi')), 'Urmi Terrace · 2 agents · 1 playlist')
  assert.equal(districtOptionLabel(hub.find((d) => d.id === 'mono-tae')), 'Tae Pier · 2 playlists')
  assert.equal(districtOptionLabel({ name: 'Old' }), 'Old')
})

test('preselect: link, then last used, then busiest; unknown ids ignored', () => {
  assert.equal(initialDistrict(hub, { requested: 'mono-tae', last: 'happy-lido' }), 'mono-tae')
  assert.equal(initialDistrict(hub, { requested: 'nope', last: 'happy-lido' }), 'happy-lido')
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
