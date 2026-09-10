import {test} from 'node:test'
import assert from 'node:assert/strict'
import {ARMY_BOMB_SHARE_CALLOUT,armyBombShareStatus} from './share-scene-copy.js'

test('ARMY Bomb share leads with current charge and the approved social hook',()=>{
  assert.equal(armyBombShareStatus({hoursRemaining:1,isDark:false}),'1H CHARGED')
  assert.equal(armyBombShareStatus({hoursRemaining:0,isDark:true}),'NEEDS SOME LOVE')
  assert.equal(ARMY_BOMB_SHARE_CALLOUT,'get ur own virtual ARMY Bomb · keep urs glowing too ↗')
})
