import { dailyStreamReviewThreshold, reviewModeVolume } from './mode-guard.ts'

function assert(value: unknown, message = 'assertion failed') {
  if (!value) throw new Error(message)
}

Deno.test('mode volume stays review-only and needs three high days', () => {
  assert(dailyStreamReviewThreshold('easy') === 480)
  assert(reviewModeVolume([481, 600], 'easy') === null)
  const review = reviewModeVolume([481, 600, 700, 20], 'easy')
  assert(review?.mode === 'easy')
  assert(review?.highVolumeDays === 3)
  assert(review?.reviewThreshold === 480)
  assert(!('to' in (review || {})))
})
