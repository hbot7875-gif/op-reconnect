// Private engagement telemetry. Achievement events belong in feed.ts;
// app/session/navigation events live here so they can answer product
// questions without leaking browsing behavior into the public City feed.

import type { SupabaseDB } from './config.ts'

export type EngagementEventType =
  | 'app_opened' | 'screen_viewed' | 'district_opened' | 'reconnect_opened'
  | 'invite_sent' | 'invite_accepted' | 'queue_built' | 'stream_detected'

const CLIENT_EVENTS = new Set<EngagementEventType>([
  'app_opened', 'screen_viewed', 'district_opened', 'reconnect_opened', 'queue_built',
])

export async function logEngagementEvent(
  supabase: SupabaseDB,
  event: {
    agentNo: string
    eventType: EngagementEventType
    screen?: string | null
    districtId?: string | null
    sessionId?: string | null
    metadata?: Record<string, unknown>
    dedupKey?: string | null
  },
): Promise<void> {
  const row = {
    agent_no: event.agentNo,
    event_type: event.eventType,
    screen: event.screen || null,
    district_id: event.districtId || null,
    session_id: event.sessionId || null,
    metadata: event.metadata || {},
    dedup_key: event.dedupKey || null,
  }
  if (row.dedup_key) {
    await supabase.from('rc_engagement_events').upsert(row, { onConflict: 'dedup_key', ignoreDuplicates: true })
  } else {
    await supabase.from('rc_engagement_events').insert(row)
  }
}

export async function trackEngagement(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const eventType = String(params.eventType || '') as EngagementEventType
  if (!CLIENT_EVENTS.has(eventType)) return { success: false, error: 'invalid_engagement_event' }

  const screen = String(params.screen || '').slice(0, 40) || null
  const districtId = String(params.districtId || '').slice(0, 80) || null
  const sessionId = String(params.sessionId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || null
  const eventId = String(params.eventId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || crypto.randomUUID()
  const rawMetadata = params.metadata && typeof params.metadata === 'object' ? params.metadata as Record<string, unknown> : {}
  const metadata = JSON.stringify(rawMetadata).length <= 2000 ? rawMetadata : {}

  await logEngagementEvent(supabase, {
    agentNo, eventType, screen, districtId, sessionId, metadata,
    dedupKey: `client:${agentNo}:${sessionId || 'none'}:${eventId}`,
  })
  return { success: true }
}

export async function adminGetEngagementReport(supabase: SupabaseDB, params: Record<string, unknown>) {
  const days = Math.max(1, Math.min(90, Number(params.days) || 7))
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const sinceDate = since.slice(0, 10)

  const [{ data: activeAgentRows }, { data: playerRows }, { data: events }, { data: activity }, { data: homeBase }] = await Promise.all([
    supabase.from('rc_agents').select('agent_no').is('retired_at', null),
    supabase.from('rc_players').select('agent_no'),
    supabase.from('rc_engagement_events').select('agent_no, event_type, screen, district_id, created_at').gte('created_at', since),
    supabase.from('rc_daily_activity').select('agent_no, raw_streams, counted_streams, kst_date').gte('kst_date', sinceDate),
    supabase.from('rc_districts').select('id').eq('is_tutorial', true).limit(1).maybeSingle(),
  ])

  const activeAccounts = new Set((activeAgentRows || []).map((a: any) => a.agent_no))
  const activeAgents = new Set((playerRows || []).map((p: any) => p.agent_no).filter((agentNo: string) => activeAccounts.has(agentNo)))
  const activeEvents = (events || []).filter((e: any) => activeAgents.has(e.agent_no))
  const activeActivity = (activity || []).filter((a: any) => activeAgents.has(a.agent_no))
  const opened = new Set(activeEvents.filter((e: any) => e.event_type === 'app_opened').map((e: any) => e.agent_no))
  const streaming = new Set(activeActivity.filter((a: any) => (a.raw_streams || a.counted_streams || 0) > 0).map((a: any) => a.agent_no))
  const both = new Set([...opened].filter((a) => streaming.has(a)))
  const streamingOnly = [...streaming].filter((a) => !opened.has(a))
  const openedOnly = [...opened].filter((a) => !streaming.has(a))
  const known = new Set([...opened, ...streaming])

  const destinations = new Map<string, { views: number; agents: Set<string> }>()
  for (const e of activeEvents.filter((row: any) => row.event_type === 'screen_viewed')) {
    const key = e.screen || 'unknown'
    const entry = destinations.get(key) || { views: 0, agents: new Set<string>() }
    entry.views += 1
    entry.agents.add(e.agent_no)
    destinations.set(key, entry)
  }

  const reconnectDestinations = new Map<string, Set<string>>()
  for (const e of activeEvents.filter((row: any) => row.event_type === 'reconnect_opened' && row.district_id)) {
    const agents = reconnectDestinations.get(e.district_id) || new Set<string>()
    agents.add(e.agent_no)
    reconnectDestinations.set(e.district_id, agents)
  }

  let activeOnHomeBase = 0
  if (homeBase?.id) {
    const { count } = await supabase.from('rc_player_districts')
      .select('agent_no', { count: 'exact', head: true }).eq('district_id', homeBase.id).eq('status', 'active')
    activeOnHomeBase = count || 0
  }

  return {
    success: true,
    days,
    since,
    agents: {
      total: activeAgents.size,
      activeOnHomeBase,
      openedApp: opened.size,
      streamed: streaming.size,
      openedAndStreamed: both.size,
      streamedWithoutOpening: streamingOnly.length,
      openedWithoutStreaming: openedOnly.length,
      neither: Math.max(0, activeAgents.size - known.size),
      openedReconnect: new Set(activeEvents.filter((e: any) => e.event_type === 'reconnect_opened').map((e: any) => e.agent_no)).size,
    },
    destinations: [...destinations.entries()].map(([screen, value]) => ({ screen, views: value.views, agents: value.agents.size }))
      .sort((a, b) => b.agents - a.agents || b.views - a.views),
    reconnectDestinations: [...reconnectDestinations.entries()].map(([districtId, agents]) => ({ districtId, agents: agents.size }))
      .sort((a, b) => b.agents - a.agents),
  }
}
