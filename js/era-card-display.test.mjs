import assert from 'node:assert/strict'
import test from 'node:test'
import { powerEraCards } from './era-card-display.js'

test('weekly power decks omit collected permanent birthday keepsakes', () => {
  const cards = [
    { id: 'jk-golden-birthday-2026', name: 'GOLDEN Birthday', status: 'keepsake', isSpecial: true },
    { id: 'golden', name: 'GOLDEN', status: 'dark' },
    { id: 'hyyh', name: 'HYYH', status: 'lit' },
  ]

  assert.deepEqual(powerEraCards(cards).map((card) => card.id), ['golden', 'hyyh'])
})

test('active birthday progress still appears until it becomes a keepsake', () => {
  const active = { id: 'future-birthday', status: 'dark', isSpecial: true }
  assert.deepEqual(powerEraCards([active]), [active])
  assert.deepEqual(powerEraCards(null), [])
})
