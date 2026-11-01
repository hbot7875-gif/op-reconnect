// Pure rules for the Playlist Maker district picker, shared by the server
// (getPlaylistMakerHub shapes the list) and the browser (playlist-maker.html
// and the in-game Vault group it). Plain JS so Node tests and Deno both load it.
//
// ~250 districts exist but only a few have goal songs, and fewer still have
// agents on them. The picker lists only districts with goals: "Agents are
// here now" (busiest first), then "More districts" A–Z, using the names
// agents see in the game (Relay Zero is "Home Base" there).

export const HOME_BASE_WARD = 'relay-zero'
export const HERE_NOW = 'Agents are here now'

/** The name a player sees for this district. */
export function displayDistrictName(d) {
  return d?.wardId === HOME_BASE_WARD || d?.ward_id === HOME_BASE_WARD ? 'Home Base' : String(d?.name || '')
}

/** Server: one row per active district, with the counts the picker shows.
 *  `agentRows` are active rc_player_districts rows ({ district_id }),
 *  `playlistRows` active shared Vault rows ({ district_id }). */
export function hubDistricts({ districts = [], wards = [], goals = [], agentRows = [], playlistRows = [] }) {
  const count = (rows) => rows.reduce((m, r) => m.set(r.district_id, (m.get(r.district_id) || 0) + 1), new Map())
  const agents = count(agentRows)
  const playlists = count(playlistRows)
  const wardName = new Map(wards.map((w) => [w.id, w.name]))
  const songs = new Map()
  for (const g of goals) {
    if (!g?.district_id || (g.kind !== 'track' && g.kind !== 'album')) continue
    if (!songs.has(g.district_id)) songs.set(g.district_id, [])
    songs.get(g.district_id).push({ kind: g.kind, label: String(g.label || '') })
  }
  return districts.map((d) => ({
    id: d.id,
    name: displayDistrictName(d),
    wardId: d.ward_id,
    wardName: d.ward_id === HOME_BASE_WARD ? 'Home Base' : (wardName.get(d.ward_id) || ''),
    agentsHere: agents.get(d.id) || 0,
    playlists: playlists.get(d.id) || 0,
    goals: songs.get(d.id) || [],
  }))
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** "Urmi Terrace · 13 agents · 3 playlists" — counts only when known. */
export function districtOptionLabel(d) {
  const bits = [String(d?.name || '')]
  if (Number(d?.agentsHere) > 0) bits.push(plural(d.agentsHere, 'agent'))
  if (Number.isFinite(Number(d?.playlists))) bits.push(plural(Number(d.playlists), 'playlist'))
  return bits.join(' · ')
}

export const MORE = 'More districts'

/** Only districts that have goal songs — a playlist for a district with no
 *  goals has nothing to help with, and listing all ~250 made the picker a
 *  wall. */
export const withGoals = (districts = []) => districts.filter((d) => Array.isArray(d.goals) && d.goals.length > 0)

/** Browser: [{ label, items }] over the districts with goals — "Agents are
 *  here now" first (busiest first), then "More districts" A–Z. Every
 *  district appears exactly once. */
export function districtGroups(districts = []) {
  const byName = (a, b) => String(a.name).localeCompare(String(b.name))
  const list = withGoals(districts)
  const here = list.filter((d) => Number(d.agentsHere) > 0)
    .sort((a, b) => b.agentsHere - a.agentsHere || byName(a, b))
  const rest = list.filter((d) => !(Number(d.agentsHere) > 0)).sort(byName)
  return [
    ...(here.length ? [{ label: HERE_NOW, items: here }] : []),
    ...(rest.length ? [{ label: MORE, items: rest }] : []),
  ]
}

/** The district to preselect: the one asked for in the link, else the last
 *  one used on this device, else the busiest — each only if it exists. */
export function initialDistrict(all = [], { requested = '', last = '' } = {}) {
  const districts = withGoals(all)
  const has = (id) => id && districts.some((d) => d.id === id)
  if (has(requested)) return requested
  if (has(last)) return last
  const busiest = [...districts].sort((a, b) => (b.agentsHere || 0) - (a.agentsHere || 0))[0]
  return busiest?.id || ''
}

/** True for something that looks like a Spotify playlist link. */
export function looksLikePlaylistLink(text) {
  return /open\.spotify\.com\/(intl-[a-z]{2}\/)?playlist\/[A-Za-z0-9]{10,}|^spotify:playlist:[A-Za-z0-9]{10,}/.test(String(text || '').trim())
}

/** The playlist id inside a link, or ''. */
export function playlistIdFromLink(text) {
  const m = /playlist[/:]([A-Za-z0-9]{10,})/.exec(String(text || ''))
  return m ? m[1] : ''
}

/** "Districts needing playlists": where agents are, with the fewest
 *  playlists first (then the most agents). At most `limit`, and only
 *  districts under `enough` playlists. */
export function neededDistricts(districts = [], { limit = 5, enough = 5 } = {}) {
  return withGoals(districts)
    .filter((d) => Number(d.agentsHere) > 0 && Number(d.playlists || 0) < enough)
    .sort((a, b) => (a.playlists || 0) - (b.playlists || 0) || b.agentsHere - a.agentsHere)
    .slice(0, limit)
}

/** "Your playlists": search by title or note, filter by district, newest or
 *  oldest first. `rows` are getPlaylistMakerHub's playlists. */
export function filterMine(rows = [], { q = '', district = '', sort = 'newest' } = {}) {
  const needle = String(q).trim().toLowerCase()
  const districtOf = (r) => r.district_id || r.config?.districtId || ''
  const out = rows.filter((r) => (!district || districtOf(r) === district)
    && (!needle || `${r.name || ''} ${r.config?.note || ''}`.toLowerCase().includes(needle)))
  const t = (r) => Date.parse(r.created_at) || 0
  return out.sort((a, b) => (sort === 'oldest' ? t(a) - t(b) : t(b) - t(a)))
}

/** The districts that appear in "Your playlists", most-used first, for the
 *  filter chips. */
export function mineDistricts(rows = [], districts = []) {
  const counts = new Map()
  for (const r of rows) {
    const id = r.district_id || r.config?.districtId
    if (id) counts.set(id, (counts.get(id) || 0) + 1)
  }
  const name = (id) => districts.find((d) => d.id === id)?.name || rows.find((r) => (r.district_id || r.config?.districtId) === id)?.config?.districtName || 'District removed'
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, name: name(id), count: n }))
}
