import assert from 'node:assert/strict'
import { districtBadgeProgress } from './badge-rules.js'

const progress = (track, album = 0) => ({
  trackGoals: [{ progress: track, target: 100 }],
  albums: [{ passesDone: album, target: 10 }],
})

assert.deepEqual(districtBadgeProgress(progress(0, 0)), { percent: 0, templateIds: [] })
assert.deepEqual(districtBadgeProgress(progress(50, 0)), { percent: 25, templateIds: ['district_frag_1'] })
assert.deepEqual(districtBadgeProgress(progress(100, 0)), { percent: 50, templateIds: ['district_frag_1', 'district_frag_2'] })
assert.deepEqual(districtBadgeProgress(progress(100, 5)), { percent: 75, templateIds: ['district_frag_1', 'district_frag_2', 'district_frag_3'] })
assert.equal(districtBadgeProgress(progress(100, 10)).percent, 100)
assert.equal(districtBadgeProgress(progress(100, 10), { done: false }).percent, 67)
assert.equal(districtBadgeProgress(progress(100, 10), { done: true }).percent, 100)
assert.equal(districtBadgeProgress({ trackGoals: [], albums: [] }).percent, 0)

console.log('8 badge progress regression tests passed')
