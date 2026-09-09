// Share only the requested moment. No buildState/provider sync/UI refresh.
// Existing goal helpers retain their normal settlement behavior.
import { loadContent } from './config.ts'
import { districtProgress } from './districts.ts'
import { resolveReconnectStatus } from './reconnect-goal.ts'
import { getBackupOverlay } from './backup-pass.ts'
import { kstDateOf } from './kst.ts'
import { districtPercent } from '../../../../js/district-progress.js'

export async function readShareMoment(sb:any, agentNo:string, kind:string, districtId:string) {
  if(kind==='district') {
    const [content,{data:pd,error}] = await Promise.all([loadContent(sb),sb.from('rc_player_districts').select('*').eq('agent_no',agentNo).eq('district_id',districtId).maybeSingle()])
    if(error)throw new Error('Could not check this district. Please retry.')
    const district=content.districts.find(d=>d.id===districtId)
    if(district?.is_centerpiece && !pd) {
      const required=content.districts.filter(d=>d.ward_id===district.ward_id&&!d.is_centerpiece)
      const {data:restored,error:restoredError}=await sb.from('rc_player_districts').select('district_id').eq('agent_no',agentNo).eq('status','restored')
      if(restoredError||!required.length||!required.every(d=>(restored||[]).some((r:any)=>r.district_id===d.id)))throw new Error('This centerpiece is not lit yet.')
      return {district,complete:true,active:null,frozen:null,percent:100}
    }
    if(!district||!pd||!['active','restored'].includes(pd.status))throw new Error('This district is not available to share.')
    const complete=pd.status==='restored'
    let active:any=null
    if(!complete) {
      const [{data:rows,error:rowError},overlay,reconnect]=await Promise.all([
        sb.from('rc_daily_activity').select('kst_date,track_counts,transmission').eq('agent_no',agentNo).gte('kst_date',kstDateOf(new Date(pd.activated_at).getTime()/1000)).order('kst_date'),
        getBackupOverlay(sb,agentNo,districtId),resolveReconnectStatus(sb,content,agentNo,districtId,pd.goals.reconnect),
      ])
      if(rowError)throw new Error('Could not check progress. Please retry.')
      active={...districtProgress(pd.goals,pd.baseline||{},rows||[],pd.activated_at,content,overlay),reconnect}
    }
    return {district,complete,active,frozen:pd.goals,percent:complete?100:districtPercent(active)}
  }
  const {data:event,error}=await sb.from('rc_defuse_events').select('id,status,target,progress,active_until,active_from,target_kind,target_label,target_names,resolved_at').order('created_at',{ascending:false}).limit(1).maybeSingle()
  if(error)throw new Error('Could not check Red Zone. Please retry.')
  if(kind==='city_bomb' && event?.status==='active' && Date.parse(event.active_until)<=Date.now())throw new Error('Red Zone is ending. Sync once, then share its result.')
  if(kind==='city_bomb' && event?.status==='active' && Date.parse(event.active_until)>Date.now())kind='red_zone_active'
  if(kind==='red_zone_active'||kind==='red_zone_success') {
    if(!event || (kind==='red_zone_active' ? event.status!=='active'||Date.parse(event.active_until)<=Date.now() : event.status!=='defused'))throw new Error('This Red Zone has changed. Reopen Share for its current state.')
    return {kind,event}
  }
  if(kind!=='city_bomb')throw new Error('Unknown share type.')
  const {data:charge,error:chargeError}=await sb.from('rc_agent_charge').select('charged_until').eq('agent_no',agentNo).maybeSingle()
  if(chargeError)throw new Error('Could not check Bomb charge. Please retry.')
  const hours=Math.max(0,(Date.parse(charge?.charged_until||'')-Date.now())/3600000)||0
  return {kind,hoursRemaining:Math.round(hours*100)/100,isDark:!!charge?.charged_until&&hours===0}
}
