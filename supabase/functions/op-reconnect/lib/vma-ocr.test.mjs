import assert from 'node:assert/strict'
import {
  evaluateVoteProof, extractVoteTotal, proofKeywordMatches, validVoteTotals, watermarkMatches,
} from './vma-ocr.js'

assert.equal(watermarkMatches('YOONGI19', 'YOONGI19'), true)
assert.equal(watermarkMatches('YOONGI 19', 'YOONGI19'), true)
assert.equal(watermarkMatches('Y00NGI19', 'YOONGI19'), true)
assert.equal(watermarkMatches('YOONGl19', 'YOONGI19'), true)
assert.equal(watermarkMatches('YOONG19', 'YOONGI19'), true)
assert.equal(watermarkMatches('ONGI19', 'YOONGI19'), true)
assert.equal(watermarkMatches('BLACKPINK JUMP BTS SWIM 20 Votes', 'YOONGI19'), false)

assert.equal(extractVoteTotal('BLACKPINK 0 Votes BTS SWIM 20 Votes'), 20)
assert.equal(extractVoteTotal('20  +   Votes'), 20)
assert.equal(extractVoteTotal('Vvioko music awaros BLACKPINK JUMP Votes ONGI19 20 Votes'), 20)
assert.equal(extractVoteTotal('0 Votes'), null)
assert.equal(extractVoteTotal('Votes 20'), 20)
assert.equal(extractVoteTotal('4:05 34% BLACKPINK 0 Votes BTS SWIM 20 Votes', [20]), 20)
assert.equal(extractVoteTotal('BTS SWIM 25 Votes', [20]), null)
assert.equal(extractVoteTotal('BTS SWIM 20 Votes', [10]), null)
assert.deepEqual(validVoteTotals(10), [10])
assert.deepEqual(validVoteTotals(20), [20])

assert.equal(proofKeywordMatches('8TS SWlM', 'BTS'), true)
assert.equal(proofKeywordMatches('8TS SWlM', 'SWIM'), true)
assert.equal(proofKeywordMatches('BLACKPINK JUMP', 'BTS'), false)

const validProof = 'VMA BTS SWIM 20 Votes YOONGI19'
assert.equal(evaluateVoteProof(validProof, {
  expectedCode: 'YOONGI19', songKeywords: ['SWIM'], displayedTotal: 20, allowedVoteTotals: [20],
}).passed, true)
assert.equal(evaluateVoteProof(validProof, {
  expectedCode: 'YOONGI19', songKeywords: ['SWIM'], displayedTotal: 10,
}).passed, false)
assert.equal(evaluateVoteProof('VMA BLACKPINK JUMP 20 Votes YOONGI19', {
  expectedCode: 'YOONGI19', songKeywords: ['SWIM'], displayedTotal: 20,
}).passed, false)
assert.equal(evaluateVoteProof('VMA BTS SWIM 20 Votes WRONG19', {
  expectedCode: 'YOONGI19', songKeywords: ['SWIM'], displayedTotal: 20,
}).passed, false)
assert.equal(evaluateVoteProof('VMA 8TS SWlM 20 Votes YOONGI19', {
  expectedCode: 'YOONGI19', songKeywords: ['SWIM'], allowedVoteTotals: [20],
}).passed, true)
assert.equal(evaluateVoteProof('VMA SWIM 20 Votes YOONGI19', {
  expectedCode: 'YOONGI19', songKeywords: ['SWIM'], allowedVoteTotals: [20],
}).passed, true)
assert.equal(evaluateVoteProof('VMA BTS SWIM 25 Votes YOONGI19', {
  expectedCode: 'YOONGI19', songKeywords: ['SWIM'], allowedVoteTotals: [20],
}).passed, false)

console.log('28 VMA OCR regression tests passed')
