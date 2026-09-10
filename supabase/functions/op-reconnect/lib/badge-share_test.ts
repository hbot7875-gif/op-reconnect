import {resolveBadgeShare,awardedArtwork} from './badge-share-source.ts'
function assert(v:unknown){if(!v)throw new Error('assertion failed')}
function db(options:any={}) {
  const records:any={rc_badges:{artwork_id:17},rc_badge_catalog:{rarity:'common'},rc_districts:{name:'Puple Sky Overlook',ward_id:'mono'},rc_badge_art:{storage_path:'exact-awarded.jpg',member:'j-hope',members:['j-hope']},...options}
  const calls:any[]=[]
  return {
    calls,
    from(table:string){const q:any={select(){return q},eq(k:string,v:any){calls.push([table,k,v]);return q},async maybeSingle(){return {data:records[table]}}};return q},
    storage:{from(bucket:string){assert(bucket==='badge-art');return {async download(path:string){calls.push(['download',path]);return {data:new Blob(['fixture'],{type:'image/jpeg'})}}}}},
  }
}
Deno.test('only supported, actually earned milestones resolve; no current progress or reroll',async()=>{
  const sb=db();const r=await resolveBadgeShare(sb,'AGENT_TEST','district_frag_1:scope');assert(r.data.milestonePercent===25&&r.artId===17);assert(r.suggestions.includes('hobi came home 😭'));assert(!('member' in r.data));assert(sb.calls.some(c=>c[1]==='agent_no'&&c[2]==='AGENT_TEST'))
  for(const id of ['ward:scope','event_jk_birthday_2026','district_frag_1']){let failed=false;try{await resolveBadgeShare(sb,'AGENT_TEST',id)}catch{failed=true}assert(failed)}
  for(const options of [{rc_badges:null},{rc_badges:{artwork_id:null}},{rc_districts:{name:'',ward_id:'mono'}},{rc_badge_catalog:null}]){let failed=false;try{await resolveBadgeShare(db(options),'A','district_frag_1:secret-scope')}catch(e){failed=true;assert(!String(e).includes('secret-scope'))}assert(failed)}
})
Deno.test('art resolver uses awarded ID and only trusted storage, never template pool or supplied URL',async()=>{
  const sb=db();const url=await awardedArtwork(sb,17);assert(url.startsWith('data:image/jpeg;base64,'));assert(sb.calls.some(c=>c[0]==='rc_badge_art'&&c[2]===17));assert(sb.calls.some(c=>c[0]==='download'&&c[1]==='exact-awarded.jpg'))
})
