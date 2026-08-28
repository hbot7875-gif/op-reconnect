import assert from 'node:assert/strict'
import {
  districtFraction,
  districtGoalsLeft,
  districtMissionsComplete,
  districtPercent,
} from './district-progress.js'

function track(progress, target, done = progress >= target) {
  return { progress, target, done }
}

function album(passesDone, target, done = passesDone >= target) {
  return { passesDone, target, done }
}

{
  const d = {
    trackGoals: [track(10, 10)],
    albums: [],
    reconnect: { done: false, restorationProgress: { progress: 91, target: 100 } },
  }
  assert.equal(districtPercent(d), 92, 'nine remaining ReConnect streams must not display 100%')
  assert.equal(districtGoalsLeft(d), 1, 'unfinished ReConnect must count as one remaining mission')
  assert.equal(districtMissionsComplete(d), false)
}

{
  const d = {
    trackGoals: [track(10, 10)],
    albums: [album(4, 4)],
    reconnect: { done: false }, // older payload or unopened puzzle/invite
  }
  assert.equal(districtPercent(d), 93)
  assert.equal(districtGoalsLeft(d), 1)
}

{
  const d = { trackGoals: [track(999, 1000, false)], albums: [], reconnect: null }
  assert.equal(districtPercent(d), 99, 'rounding alone must not make an unfinished goal look restored')
}

{
  const d = {
    trackGoals: [track(10, 10)],
    albums: [album(4, 4)],
    reconnect: { done: false, restorationProgress: { progress: 100, target: 100 } },
  }
  assert.equal(districtFraction(d), 0.99, 'a pending cipher after streaming must reserve the final 1%')
  assert.equal(districtPercent(d), 99)
}

{
  const d = {
    trackGoals: [track(10, 10)],
    albums: [album(4, 4)],
    reconnect: { done: true, restorationProgress: { progress: 100, target: 100 } },
  }
  assert.equal(districtPercent(d), 100)
  assert.equal(districtGoalsLeft(d), 0)
  assert.equal(districtMissionsComplete(d), true)
}

{
  const d = { trackGoals: [track(10, 10)], albums: [album(4, 4)], reconnect: null }
  assert.equal(districtPercent(d), 100, 'districts without ReConnect retain normal completion behavior')
}

console.log('district progress: 6 tests passed')
