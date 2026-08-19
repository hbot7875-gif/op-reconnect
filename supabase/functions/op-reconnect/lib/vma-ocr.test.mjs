import assert from 'node:assert/strict'
import { extractVoteTotal, watermarkMatches } from './vma-ocr.js'

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

console.log('11 VMA OCR regression tests passed')
