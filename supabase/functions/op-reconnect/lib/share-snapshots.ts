// Privacy-safe, frozen social snapshots for link-first ReConnect sharing.
// Public responses are allowlisted separately from private ownership/image
// fields. Quest chat is included only when explicitly selected and validated.

import React from 'npm:react@18.3.1'
import { ImageResponse } from 'npm:@vercel/og@0.8.5'
import type { SupabaseDB } from './config.ts'
import { readShareMoment } from './share-source.ts'
import { ROAD_TO_1B_TRACK_NAMES } from './side-missions.ts'
import { selectedQuestShareData } from './reconnect-missions.ts'
import { publicSnapshot } from './quest-share-rules.js'
import { questImageElement, questLayout, QUEST_FONTS } from './quest-share-layout.js'
import { throttle } from './auth.ts'

const SITE = 'https://hopetrackers.org'
const ID_RE = /^[A-Za-z0-9_-]{22}$/

type SnapshotKind = 'district' | 'red_zone_active' | 'red_zone_success' | 'quest' | 'city_bomb'

function opaqueId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let raw = ''
  for (const byte of bytes) raw += String.fromCharCode(byte)
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function clean(value: unknown, max = 90): string {
  return String(value || '').replace(/[<>\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function titleCase(value: unknown): string {
  return clean(value).toLowerCase().replace(/(^|[\s/&-])([a-z])/g, (_m, gap, c) => gap + c.toUpperCase())
}

function districtLine(name: string, complete: boolean): string {
  const n = name.toLowerCase()
  if (complete) return n.includes('map of seven') ? 'WE MADE IT ALL THE WAY 😭💜' : 'I FINALLY LIT IT UP 😭💜'
  if (/puple|sky|overlook|night|moon|rain/.test(n)) return 'my district is still basically dark 😭'
  if (/fountain|ocean|water|swim/.test(n)) return 'my district still needs more light 😭'
  if (/crossing|station|bridge|road/.test(n)) return 'my district still has a long way to go 😭'
  return 'my district is still mostly dark 😭'
}

type ShareGoal = { label: string; progress: number; target: number; kind: 'track' | 'album' }

function goalName(value: unknown): string {
  return clean(value, 44).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function districtShareGoals(active: any, frozen: any, complete: boolean): { goals: ShareGoal[]; roadTo1B: boolean } {
  const tracks: ShareGoal[] = active
    ? (active.trackGoals || []).map((goal: any) => ({
        label: clean(goal.label, 44), progress: Math.max(0, Number(goal.progress) || 0),
        target: Math.max(1, Number(goal.target) || 1), kind: 'track' as const,
      }))
    : (frozen?.trackGoals || []).map((goal: any) => ({
        label: clean(goal.label, 44), progress: complete ? Math.max(1, Number(goal.target) || 1) : 0,
        target: Math.max(1, Number(goal.target) || 1), kind: 'track' as const,
      }))
  const albums: ShareGoal[] = active
    ? (active.albums || []).map((goal: any) => ({
        label: clean(goal.label, 44), progress: Math.max(0, Number(goal.passesDone) || 0),
        target: Math.max(1, Number(goal.target) || 1), kind: 'album' as const,
      }))
    : (frozen?.albumGoals || []).map((goal: any) => ({
        label: clean(goal.label, 44), progress: complete ? Math.max(1, Number(goal.target) || 1) : 0,
        target: Math.max(1, Number(goal.target) || 1), kind: 'album' as const,
      }))
  const focus = new Set(ROAD_TO_1B_TRACK_NAMES.map(goalName))
  const focused = tracks.filter((goal) => focus.has(goalName(goal.label)))
  if (focused.length >= 2) return { goals: focused.slice(0, 3), roadTo1B: true }
  return { goals: [...tracks.slice(0, 2), ...albums.slice(0, 1)].slice(0, 3), roadTo1B: false }
}

function redTarget(defuse: any): { label: string; unit: string } {
  const entries = Array.isArray(defuse?.targetNames) ? defuse.targetNames : []
  if (entries.length) {
    const label = entries.map((entry: any) => clean(entry.name, 65)).filter(Boolean).join(' + ')
    return { label: label || 'BTS', unit: entries.every((entry: any) => entry.kind === 'album') ? 'album streams' : 'streams' }
  }
  return { label: clean(defuse?.targetTrack || defuse?.targetAlbum || 'BTS', 65), unit: defuse?.targetAlbum ? 'album streams' : 'streams' }
}

function redLine(progress: number, target: number, activeFrom: string | null, endsAt: string, capturedAt: string): string {
  const fraction = progress / Math.max(1, target)
  if (fraction >= .9) return "wait we're actually about to do this 😭"
  const now = new Date(capturedAt).getTime()
  const start = activeFrom ? new Date(activeFrom).getTime() : NaN
  const end = new Date(endsAt).getTime()
  const elapsed = now - start
  const remaining = end - now
  const projected = progress > 0 && elapsed >= 15 * 60_000 ? elapsed * (target - progress) / progress : Infinity
  if (elapsed >= 15 * 60_000 && (progress === 0 || projected > remaining)) return 'okay we actually need more ARMY 😭'
  return 'ARMY, we could use you in here 😭'
}

async function insert(supabase: SupabaseDB, kind: SnapshotKind, data: Record<string, unknown>, agentNo?:string, cacheKey?:string) {
  const id = opaqueId()
  const { error } = await supabase.from('rc_share_snapshots').insert({ id, kind, data, ...(agentNo?{created_by:agentNo,cache_key:cacheKey}: {}) })
  if (error) throw new Error('share_snapshot_failed')
  const pathKind = kind === 'city_bomb' ? 'city' : kind === 'quest' ? 'quest' : kind === 'district' ? 'district' : 'red-zone'
  const url = `${SITE}/share/${pathKind}/${id}`
  return { id, url }
}

export async function createShareSnapshot(supabase: SupabaseDB, params: any) {
  const agentNo = clean(params.agentNo, 20).toUpperCase()
  if(params.kind === 'quest') {
    if(!await throttle(supabase,`quest-share:${agentNo}`,12,3600)) return {success:false,error:'You have prepared several shares. Please try again later.'}
    const selected:any = await selectedQuestShareData(supabase,params)
    if(!selected.success) return selected
    try { questLayout(selected.data); questLayout(selected.data,true) }
    catch { return {success:false,error:'Selected conversation does not fit. Choose fewer messages.'} }
    const {url} = await insert(supabase,'quest',selected.data)
    return {success:true,url,title:selected.data.title,data:selected.data}
  }
  const requested = clean(params.kind, 30)
  if(!['district','city_bomb','red_zone_active','red_zone_success'].includes(requested))return {success:false,error:'invalid_share_kind'}
  try {
    const moment:any=await readShareMoment(supabase,agentNo,requested,clean(params.districtId,100))
    const kind:SnapshotKind=moment.kind||'district'
    let data:any, title:string, visual:any=null
    if(kind==='district') {
      const {district,active,complete,percent,frozen}=moment
      const displayName=district.ward_id==='relay-zero'?'Home Base':titleCase(district.name), picked=districtShareGoals(active,frozen,complete)
      data={displayName,percent,complete,line:districtLine(displayName,complete),goals:picked.goals.slice(0,2),roadTo1B:picked.roadTo1B}
      title=`${displayName} · ${percent}% restored`
      visual={id:district.id,name:district.name,wardId:district.ward_id,centerpiece:!!district.is_centerpiece,charge:Math.max(0,Math.min(1,Number(params.sceneCharge)||0))}
    } else if(kind==='city_bomb') {
      data={hoursRemaining:moment.hoursRemaining,isDark:moment.isDark,line:moment.hoursRemaining?'keeping my ARMY Bomb alive 💜':'my ARMY Bomb needs me 😭'}
      title='My ARMY Bomb · ReConnect'
    } else {
      const ev=moment.event
      if(params.eventId&&params.eventId!==ev.id)return {success:false,error:'This Red Zone has changed. Reopen Share.'}
      const progress=Number(ev.progress)||0,target=Math.max(1,Number(ev.target)||1)
      if(kind==='red_zone_success'){data={progress,target,line:'WE ACTUALLY SAVED IT 😭'};title='ReConnect · City safe'}
      else {
        const capturedAt=new Date().toISOString(),endsAt=ev.active_until
        const info=redTarget({targetNames:ev.target_names,targetTrack:ev.target_kind==='track'?ev.target_label:null,targetAlbum:ev.target_kind==='album'?ev.target_label:null})
        data={progress,target,targetLabel:info.label,unit:info.unit,capturedAt,endsAt,remainingSeconds:Math.max(0,Math.floor((Date.parse(endsAt)-Date.now())/1000)),line:redLine(progress,target,ev.active_from,endsAt,capturedAt)}
        title='ReConnect · City under attack'
      }
    }
    const stable={...data,capturedAt:undefined,remainingSeconds:kind==='red_zone_active'?Math.floor(data.remainingSeconds/10):undefined}
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({kind,data:stable,visual})))
    const cacheKey=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')
    const {data:prior}=await supabase.from('rc_share_snapshots').select('id,data').eq('created_by',agentNo).eq('cache_key',cacheKey).not('image_png','is',null).gt('expires_at',new Date().toISOString()).limit(1).maybeSingle()
    if(prior)return {success:true,id:prior.id,kind,url:`${SITE}/share/${kind==='district'?'district':kind==='city_bomb'?'city':'red-zone'}/${prior.id}`,title,data:prior.data,visual,imageReady:true}
    if(!await throttle(supabase,`scene-share:${agentNo}`,30,3600))return {success:false,error:'Please wait before preparing more shares.'}
    const saved=await insert(supabase,kind,data,agentNo,cacheKey)
    return {success:true,...saved,kind,title,data,visual,imageReady:false}
  }catch(e){return {success:false,error:(e as Error).message}}
}

export function decodeSharePng(value:unknown):Uint8Array {
  if(typeof value!=='string'||value.length>700000||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))throw new Error('Invalid share image')
  const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0))
  if(bytes.length<33||[137,80,78,71,13,10,26,10].some((n,i)=>bytes[i]!==n))throw new Error('Expected PNG')
  const view=new DataView(bytes.buffer)
  if(view.getUint32(16)!==1200||view.getUint32(20)!==630)throw new Error('Expected 1200×630 image')
  // Only a bounded, static raster. Reject metadata, animations and broken chunks.
  let offset=8,header=false,pixels=false,ended=false
  while(offset+12<=bytes.length){
    const length=view.getUint32(offset),end=offset+12+length
    if(end>bytes.length)throw new Error('Broken PNG')
    const type=String.fromCharCode(...bytes.slice(offset+4,offset+8))
    if(!['IHDR','IDAT','IEND','sRGB','gAMA','cHRM','pHYs'].includes(type))throw new Error('Unsupported PNG metadata')
    let crc=0xffffffff
    for(let i=offset+4;i<end-4;i++){crc^=bytes[i];for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}
    if(((crc^0xffffffff)>>>0)!==view.getUint32(end-4))throw new Error('Broken PNG checksum')
    if(type==='IHDR'){if(header||offset!==8||length!==13||bytes[offset+16]!==8||![2,6].includes(bytes[offset+17])||bytes[offset+18]||bytes[offset+19]||bytes[offset+20])throw new Error('Unsupported PNG format');header=true}
    if(type==='IDAT')pixels=true
    if(type==='IEND'){if(length||end!==bytes.length)throw new Error('Broken PNG end');ended=true}
    offset=end
  }
  if(!header||!pixels||!ended||offset!==bytes.length)throw new Error('Incomplete PNG')
  return bytes
}

