import { el, hideOverlay, toast } from './state.js'
import { call } from './api.js'
import { getAgentNo } from './session.js'
import { CHAT_WARNING, selectionProblem, captionSuggestions, questLinkPayload, publicQuest } from '../supabase/functions/op-reconnect/lib/quest-share-rules.js'
import { questLayout, QUEST_FONTS } from '../supabase/functions/op-reconnect/lib/quest-share-layout.js'

const drafts = new Map()
let fontReady=null
export function loadQuestFonts(){
  if(!fontReady)fontReady=Promise.all(QUEST_FONTS.map(async f=>{const face=new FontFace(f.name,`url(${f.url})`,{weight:String(f.weight)});await face.load();document.fonts.add(face)})).catch(e=>{fontReady=null;throw e})
  return fontReady
}
function node(tag, cls, text) { const n=el(tag,cls); if(text!==undefined)n.textContent=text; return n }

export function drawQuestCanvas(data, portrait=false) {
  const layout=questLayout(data,portrait)
  const canvas=document.createElement('canvas');canvas.width=layout.width;canvas.height=layout.height
  const ctx=canvas.getContext('2d');ctx.fillStyle=layout.background;ctx.fillRect(0,0,canvas.width,canvas.height)
  for(const o of layout.ops){ctx.font=`${o.family?700:o.size<=25?400:o.weight} ${o.size}px "${o.family || (o.size<=25?'Share Tech Mono':'Roboto')}", sans-serif`;ctx.fillStyle=o.color;ctx.fillText(o.text,o.x,o.y)}
  canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`${data.title}: ${data.progress} of ${data.target}, ${data.messages?.length||0} selected messages`)
  return canvas
}

