import { dailyStreamReviewThreshold, reviewModeVolume, suggestedModeFor } from './mode-guard.ts'
import { streamsPerXpFor } from './config.ts'
import { goalTargetForMode } from './districts.ts'

function assert(value: unknown, message = 'assertion failed') {
  if (!value) throw new Error(message)
}

Deno.test('mode volume stays review-only and needs three high days', () => {
  assert(dailyStreamReviewThreshold('easy') === 480)
  assert(dailyStreamReviewThreshold('steady') === 960)
  assert(reviewModeVolume([481, 600], 'easy') === null)
  const review = reviewModeVolume([481, 600, 700, 20], 'easy')
  assert(review?.mode === 'easy')
  assert(review?.highVolumeDays === 3)
  assert(review?.reviewThreshold === 480)
  assert(review?.suggestedMode === 'steady')
  assert(suggestedModeFor('steady') === 'medium')
  assert(!('to' in (review || {})))
})

Deno.test('steady sits between Easy and Medium without changing frozen goals', () => {
  const content: any = {
    config: { modes: { easy: { multiplier: 1.3 }, steady: { multiplier: 2.5 }, medium: { multiplier: 5 } } },
    goals: [], wards: [], districts: [],
  }
  const goal: any = { target: 20, config: {} }
  assert(goalTargetForMode(content, 'easy', goal) === 26)
  assert(goalTargetForMode(content, 'steady', goal) === 50)
  assert(goalTargetForMode(content, 'medium', goal) === 100)
  assert(streamsPerXpFor(content, 'steady') === 15)
})