export async function attachShareImage(sb:SupabaseDB,params:any) {
  try {
    decodeSharePng(params.png)
    if(!ID_RE.test(params.id||''))throw new Error('Invalid share')
    const {data,error}=await sb.from('rc_share_snapshots').update({image_png:params.png}).eq('id',params.id).eq('created_by',params.agentNo).is('image_png',null).gt('expires_at',new Date().toISOString()).select('id').maybeSingle()
    if(error||!data)throw new Error('Could not save this share image. Reopen Share to retry.')
    return {success:true}
  }catch(e){return {success:false,error:(e as Error).message}}
}

export async function getPublicShareSnapshot(supabase: SupabaseDB, params: any) {
  const id = clean(params.id, 30)
  if (!ID_RE.test(id)) return { success: false, error: 'not_found' }
  const { data } = await supabase.from('rc_share_snapshots').select('id,kind,data,created_at,expires_at').eq('id', id).gt('expires_at', new Date().toISOString()).maybeSingle()
  const snapshot = publicSnapshot(data)
  return snapshot ? { success: true, snapshot } : { success: false, error: 'not_found' }
}

const h = React.createElement
function card(snapshot: any) {
  const data = snapshot.data || {}
  if(snapshot.kind === 'quest') return questImageElement(h,data)
  const district = snapshot.kind === 'district'
  const success = snapshot.kind === 'red_zone_success'
  const accent = district ? (data.complete ? '#e4b968' : '#a78bfa') : success ? '#e4b968' : '#d44a60'
  const heading = district ? data.displayName : success ? 'CITY SAFE ✦' : 'CITY UNDER ATTACK'
  const primary = district ? `${data.percent}% RESTORED${data.complete ? ' ✦' : ''}` : success ? 'DEFUSED' : `${Math.round(Number(data.progress) / Math.max(1, Number(data.target)) * 100)}% DEFUSED`
  const secondary = district ? data.line : `${Number(data.progress).toLocaleString()} / ${Number(data.target).toLocaleString()} ${String(data.unit || 'streams').toUpperCase()}`
  const timer = !district && !success ? `${String(Math.floor(data.remainingSeconds / 3600)).padStart(2, '0')}:${String(Math.floor(data.remainingSeconds % 3600 / 60)).padStart(2, '0')}:${String(data.remainingSeconds % 60).padStart(2, '0')} LEFT` : ''
  const goals: ShareGoal[] = district && Array.isArray(data.goals) ? data.goals.slice(0, 3) : []
  const scene = district
    ? h('div', { style: { display: 'flex', position: 'relative', width: '65%', height: '100%', background: 'linear-gradient(180deg,#111126,#29204b 60%,#090913)', overflow: 'hidden' } },
        h('div', { style: { position: 'absolute', left: 70, right: 55, bottom: 95, height: 230, border: '2px solid rgba(167,139,250,.35)', background: 'linear-gradient(180deg,rgba(80,58,133,.25),rgba(8,8,18,.92))' } }),
        ...[90,210,350,500].map((x, i) => h('div', { key: x, style: { position: 'absolute', left: x, bottom: 95, width: 70 + i * 9, height: 155 + i * 32, background: '#0a0a14', borderTop: `3px solid ${accent}` } })),
        h('div', { style: { position: 'absolute', inset: 0, background: 'linear-gradient(90deg,transparent 65%,#090810),linear-gradient(0deg,#090810,transparent 45%)' } }))
    : h('div', { style: { display: 'flex', width: '65%', height: '100%', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle at 50% 45%,rgba(128,30,52,.28),#090810 58%)' } },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 275, height: 275, borderRadius: 999, border: `5px solid ${accent}`, background: success ? 'radial-gradient(circle at 34% 28%,#d7bcff,#6d37bb 52%,#261345)' : 'radial-gradient(circle at 34% 28%,#d75b6e,#821b32 55%,#370913)', color: '#fff', fontSize: 68, boxShadow: `0 0 55px ${accent}55` } }, '⟭⟬'))
  return h('div', { style: { display: 'flex', width: 1200, height: 630, color: '#f4f0fa', background: '#090810', fontFamily: 'Arial, sans-serif' } }, scene,
    h('div', { style: { display: 'flex', flexDirection: 'column', width: '35%', padding: '74px 55px 42px 28px', justifyContent: 'center' } },
      h('div', { style: { color: '#aaa2b9', fontSize: 18, letterSpacing: 5, marginBottom: 25 } }, district ? 'MY DISTRICT' : 'RECONNECT · RED ZONE'),
      h('div', { style: { fontSize: district ? 40 : 36, fontWeight: 800, lineHeight: 1.12, marginBottom: 22 } }, clean(heading, 70).toUpperCase()),
      h('div', { style: { color: accent, fontSize: 29, fontWeight: 700, marginBottom: district && goals.length ? 18 : 24 } }, primary),
      district && goals.length ? h('div', { style: { display: 'flex', flexDirection: 'column', width: '100%', gap: 9, marginBottom: 17 } },
        ...goals.map((goal, index) => h('div', { key: `${goal.label}-${index}`, style: { display: 'flex', width: '100%', alignItems: 'baseline', justifyContent: 'space-between', gap: 14, fontSize: 18, lineHeight: 1.18 } },
          h('div', { style: { color: '#ddd7e6', maxWidth: 238 } }, clean(goal.label, 34)),
          h('div', { style: { color: goal.progress >= goal.target ? accent : '#bdb5c8', fontWeight: 700, whiteSpace: 'nowrap' } }, `${Math.min(goal.progress, goal.target).toLocaleString()} / ${goal.target.toLocaleString()}`))),
        data.roadTo1B ? h('div', { style: { color: '#9188a1', fontSize: 14, letterSpacing: 1.2, marginTop: 2 } }, 'road to 1B ↗') : null) : null,
      h('div', { style: { fontSize: district ? 19 : 23, lineHeight: 1.35, color: '#ddd7e6', marginBottom: timer ? 22 : district ? 28 : 60 } }, secondary),
      timer ? h('div', { style: { color: '#ff9bac', fontSize: 25, fontWeight: 700, marginBottom: 45 } }, timer) : null,
      h('div', { style: { color: '#8f879d', fontSize: 17, letterSpacing: 3, marginTop: 'auto' } }, 'RECONNECT · HOPETRACKER'),
      h('div', { style: { color: '#bbb4c5', fontSize: 18, marginTop: 8 } }, 'hopetrackers.org')))
}

let questFonts: Promise<any[]> | null = null
export async function shareImageResponse(supabase: SupabaseDB, id: string): Promise<Response> {
  if(!ID_RE.test(id))return new Response('Not found',{status:404})
  const {data:stored}=await supabase.from('rc_share_snapshots').select('image_png,kind,created_by').eq('id',id).gt('expires_at',new Date().toISOString()).maybeSingle()
  if(stored?.image_png)return new Response(decodeSharePng(stored.image_png).buffer as ArrayBuffer,{headers:{'Content-Type':'image/png','Cache-Control':'public,max-age=31536000,immutable','X-Content-Type-Options':'nosniff'}})
  if(stored?.created_by && stored.kind!=='quest')return new Response('Image is preparing',{status:404,headers:{'Cache-Control':'no-store'}})
  const result: any = await getPublicShareSnapshot(supabase, { id })
  if (!result.success) return new Response('Not found', { status: 404 })
  let fonts:any[]|undefined
  if(result.snapshot.kind==='quest') {
    if(!questFonts)questFonts=Promise.all(QUEST_FONTS.map(async(font:any)=>{const r=await fetch(font.url);if(!r.ok)throw new Error('font unavailable');return {name:font.name,data:await r.arrayBuffer(),weight:font.weight,style:'normal'}})).catch(e=>{questFonts=null;throw e})
    fonts=await questFonts
  }
  const response = new ImageResponse(card(result.snapshot) as any, { width: 1200, height: 630, ...(fonts?{fonts}: {}) })
  response.headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  return response
}
