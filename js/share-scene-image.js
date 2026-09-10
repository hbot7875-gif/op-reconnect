import { buildModel, renderScene } from './scene.js'
import { districtPercent } from './district-progress.js'
import { coreBlock } from './screen-world.js'

const bombFrames=new Map(),districtFrames=new Map()
function remember(map,key,work){map.set(key,work);while(map.size>4)map.delete(map.keys().next().value);return work}

function districtFrame(v,percent) {
  const live=document.querySelector('.district-canvas')
  const w=parseFloat(live?.style.width)||341,h=parseFloat(live?.style.height)||Math.round(Math.min(220,Math.max(150,w*.52)))
  const key=JSON.stringify({v,percent,w,h})
  if(districtFrames.has(key))return districtFrames.get(key)
  const canvas=document.createElement('canvas');canvas.width=780;canvas.height=Math.round(h*780/w)
  const ctx=canvas.getContext('2d');ctx.scale(780/w,780/w)
  renderScene(ctx,buildModel(v.id,w,h,v.name,{wardId:v.wardId,centerpiece:v.centerpiece}),percent/100,4800,false,v.charge||0,[])
  return remember(districtFrames,key,canvas)
}

let idleJob=null
export function warmShareArtwork(state,district=null) {
  if(idleJob!==null){if(window.cancelIdleCallback)cancelIdleCallback(idleJob);else clearTimeout(idleJob)}
  const work=()=>{
    idleJob=null
    if(document.hidden)return
    if(district){try{const percent=district.status==='active'?districtPercent(state.activeDistrict):100;districtFrame({id:district.id,name:district.name,wardId:district.wardId,centerpiece:district.status==='centerpiece_lit',charge:Math.max(0,Math.min(1,Number(state.bomb?.charge)||0))},percent)}catch{/* Idle preparation must never interrupt gameplay. */}}
    else {
      const d=state.bomb?.defuse
      const snapshot=d?{kind:'red_zone_active',data:{progress:d.progress,target:d.target,endsAt:d.activeUntil||d.endsAt}}:{kind:'city_bomb',data:{hoursRemaining:state.agentCharge?.hoursRemaining||0,isDark:!!state.agentCharge?.isDark}}
      bombImage(snapshot).catch(()=>{})
    }
  }
  idleJob=window.requestIdleCallback?requestIdleCallback(work,{timeout:2000}):setTimeout(work,500)
}

// Rasterize only our own Bomb DOM, never the surrounding player page/chat.
async function bombImage(snapshot) {
  const key=JSON.stringify({kind:snapshot.kind,progress:snapshot.data.progress,target:snapshot.data.target,hours:Math.round(snapshot.data.hoursRemaining||0),dark:!!snapshot.data.isDark})
  if(bombFrames.has(key))return bombFrames.get(key)
  const pending=captureBomb(snapshot);remember(bombFrames,key,pending);pending.catch(()=>bombFrames.delete(key));return pending
}

