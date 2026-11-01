import assert from 'node:assert/strict'
import test from 'node:test'
import { catalogTitleKey, sameCatalogTitle, pickTitleMatch, trackTitleOwners, trackClaimedByOtherTitle } from './catalog-match.js'

const bts = (artists) => artists.some((a) => a.name === 'BTS')
const item = (name, id, artist = 'BTS') => ({ name, id, artists: [{ name: artist }] })

test('a "<song> <artist>" search never links a different title', () => {
  // The real search: "RUN BTS" returned the song Run BTS first.
  const items = [item('Run BTS', '69xoh'), item('Run', '3G1aA')]
  assert.equal(pickTitleMatch(items, 'RUN', bts).id, '3G1aA')
  assert.equal(pickTitleMatch([item('Dimple', '1rLk')], 'Like', bts), null)
  assert.equal(pickTitleMatch([item('Anpanman', '453W')], 'Go Go', bts), null)
})

test('only case, punctuation and feat. spelling are ignored', () => {
  assert.ok(sameCatalogTitle('IDOL (feat. Nicki Minaj)', 'IDOL (Feat. Nicki Minaj)'))
  assert.ok(sameCatalogTitle("they don't know 'bout us", 'they don’t know ’bout us'))
  assert.ok(sameCatalogTitle('Run', 'RUN'))
  assert.ok(!sameCatalogTitle('IDOL (feat. Nicki Minaj)', 'IDOL'))
  assert.ok(!sameCatalogTitle('Airplane pt.2', 'Airplane pt.2 - Japanese ver.'))
  assert.ok(!sameCatalogTitle('', ''))
  assert.equal(catalogTitleKey('2학년'), '2학년')
})

test('a non-BTS result with the right title is still refused', () => {
  assert.equal(pickTitleMatch([item('Run', 'x', 'Someone Else')], 'Run', bts), null)
})

test('a track stored under two titles is flagged for the by-name merge', () => {
  const uris = {
    'lfm:bts:run bts': { id: '69xoh', uri: 'spotify:track:69xoh', name: 'Run BTS' },
    'itunes:1627574655': { id: '69xoh', uri: 'spotify:track:69xoh', name: 'RUN' },
    'lfm:bts:run': { id: '3G1aA', uri: 'spotify:track:3G1aA', name: 'Run' },
    'itunes:x': { id: '3G1aA', uri: 'spotify:track:3G1aA', name: 'RUN' },
    gone: { notFound: true, name: 'Like' },
  }
  const owners = trackTitleOwners(uris)
  assert.equal(trackClaimedByOtherTitle(owners, '69xoh', 'RUN'), true)
  assert.equal(trackClaimedByOtherTitle(owners, '3G1aA', 'RUN'), false)
  assert.equal(trackClaimedByOtherTitle(owners, 'unknown', 'RUN'), false)
})
