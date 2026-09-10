import type { GameContent, SupabaseDB } from './config.ts'
import { districtProgress } from './districts.ts'
import { getMissionStatus } from './reconnect-missions.ts'
import { getBackupOverlay } from './backup-pass.ts'
import { kstDateOf } from './kst.ts'
import { ONLINE_WINDOW_MS } from './feed.ts'

const MAX_MESSAGE_LEN = 240
const SEND_WINDOW_MS = 10 * 60 * 1000
const SEND_LIMIT = 6

function percent(progress: any, reconnect: any): number {
  let got = 0
  let need = 0
  for (const goal of progress?.trackGoals || []) {
    const target = Math.max(0, Number(goal.target) || 0)
    got += Math.min(Math.max(0, Number(goal.progress) || 0), target)
    need += target
  }
  for (const album of progress?.albums || []) {
    const target = Math.max(0, Number(album.target) || 0)
    got += Math.min(Math.max(0, Number(album.passesDone) || 0), target)
    need += target
  }
  if (reconnect) {
    const target = Math.max(1, Number(reconnect.restorationProgress?.target) || 1)
    got += reconnect.done ? target : Math.min(Math.max(0, Number(reconnect.restorationProgress?.progress) || 0), target)
    need += target
  }
  if (!need) return 0
  const complete = (progress?.trackGoals || []).every((g: any) => g.done)
    && (progress?.albums || []).every((a: any) => a.done)
    && (!reconnect || reconnect.done)
  return complete ? 100 : Math.min(99, Math.round((got / need) * 100))
}

/** Everyone with this district currently active, whether or not they are
 *  online right now. Being "in" a district is an assignment, not a session:
 *  the roster this feeds is for finding the people restoring it so you can
 *  signal them, and someone who closed the app an hour ago is exactly who
 *  you want to reach. `online` is still reported per agent so the UI can
 *  mark who is live without hiding anyone.
 *
 *  appear_offline is deliberately still honoured — that is a player's own
 *  privacy choice about being listed, not a staleness filter. */
async function activeAgents(supabase: SupabaseDB, districtId: string) {
  const since = Date.now() - ONLINE_WINDOW_MS
  const { data: districts } = await supabase.from('rc_player_districts')
    .select('agent_no,district_id,status,goals,baseline,activated_at')
    .eq('district_id', districtId).eq('status', 'active').limit(200)
  const agentNos = (districts || []).map((d: any) => d.agent_no)
  if (!agentNos.length) return []
  // Retirement is a soft delete: rc_players and the district row both stay
  // as history, and rc_agents.retired_at is the authoritative flag (same
  // gate the leaderboard and the bomb's defender list already apply).
  // Without this a retired agent still counted here and could be sent a
  // signal they will never read.
  const [{ data: players }, { data: liveAgents }] = await Promise.all([
    supabase.from('rc_players')
      .select('agent_no,codename,last_seen_at').in('agent_no', agentNos)
      .eq('appear_offline', false)
      .order('last_seen_at', { ascending: false }),
    supabase.from('rc_agents').select('agent_no').in('agent_no', agentNos).is('retired_at', null),
  ])
  const stillPlaying = new Set((liveAgents || []).map((a: any) => String(a.agent_no)))
  const pdByAgent = new Map((districts || []).map((d: any) => [d.agent_no, d]))
  return (players || []).filter((p: any) => pdByAgent.has(p.agent_no) && stillPlaying.has(String(p.agent_no)))
    .map((p: any) => ({
      ...p,
      pd: pdByAgent.get(p.agent_no),
      online: new Date(p.last_seen_at || 0).getTime() >= since,
    }))
}

/** How many agents are restoring each district in one ward. Counts only —
 *  a ward has up to 25 districts and agentProgress() costs two queries per
 *  agent, so percentages stay on the district screen where they are already
 *  computed for the handful of people actually listed. */
export async function getWardRoster(supabase: SupabaseDB, content: GameContent, params: any) {
  const wardId = String(params.wardId || '').trim()
  const districtIds = (content.districts || [])
    .filter((d: any) => d.ward_id === wardId).map((d: any) => d.id)
  if (!districtIds.length) return { success: false, error: 'ward_not_found' }

  const { data: assigned, error } = await supabase.from('rc_player_districts')
    .select('agent_no,district_id').in('district_id', districtIds).eq('status', 'active').limit(2000)
  if (error) return { success: false, error: error.message }

  // Hidden and retired agents are left out of the count as well as the
  // list, so the number and the roster you can open can never disagree.
  const agentNos = [...new Set((assigned || []).map((row: any) => row.agent_no))]
  const [{ data: visible }, { data: liveAgents }] = agentNos.length
    ? await Promise.all([
      supabase.from('rc_players').select('agent_no').in('agent_no', agentNos).eq('appear_offline', false),
      supabase.from('rc_agents').select('agent_no').in('agent_no', agentNos).is('retired_at', null),
    ])
    : [{ data: [] }, { data: [] }]
  const stillPlaying = new Set((liveAgents || []).map((a: any) => String(a.agent_no)))
  const shown = new Set((visible || []).map((p: any) => p.agent_no).filter((no: any) => stillPlaying.has(String(no))))

  const counts: Record<string, number> = {}
  for (const row of assigned || []) {
    if (!shown.has(row.agent_no)) continue
    counts[row.district_id] = (counts[row.district_id] || 0) + 1
  }
  return { success: true, wardId, counts }
}

