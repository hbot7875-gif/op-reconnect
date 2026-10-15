// MAMA Event Hub — Team and Chat, server side. Plain JS with the database
// passed in, so Node can test it; vote-campaign.ts is the Deno wrapper.
//
// Privacy, in one place:
//   * agentNo is only ever the session-verified caller (index.ts).
//   * The roster is the CALLER's team, chosen in SQL from their own row;
//     there is no parameter that names a team.
//   * Responses carry codenames, team ids and an opaque per-event
//     member_key (for mute) — never an agent number.
//   * An Instagram username is included only when its owner switched it on
//     for this event, and only in their own team's roster.
// The atomic parts (slow mode, report thresholds, mutes) are SQL functions
// in migration 20261015150000.
import { kstDayOf, campaignPhase, cityPhase } from './vote-campaign-rules.js'
import { getPublicBattle } from './vote-campaign-service.js'
import { checkChatText } from './battle-text-filter.js'
import { decideMoments, CHAT_EMOJI, REPORT_REASONS } from './battle-hub-rules.js'

const fail = (error, extra = {}) => ({ success: false, error, ...extra })
const agentOf = (params) => String(params.agentNo || '').trim().toUpperCase()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const idOf = (v) => (Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null)
// How often a feed poll may re-check the battle for new moments.
export const MOMENT_CHECK_MS = 30_000

/** The battle the hub belongs to: enabled, and still shown in the City. */
async function hubCampaign(db, now) {
  const { data } = await db.from('rc_vote_campaigns').select('id, opens_at, closes_at, battle').eq('active', true)
    .order('closes_at', { ascending: false }).limit(5)
  return (data || []).find((c) => c.battle?.enabled && cityPhase(c, now)) || null
}

// ── Team ───────────────────────────────────────────────────────────────

export async function getBattleTeam(db, params, now = new Date()) {
  const c = await hubCampaign(db, now)
  if (!c) return fail('no_battle')
  const { data, error } = await db.rpc('rc_battle_team_roster', { p_campaign_id: c.id, p_agent_no: agentOf(params), p_day: kstDayOf(now) })
  if (error) return fail(error.message)
  if (!data?.team) return fail('team_required')
  return {
    success: true,
    team: data.team,
    showIg: !!data.showIg,
    count: Number(data.count) || 0,
    online: Number(data.online) || 0,
    // Only these four fields, whatever the query returns. `today` is the
    // teammate's verified votes today (pending or in-review never count).
    members: (data.members || []).map((m) => ({
      codename: String(m.codename || 'Agent'), ig: m.ig ? String(m.ig) : null, today: Math.max(0, Number(m.today) || 0), me: !!m.me,
    })),
  }
}

/** "Show my Instagram username to my team" — this event only. */
export async function setBattleInstagram(db, params, now = new Date()) {
  const c = await hubCampaign(db, now)
  if (!c) return fail('no_battle')
  const on = params.on === true
  const { data, error } = await db.from('rc_campaign_teams').update({ show_ig: on, show_ig_at: now.toISOString() })
    .eq('campaign_id', c.id).eq('agent_no', agentOf(params)).not('team', 'is', null).select('team')
  if (error) return fail(error.message)
  if (!data?.length) return fail('team_required')
  return { success: true, showIg: on }
}

// ── Chat ───────────────────────────────────────────────────────────────

/** Posts any due battle moments. At most one battle read per MOMENT_CHECK_MS
 *  across all servers (state in rc_cache); deterministic keys make a race
 *  post one row. Never throws into the feed. */
async function upkeepMoments(db, c, now, cache) {
  const key = `battle_moments:${c.id}`
  const { data: row } = await db.from('rc_cache').select('value').eq('key', key).maybeSingle()
  const prev = row?.value || {}
  if (prev.checkedAt && now.getTime() - Date.parse(prev.checkedAt) < MOMENT_CHECK_MS) return
  const battle = await getPublicBattle(db, now, { cache })
  if (!battle?.success || battle.phase !== 'open') return
  const { state, inserts } = decideMoments(prev, battle, now)
  await db.from('rc_cache').upsert({ key, value: state, updated_at: now.toISOString() })
  if (inserts.length) {
    await db.from('rc_battle_chat').upsert(
      inserts.map((m) => ({ campaign_id: c.id, kind: 'system', team: m.team, body: m.body, system_key: m.key })),
      { onConflict: 'campaign_id,system_key', ignoreDuplicates: true },
    )
  }
}

