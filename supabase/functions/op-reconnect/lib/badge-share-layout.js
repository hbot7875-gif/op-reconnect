import { safeText, wrapText } from './quest-share-rules.js'

export const BADGE_MILESTONES = Object.freeze({district_frag_1:25,district_frag_2:50,district_frag_3:75,district_restored:100})
export const badgeReactions = member => [
  'LOOK WHO I GOT 😭😭',
  ...(member ? [`${member} came home 😭`] : []),
  'I was literally just streaming and got him???',
  "okay who did y'all get 👀",
  'show me your badges rn',
  'NO WAY I GOT HIM 😭',
  'LOOK WHO CAME HOME 😭',
  "who did y'all unlock 👀",
  'wait who did everyone else get',
  "I need to see everyone's badges rn 😭",
  'okay now show me yours',
  'WHO DID YOU GET 👀',
]

export function badgeLayout(data, portrait=false) {
  const width=portrait?1080:1200,height=portrait?1350:630,ops=[]
  const add=(text,x,y,size,color='#eee8f6',weight=700)=>ops.push({text,x,y,size,color,weight})
  const rare=data.rarity==='rare'
  const art=portrait?{x:190,y:215,w:700,h:rare?790:700,r:rare?38:350}:{x:rare?122:75,y:rare?75:94,w:rare?395:440,h:rare?480:440,r:rare?30:220}
  const x=portrait?80:620, max=portrait?30:21
  add('BADGE UNLOCKED',x,portrait?82:61,portrait?25:16,'#b59bcf',500)
  add('WHO DID YOU GET?',x,portrait?148:137,portrait?58:51,'#f5f0fa');ops.at(-1).eyes=true
  let y=portrait?art.y+art.h+90:245
  add(`${data.milestonePercent}% OF`,x,y,portrait?42:27,'#edc66f');y+=portrait?55:36
  const district=`${safeText(data.districtDisplayName,90).toUpperCase()} RESTORED`
  for(const line of wrapText(district,max)){add(line,x,y,portrait?42:27,'#edc66f');y+=portrait?53:34}
  add('got this from restoring my district',x,Math.max(y+18,portrait?1100:345),portrait?31:20,'#c8bdd3',400)
  add('show me your badges rn',x,portrait?1205:492,portrait?39:29,'#d3b9ef',600)
  add('OP: RECONNECT',x,height-72,portrait?27:23,'#b7a6c6')
  add('hopetrackers.org',x,height-32,portrait?29:26,'#cfc0df',400)
  return {width,height,art,ops,background:'#100d1a'}
}

export function badgeImageElement(h,data,artwork,portrait=false) {
  const l=badgeLayout(data,portrait),a=l.art
  return h('div',{style:{display:'flex',position:'relative',width:l.width,height:l.height,background:l.background,fontFamily:'Roboto'}},
    h('div',{style:{display:'flex',position:'absolute',left:a.x,top:a.y,width:a.w,height:a.h,border:'7px solid #d9ad5f',borderRadius:a.r,overflow:'hidden',boxShadow:'0 0 38px rgba(217,173,95,.3)'}},h('img',{src:artwork,width:a.w,height:a.h,style:{objectFit:'cover',objectPosition:'50% 20%'}})),
    ...l.ops.map((o,i)=>h('div',{key:i,style:{display:'flex',position:'absolute',left:o.x,top:o.y-o.size,fontSize:o.size,fontWeight:o.weight,color:o.color,whiteSpace:'pre'}},o.text)),
    ...l.ops.filter(o=>o.eyes).map((o,i)=>h('svg',{key:'eyes'+i,width:o.size*1.05,height:o.size*.54,viewBox:'0 0 52 27',style:{position:'absolute',left:o.x+o.size*9.05,top:o.y-o.size*.8}},
      h('ellipse',{cx:13,cy:13.5,rx:11,ry:13,fill:'#f5f0fa'}),h('ellipse',{cx:39,cy:13.5,rx:11,ry:13,fill:'#f5f0fa'}),
      h('circle',{cx:16,cy:14,r:5,fill:'#17111f'}),h('circle',{cx:36,cy:14,r:5,fill:'#17111f'}))))
}
