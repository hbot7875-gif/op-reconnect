// Shared, pure share rules. No account/DB data is reachable through this module.
export const CHAT_WARNING = 'These selected messages will be public. Check for names or personal details.'
export const SHARE_VERSION = 1
const chars = (s) => Array.from(String(s || ''))
export const safeText = (s, max = 100) => chars(String(s || '').normalize('NFC').replace(/[<>\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, max).join('')
const count = (n) => Number.isFinite(Number(n)) ? Math.max(0, Math.floor(Number(n))) : 0
const identityKey = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

export function messageProblem(body, identifiers = []) {
  if (typeof body !== 'string' || !body.trim()) return 'This message is empty.'
  if (/[<>\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(body)) return 'This message contains markup or hidden formatting.'
  if (/(?:https?:|www\.|mailto:|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b[a-z0-9-]+\.(?:com|org|net|io|co|me|app|dev|gg|xyz|in|uk)\b|@\w|\bagent\s*\d{3,}\b|(?:\+?\d[\s().-]*){7,})/iu.test(body)) return 'This message may contain a link, contact detail or account identifier.'
  const key = identityKey(body)
  if (identifiers.some((id) => identityKey(id).length >= 3 && key.includes(identityKey(id)))) return 'This message contains a known private identifier or protected Quest information.'
  if (chars(body).length > 150) return 'This message is too long for the share. Choose a shorter message.'
  return null
}

// Deterministic conservative wrapping is reused by OG, story and browser preview.
// Wide scripts/emoji count as two cells. Text is never dropped to make it fit.
export function wrapText(value, width) {
  const lines = []; let line = ''; let used = 0
  const segmenter = new Intl.Segmenter(undefined,{granularity:'grapheme'})
  const unitsOf = ch => /[^\u0020-\u024f]/u.test(ch) ? 2 : /[WMwm@]/.test(ch) ? 1.8 : 1
  for (const word of String(value||'').split(/\s+/u)) {
    const pieces=[...segmenter.segment(word)].map(s=>s.segment)
    const length=pieces.reduce((sum,ch)=>sum+unitsOf(ch),0)
    if(line && used+1+length>width){lines.push(line);line='';used=0}
    if(line){line+=' ';used++}
    for(const ch of pieces){const units=unitsOf(ch);if(used+units>width){lines.push(line);line='';used=0}line+=ch;used+=units}
  }
  if (line) lines.push(line)
  return lines
}

export function selectionProblem(messages) {
  if (!Array.isArray(messages) || messages.length > 5) return { index: 5, reason: 'Choose no more than five messages.' }
  let lines = 0
  for (let i = 0; i < messages.length; i++) {
    const problem = messageProblem(messages[i].body)
    if (problem) return { index: i, reason: problem }
    lines += wrapText(messages[i].body, 34).length + 1
    if (lines > 11) return { index: i, reason: 'This message makes the conversation too tall. Deselect it or another message.' }
  }
  return null
}

export function publicQuest(data) {
  const type = ['pooled', 'checklist', 'signals', 'team'].includes(data.countingType) ? data.countingType : 'signals'
  const capacity = Math.min(100, count(data.capacity))
  const complete = data.complete === true
  return {
    title: safeText(data.title, 80), countingType: type,
    progress: count(data.progress), target: count(data.target), complete,
    joined: Math.min(capacity, count(data.joined)), capacity,
    availableSeats: complete ? 0 : Math.min(capacity, count(data.availableSeats)),
    messages: (Array.isArray(data.messages) ? data.messages : []).slice(0, 5).map((m) => ({
      label: /^(YOU|AGENT(?: [2-5])?)$/.test(m.label) ? m.label : 'AGENT', body: safeText(m.body, 150),
    })),
    capturedAt: safeText(data.capturedAt, 35), version: SHARE_VERSION,
  }
}

export function publicSnapshot(row) {
  if (!row || !['district', 'red_zone_active', 'red_zone_success', 'quest', 'city_bomb'].includes(row.kind)) return null
  const d = row.data || {}; let data
  if (row.kind === 'quest') data = publicQuest(d)
  else if(row.kind==='city_bomb')data={hoursRemaining:Math.round(Math.max(0,Number(d.hoursRemaining)||0)),isDark:d.isDark===true,line:safeText(d.line,180)}
  else if (row.kind === 'district') data = {
    displayName: safeText(d.displayName, 90), percent: Math.min(100, count(d.percent)), complete: d.complete === true,
    line: safeText(d.line, 180), roadTo1B: d.roadTo1B === true,
    goals: (Array.isArray(d.goals) ? d.goals : []).slice(0, 3).map(g => ({label: safeText(g.label,44), kind: g.kind === 'album' ? 'album' : 'track', progress: count(g.progress), target: count(g.target)})),
  }
  else data = {progress:count(d.progress),target:count(d.target),line:safeText(d.line,180),
    ...(row.kind === 'red_zone_active' ? {targetLabel:safeText(d.targetLabel,180),unit:safeText(d.unit,24),capturedAt:safeText(d.capturedAt,35),endsAt:safeText(d.endsAt,35),remainingSeconds:count(d.remainingSeconds)} : {})}
  return {id:row.id,kind:row.kind,data,created_at:row.created_at,expires_at:row.expires_at}
}

export function questProgressLabel(q) {
  return q.countingType === 'pooled' ? 'STREAMS TOGETHER' : q.countingType === 'checklist' ? 'ARMY FINISHED THEIR TRACKLIST' : q.countingType === 'team' ? 'ARMY JOINED' : 'ARMY SENT THEIR SIGNAL'
}

export function captionSuggestions(q, hasChat = false) {
  if (q.complete) return { Completed: ['WE ACTUALLY DID IT 😭', `${q.progress}/${q.target} 🫡`, 'somehow these people actually finished it', ...(hasChat ? ['all that yapping and we still finished 😭'] : [])] }
  const pools = { Streaming: ['we’re actually getting there 😭', ...(q.countingType === 'pooled' ? [`${q.progress}/${q.target} somebody MOVE 😭`] : []), ...(q.progress / Math.max(1,q.target) >= .9 ? ["WE'RE SO CLOSE 😭"] : [])] }
  if (hasChat) { pools.Chaotic = ["we're supposed to be streaming btw 😭", 'this was meant to be a serious streaming mission', 'I fear nobody here is normal', 'joined for streaming stayed for whatever this is 😭']; pools.Chat = ['the team chat was a mistake 😭', 'this is what happens when you give army a team chat', 'all this yapping and somehow we’re still streaming'] }
  if (q.availableSeats > 0) pools.Invite = ['if you’re streaming anyway come do it with us', 'come be my streaming buddy', 'you + me + BTS. that’s the plan', ...(q.availableSeats === 1 ? ['we have one seat left who wants it 👀', 'anyone wanna take the last seat'] : [])]
  if (/\barirang\b/i.test(q.title)) pools.Hooligan = ['hooligans wya', 'fine. hooligan mode activated', 'who let the hooligans into ReConnect 😭', ...(q.availableSeats === 1 ? ['need one more hooligan who wants in 😭'] : [])]
  return pools
}

export function questLinkPayload(caption, url) {
  return {title:'ReConnect Quest',text:String(caption || '').split(url).join('').trim(),url}
}
