import { call } from './api.js'
import { getAgentNo } from './session.js'
import { shareLinkPayload } from '../supabase/functions/op-reconnect/lib/quest-share-rules.js'

const FALLBACK_REACTIONS=['LOOK WHO I GOT 😭😭','I was literally just streaming and got him???',"okay who did y'all get 👀",'show me your badges rn','NO WAY I GOT HIM 😭','LOOK WHO CAME HOME 😭',"who did y'all unlock 👀",'okay now show me yours']

export function nextBadgeReaction(suggestions,current='',random=Math.random) {
  const pool=[...new Set((Array.isArray(suggestions)?suggestions:FALLBACK_REACTIONS).map(v=>String(v||'').trim()).filter(Boolean))]
  const choices=pool.length>1?pool.filter(v=>v!==current):pool
  return choices[Math.min(choices.length-1,Math.floor(Math.max(0,Math.min(.999999,Number(random())||0))*choices.length))]||''
}

// Inline controls: no showOverlay/hideOverlay, no badge queue or seen-state writes.
export function badgeShareControls(badgeId,request=call,random=Math.random) {
  const wrap=document.createElement('div');wrap.className='badge-share-controls'
  const button=document.createElement('button');button.className='bgu-share';button.textContent='↗ Share Badge'
  const editor=document.createElement('div');editor.className='badge-share-editor';editor.hidden=true
  const label=document.createElement('label');label.className='badge-share-label';label.textContent='Your caption'
  const caption=document.createElement('textarea');caption.className='badge-share-caption';caption.rows=2;caption.maxLength=180;caption.setAttribute('aria-label','Badge share caption')
  const another=document.createElement('button');another.className='bgu-share badge-share-another';another.textContent='Try another'
  const send=document.createElement('button');send.className='btn btn-primary badge-share-send';send.textContent='Share now'
  const story=document.createElement('button');story.className='bgu-share';story.textContent='Share Story image'
  const status=document.createElement('p');status.className='badge-share-status';status.setAttribute('role','status')
  editor.append(label,caption,another,send,story);wrap.append(button,editor,status)
  let snapshot=null,file=null,busy=false,copyOnly=false,suggestions=FALLBACK_REACTIONS
  const lock=value=>{busy=value;button.disabled=value;another.disabled=value;send.disabled=value;story.disabled=value}
  const preserveEscape=e=>{if(busy&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation()}}
  async function run(work){if(busy)return;lock(true);document.addEventListener('keydown',preserveEscape,true);try{await work()}catch{status.textContent='Could not open sharing. Your badge is safe; please retry.'}finally{lock(false);if(!snapshot)button.textContent='↗ Share Badge';document.removeEventListener('keydown',preserveEscape,true)}}
  button.onclick=()=>run(async()=>{
    button.textContent='Preparing share…';status.textContent=''
    const result=await request('createShareSnapshot',{agentNo:getAgentNo(),kind:'badge',badgeId})
    if(!result?.success){status.textContent=result?.error||'Badge sharing is unavailable right now.';button.textContent='↗ Share Badge';return}
    snapshot=result;suggestions=Array.isArray(result.suggestions)&&result.suggestions.length?result.suggestions:FALLBACK_REACTIONS
    caption.value=nextBadgeReaction(suggestions,'',random);button.hidden=true;editor.hidden=false
    caption.focus();caption.setSelectionRange(caption.value.length,caption.value.length)
  })
  another.onclick=()=>{caption.value=nextBadgeReaction(suggestions,caption.value,random);caption.focus()}
  send.onclick=()=>run(async()=>{
    if(!snapshot)return
    if(copyOnly||typeof navigator.share!=='function'){
      if(!copyOnly){copyOnly=true;send.textContent='Copy link';status.textContent='Sharing is unavailable here. You can copy the link.';return}
      await navigator.clipboard.writeText(snapshot.url);status.textContent='Link copied.';return
    }
    try{await navigator.share(shareLinkPayload(snapshot.title,caption.value,snapshot.url));status.textContent=''}
    catch(e){if(e.name!=='AbortError'){copyOnly=true;send.textContent='Copy link';status.textContent='Sharing could not open. You can still copy the link.'}}
  })
  story.onclick=()=>run(async()=>{
    if(!snapshot)return
    if(!file){
      status.textContent='Preparing Story image…'
      const result=await request('getBadgeShareStory',{agentNo:getAgentNo(),id:snapshot.id})
      if(!result?.success){status.textContent=result?.error||'The image is unavailable. Your badge is safe.';return}
      const bytes=Uint8Array.from(atob(result.png),c=>c.charCodeAt(0));file=new File([bytes],'reconnect-badge.png',{type:'image/png'})
      status.textContent='Image ready. Tap Share Story image.';return
    }
    try {
      if(navigator.share&&navigator.canShare?.({files:[file]}))await navigator.share({...shareLinkPayload(snapshot.title,caption.value,snapshot.url),files:[file]})
      else{const a=document.createElement('a');a.href=URL.createObjectURL(file);a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);status.textContent='Image saved.'}
    }catch(e){if(e.name!=='AbortError')status.textContent='Could not share this image. Your badge is safe; please retry.'}
  })
  return wrap
}
