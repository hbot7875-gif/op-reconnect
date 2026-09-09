import { publicQuest, questProgressLabel, wrapText, selectionProblem } from './quest-share-rules.js'
export const QUEST_FONTS = [
  {name:'Roboto',weight:400,url:'https://fonts.gstatic.com/s/roboto/v51/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWubEbWmT.ttf'},
  {name:'Roboto',weight:700,url:'https://fonts.gstatic.com/s/roboto/v51/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWuYjammT.ttf'},
  {name:'Orbitron',weight:700,url:'https://fonts.gstatic.com/s/orbitron/v35/yMJMMIlzdpvBhQQL_SC3X9yhF25-T1ny_CmBoWg2.ttf'},
  {name:'Share Tech Mono',weight:400,url:'https://fonts.gstatic.com/s/sharetechmono/v16/J7aHnp1uDWRBEqV98dVQztYldFcLowEA.ttf'},
]

// A single text/geometry layout for DOM preview, Canvas story and server OG.
// Quest's purple labels, unboxed score and left-aligned chat are retained.
export function questLayout(input, portrait = false) {
  const q = publicQuest(input)
  const error = selectionProblem(q.messages)
  if (error) throw new Error(error.reason)
  const width = portrait ? 1080 : 1200, height = portrait ? 1350 : 630
  const ops = []; const add = (text,x,y,size,color='#eee8f6',weight=400) => ops.push({text,x,y,size,color,weight})
  const chat = q.messages.length > 0
  const missionX = portrait || !chat ? 64 : 800
  const missionW = portrait ? 950 : chat ? 340 : 1070
  const longTitle=q.title.length>42
  const titleLines = wrapText(q.title, portrait || !chat ? 36 : longTitle ? 21 : 16)
  add('RECONNECT QUEST',64,48,22,'#ab90df',600)
  let y = portrait ? 118 : 120
  for (const line of titleLines) { add(line,missionX,y,portrait ? 42 : longTitle ? 23 : 30,'#f5effb',700); ops.at(-1).family='Orbitron'; y += portrait ? 54 : longTitle ? 30 : 38 }
  y += 26
  add(`${q.progress.toLocaleString()} / ${q.target.toLocaleString()}`,missionX,y,portrait ? 64 : 50,'#c4a5ff',700); y += portrait ? 78 : 62
  for (const line of wrapText(questProgressLabel(q),chat && !portrait ? 24 : 50)) {add(line,missionX,y,21,'#b9abc9',600); y+=28}
  y += 28
  add(`${q.joined} / ${q.capacity} ARMY HERE`,missionX,y,25,'#d8cbe9',600)
  if (q.complete) add('QUEST COMPLETE',missionX,y+43,24,'#dfbb75',600)
  else if(q.availableSeats) add(`${q.availableSeats} OPEN SEAT${q.availableSeats === 1 ? '' : 'S'}`,missionX,y+43,24,'#b49cdd',600)
  else add('TEAM FULL',missionX,y+43,23,'#a498b4')
  if(chat) {
    let cy = portrait ? Math.max(540,y+100) : 122
    for(const m of q.messages) {
      add(m.label,64,cy,20,m.label === 'YOU' ? '#dfbb75' : '#ab90df',700);cy+=30
      for(const line of wrapText(m.body,34)) {add(line,64,cy,portrait?33:30);cy+=portrait?44:37}
      cy+=18
    }
    if(cy>height-76) throw new Error('Selected messages will not fit. Choose fewer messages.')
  }
  add('OP: RECONNECT',64,height-65,22,'#ac9bbf',600)
  add('hopetrackers.org',64,height-31,21,'#cbbedd')
  return {width,height,ops,background:'#100d1a'}
}

export function questImageElement(h, data, portrait = false) {
  const layout=questLayout(data,portrait)
  return h('div',{style:{display:'flex',position:'relative',width:layout.width,height:layout.height,background:layout.background,fontFamily:'sans-serif'}},
    ...layout.ops.map((o,i)=>h('div',{key:i,style:{display:'flex',position:'absolute',left:o.x,top:o.y- o.size,width:layout.width-o.x-24,fontSize:o.size,color:o.color,fontFamily:o.family || (o.size<=25?'Share Tech Mono':'Roboto'),fontWeight:o.family?700:o.size<=25?400:o.weight,whiteSpace:'pre'}},o.text)))
}
