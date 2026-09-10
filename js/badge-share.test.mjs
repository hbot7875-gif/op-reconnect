import {test} from 'node:test'
import assert from 'node:assert/strict'
import {BADGE_MILESTONES,badgeLayout,badgeReactions} from '../supabase/functions/op-reconnect/lib/badge-share-layout.js'
import {nextBadgeReaction} from './badge-share.js'
import {publicSnapshot,shareLinkPayload,questCallout} from '../supabase/functions/op-reconnect/lib/quest-share-rules.js'
import {questLayout} from '../supabase/functions/op-reconnect/lib/quest-share-layout.js'
import {badgeLanding} from '../worker/index.js'

test('badge public projection keeps milestone frozen and strips all private identifiers',()=>{
  const snapshot=publicSnapshot({id:'a'.repeat(22),kind:'badge',created_by:'private',badge_art_id:14,data:{milestonePercent:25,currentPercent:100,districtDisplayName:'Puple Sky Overlook',rarity:'common',reaction:'LOOK WHO I UNLOCKED 😭',artworkUrl:'private',scopeId:'private',badgeId:'private',unlockHint:'private'}})
  assert.equal(snapshot.data.milestonePercent,25);assert.ok(!JSON.stringify(snapshot).includes('private'));assert.ok(!('currentPercent' in snapshot.data))
  assert.equal(publicSnapshot({kind:'badge',data:{milestonePercent:42}}),null)
  assert.deepEqual(Object.values(BADGE_MILESTONES),[25,50,75,100])
})
test('all native payloads retain one URL and reaction only',()=>{
  const url='https://hopetrackers.org/share/badge/'+'a'.repeat(22)
  for(const title of ['District','Red Zone','Badge','Quest'])assert.deepEqual(shareLinkPayload(title,`look 😭 ${url} ${url}`,url),{title,text:'look 😭',url})
})
test('Quest callouts distinguish full, reserved, open and complete without fake playback',()=>{
  assert.equal(questCallout({availableSeats:1}),'come stream with us ↗')
  assert.equal(questCallout({availableSeats:0}),'stream along with us ↗')
  assert.equal(questCallout({complete:true,availableSeats:0}),'we actually did it 😭')
  for(const q of [{availableSeats:0},{availableSeats:1},{complete:true,availableSeats:0}]){
    const l=questLayout({...q,title:'My You / Still With You',countingType:'pooled',progress:372,target:500,joined:6,capacity:6,messages:[]})
    assert.ok(l.ops.some(o=>o.x>700));assert.ok(!l.ops.some(o=>/TEAM FULL|ARMY STREAMING/.test(o.text)))
  }
})
test('badge layout is art-first, portrait-only on request and landing has no private source',()=>{
  const d={milestonePercent:25,districtDisplayName:'Puple Sky Overlook',rarity:'common',reaction:'LOOK WHO I UNLOCKED 😭'}
  assert.equal(badgeLayout(d).width,1200);assert.equal(badgeLayout(d,true).height,1350);assert.ok(badgeLayout(d).art.w>=400)
  assert.ok(badgeLayout(d).ops.some(o=>o.text==='WHO DID YOU GET?'));assert.ok(badgeLayout(d).ops.some(o=>/restoring my district/.test(o.text)))
  const html=badgeLanding({kind:'badge',data:{...d,artworkUrl:'private/path',badgeId:'secret'}},'a'.repeat(22))
  assert.ok(!/private\/path|secret/.test(html));assert.ok(html.includes('25% Restored · Puple Sky Overlook'));assert.ok(html.includes('og:description'))
})
test('badge reactions are natural, member-aware only when supplied, and rotate without repeating',()=>{
  assert.ok(badgeReactions('hobi').includes('hobi came home 😭'))
  assert.ok(!badgeReactions('').some(v=>/hobi|jimin|yoongi/.test(v)))
  assert.equal(nextBadgeReaction(['one','two'],'one',()=>0),'two')
  assert.equal(nextBadgeReaction(['one','two'],'two',()=>0),'one')
})