async function captureBomb(snapshot) {
  const d=snapshot.data, attack=snapshot.kind==='red_zone_active'
  const host=document.createElement('div')
  host.style.cssText='position:fixed;left:-10000px;top:0;width:375px;pointer-events:none;contain:layout style;'
  host.setAttribute('aria-hidden','true')
  const state={agentCharge:{hoursRemaining:snapshot.kind==='red_zone_success'?48:Math.round(d.hoursRemaining||0),isDark:!!d.isDark},bomb:{defuse:attack?{progress:d.progress,target:d.target,endsAt:d.endsAt,targetTrack:d.targetLabel}:null}}
  host.append(coreBlock(state,true));document.body.append(host)
  try {
    const original=host.querySelector('.army-core'), copy=original.cloneNode(true)
    const originals=[original,...original.querySelectorAll('*')],copies=[copy,...copy.querySelectorAll('*')]
    for(let i=0;i<originals.length;i++){
      const style=getComputedStyle(originals[i]);let css=''
      for(const key of style){const value=style.getPropertyValue(key);if(!value.includes('url('))css+=`${key}:${value};`}
      copies[i].setAttribute('style',css+'animation:none!important;transition:none!important;')
      copies[i].removeAttribute('id');copies[i].removeAttribute('aria-label')
    }
    // Freeze the actual CSS liquid and glass, including inline progress variables.
    const r=original.getBoundingClientRect(),padding=48,w=r.width+padding*2,h=r.height+padding*2
    copy.style.margin='0';copy.style.position='relative';copy.style.left='0';copy.style.top='0';copy.style.transform='none';copy.style.opacity='1'
    const markup=new XMLSerializer().serializeToString(copy)
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="padding:${padding}px;width:${w}px;height:${h}px;box-sizing:border-box">${markup}</div></foreignObject></svg>`
    const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await image.decode();return image
  } finally {host.remove()}
}

const images=new Map()
function text(ctx,value,x,y,maxWidth,size,color='#eee8f6',weight=600){
  ctx.fillStyle=color;ctx.font=`${weight} ${size}px Arial,sans-serif`
  const words=String(value||'').split(/\s+/);let line=''
  for(const word of words){const next=line?line+' '+word:word;if(line&&ctx.measureText(next).width>maxWidth){ctx.fillText(line,x,y);y+=size*1.2;line=word}else line=next}
  if(line)ctx.fillText(line,x,y)
  return y+size*1.2
}

export async function renderShareSceneImage(snapshot) {
  const key=JSON.stringify({kind:snapshot.kind,data:snapshot.data,visual:snapshot.visual})
  if(images.has(key))return images.get(key)
  const work=(async()=>{
    const c=document.createElement('canvas');c.width=1200;c.height=630
    const ctx=c.getContext('2d'),d=snapshot.data
    ctx.fillStyle='#090810';ctx.fillRect(0,0,1200,630)
    if(snapshot.kind==='district') {
      const v=snapshot.visual
      const frame=districtFrame(v,d.percent);ctx.drawImage(frame,0,(630-frame.height)/2)
      const fade=ctx.createLinearGradient(738,0,810,0);fade.addColorStop(0,'rgba(9,8,16,0)');fade.addColorStop(1,'#090810');ctx.fillStyle=fade;ctx.fillRect(738,0,462,630)
      text(ctx,'MY DISTRICT',812,65,340,19,'#ab90df')
      let y=text(ctx,d.displayName.toUpperCase(),812,125,350,37)
      y=text(ctx,`${d.percent}% RESTORED`,812,y+24,350,31,d.complete?'#e4b968':'#b99bec')+30
      for(const goal of (d.goals||[]).slice(0,2)){
        const name=goal.label.length>18?goal.label.slice(0,17)+'…':goal.label
        text(ctx,name,812,y,350,34);y+=38;text(ctx,`${goal.progress} / ${goal.target}`,812,y,350,34,'#c9badd');y+=43
      }
      text(ctx,d.complete?'go light up ur city ↗':'come light up ur city ↗',812,Math.max(y+4,497),350,29,'#cbbadd')
      if(d.roadTo1B&&y<480)text(ctx,'road to 1B ↗',812,535,350,22,'#a99bb9')
    } else {
      const image=await bombImage(snapshot)
      const scale=Math.min(660/image.width,560/image.height)
      ctx.drawImage(image,(760-image.width*scale)/2,(630-image.height*scale)/2,image.width*scale,image.height*scale)
      const live=snapshot.kind==='red_zone_active',win=snapshot.kind==='red_zone_success'
      let y=text(ctx,live?'CITY UNDER ATTACK':win?'CITY SAFE ✦':'MY ARMY BOMB',790,95,360,32,live?'#e8a4ad':'#bfa4ec')
      if(live){y=text(ctx,`${Math.round(d.progress/d.target*100)}% DEFUSED`,790,y+32,365,37)+25;y=text(ctx,`${d.progress.toLocaleString()} / ${d.target.toLocaleString()} STREAMS`,790,y,365,27)+12
        const s=d.remainingSeconds;const timer=[Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(n=>String(n).padStart(2,'0')).join(':')
        y=text(ctx,timer+' LEFT',790,y,365,27,'#ffbcc6')+20
        const targetBottom=text(ctx,'STREAM '+d.targetLabel,790,y,365,d.targetLabel.length>60?23:28)
        if(targetBottom<475)text(ctx,'EVERYBODY MOVE ↗',790,targetBottom+30,365,28,'#e8bcc8')
        else text(ctx,'EVERYBODY MOVE ↗',64,570,650,30,'#e8bcc8')
      } else text(ctx,win?'DEFUSED':d.hoursRemaining?`${Math.round(d.hoursRemaining)}H CHARGED`:d.isDark?'NEEDS SOME LOVE':'WAITING FOR ITS SPARK',790,y+50,365,34,win?'#e4b968':'#c8b3ec')
    }
    text(ctx,'RECONNECT · HOPETRACKER',snapshot.kind==='district'?812:790,567,365,17,'#a493b7')
    text(ctx,'hopetrackers.org',snapshot.kind==='district'?812:790,605,365,24,'#c3b4d5')
    return c.toDataURL('image/png').split(',')[1]
  })()
  images.set(key,work);while(images.size>4)images.delete(images.keys().next().value)
  work.catch(()=>images.delete(key));return work
}