const shapeReply = (r) => (r ? { id: r.id, team: r.team || null, codename: r.codename || 'Agent', body: r.body ?? null } : null)

export async function getBattleChat(db, params, now = new Date(), { cache } = {}) {
  const c = await hubCampaign(db, now)
  if (!c) return fail('no_battle')
  const phase = campaignPhase(c, now)
  if (phase === 'open') await upkeepMoments(db, c, now, cache).catch(() => {})
  const { data, error } = await db.rpc('rc_battle_chat_feed', { p_campaign_id: c.id, p_agent_no: agentOf(params), p_limit: 60 })
  if (error) return fail(error.message)
  if (!data?.team) return fail('team_required')
  return {
    success: true,
    team: data.team,
    open: phase === 'open' && !c.battle?.chat_paused,
    paused: !!c.battle?.chat_paused,
    timeoutUntil: data.timeoutUntil || null,
    presence: data.presence || {},
    messages: (data.messages || []).map((m) => ({
      id: m.id, kind: m.kind, sys: m.sys || null, team: m.team || null,
      codename: m.codename || null, memberKey: m.mine ? null : m.memberKey || null,
      body: m.body ?? null, status: m.status, mine: !!m.mine, at: m.at,
      replyTo: shapeReply(m.replyTo), reactions: m.reactions || {}, myReactions: m.myReactions || [],
    })),
    moments: (data.moments || []).map((m) => ({ id: m.id, sys: m.sys, team: m.team || null, body: m.body, at: m.at })),
    muted: (data.muted || []).map((m) => ({ memberKey: m.memberKey, codename: m.codename })),
  }
}

const fromRpc = (data, extra = {}) => (data?.ok
  ? { success: true, ...extra }
  : fail(data?.error || 'failed', { ...(data?.wait ? { wait: Number(data.wait) } : {}), ...(data?.until ? { until: data.until } : {}) }))

export async function sendBattleChat(db, params, now = new Date()) {
  const text = checkChatText(params.message)
  if (!text.ok) return fail('chat_text', { reason: text.reason })
  const c = await hubCampaign(db, now)
  if (!c) return fail('no_battle')
  const { data, error } = await db.rpc('rc_battle_chat_send', {
    p_campaign_id: c.id, p_agent_no: agentOf(params), p_body: text.value, p_reply_to: idOf(params.replyTo),
  })
  if (error) return fail(error.message)
  return fromRpc(data, { id: data?.id })
}

export async function reactBattleChat(db, params, now = new Date()) {
  if (!CHAT_EMOJI.includes(params.emoji) || !idOf(params.messageId)) return fail('bad_request')
  const c = await hubCampaign(db, now)
  if (!c) return fail('no_battle')
  const { data, error } = await db.rpc('rc_battle_chat_react', {
    p_campaign_id: c.id, p_agent_no: agentOf(params), p_message_id: idOf(params.messageId), p_emoji: params.emoji,
  })
  if (error) return fail(error.message)
  return fromRpc(data, { on: !!data?.on })
}

export async function reportBattleChat(db, params, now = new Date()) {
  if (!REPORT_REASONS.includes(params.reason) || !idOf(params.messageId)) return fail('bad_request')
  const c = await hubCampaign(db, now)
  if (!c) return fail('no_battle')
  const { data, error } = await db.rpc('rc_battle_chat_report', {
    p_campaign_id: c.id, p_agent_no: agentOf(params), p_message_id: idOf(params.messageId), p_reason: params.reason,
  })
  if (error) return fail(error.message)
  return fromRpc(data)
}

export async function muteBattleChat(db, params, now = new Date()) {
  if (!UUID.test(String(params.memberKey || ''))) return fail('bad_request')
  const c = await hubCampaign(db, now)
  if (!c) return fail('no_battle')
  const on = params.on !== false
  const { data, error } = await db.rpc('rc_battle_chat_mute', {
    p_campaign_id: c.id, p_agent_no: agentOf(params), p_member_key: params.memberKey, p_on: on,
  })
  if (error) return fail(error.message)
  return fromRpc(data, { muted: on })
}

