import test from 'node:test'
import assert from 'node:assert/strict'
import { publicQuest, publicSnapshot, selectionProblem, messageProblem, captionSuggestions, questLinkPayload, questProgressLabel, wrapText } from '../supabase/functions/op-reconnect/lib/quest-share-rules.js'
import { questLayout } from '../supabase/functions/op-reconnect/lib/quest-share-layout.js'
import { questLanding } from '../worker/index.js'
const q={title:'My You / Still With You',countingType:'pooled',progress:240,target:500,joined:5,capacity:6,availableSeats:1,complete:false,messages:[],capturedAt:'2026-09-08T10:00:00Z'}
test('every public share kind drops private and unrecognized fields',()=>{
  for(const kind of ['district','red_zone_active','red_zone_success','quest']){
    const result=publicSnapshot({id:'abc',kind,data:{...q,agentNo:'SECRET',messages:[{label:'moonchild',body:'hey',agentNo:'SECRET',id:'99'}],goals:[{label:'SWIM',target:50,progress:4,keys:['SECRET']}],token:'SECRET'},internal:'SECRET'})
    assert(!JSON.stringify(result).includes('SECRET'));assert(!JSON.stringify(result).includes('moonchild'));assert.equal(result.data.messages?.[0].id,undefined)
  }
})
test('contact details, markup, identifiers and protected answers are blocked',()=>{
  for(const body of ['https://example.com','hi @handle','text me +91 98765 43210','AGENT114','me@example.org','<script>alert(1)</script>','hello\u202eabc','a.com','my codeword is seoul'])assert(messageProblem(body,['seoul']),body)
  for(const body of ['Hi gayss','I mean guys',"I won’t 😋",'보라해 💜','हम कर सकते हैं 😭'])assert.equal(messageProblem(body),null)
})
test('selection has per-message errors, never truncates to fit',()=>{
  assert.equal(selectionProblem([{body:'x'.repeat(151)}]).index,0)
  assert(selectionProblem(Array.from({length:6},()=>({body:'hi'}))))
  assert(selectionProblem(Array.from({length:5},()=>({body:'long '.repeat(25)}))))
})
test('checklists never use pooled wording; full and completed teams never invite',()=>{
  assert.match(questProgressLabel({...q,countingType:'checklist'}),/TRACKLIST/)
  assert(!captionSuggestions({...q,availableSeats:0}).Invite)
  assert(!captionSuggestions({...q,complete:true}).Invite)
  assert(!captionSuggestions(q).Hooligan)
  assert(captionSuggestions({...q,title:'ARIRANG'}).Hooligan)
  assert(!captionSuggestions({...q,availableSeats:2}).Invite.some(s=>s.includes('one seat')))
})
test('edited, blank and pasted-URL captions send the link exactly once',()=>{
  const url='https://hopetrackers.org/share/quest/abc'
  for(const caption of ['', 'my own caption', `hey ${url}\n${url}`])assert.equal(JSON.stringify(questLinkPayload(caption,url)).split(url).length-1,1)
  assert.equal(questLinkPayload('',url).text,'')
})
test('layouts support every counting type and keep no-chat layout complete',()=>{
  for(const type of ['pooled','checklist','signals','team'])for(const complete of [true,false])for(const portrait of [true,false]){
    const layout=questLayout({...q,countingType:type,complete},portrait)
    assert.equal(layout.width,portrait?1080:1200)
    assert(layout.ops.every(o=>o.y<layout.height && o.y>=0))
    assert(!layout.ops.some(o=>o.text==='YOU'))
  }
})
test('emoji and Unicode wrapping keeps grapheme clusters intact',()=>{assert(wrapText('💜 🐰 안녕하세요 hello',12).join(' ').includes('안녕하세요'));assert(wrapText('👩‍👩‍👧‍👧 hello',4)[0].includes('👩‍👩‍👧‍👧'))})
test('landing is escaped and discovery-only, no internal fields or chat proxy',()=>{
  const html=questLanding({id:'abc',kind:'quest',data:{...q,messages:[{label:'YOU',body:'Hello & welcome'}],missionId:'SECRET'}},'abcdefghijklmnopqrstuv')
  assert(html.includes('Hello &amp; welcome'));assert(!html.includes('SECRET'));assert(!html.includes('sessionToken'));assert(!html.includes('joinQuest'))
  assert(!questLanding({id:'abc',kind:'quest',data:q},'abcdefghijklmnopqrstuv').includes('aria-label="Selected conversation"'))
})
