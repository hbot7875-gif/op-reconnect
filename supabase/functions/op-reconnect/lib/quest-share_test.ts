import {getQuestShareSource,selectedQuestShareData} from './reconnect-missions.ts'
const assert=(value:any,message='assertion failed')=>{if(!value)throw new Error(message)}
function db(myStatus='joined',pending=true,checklist=false){
 const goal={id:'goal',variant:'connect',config:checklist?{checklist:{tracks:[{label:'one',keys:['one']}]}}:{sharedTrack:{label:'My You / Still With You',keys:['one'],target:500}}}
 const tables:any={
 rc_player_districts:['SELF','OTHER'].map(agent_no=>({agent_no,district_id:'district',status:'active',goals:{reconnect:goal}})),
 rc_reconnect_missions:[{id:'mission',district_id:'district',goal_id:'goal',status:'open',phase:'cipher',required_agents:3,expires_at:'2099-01-01'}],
 rc_reconnect_participants:[{mission_id:'mission',agent_no:'SELF',status:myStatus,joined_at:new Date().toISOString(),streamed_at:'2026-01-01'},{mission_id:'mission',agent_no:'OTHER',status:'joined',joined_at:new Date().toISOString(),streamed_at:'2026-01-01'},...(pending?[{mission_id:'mission',agent_no:'PENDING',status:'invited',joined_at:new Date().toISOString()}]:[])],
 rc_reconnect_messages:[{id:1,mission_id:'mission',agent_no:'SELF',body:'hello',created_at:'2026-09-08T10:00:00Z'},{id:2,mission_id:'mission',agent_no:'OTHER',body:'hi 😭',created_at:'2026-09-08T10:00:01Z'},{id:3,mission_id:'other-mission',agent_no:'OTHER',body:'private',created_at:'2026-09-08T10:00:02Z'}],
 rc_players:[{agent_no:'SELF',codename:'secretname'},{agent_no:'OTHER',codename:'othername'}],rc_agents:[],rc_goals:[{id:'goal',label:'This Is RM: Full Playlist'}],
 rc_daily_activity:['SELF','OTHER'].map(agent_no=>({agent_no,kst_date:'2090-01-01',track_counts:{one:{n:120}},raw_streams:120})),
 }
 return {tables,from(table:string){let rows=[...(tables[table]||[])],single=false;const q:any={
 select(){return q},eq(k:string,v:any){rows=rows.filter(r=>r[k]===v);return q},in(k:string,values:any[]){rows=rows.filter(r=>values.includes(r[k]));return q},gte(k:string,v:any){rows=rows.filter(r=>r[k]>=v);return q},
 order(k:string,opts:any={}){rows.sort((a,b)=>(a[k]>b[k]?1:-1)*(opts.ascending===false?-1:1));return q},limit(n:number){rows=rows.slice(0,n);return q},maybeSingle(){single=true;return q},
 then(resolve:any){return Promise.resolve({data:single?(rows[0]||null):rows,error:null}).then(resolve)},
 };return q}}
}
Deno.test('invited participant cannot read share source or publish',async()=>{const result=await getQuestShareSource(db('invited'),{agentNo:'SELF',districtId:'district'});assert(!result.success)})
Deno.test('pending invite reserves a seat and source has IDs but no original authors',async()=>{const result:any=await getQuestShareSource(db(),{agentNo:'SELF',districtId:'district'});assert(result.success);assert(result.quest.availableSeats===0);assert(result.quest.progress===240);assert(result.messages.length===2);assert(result.messages[0].id==='1');assert(!JSON.stringify(result).includes('OTHER'));assert(!JSON.stringify(result).includes('secretname'))})
Deno.test('selected IDs are validated, ordered and projected; foreign IDs rejected',async()=>{const database=db();const params={agentNo:'SELF',districtId:'district',includeChat:true,messageIds:['2','1']};const result:any=await selectedQuestShareData(database,params);assert(result.success);assert(result.data.messages[0].label==='YOU');assert(result.data.messages[1].label==='AGENT');assert(!('id' in result.data.messages[0]));assert(!(await selectedQuestShareData(database,{...params,messageIds:['3']})).success);assert(!(await selectedQuestShareData(database,{...params,includeChat:false})).success)})
Deno.test('no chat selected means no transcript in frozen data',async()=>{const result:any=await selectedQuestShareData(db(),{agentNo:'SELF',districtId:'district',includeChat:false,messageIds:[]});assert(result.success);assert(result.data.messages.length===0)})
Deno.test('checklist progress counts finished agents, never sums their streams',async()=>{const result:any=await getQuestShareSource(db('joined',false,true),{agentNo:'SELF',districtId:'district'});assert(result.success);assert(result.quest.countingType==='checklist');assert(result.quest.progress===2);assert(result.quest.target===3);assert(result.quest.availableSeats===1)})
Deno.test('known names in selected text are rejected server side',async()=>{const database=db();database.tables.rc_reconnect_messages[0].body='hello secretname';const result=await selectedQuestShareData(database,{agentNo:'SELF',districtId:'district',includeChat:true,messageIds:['1']});assert(!result.success)})