export function questShareSheet(districtId, options={}) {
  const request=options.request || call
  const draftKey=`${getAgentNo()}:${districtId}`
  const draft=drafts.get(draftKey) || {includeChat:false,ids:[],caption:null}
  drafts.set(draftKey,draft)
  const sheet=node('div','sheet quest-share-editor')
  const header=node('div','quest-share-header')
  header.append(node('h2','','Share Quest'))
  const close=node('button','btn btn-ghost','Close');close.onclick=hideOverlay;header.append(close);sheet.append(header)
  const preview=node('div','quest-share-preview','Loading Quest…');sheet.append(preview)
  const include=node('label','quest-share-chat-switch');const check=document.createElement('input');check.type='checkbox';check.checked=draft.includeChat
  include.append(check,document.createTextNode(' Include chat moment'));sheet.append(include)
  const warning=node('p','quest-share-warning',CHAT_WARNING);warning.hidden=!draft.includeChat;sheet.append(warning)
  const picker=node('div','quest-share-picker');picker.hidden=!draft.includeChat;sheet.append(picker)
  const captionLabel=node('label','quest-share-caption-label','Caption');const caption=node('textarea','ob-input');caption.id='quest-share-caption';caption.maxLength=1200;caption.rows=3;captionLabel.htmlFor=caption.id
  caption.setAttribute('aria-label','Caption');caption.value=draft.caption||'';sheet.append(captionLabel,caption)
  const suggestions=node('div','quest-share-suggestions');sheet.append(suggestions)
  const status=node('p','quest-share-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');sheet.append(status)
  const actions=node('div','quest-share-actions')
  const share=node('button','btn btn-primary','SHARE'), story=node('button','btn btn-ghost','SHARE IMAGE / STORY'), copy=node('button','btn btn-ghost','COPY LINK')
  actions.append(share,story,copy);sheet.append(actions)
  let source=null, snapshot=null, file=null, busy=false, selectionError=null
  const buttons=[share,story,copy]
  function invalidate(){snapshot=null;file=null;share.textContent='SHARE';story.textContent='SHARE IMAGE / STORY'}
  function chosen(){
    const labels=new Map()
    return (draft.includeChat ? source.messages.filter(m=>draft.ids.includes(m.id)) : []).map(m=>{
      if(m.label!=='YOU'&&!labels.has(m.label))labels.set(m.label,labels.size===0?'AGENT':`AGENT ${labels.size+1}`)
      return {...m,label:m.label==='YOU'?'YOU':labels.get(m.label)}
    })
  }
  function render(){
    if(!source)return
    const messages=chosen()
    selectionError=selectionProblem(messages)
    const missing=draft.includeChat&&draft.ids.some(id=>!source.messages.some(m=>m.id===id))
    if(missing)selectionError={reason:'A selected message is unavailable. Clear the selection and choose again.'}
    const blocked=messages.find(m=>m.problem)
    if(blocked)selectionError={reason:blocked.problem}
    if(!selectionError) {
      try {preview.replaceChildren(drawQuestCanvas(snapshot?.data || {...source.quest,messages}))}
      catch(e){selectionError={reason:e.message}}
    }
    if(selectionError){preview.replaceChildren(node('p','', 'Update the selected conversation to preview this share.'));status.textContent=selectionError.reason}
    else status.textContent=snapshot?'Ready. Your preview is frozen; tap Share to choose an app.':''
    picker.replaceChildren()
    const clear=node('button','btn btn-ghost','Clear selection');clear.onclick=()=>{draft.ids=[];invalidate();render()};picker.append(clear)
    if(!source.messages.length)picker.append(node('p','muted','No messages yet. Your Quest can be shared without chat.'))
    for(const m of source.messages){
      const label=node('label','quest-share-pick-row reconnect-chat-msg'+(m.label==='YOU'?' is-me':''))
      const input=document.createElement('input');input.type='checkbox';input.checked=draft.ids.includes(m.id);input.dataset.blocked=String(!!m.problem&&!input.checked);input.disabled=busy||input.dataset.blocked==='true'
      input.setAttribute('aria-label',`Select message: ${m.body}`)
      const content=node('span','');content.append(node('b','',m.label),node('span','',m.body))
      const pickedIndex=messages.findIndex(x=>x.id===m.id)
      if(m.problem || selectionError?.index===pickedIndex)content.append(node('small','quest-share-message-error',m.problem||selectionError.reason))
      label.append(input,content);picker.append(label)
      input.onchange=()=>{draft.ids=input.checked?[...draft.ids,m.id]:draft.ids.filter(id=>id!==m.id);invalidate();render()}
    }
    suggestions.replaceChildren()
    const pools=captionSuggestions(source.quest,messages.length>0)
    const tabs=node('div','quest-share-categories'), choices=node('div','quest-share-caption-choices')
    for(const [name,values] of Object.entries(pools)){
      const tab=node('button','btn btn-ghost',name);tab.onclick=()=>{choices.replaceChildren();for(const value of values){const b=node('button','quest-share-caption-option',value);b.onclick=()=>{caption.value=value;draft.caption=value};choices.append(b)}};tabs.append(tab)
    }
    suggestions.append(tabs,choices)
    for(const b of buttons)b.disabled=busy||!!selectionError
  }
  caption.oninput=()=>{draft.caption=caption.value}
  check.onchange=()=>{draft.includeChat=check.checked;warning.hidden=picker.hidden=!check.checked;invalidate();render()}
  function setBusy(value){busy=value;check.disabled=value;for(const input of picker.querySelectorAll('input,button'))input.disabled=value||input.dataset.blocked==='true';buttons.forEach(b=>b.disabled=value||!!selectionError)}
  async function prepare(){
    if(busy||selectionError||!source)return false
    setBusy(true);status.textContent='Preparing share…'
    try {
      const result=await request('createShareSnapshot',{agentNo:getAgentNo(),kind:'quest',districtId,includeChat:draft.includeChat,messageIds:draft.includeChat?draft.ids:[]})
      if(!result?.success)throw new Error(result?.error||'Could not prepare this share. Please retry.')
      snapshot=result
      share.textContent='SHARE NOW';story.textContent='SHARE IMAGE NOW';render();return true
    } catch(e){status.textContent=e.message;return false}
    finally{setBusy(false)}
  }
  share.onclick=async()=>{
    if(busy)return
    if(!snapshot){const ready=await prepare();if(!ready||!navigator.userActivation?.isActive)return}
    if(typeof navigator.share!=='function'){status.textContent='Sharing is unavailable in this browser. Use Copy Link below.';return}
    setBusy(true)
    try{await navigator.share(questLinkPayload(caption.value,snapshot.url))}
    catch(e){if(e.name!=='AbortError')status.textContent='Could not open sharing. Your draft is safe; try again or copy the link.'}
    finally{setBusy(false)}
  }
  story.onclick=async()=>{
    if(busy)return
    if(!snapshot){await prepare();return}
    if(!file){
      setBusy(true);status.textContent='Preparing image…'
      try{const canvas=drawQuestCanvas(snapshot.data,true);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('Image unavailable');file=new File([blob],'reconnect-quest.png',{type:'image/png'});status.textContent='Image ready. Tap Share Image Now to choose an app.'}
      catch{status.textContent='Could not prepare the image. Your link and draft are safe; please retry.'}
      finally{setBusy(false)}
      return
    }
    setBusy(true)
    try{
      if(navigator.share&&navigator.canShare?.({files:[file]}))await navigator.share({...questLinkPayload(caption.value,snapshot.url),files:[file]})
      else{const url=URL.createObjectURL(file);const a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status.textContent='Image saved. Copy Link is available below.'}
    }catch(e){if(e.name!=='AbortError')status.textContent='Could not share the image. Your draft is safe; please retry.'}
    finally{setBusy(false)}
  }
  copy.onclick=async()=>{if(busy)return;if(!snapshot){await prepare();return}try{await navigator.clipboard.writeText(snapshot.url);toast('Link copied')}catch{status.textContent='Could not copy the link. Please retry.'}}
  async function load(){
    buttons.forEach(b=>b.disabled=true)
    const loadingSource=request('getQuestShareSource',{agentNo:getAgentNo(),districtId})
    try{await loadQuestFonts()}catch{status.textContent='Could not load share fonts. Reopen this sheet to retry.';return}
    const result=await loadingSource
    if(!result?.success){status.textContent=result?.error||'Could not load Quest.';const retry=node('button','btn btn-ghost','Retry');retry.onclick=()=>{retry.remove();load()};status.append(retry);return}
    source=result
    if(draft.caption===null){draft.caption=Object.values(captionSuggestions(source.quest,false))[0]?.[0]||'';caption.value=draft.caption}
    render()
  }
  load()
  return sheet
}