async function agentProgress(supabase: SupabaseDB, content: GameContent, row: any) {
  const pd = row.pd
  const activationDate = kstDateOf(Math.floor(new Date(pd.activated_at).getTime() / 1000))
  const [{ data: rollups }, backup] = await Promise.all([
    supabase.from('rc_daily_activity').select('kst_date,track_counts,transmission')
      .eq('agent_no', row.agent_no).gte('kst_date', activationDate).order('kst_date'),
    getBackupOverlay(supabase, row.agent_no, pd.district_id),
  ])
  const progress = districtProgress(pd.goals, pd.baseline || {}, rollups || [], pd.activated_at, content, backup)
  const frozenReconnect = pd.goals?.reconnect || null
  const reconnect = frozenReconnect
    ? await getMissionStatus(supabase, row.agent_no, pd.district_id, frozenReconnect)
    : null
  return percent(progress, reconnect)
}

export async function getDistrictPresence(supabase: SupabaseDB, content: GameContent, params: any) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const districtId = String(params.districtId || '').trim()
  if (!districtId || !content.districts.some((d: any) => d.id === districtId)) {
    return { success: false, error: 'district_not_found' }
  }
  const rows = await activeAgents(supabase, districtId)
  const agents = await Promise.all(rows.map(async (row: any) => ({
    codename: row.codename,
    isMe: row.agent_no === agentNo,
    online: !!row.online,
    restored: await agentProgress(supabase, content, row),
  })))

  const { data: messages } = await supabase.from('rc_district_messages')
    .select('id,sender_agent_no,body,created_at,read_at')
    .eq('recipient_agent_no', agentNo).eq('district_id', districtId)
    .order('created_at', { ascending: false }).limit(20)
  const senders = [...new Set((messages || []).map((m: any) => m.sender_agent_no))]
  const { data: senderRows } = senders.length
    ? await supabase.from('rc_players').select('agent_no,codename').in('agent_no', senders)
    : { data: [] }
  const names = new Map((senderRows || []).map((p: any) => [p.agent_no, p.codename]))
  const inbox = (messages || []).map((m: any) => ({
    id: m.id, codename: names.get(m.sender_agent_no) || 'A signal', body: m.body,
    createdAt: m.created_at, unread: !m.read_at,
  }))
  if (inbox.some((m: any) => m.unread)) {
    await supabase.from('rc_district_messages').update({ read_at: new Date().toISOString() })
      .eq('recipient_agent_no', agentNo).eq('district_id', districtId).is('read_at', null)
  }
  return { success: true, agents, inbox }
}

export async function getDistrictMessageSummary(supabase: SupabaseDB, agentNo: string) {
  const { data } = await supabase.from('rc_district_messages').select('district_id')
    .eq('recipient_agent_no', agentNo).is('read_at', null).limit(100)
  const unreadByDistrict: Record<string, number> = {}
  for (const row of data || []) unreadByDistrict[row.district_id] = (unreadByDistrict[row.district_id] || 0) + 1
  return { totalUnread: Object.values(unreadByDistrict).reduce((a, b) => a + b, 0), unreadByDistrict }
}

export async function sendDistrictMessage(supabase: SupabaseDB, params: any) {
  const sender = String(params.agentNo || '').trim().toUpperCase()
  const districtId = String(params.districtId || '').trim()
  const codename = String(params.codename || '').trim()
  const body = String(params.message || '').trim().slice(0, MAX_MESSAGE_LEN)
  if (!districtId || !codename || !body) return { success: false, error: 'message_required' }

  // Same roster the sheet listed, so anyone you can see you can signal —
  // previously this re-checked an online-only list, and messaging someone
  // who had just closed the app failed with "agent_not_here".
  const visible = await activeAgents(supabase, districtId)
  const recipient = visible.find((p: any) => p.codename.toLocaleLowerCase() === codename.toLocaleLowerCase())
  if (!recipient) return { success: false, error: 'agent_not_here' }
  if (recipient.agent_no === sender) return { success: false, error: 'cannot_message_self' }

  const since = new Date(Date.now() - SEND_WINDOW_MS).toISOString()
  const { count } = await supabase.from('rc_district_messages').select('id', { count: 'exact', head: true })
    .eq('sender_agent_no', sender).gte('created_at', since)
  if ((count || 0) >= SEND_LIMIT) return { success: false, error: 'message_rate_limited' }

  const { error } = await supabase.from('rc_district_messages').insert({
    sender_agent_no: sender, recipient_agent_no: recipient.agent_no, district_id: districtId, body,
  })
  return error ? { success: false, error: error.message } : { success: true }
}
