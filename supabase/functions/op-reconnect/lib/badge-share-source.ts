import { BADGE_MILESTONES, badgeReactions } from './badge-share-layout.js'
import { safeText } from './quest-share-rules.js'

const MEMBER_CAPTIONS:Record<string,string>={rm:'namjoon',jin:'jin',suga:'yoongi','j-hope':'hobi',jhope:'hobi',jimin:'jimin',v:'taehyung','jung kook':'jungkook',jungkook:'jungkook'}
function publicMember(art:any) {
  const members=Array.isArray(art?.members)&&art.members.length?art.members:String(art?.member||'').split(/\s*(?:\+|,)\s*/)
  if(members.length!==1)return ''
  return MEMBER_CAPTIONS[String(members[0]||'').trim().toLowerCase()]||''
}

// Private resolver: none of the database IDs/paths leave this module's caller.
export async function resolveBadgeShare(sb:any,agentNo:string,badgeId:string) {
  const split=badgeId.indexOf(':');const template=badgeId.slice(0,split),scope=badgeId.slice(split+1)
  const milestonePercent=BADGE_MILESTONES[template as keyof typeof BADGE_MILESTONES]
  if(split<1||!scope||!milestonePercent)throw new Error('Sharing is available for 25%, 50%, 75% and 100% restoration badges only.')
  const {data:award,error}=await sb.from('rc_badges').select('artwork_id').eq('agent_no',agentNo).eq('badge_id',badgeId).maybeSingle()
  if(error||!award)throw new Error('This badge is not available in your collection.')
  if(!award.artwork_id)throw new Error('The awarded badge artwork is unavailable. Please try again later.')
  const [{data:catalog,error:ce},{data:district,error:de},{data:artMeta,error:ae}]=await Promise.all([
    sb.from('rc_badge_catalog').select('rarity').eq('id',template).eq('active',true).maybeSingle(),
    sb.from('rc_districts').select('name,ward_id').eq('id',scope).maybeSingle(),
    sb.from('rc_badge_art').select('member,members').eq('id',award.artwork_id).maybeSingle(),
  ])
  if(ce||de||ae||!catalog||!district?.name||!artMeta)throw new Error('This badge cannot be shared right now.')
  const districtDisplayName=district.ward_id==='relay-zero'?'Home Base':safeText(district.name,90)
  if(!districtDisplayName)throw new Error('This badge cannot be shared right now.')
  const suggestions=badgeReactions(publicMember(artMeta))
  return {artId:award.artwork_id,suggestions,data:{milestonePercent,districtDisplayName,rarity:catalog.rarity==='rare'?'rare':'common',reaction:suggestions[0],capturedAt:new Date().toISOString(),version:3}}
}

export async function awardedArtwork(sb:any,artId:number) {
  const {data:art,error}=await sb.from('rc_badge_art').select('storage_path').eq('id',artId).maybeSingle()
  if(error||!art?.storage_path)throw new Error('The awarded badge artwork is unavailable. Please try again later.')
  const {data:blob,error:downloadError}=await sb.storage.from('badge-art').download(art.storage_path)
  if(downloadError||!blob||blob.size>8_000_000||!['image/png','image/jpeg','image/webp'].includes(blob.type))throw new Error('The awarded badge artwork could not be loaded.')
  const bytes=new Uint8Array(await blob.arrayBuffer())
  return `data:${blob.type};base64,${base64(bytes)}`
}
export function base64(bytes:Uint8Array) {let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(raw)}
