// Pure rules for the Playlist Maker district picker, shared by the server
// (getPlaylistMakerHub shapes the list) and the browser (playlist-maker.html
// and the in-game Vault group it). Plain JS so Node tests and Deno both load it.
//
// ~250 districts exist but only a handful have agents on them at any time.
// The picker leads with those ("Agents are here now", busiest first), then
// every other district under its ward, A–Z, using the names agents see in
// the game (Relay Zero is "Home Base" there).

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

/** Browser: [{ label, items }] — "Agents are here now" first (busiest
 *  first), then each ward (Home Base first, then A–Z) with its districts
 *  A–Z. Every district appears exactly once. */
export function districtGroups(districts = []) {
  const byName = (a, b) => String(a.name).localeCompare(String(b.name))
  const here = districts.filter((d) => Number(d.agentsHere) > 0)
    .sort((a, b) => b.agentsHere - a.agentsHere || byName(a, b))
  const groups = here.length ? [{ label: HERE_NOW, items: here }] : []
  const wards = new Map()
  for (const d of districts) {
    if (Number(d.agentsHere) > 0) continue
    const key = d.wardName || 'Other'
    if (!wards.has(key)) wards.set(key, [])
    wards.get(key).push(d)
  }
  const wardOrder = [...wards.keys()].sort((a, b) =>
    (a === 'Home Base' ? -1 : b === 'Home Base' ? 1 : a.localeCompare(b)))
  for (const key of wardOrder) groups.push({ label: key, items: wards.get(key).sort(byName) })
  return groups
}

/** The district to preselect: the one asked for in the link, else the last
 *  one used on this device, else the busiest — each only if it exists. */
export function initialDistrict(districts = [], { requested = '', last = '' } = {}) {
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
  return districts
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
