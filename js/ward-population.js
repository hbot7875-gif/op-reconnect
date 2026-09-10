// How many agents are restoring each district in a ward.
//
// "In" a district means the district is active on their account, not that
// they have the app open — the ward list and the district roster both need
// that number, and presence (onlineNow) deliberately answers a different
// question. Kept in its own module so screen-ward.js and screen-district.js
// can share one cache without importing each other.

import { call } from './api.js'
import { getAgentNo } from './session.js'

const cache = new Map()
const inFlight = new Map()

/** Counts for one ward, keyed by district id. Cached for the session: the
 *  number moves when someone activates or finishes a district, which is far
 *  slower than the 90s poll that re-renders these screens. */
export function wardPopulation(wardId) {
  const id = String(wardId || '')
  if (!id) return Promise.resolve({})
  if (cache.has(id)) return Promise.resolve(cache.get(id))
  if (inFlight.has(id)) return inFlight.get(id)

  const request = call('getWardRoster', { agentNo: getAgentNo(), wardId: id })
    .then((res) => {
      const counts = res?.success ? (res.counts || {}) : {}
      // Only a real answer is cached — a failed call must not pin every
      // district in this ward at zero for the rest of the session.
      if (res?.success) cache.set(id, counts)
      return counts
    })
    .catch(() => ({}))
    .finally(() => inFlight.delete(id))

  inFlight.set(id, request)
  return request
}

/** The count already known for one district, without waiting on a fetch —
 *  for painting a button that must not flicker in from empty. */
export function knownDistrictPopulation(wardId, districtId) {
  return Number(cache.get(String(wardId || ''))?.[String(districtId || '')]) || 0
}
