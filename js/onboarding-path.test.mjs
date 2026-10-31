import test from 'node:test'
import assert from 'node:assert/strict'
import { fromVotingLink, suggestCodename } from './onboarding-path.js'

test('a voting link or a remembered invite means the quick path', () => {
  assert.equal(fromVotingLink('?screen=voting', null), true)
  assert.equal(fromVotingLink('?screen=voting&team=aliens', null), true)
  assert.equal(fromVotingLink('', 'hooligans'), true)
  assert.equal(fromVotingLink('?screen=moon', null), false)
  assert.equal(fromVotingLink('', null), false)
  assert.equal(fromVotingLink(undefined, undefined), false)
})

test('suggested codenames pass the joinGame codename rules', () => {
  const seq = [0, 0, 0.5, 0.999, 0.999, 0, 0.3, 0.7, 0.1]
  for (let i = 0; i < 200; i++) {
    let k = i
    const rand = () => (seq[k++ % seq.length] + i / 1000) % 1
    const c = suggestCodename(rand)
    assert.match(c, /^[\p{L}\p{N} ._-]{3,24}$/u)
    assert.doesNotMatch(c, /^agent\s*\d+$/i)
    assert.doesNotMatch(c, /^\d+$/)
    assert.match(c, /\d{4}$/)
  }
})

test('the two words of a codename differ', () => {
  assert.equal(suggestCodename(() => 0), 'PurpleBorahae1000')
})
