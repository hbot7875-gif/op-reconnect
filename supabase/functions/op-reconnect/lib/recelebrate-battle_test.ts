import { qualifyBattleRows, trackKeyMap, type QualifyContext, type ScrobbleRow } from './recelebrate-battle.ts'

function assert(value: unknown, message = 'assertion failed') {
  if (!value) throw new Error(message)
}

// The same 17 tracks + match keys the migration seeds.
const TRACKS = [
  ['body-to-body', ['body to body']], ['hooligan', ['hooligan']], ['aliens', ['aliens']], ['fya', ['fya']],
  ['two-point-oh', ['20']], ['no-29', ['no 29', 'no29']], ['swim', ['swim']], ['merry-go-round', ['merry go round']],
  ['normal', ['normal']], ['like-animals', ['like animals']], ['they-dont-know-bout-us', ['they dont know bout us']],
  ['one-more-night', ['one more night']], ['please', ['please']], ['into-the-sun', ['into the sun']],
  ['wild-flower', ['wild flower', '야생화', '야생화 wild flower']], ['haegeum', ['haegeum', '해금', '해금 haegeum']],
  ['killin-it-girl', ['killin it girl', 'killing it girl']],
].map(([track_id, match_keys]) => ({ track_id: track_id as string, match_keys: match_keys as string[] }))

const FROM = 1_789_876_800 // 2026-09-20T04:00:00Z
const UNTIL = FROM + 86_400

function ctx(over: Partial<QualifyContext> = {}): QualifyContext {
  return {
    fromTs: FROM, untilTs: UNTIL,
    keyToTrack: trackKeyMap(TRACKS),
    selectedSource: new Map([['AGENT_H', 'listenbrainz'], ['AGENT_A', 'direct'], ['AGENT_NOTEAM', 'listenbrainz']]),
    teamSince: new Map([['AGENT_H', FROM - 3600], ['AGENT_A', FROM + 600]]),
    allow: ['bts', '방탄소년단', 'rm', 'jin', 'suga', 'agust d', 'j hope', 'jhope', 'jimin', 'v', 'jung kook', 'jungkook'],
    overrides: {},
    ...over,
  }
}

let id = 1
const row = (agent: string, track: string, artist: string | null, at: number, source = agent === 'AGENT_A' ? 'webhook' : 'listenbrainz'): ScrobbleRow =>
  ({ id: id++, agent_no: agent, track_name: track, artist_name: artist, listened_at: at, source })

Deno.test('every one of the 17 tracks maps from real-world title variants', () => {
  const variants: [string, string, string][] = [
    ['Body to Body', 'BTS', 'body-to-body'], ['Hooligan', 'BTS', 'hooligan'], ['Aliens', 'BTS', 'aliens'],
    ['FYA', 'BTS', 'fya'], ['2.0', 'BTS', 'two-point-oh'], ['No. 29', 'BTS', 'no-29'], ['No.29', 'BTS', 'no-29'],
    ['SWIM', 'BTS', 'swim'], ['Merry Go Round', 'BTS', 'merry-go-round'], ['NORMAL (Clean Ver.)', 'BTS', 'normal'],
    ['Like Animals', 'BTS', 'like-animals'], ["they don't know 'bout us", 'BTS', 'they-dont-know-bout-us'],
    ['One More Night', 'BTS', 'one-more-night'], ['Please', 'BTS', 'please'], ['Into the Sun', 'BTS', 'into-the-sun'],
    ['Wild Flower (with youjeen)', 'RM', 'wild-flower'], ['야생화 (Wild Flower)', 'RM', 'wild-flower'],
    ['해금', 'Agust D', 'haegeum'], ['Haegeum', 'Agust D', 'haegeum'], ["Killin' It Girl (feat. GloRilla)", 'j-hope', 'killin-it-girl'],
  ]
  const rows = variants.map(([t, a], i) => row('AGENT_H', t, a, FROM + 100 + i))
  const out = qualifyBattleRows(rows, ctx())
  assert(out.length === variants.length, `expected ${variants.length}, got ${out.length}`)
  variants.forEach(([, , trackId], i) => assert(out[i].track_id === trackId, `${variants[i][0]} → ${out[i].track_id}`))
  assert(new Set(out.map((r) => r.track_id)).size === 17, 'all 17 tracks covered')
})

Deno.test('only plays inside the exact 24h window qualify', () => {
  const out = qualifyBattleRows([
    row('AGENT_H', 'SWIM', 'BTS', FROM - 1),
    row('AGENT_H', 'SWIM', 'BTS', FROM),
    row('AGENT_H', 'SWIM', 'BTS', UNTIL - 1),
    row('AGENT_H', 'SWIM', 'BTS', UNTIL),
  ], ctx())
  assert(out.length === 2 && out[0].listened_at === FROM && out[1].listened_at === UNTIL - 1)
})

Deno.test('no team → no contribution; plays before the team was chosen don\'t count', () => {
  const out = qualifyBattleRows([
    row('AGENT_NOTEAM', 'SWIM', 'BTS', FROM + 10),
    row('AGENT_A', 'Haegeum', 'Agust D', FROM + 599),
    row('AGENT_A', 'Haegeum', 'Agust D', FROM + 600),
  ], ctx())
  assert(out.length === 1 && out[0].agent_no === 'AGENT_A' && out[0].listened_at === FROM + 600)
})

Deno.test('same legitimacy rules as the rest of ReConnect', () => {
  const out = qualifyBattleRows([
    row('AGENT_H', 'Please', 'Some Other Artist', FROM + 1), // not a BTS artist
    row('AGENT_H', 'Advertisement', 'Spotify', FROM + 2), // ad
    row('AGENT_H', 'SWIM', 'BTS', FROM + 3, 'statsfm'), // not the agent's selected source
    row('AGENT_H', 'Dynamite', 'BTS', FROM + 4), // not one of the 17
    row('AGENT_H', 'SWIM with RM (Chill Hip Hop Remix)', 'BTS', FROM + 5), // a different song key
    row('AGENT_H', 'SWIM', null, FROM + 6), // no artist on the row (stats.fm-style) is trusted
  ], ctx())
  assert(out.length === 1 && out[0].listened_at === FROM + 6, JSON.stringify(out))
})
