import { openDistrictShare } from './share-flow.js'
export { openRedZoneShare, openSuccessfulRedZoneShare } from './share-flow.js'

export function openShare(state, options = {}) {
  return openDistrictShare(state, options)
}