// ── Admin (admin key) ─────────────────────────────────────────────────

/** Reported and hidden messages, newest first, with who sent them. */
export async function adminListBattleChat(db, params, now = new Date()) {
  const c = await hubCampaign(db, now)
  if (!c) return fail('no_battle')
  const [{ data: reps, error: e1 }, { data: hidden, error: e2 }] = await Promise.all([
    db.from('rc_battle_chat_reports').select('message_id, reporter_team, reason').is('resolved_at', null).limit(1000),
    db.from('rc_battle_chat').select('id').eq('campaign_id', c.id).neq('status', 'visible').order('id', { ascending: false }).limit(100),
  ])
  if (e1 || e2) return fail((e1 || e2).message)
  const ids = [...new Set([...(reps || []).map((r) => Number(r.message_id)), ...(hidden || []).map((r) => Number(r.id))])]
  if (!ids.length) return { success: true, items: [] }
  const { data: msgs, error } = await db.from('rc_battle_chat').select('id, agent_no, team, body, status, created_at')
    .eq('campaign_id', c.id).in('id', ids).order('id', { ascending: false }).limit(100)
  if (error) return fail(error.message)
  const agents = [...new Set((msgs || []).map((m) => m.agent_no).filter(Boolean))]
  const [{ data: players }, { data: teams }] = agents.length ? await Promise.all([
    db.from('rc_players').select('agent_no, codename').in('agent_no', agents),
    db.from('rc_campaign_teams').select('agent_no, chat_timeout_until').eq('campaign_id', c.id).in('agent_no', agents),
  ]) : [{ data: [] }, { data: [] }]
  const names = new Map((players || []).map((p) => [p.agent_no, p.codename]))
  const timeouts = new Map((teams || []).map((t) => [t.agent_no, t.chat_timeout_until]))
  return {
    success: true,
    items: (msgs || []).map((m) => {
      const mine = (reps || []).filter((r) => Number(r.message_id) === Number(m.id))
      return {
        id: m.id, agentNo: m.agent_no, codename: names.get(m.agent_no) || 'Agent', team: m.team, body: m.body,
        status: m.status, at: m.created_at, reports: mine.length,
        ownTeamReports: mine.filter((r) => r.reporter_team === m.team).length,
        reasons: [...new Set(mine.map((r) => r.reason))],
        timeoutUntil: timeouts.get(m.agent_no) && new Date(timeouts.get(m.agent_no)) > now ? timeouts.get(m.agent_no) : null,
      }
    }),
  }
}

const TIMEOUTS = { '60': 60, '1440': 1440 }

/** restore | remove a message, or time its sender out (60 / 1440 minutes,
 *  'event' = until voting closes, '0' = lift). */
export async function adminModerateBattleChat(db, params, now = new Date()) {
  const c = await hubCampaign(db, now)
  const id = idOf(params.messageId)
  if (!c || !id) return fail('bad_request')
  const { data: m } = await db.from('rc_battle_chat').select('id, agent_no, kind').eq('id', id).eq('campaign_id', c.id).maybeSingle()
  if (!m || m.kind !== 'player') return fail('not_found')
  const resolve = () => db.from('rc_battle_chat_reports').update({ resolved_at: now.toISOString() }).eq('message_id', id).is('resolved_at', null)
  if (params.action === 'restore' || params.action === 'remove') {
    const { error } = await db.from('rc_battle_chat').update({ status: params.action === 'restore' ? 'visible' : 'removed' }).eq('id', id)
    if (error) return fail(error.message)
    await resolve()
    return { success: true }
  }
  if (params.action === 'timeout') {
    const p = String(params.minutes)
    const until = p === '0' ? null : p === 'event' ? c.closes_at : TIMEOUTS[p] ? new Date(now.getTime() + TIMEOUTS[p] * 60_000).toISOString() : undefined
    if (until === undefined) return fail('bad_request')
    const { error } = await db.from('rc_campaign_teams').update({ chat_timeout_until: until }).eq('campaign_id', c.id).eq('agent_no', m.agent_no)
    if (error) return fail(error.message)
    return { success: true, until }
  }
  return fail('bad_request')
}
