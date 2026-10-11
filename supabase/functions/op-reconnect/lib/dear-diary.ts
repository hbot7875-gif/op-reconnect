// Dear Diary — one private, KST-dated entry per authenticated ReConnect agent.
// Activity is read from existing ledgers only; unavailable facts are omitted.

import type { GameContent, SupabaseDB } from './config.ts'
import { PERSONAL_COUNT_CAP, trackArtistOverrides } from './config.ts'
import { countedStreams } from './derive.ts'
import { addDaysStr, kstDateOf, kstDayBounds, todayKst } from './kst.ts'
import { countedArtistPlays, normalizeKey, normKeyFull } from './text.ts'
import {
  backupPassCandidates, candidateDigest, normalizeDiaryCandidate,
  selectDailyMemories, streamingXpKstDate, type DiaryCandidate,
} from './diary-candidates.ts'

const NOTE_MAX = 1200
const DIARY_THEMES = new Set(['oldworld', 'school90s', 'y2k', 'modern', 'future'])
const DIARY_DECORATION_IDS = new Set(['organic', 'keepsake', 'star', 'mark', 'fastener', 'accent'])
const DIARY_DECORATION_SLOTS = new Set(['entry-leading', 'entry-trailing', 'badges-heading', 'moments-heading', 'note-heading', 'footer-center'])
const DIARY_DECORATION_LIMIT = 4

export type DiaryDecorations = {
  version: 1
  items: Array<{ sheet: number; decoration_id: string; slot: string; size: 's' | 'm' }>
}

const EMPTY_DECORATIONS: DiaryDecorations = { version: 1, items: [] }

export function validateDiaryDecorations(value: unknown): { success: true; decorations: DiaryDecorations } | { success: false; error: string } {
  if (!value || typeof value !== 'object' || (value as any).version !== 1 || !Array.isArray((value as any).items)) return { success: false, error: 'Those page decorations are not valid.' }
  const items = (value as any).items
  if (items.length > 80) return { success: false, error: 'That diary has too many page decorations.' }
  const seen = new Set<string>(), perSheet = new Map<number, number>(), normalized: DiaryDecorations['items'] = []
  for (const item of items) {
    const sheet = Number(item?.sheet), decorationId = String(item?.decoration_id || ''), slot = String(item?.slot || ''), size = String(item?.size || '')
    if (!Number.isInteger(sheet) || sheet < 0 || sheet > 19) return { success: false, error: 'That decoration sheet is not valid.' }
    if (!DIARY_DECORATION_IDS.has(decorationId)) return { success: false, error: 'That decoration is not available.' }
    if (!DIARY_DECORATION_SLOTS.has(slot)) return { success: false, error: 'That decoration slot is not available.' }
    if (size !== 's' && size !== 'm') return { success: false, error: 'That decoration size is not available.' }
    const key = `${sheet}:${slot}`, count = perSheet.get(sheet) || 0
    if (seen.has(key)) return { success: false, error: 'Two decorations cannot share one diary spot.' }
    if (count >= DIARY_DECORATION_LIMIT) return { success: false, error: 'Each diary sheet can hold up to four decorations.' }
    seen.add(key); perSheet.set(sheet, count + 1)
    normalized.push({ sheet, decoration_id: decorationId, slot, size: size as 's' | 'm' })
  }
  return { success: true, decorations: { version: 1, items: normalized } }
}

function storedDiaryDecorations(value: unknown): DiaryDecorations {
  const checked = validateDiaryDecorations(value)
  return checked.success ? checked.decorations : EMPTY_DECORATIONS
}

function artUrl(path: string | null): string | null {
  if (!path) return null
  return `${Deno.env.get('SUPABASE_URL') || ''}/storage/v1/object/public/badge-art/${path}`
}

function templateId(badgeId: string) { return badgeId.split(':', 1)[0] }

function pick<T>(items: T[], seed: number): T { return items[Math.abs(seed) % items.length] }

type CopyChoice = { key: string; text: string }

function choose(items: CopyChoice[], seed: number, recentlyUsed: string[]): CopyChoice {
  const fresh = items.filter((item) => !recentlyUsed.includes(item.key))
  return pick(fresh.length ? fresh : items, seed)
}

function loudNumber(value: number): string { return ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'][value] || String(value) }

function normalizeDate(value: unknown): string | null {
  const date = String(value || todayKst())
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return null
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (parsed.toISOString().slice(0, 10) !== date) return null
  return date <= todayKst() ? date : null
}

export interface DiaryFacts {
  xp: number
  streams: number
  badges: Array<{ badgeId: string; name: string; reason: string; artworkUrl: string | null; rarity: string; earnedAt?: string }>
  completedDistricts: Array<{ id: string; name: string }>
  moments: Array<{ kind: string; text: string; agentName?: string; districtName?: string; missionName?: string }>
}

type ListeningBucket = Record<string, { n?: number; a?: Record<string, number> }>

/** One canonical filter feeds the archive index and every listening detail.
 * Raw scrobbles or non-BTS bucket entries can never make a diary date exist. */
export function countedDiaryTracks(bucket: ListeningBucket, allowlist: string[], overrides: Record<string, string[]> = {}) {
  return Object.entries(bucket || {}).map(([key, value]) => ({
    key,
    count: Math.min(countedArtistPlays(value?.a || {}, allowlist, key, overrides), PERSONAL_COUNT_CAP),
  })).filter((item) => item.count > 0)
}

export function isCountedDiaryScrobble(row: { track_name?: string; artist_name?: string }, allowlist: string[], overrides: Record<string, string[]> = {}) {
  const key = normKeyFull(String(row?.track_name || ''))
  const artist = normalizeKey(String(row?.artist_name || ''))
  return !!key && countedArtistPlays({ [artist]: 1 }, allowlist, key, overrides) > 0
}

export function isNoRecordedHistoricalDay(date: string, state: string, note: string, today = todayKst()) {
  return date < today && state === 'none' && !String(note || '').trim()
}

export function diaryBadgeFact(row: any, template: any, storagePath?: string | null) {
  const name = String(template?.name || 'Badge award')
  return {
    badge: {
      badgeId: String(row.badge_id), name,
      rarity: String(template?.rarity || 'common'),
      reason: String(template?.unlock_hint || 'Earned through ReConnect activity.'),
      artworkUrl: artUrl(storagePath || null), earnedAt: row.earned_at,
    },
    title: `Earned the ${name} badge.`,
    artworkAvailable: !!storagePath,
  }
}

type DiarySnapshot = DiaryFacts & {
  _copyKey: string
  _candidateDigest: string
  _candidates: DiaryCandidate[]
  _state: 'real' | 'light' | 'none'
  _frozen: boolean
  _materializedAt: string
}

export function factsFromFrozenSnapshot(stored: Partial<DiarySnapshot>): DiaryFacts {
  return {
    xp: stored.xp || 0,
    streams: stored.streams || 0,
    badges: stored.badges || [],
    completedDistricts: stored.completedDistricts || [],
    moments: stored.moments || [],
  }
}

function c(raw: Partial<DiaryCandidate>, out: DiaryCandidate[]) {
  const item = normalizeDiaryCandidate(raw)
  if (item) out.push(item)
}

function feedCandidate(row: any, districtNames: Map<string, string>): DiaryCandidate | null {
  // Historical limitation: level/ward/streak facts exist only while their
  // immutable feed rows are retained. Current player state is never used to
  // guess a missing past date.
  const payload = row.payload || {}
  const districtId = String(row.dedup_key || '').match(/^feed:district:[^:]+:(.+)$/)?.[1]
  const district = districtNames.get(districtId || '')
  const map: Record<string, { type: string; importance: 'special' | 'nice'; title: string; facts?: any }> = {
    district_restored: { type: 'district-restored', importance: 'special', title: district ? `Restored ${district}.` : 'Restored a district.', facts: district ? { district } : {} },
    ward_completed: { type: 'ward-completed', importance: 'special', title: payload.wardName ? `Restored ${payload.wardName}.` : 'Restored a ward.', facts: payload.wardName ? { ward: payload.wardName } : {} },
    level_up: { type: 'level-reached', importance: 'special', title: `Reached Level ${Number(payload.level) || '?'}.`, facts: { level: Number(payload.level) || 0, levelName: payload.name || '' } },
    reconnect_completed: { type: 'reconnect-completed', importance: 'special', title: payload.partnerCodename ? `Completed a ReConnect Quest with Agent ${payload.partnerCodename}.` : 'Completed a ReConnect Quest.', facts: { partnerCodename: payload.partnerCodename || '' } },
    item_dropped: { type: 'item-found', importance: 'nice', title: `Found a${payload.rarity ? ` ${payload.rarity}` : ''} reward.`, facts: { rarity: payload.rarity || '' } },
    era_lit: { type: 'era-lit', importance: 'nice', title: payload.eraName ? `Lit the ${payload.eraName} Era.` : 'Lit an Era Card.', facts: { eraName: payload.eraName || '' } },
    bomb_fed: { type: 'bomb-fed', importance: 'nice', title: 'Fed the ARMY Bomb.', facts: { hoursAdded: Number(payload.hoursAdded) || 0 } },
    ticket_claimed: { type: 'milestone-unlocked', importance: 'special', title: 'Claimed a Magic Shop ticket.' },
    side_mission_daily: { type: 'side-mission', importance: 'nice', title: "Completed today's Signal Sweep." },
    side_mission_weekly: { type: 'side-mission', importance: 'nice', title: 'Completed the weekly Signal Sweep.' },
    streak_badge: { type: 'streak-milestone', importance: 'special', title: `Reached a ${Number(payload.days) || '?'}-day streak.`, facts: { days: Number(payload.days) || 0 } },
  }
  const found = map[row.event_type]
  if (!found) return null
  return normalizeDiaryCandidate({ ...found, occurredAt: row.created_at, reliability: 'A', source: { table: 'rc_feed_events', id: String(row.id), eventType: row.event_type } })
}

function frozenFor(date: string): boolean {
  const graceEnds = new Date(`${addDaysStr(date, 1)}T00:00:00+09:00`).getTime() + 36 * 3600_000
  return Date.now() >= graceEnds
}

/** Casual, deterministic ARMY-style copy. No facts are added beyond the snapshot. */
export function diarySummaryChoice(facts: DiaryFacts, seed: number, recentlyUsed: string[] = []): CopyChoice {
  const badge = facts.badges[0]
  const district = facts.completedDistricts[0]
  const helpedMe = facts.moments.find((m) => ['helped-me', 'backup-helped-me'].includes(m.kind))
  const helpedAgent = facts.moments.find((m) => ['helped-agent', 'backup-helped-agent'].includes(m.kind))
  const mission = facts.moments.find((m) => ['mission', 'mission-completed', 'reconnect-completed'].includes(m.kind))
  const categories = [facts.badges.length > 0, facts.xp > 0, facts.streams > 0, !!district, facts.moments.length > 0].filter(Boolean).length

  if (!categories) return choose([
    { key: 'quiet-moving-on', text: 'Dear Diary, nothing happened today. Moving on.' },
    { key: 'quiet-zero', text: 'Dear Diary, 0 badges. Very peaceful.' },
    { key: 'quiet-suspicious', text: 'Dear Diary, today was suspiciously quiet.' },
    { key: 'quiet-was-here', text: 'Dear Diary, no major updates. I was here though.' },
    { key: 'quiet-report', text: 'Dear Diary, there isn\'t much to keep from today.' },
    { key: 'quiet-off', text: 'Dear Diary, apparently I took the day off.' },
    { key: 'quiet-plain', text: 'Dear Diary, pretty quiet today.' },
  ], seed, recentlyUsed)

  if (categories >= 2) {
    const secondFact = district ? `${district.name} was restored too.`
      : mission ? `${mission.missionName || 'ReConnect'} mission done. One less thing.`
      : helpedMe ? `Agent ${helpedMe.agentName || 'someone'} came through today.`
      : facts.streams > 0 ? `${facts.streams} streams made it onto the record.`
      : facts.xp > 0 ? `${facts.xp} XP too. That happened.` : ''
    if (facts.badges.length > 1) return choose([
      { key: 'mixed-badges-evidence', text: `Dear Diary, ${facts.badges.length} badges. ${loudNumber(facts.badges.length)}. ${secondFact} Evidence below.` },
      { key: 'mixed-badges-proof', text: `Dear Diary, ${loudNumber(facts.badges.length)} badges. I have evidence. ${secondFact}` },
      { key: 'mixed-badges-happened', text: `Dear Diary, ${facts.badges.length} badges found their way onto this page. ${secondFact}` },
    ], seed, recentlyUsed)
    if (badge) return choose([
      { key: 'mixed-badge-acquired', text: `Dear Diary, ${badge.name} is staying on this page. ${secondFact}` },
      { key: 'mixed-badge-keeping', text: `Dear Diary, I got a badge. Obviously I’m keeping it. ${secondFact}` },
      { key: 'mixed-badge-proof', text: `Dear Diary, there is a new badge on this page. ${secondFact}` },
    ], seed, recentlyUsed)
    const lead = mission ? `${mission.missionName || 'ReConnect'} mission done.`
      : helpedMe ? `Agent ${helpedMe.agentName || 'someone'} helped me today.`
      : district ? `${district.name} moved.`
      : facts.streams > 0 ? `${facts.streams} streams today.`
      : `${facts.xp} XP today.`
    const extra = facts.streams > 0 && !lead.includes('streams') ? `${facts.streams} streams too.`
      : facts.xp > 0 && !lead.includes('XP') ? `${facts.xp} XP too.` : ''
    return choose([
      { key: 'mixed-report', text: `Dear Diary, ${lead} ${extra} I’m writing it down before the day disappears.` },
      { key: 'mixed-noted', text: `Dear Diary, ${lead} ${extra} This one belongs on the page.` },
      { key: 'mixed-happened', text: `Dear Diary, ${lead} ${extra} So that was today.` },
    ], seed, recentlyUsed)
  }

  if (facts.badges.length > 1) return choose([
    { key: 'badges-two', text: `Dear Diary, ${facts.badges.length} badges. ${loudNumber(facts.badges.length)}.` },
    { key: 'badges-display', text: `Dear Diary, ${loudNumber(facts.badges.length)} badges. I have evidence.` },
    { key: 'badges-casual', text: `Dear Diary, ${facts.badges.length} new badges. That happened.` },
  ], seed, recentlyUsed)
  if (badge) return choose([
    { key: 'badge-showoff', text: 'Dear Diary, I got a badge. Obviously I’m keeping it.' },
    { key: 'badge-one', text: `Dear Diary, ${badge.name} has a place on this page now.` },
    { key: 'badge-stuck', text: `Dear Diary, ${badge.name} is going on this page.` },
    { key: 'badge-proof', text: 'Dear Diary, one badge. I have evidence.' },
  ], seed, recentlyUsed)
  if (facts.streams >= 20) return choose([
    { key: 'streams-high-worse', text: `Dear Diary, ${facts.streams} streams. I’ve seen worse.` },
    { key: 'streams-high-count', text: `Dear Diary, ${facts.streams} streams today. Could be worse.` },
    { key: 'streams-high-loop', text: `Dear Diary, I streamed ${facts.streams} times. That happened.` },
  ], seed, recentlyUsed)
  if (facts.streams > 0) return choose([
    { key: 'streams-low', text: `Dear Diary, ${facts.streams} streams made it into today.` },
    { key: 'streams-some', text: `Dear Diary, I left ${facts.streams} streams behind today. Small, but real.` },
  ], seed, recentlyUsed)
  if (district) return choose([
    { key: 'district-survived', text: `Dear Diary, ${district.name} moved. Finally.` },
    { key: 'district-done', text: `Dear Diary, ${district.name} is restored. One less thing.` },
    { key: 'district-power', text: `Dear Diary, ${district.name} is done. I’ll take it.` },
  ], seed, recentlyUsed)
  if (mission) return choose([
    { key: 'mission-one-down', text: `Dear Diary, one mission down${mission.missionName ? ` — ${mission.missionName}` : ''}. I’ll take it.` },
    { key: 'mission-survived', text: `Dear Diary, ${mission.missionName || 'ReConnect'} mission done. One less thing.` },
  ], seed, recentlyUsed)
  if (helpedMe) return choose([
    { key: 'helped-noted', text: `Dear Diary, Agent ${helpedMe.agentName || 'someone'} helped me today. Noted.` },
    { key: 'helped-owe', text: `Dear Diary, I got help from Agent ${helpedMe.agentName || 'someone'}. I owe them one.` },
  ], seed, recentlyUsed)
  if (helpedAgent) return choose([
    { key: 'helper-me', text: `Dear Diary, I helped Agent ${helpedAgent.agentName || 'someone'} today. Noted.` },
    { key: 'helper-receipt', text: `Dear Diary, Agent ${helpedAgent.agentName || 'someone'} needed help. I showed up.` },
  ], seed, recentlyUsed)
  if (facts.moments[0]?.text) return choose([
    { key: 'moment-noted', text: `Dear Diary, ${facts.moments[0].text} I wanted to keep that here.` },
    { key: 'moment-report', text: `Dear Diary, ${facts.moments[0].text} This page can remember it.` },
  ], seed, recentlyUsed)
  return choose([
    { key: 'xp-found', text: `Dear Diary, ${facts.xp} XP found its way into today.` },
    { key: 'xp-proof', text: `Dear Diary, ${facts.xp} XP. It’s on the record.` },
    { key: 'xp-take', text: `Dear Diary, I gained ${facts.xp} XP. I’ll take it.` },
  ], seed, recentlyUsed)
}

export function diarySummary(facts: DiaryFacts, seed: number, recentlyUsed: string[] = []): string {
  return diarySummaryChoice(facts, seed, recentlyUsed).text
}

async function realDay(sb: SupabaseDB, content: GameContent, agentNo: string, date: string) {
  const { fromTs, toTs } = kstDayBounds(date)
  const from = new Date(fromTs * 1000).toISOString(), to = new Date(toTs * 1000).toISOString()
  const districtNames = new Map(content.districts.map((d) => [d.id, d.name]))
  const backupOutcomeFilter = `and(status.eq.complete,completed_at.gte.${from},completed_at.lt.${to}),and(status.eq.banked,closed_at.gte.${from},closed_at.lt.${to})`
  const [playerRes, feedRes, xpRes, streamXpRes, dailyRes, scrobblesRes, badgeRes, districtRes, backupOwnerRes, backupHelperRes, participantJoinedRes, participantStreamedRes, skipsRes, chestRes, passRes, presenceRes, afterRes, battleRes, playlistRes, saveRes] = await Promise.all([
    sb.from('rc_players').select('agent_no,codename,joined_at,mode_upgraded_at,mode_upgraded_from').eq('agent_no', agentNo).maybeSingle(),
    sb.from('rc_feed_events').select('id,event_type,payload,dedup_key,created_at').eq('agent_no', agentNo).gte('created_at', from).lt('created_at', to),
    sb.from('rc_xp_ledger').select('id,amount,source,kind,dedup_key,meta,created_at').eq('agent_no', agentNo).gte('created_at', from).lt('created_at', to),
    sb.from('rc_xp_ledger').select('id,amount,source,kind,dedup_key,meta,created_at').eq('agent_no', agentNo).eq('dedup_key', `streams:${agentNo}:${date}`),
    sb.from('rc_daily_activity').select('track_counts').eq('agent_no', agentNo).eq('kst_date', date).maybeSingle(),
    sb.from('rc_scrobbles').select('id,track_name,artist_name,listened_at').eq('agent_no', agentNo).gte('listened_at', fromTs).lt('listened_at', toTs).order('listened_at'),
    sb.from('rc_badges').select('badge_id,artwork_id,earned_at').eq('agent_no', agentNo).gte('earned_at', from).lt('earned_at', to).order('earned_at'),
    sb.from('rc_player_districts').select('district_id,completed_at').eq('agent_no', agentNo).gte('completed_at', from).lt('completed_at', to),
    sb.from('rc_backup_requests').select('id,owner_agent_no,helper_agent_no,district_id,status,banked_credit,completed_at,closed_at').eq('owner_agent_no', agentNo).or(backupOutcomeFilter),
    sb.from('rc_backup_requests').select('id,owner_agent_no,helper_agent_no,district_id,status,banked_credit,completed_at,closed_at').eq('helper_agent_no', agentNo).or(backupOutcomeFilter),
    sb.from('rc_reconnect_participants').select('mission_id,status,joined_at,streamed_at').eq('agent_no', agentNo).gte('joined_at', from).lt('joined_at', to),
    sb.from('rc_reconnect_participants').select('mission_id,status,joined_at,streamed_at').eq('agent_no', agentNo).gte('streamed_at', from).lt('streamed_at', to),
    sb.from('rc_quest_skips').select('id,mission_id,district_id,free_reason,created_at').eq('agent_no', agentNo).gte('created_at', from).lt('created_at', to),
    sb.from('rc_supply_chest_opens').select('id,event_id,reward_kind,reward_detail,opened_at').eq('agent_no', agentNo).gte('opened_at', from).lt('opened_at', to),
    sb.from('rc_recelebrate_passes').select('event_id,pass_issued_at,team,team_chosen_at').eq('agent_no', agentNo),
    sb.from('rc_recelebrate_presence').select('event_id,watched_at').eq('agent_no', agentNo).gte('watched_at', from).lt('watched_at', to),
    sb.from('rc_recelebrate_after_party_claims').select('event_id,reward_kind,reward_amount,badge_ids,claimed_at').eq('agent_no', agentNo).gte('claimed_at', from).lt('claimed_at', to),
    sb.from('rc_recelebrate_battle_streams').select('event_id,listened_at,track_id,track_name').eq('agent_no', agentNo).gte('listened_at', fromTs).lt('listened_at', toTs),
    sb.from('generated_playlists').select('playlist_id,name,source,created_at').eq('agent_no', agentNo).gte('created_at', from).lt('created_at', to),
    sb.from('rc_playlist_saves').select('playlist_id,created_at').eq('agent_no', agentNo).gte('created_at', from).lt('created_at', to),
  ])
  const completedMissionsRes = await sb.from('rc_reconnect_missions').select('id,completed_at').eq('status', 'complete').gte('completed_at', from).lt('completed_at', to)
  const completedMissionIds = (completedMissionsRes.data || []).map((row: any) => row.id)
  const completedParticipationRes = completedMissionIds.length
    ? await sb.from('rc_reconnect_participants').select('mission_id').eq('agent_no', agentNo).in('mission_id', completedMissionIds)
    : { data: [] }
  const participatedMissionIds = new Set((completedParticipationRes.data || []).map((row: any) => row.mission_id))
  const rows = <T>(res: any): T[] => res?.error ? [] : (res?.data || [])
  const candidates: DiaryCandidate[] = []
  const player = playerRes.data
  if (player?.joined_at && kstDateOf(Date.parse(player.joined_at) / 1000) === date) c({ type: 'agent-joined', occurredAt: player.joined_at, importance: 'special', reliability: 'A', safeTitle: 'Became a ReConnect agent.', source: { table: 'rc_players', id: agentNo, eventType: 'joined_at' }, facts: {} }, candidates)
  if (player?.joined_at && date !== kstDateOf(Date.parse(player.joined_at) / 1000) && date.slice(5) === kstDateOf(Date.parse(player.joined_at) / 1000).slice(5)) c({ type: 'join-anniversary', occurredAt: `${date}T00:00:00+09:00`, importance: 'special', reliability: 'A', safeTitle: 'Another year as a ReConnect agent.', source: { table: 'rc_players', id: `${agentNo}:${date}`, eventType: 'join_anniversary' }, facts: { years: Number(date.slice(0, 4)) - Number(kstDateOf(Date.parse(player.joined_at) / 1000).slice(0, 4)) } }, candidates)
  if (player?.mode_upgraded_at && kstDateOf(Date.parse(player.mode_upgraded_at) / 1000) === date) c({ type: 'mode-upgrade', occurredAt: player.mode_upgraded_at, importance: 'nice', reliability: 'A', safeTitle: 'Upgraded agent mode.', source: { table: 'rc_players', id: agentNo, eventType: 'mode_upgraded_at' }, facts: { from: player.mode_upgraded_from || '' } }, candidates)
  for (const row of rows<any>(feedRes)) { const item = feedCandidate(row, districtNames); if (item) candidates.push(item) }

  let xp = 0
  const xpRows = [...new Map([...rows<any>(xpRes), ...rows<any>(streamXpRes)].map((row) => [String(row.id || row.dedup_key), row])).values()]
  for (const row of xpRows) {
    if (row.kind !== 'earn' || Number(row.amount) <= 0 || /admin|reset|spend/i.test(String(row.source || ''))) continue
    const streamDate = String(row.source || '').toLowerCase().includes('stream') ? streamingXpKstDate(row.dedup_key, agentNo) : null
    if (String(row.source || '').toLowerCase().includes('stream') && streamDate !== date) continue
    xp += Number(row.amount)
    // Historical limitation: a Red Zone day is reconstructed only from this
    // durable reward ledger. Participation without a reward row is omitted.
    c({ type: /red.?zone|defuse/i.test(String(row.source)) ? 'red-zone-reward' : 'xp', occurredAt: streamDate ? `${date}T12:00:00+09:00` : row.created_at, importance: /red.?zone|defuse/i.test(String(row.source)) ? 'special' : 'ordinary', reliability: streamDate ? 'A' : 'B', safeTitle: /red.?zone|defuse/i.test(String(row.source)) ? `Qualified for a Red Zone reward.` : `Earned ${Number(row.amount)} XP.`, source: { table: 'rc_xp_ledger', id: String(row.id || row.dedup_key) }, facts: { amount: Number(row.amount), source: String(row.source || '') } }, candidates)
  }
  const bucket = dailyRes.data?.track_counts || {}
  const allowlist = content.config.bts_artists || []
  const artistOverrides = trackArtistOverrides(content)
  const streams = countedStreams(bucket, allowlist, PERSONAL_COUNT_CAP, artistOverrides)
  if (streams > 0) c({ type: streams >= 20 ? 'high-stream-day' : 'counted-streams', occurredAt: `${date}T12:00:00+09:00`, importance: streams >= 20 ? 'nice' : 'ordinary', reliability: 'A', safeTitle: `${streams} counted stream${streams === 1 ? '' : 's'}.`, source: { table: 'rc_daily_activity', id: `${agentNo}:${date}` }, facts: { count: streams } }, candidates)
  const listenedTracks = countedDiaryTracks(bucket, allowlist, artistOverrides)
  if (listenedTracks.length >= 5) c({ type: 'listening-variety', occurredAt: `${date}T12:01:00+09:00`, importance: 'nice', reliability: 'A', safeTitle: `Listened to ${listenedTracks.length} different tracks.`, source: { table: 'rc_daily_activity', id: `${agentNo}:${date}:variety` }, facts: { uniqueTracks: listenedTracks.length } }, candidates)
  const top = listenedTracks.sort((a, b) => b.count - a.count)[0]
  if (top && top.count >= 3) { const name = String(top.key).replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); c({ type: 'top-track', occurredAt: `${date}T12:02:00+09:00`, importance: 'nice', reliability: 'B', safeTitle: `${name} was the song of the day.`, source: { table: 'rc_daily_activity', id: `${agentNo}:${date}:top` }, facts: { trackName: name, count: top.count } }, candidates) }
  const countedScrobbles = rows<any>(scrobblesRes).filter((row) => isCountedDiaryScrobble(row, allowlist, artistOverrides))
  const firstTrack = countedScrobbles[0], lastTrack = countedScrobbles.at(-1)
  if (firstTrack) c({ type: 'first-track', occurredAt: new Date(Number(firstTrack.listened_at) * 1000).toISOString(), importance: 'ordinary', reliability: 'A', safeTitle: `${firstTrack.track_name} started the listening day.`, source: { table: 'rc_scrobbles', id: String(firstTrack.id) }, facts: { trackName: firstTrack.track_name } }, candidates)
  if (lastTrack && lastTrack.id !== firstTrack?.id) c({ type: 'last-track', occurredAt: new Date(Number(lastTrack.listened_at) * 1000).toISOString(), importance: 'ordinary', reliability: 'A', safeTitle: `${lastTrack.track_name} closed the listening day.`, source: { table: 'rc_scrobbles', id: String(lastTrack.id) }, facts: { trackName: lastTrack.track_name } }, candidates)

  const badgeRows = rows<any>(badgeRes), tids = [...new Set(badgeRows.map((b) => templateId(String(b.badge_id))))], artIds = [...new Set(badgeRows.map((b) => b.artwork_id).filter(Boolean))]
  const [templatesRes, artRes] = await Promise.all([
    tids.length ? sb.from('rc_badge_catalog').select('id,name,rarity,unlock_hint').in('id', tids) : Promise.resolve({ data: [] }),
    artIds.length ? sb.from('rc_badge_art').select('id,storage_path').in('id', artIds) : Promise.resolve({ data: [] }),
  ])
  const templates = new Map(rows<any>(templatesRes).map((r) => [r.id, r])), art = new Map(rows<any>(artRes).map((r) => [r.id, r.storage_path]))
  const badges: DiaryFacts['badges'] = []
  for (const row of badgeRows) {
    const t: any = templates.get(templateId(String(row.badge_id))), path = art.get(row.artwork_id) as string | undefined
    const presentation = diaryBadgeFact(row, t, path)
    badges.push(presentation.badge)
    c({ type: 'badge-awarded', occurredAt: row.earned_at, importance: 'special', reliability: 'A', safeTitle: presentation.title, source: { table: 'rc_badges', id: String(row.badge_id) }, artworkId: path ? Number(row.artwork_id) : undefined, facts: { badgeId: String(row.badge_id), badgeName: presentation.badge.name, artworkAvailable: presentation.artworkAvailable } }, candidates)
  }
  const completedDistricts: DiaryFacts['completedDistricts'] = []
  for (const row of rows<any>(districtRes)) { const name = districtNames.get(row.district_id) || 'a district'; completedDistricts.push({ id: row.district_id, name }); c({ type: 'district-restored', occurredAt: row.completed_at, importance: 'special', reliability: 'A', safeTitle: `Restored ${name}.`, source: { table: 'rc_player_districts', id: `${agentNo}:${row.district_id}` }, facts: { district: name } }, candidates) }

  const backupRows = [...rows<any>(backupOwnerRes), ...rows<any>(backupHelperRes)]
  const otherNos = [...new Set(backupRows.map((r) => r.owner_agent_no === agentNo ? r.helper_agent_no : r.owner_agent_no).filter(Boolean))]
  const peopleRes = otherNos.length ? await sb.from('rc_players').select('agent_no,codename').in('agent_no', otherNos) : { data: [] }
  const people = new Map(rows<any>(peopleRes).map((p) => [p.agent_no, p.codename]))
  candidates.push(...backupPassCandidates(backupRows, people, agentNo))

  const participantRows = [...new Map([...rows<any>(participantJoinedRes), ...rows<any>(participantStreamedRes)].map((row) => [`${row.mission_id}:${row.joined_at}`, row])).values()]
  for (const row of participantRows) {
    if (row.status !== 'invited' && row.joined_at && kstDateOf(Date.parse(row.joined_at) / 1000) === date) c({ type: 'mission-joined', occurredAt: row.joined_at, importance: 'nice', reliability: 'A', safeTitle: 'Joined a ReConnect mission.', source: { table: 'rc_reconnect_participants', id: `${row.mission_id}:${agentNo}:joined` }, facts: { missionId: row.mission_id } }, candidates)
    if (row.streamed_at && kstDateOf(Date.parse(row.streamed_at) / 1000) === date) c({ type: 'mission-contributed', occurredAt: row.streamed_at, importance: 'nice', reliability: 'B', safeTitle: 'Contributed to a ReConnect mission.', source: { table: 'rc_reconnect_participants', id: `${row.mission_id}:${agentNo}:streamed` }, facts: { missionId: row.mission_id } }, candidates)
  }
  if (participatedMissionIds.size) {
    const missionDetailsRes = await sb.from('rc_reconnect_missions').select('id,district_id,track_label,completed_at').in('id', [...participatedMissionIds])
    for (const row of rows<any>(missionDetailsRes)) c({ type: 'mission-completed', occurredAt: row.completed_at, importance: 'special', reliability: 'A', safeTitle: `Completed ${row.track_label || 'a ReConnect mission'}.`, source: { table: 'rc_reconnect_missions', id: String(row.id) }, facts: { missionName: row.track_label || 'ReConnect', district: districtNames.get(row.district_id) || '' } }, candidates)
  }
  for (const row of rows<any>(skipsRes)) if (row.free_reason === 'teammate_rescue') c({ type: 'teammate-rescue', occurredAt: row.created_at, importance: 'special', reliability: 'A', safeTitle: 'A teammate rescue got me out of a stuck mission.', source: { table: 'rc_quest_skips', id: String(row.id) }, facts: {} }, candidates)
  for (const row of rows<any>(chestRes)) c({ type: /badge|backup/i.test(row.reward_kind) ? 'rare-chest-reward' : 'chest-opened', occurredAt: row.opened_at, importance: /badge|backup/i.test(row.reward_kind) ? 'special' : 'nice', reliability: 'A', safeTitle: `Opened a Supply Chest${row.reward_kind ? ` and found ${String(row.reward_kind).replaceAll('_', ' ')}` : ''}.`, source: { table: 'rc_supply_chest_opens', id: String(row.id) }, facts: { rewardKind: row.reward_kind || '' } }, candidates)
  for (const row of rows<any>(passRes)) { if (row.pass_issued_at && kstDateOf(Date.parse(row.pass_issued_at) / 1000) === date) c({ type: 'party-pass', occurredAt: row.pass_issued_at, importance: 'nice', reliability: 'A', safeTitle: 'Got a RE:CELEBRATE Party Pass.', source: { table: 'rc_recelebrate_passes', id: `${row.event_id}:${agentNo}:pass` }, facts: { eventId: row.event_id } }, candidates); if (row.team_chosen_at && kstDateOf(Date.parse(row.team_chosen_at) / 1000) === date) c({ type: 'team-chosen', occurredAt: row.team_chosen_at, importance: 'nice', reliability: 'A', safeTitle: `Joined ${row.team === 'aliens' ? 'Aliens' : 'Hooligans'} for RE:CELEBRATE.`, source: { table: 'rc_recelebrate_passes', id: `${row.event_id}:${agentNo}:team` }, facts: { team: row.team || '' } }, candidates) }
  for (const row of rows<any>(presenceRes)) c({ type: 'watch-party', occurredAt: row.watched_at, importance: 'special', reliability: 'A', safeTitle: 'Joined the RE:CELEBRATE Watch Party.', source: { table: 'rc_recelebrate_presence', id: `${row.event_id}:${agentNo}` }, facts: { eventId: row.event_id } }, candidates)
  if (rows<any>(battleRes).length) c({ type: 'battle-contribution', occurredAt: new Date(Number(rows<any>(battleRes)[0].listened_at) * 1000).toISOString(), importance: 'nice', reliability: 'A', safeTitle: `Added ${rows<any>(battleRes).length} stream${rows<any>(battleRes).length === 1 ? '' : 's'} to the RE:CELEBRATE battle.`, source: { table: 'rc_recelebrate_battle_streams', id: `${rows<any>(battleRes)[0].event_id}:${agentNo}:${date}` }, facts: { count: rows<any>(battleRes).length } }, candidates)
  for (const row of rows<any>(afterRes)) c({ type: 'recelebrate-afterparty', occurredAt: row.claimed_at, importance: 'special', reliability: 'A', safeTitle: 'Claimed the RE:CELEBRATE After Party keepsake.', source: { table: 'rc_recelebrate_after_party_claims', id: `${row.event_id}:${agentNo}` }, facts: { rewardKind: row.reward_kind, rewardAmount: Number(row.reward_amount) || 0 } }, candidates)
  for (const row of rows<any>(playlistRes)) c({ type: 'playlist-created', occurredAt: row.created_at, importance: 'special', reliability: 'A', safeTitle: row.name ? `Created the ${row.name} playlist.` : 'Created a Candy Star playlist.', source: { table: 'generated_playlists', id: String(row.playlist_id) }, facts: { playlistName: row.name || '' } }, candidates)
  for (const row of rows<any>(saveRes)) c({ type: 'playlist-saved', occurredAt: row.created_at, importance: 'ordinary', reliability: 'A', safeTitle: 'Saved a playlist.', source: { table: 'rc_playlist_saves', id: `${agentNo}:${row.playlist_id}` }, facts: {} }, candidates)

  const selection = selectDailyMemories(candidates)
  const moments = selection.selected.filter((x) => x.type !== 'badge-awarded' && x.type !== 'xp' && !['counted-streams', 'high-stream-day'].includes(x.type)).map((x) => ({ kind: x.type, text: x.safeTitle, agentName: x.counterpartyCodename, districtName: String(x.facts.district || ''), missionName: String(x.facts.missionName || '') }))
  return { facts: { xp, streams, badges, completedDistricts, moments } as DiaryFacts, candidates: selection.selected, state: selection.state, joinedDate: player?.joined_at ? kstDateOf(Date.parse(player.joined_at) / 1000) : date }
}

export async function getDearDiary(sb: SupabaseDB, content: GameContent, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const date = normalizeDate(params.date)
  if (!date) return { success: false, error: 'That diary page is not available.' }
  const [entryRes, preferenceRes] = await Promise.all([
    sb.from('rc_dear_diary_entries').select('*').eq('agent_no', agentNo).eq('kst_date', date).maybeSingle(),
    sb.from('rc_dear_diary_preferences').select('theme').eq('agent_no', agentNo).maybeSingle(),
  ])
  const { data: existing, error } = entryRes
  if (error) return { success: false, error: error.message }
  const frozen = existing?.summary_snapshot?._frozen === true
  const live = frozen ? null : await realDay(sb, content, agentNo, date)
  const stored = existing?.summary_snapshot as DiarySnapshot | undefined
  const facts: DiaryFacts = frozen && stored ? factsFromFrozenSnapshot(stored) : live!.facts
  const state = existing?.note && (frozen ? stored?._state : live!.state) === 'none' ? 'light' : (frozen ? (stored?._state || 'none') : live!.state)
  const candidates = frozen ? (stored?._candidates || []) : live!.candidates
  const theme = DIARY_THEMES.has(preferenceRes.data?.theme) ? preferenceRes.data.theme : null
  if (isNoRecordedHistoricalDay(date, state, existing?.note || '')) {
    return {
      success: true, date, isToday: false, theme, summary: null, note: '',
      archiveState: 'none', noRecordedEntry: true, isFirstAgentDay: false,
      xp: 0, streams: 0, badges: [], completedDistricts: [], moments: [], decorations: EMPTY_DECORATIONS,
    }
  }
  const version = existing?.summary_version || 0
  const regenerate = params.regenerate === true
  const nextVersion = regenerate ? version + 1 : version
  const seed = [...`${agentNo}:${date}:${nextVersion}`].reduce((n, c) => n + c.charCodeAt(0), 0)
  const { data: recent } = await sb.from('rc_dear_diary_entries').select('summary_snapshot')
    .eq('agent_no', agentNo).neq('kst_date', date).order('kst_date', { ascending: false }).limit(14)
  const recentlyUsed = (recent || []).map((row: any) => row.summary_snapshot?._copyKey).filter(Boolean)
  const join = candidates.find((item) => item.type === 'agent-joined')
  const choice = join ? { key: 'agent-joined', text: 'Dear Diary, today I became an agent.' } : diarySummaryChoice(facts, seed, recentlyUsed)
  const digest = candidateDigest(candidates)
  const changed = !frozen && stored?._candidateDigest !== digest
  const summary = !regenerate && !changed && existing?.summary_text ? existing.summary_text : choice.text
  if (!existing?.summary_text || regenerate || changed) {
    const snapshot: DiarySnapshot = { ...facts, _copyKey: choice.key, _candidateDigest: digest, _candidates: candidates, _state: state, _frozen: frozenFor(date), _materializedAt: new Date().toISOString() }
    const { error: saveError } = await sb.from('rc_dear_diary_entries').upsert({
      agent_no: agentNo, kst_date: date, note: existing?.note || '', summary_text: summary,
      summary_version: nextVersion, summary_snapshot: snapshot, updated_at: new Date().toISOString(),
    }, { onConflict: 'agent_no,kst_date' })
    if (saveError) return { success: false, error: saveError.message }
  }
  return { success: true, date, isToday: date === todayKst(), theme, summary, note: existing?.note || '', decorations: storedDiaryDecorations(existing?.decorations), archiveState: state, isFirstAgentDay: !!join, ...facts }
}

/** Range-index endpoint: only dates with a reliable materialized/source row
 * or a private note are returned. Page turns therefore skip unsupported gaps. */
export async function getDearDiaryArchive(sb: SupabaseDB, content: GameContent, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const before = normalizeDate(params.before) || todayKst()
  const days = Math.max(7, Math.min(120, Number(params.days) || 60))
  const { data: player, error } = await sb.from('rc_players').select('joined_at').eq('agent_no', agentNo).maybeSingle()
  if (error || !player?.joined_at) return { success: false, error: error?.message || 'Agent join date is unavailable.' }
  const joinedDate = kstDateOf(Date.parse(player.joined_at) / 1000)
  const fromDate = [joinedDate, addDaysStr(before, -(days - 1))].sort().at(-1)!
  const from = new Date(`${fromDate}T00:00:00+09:00`).toISOString(), to = new Date(`${addDaysStr(before, 1)}T00:00:00+09:00`).toISOString()
  const backupOutcomeFilter = `and(status.eq.complete,completed_at.gte.${from},completed_at.lt.${to}),and(status.eq.banked,closed_at.gte.${from},closed_at.lt.${to})`
  const [entries, feed, badges, districts, daily, xp, streamXp, backupOwner, backupHelper, skips, chests, passes, presence, after, battle, playlists, saves, missionJoins, missionStreams] = await Promise.all([
    sb.from('rc_dear_diary_entries').select('kst_date,note,summary_snapshot').eq('agent_no', agentNo).gte('kst_date', fromDate).lte('kst_date', before),
    sb.from('rc_feed_events').select('created_at').eq('agent_no', agentNo).gte('created_at', from).lt('created_at', to),
    sb.from('rc_badges').select('earned_at').eq('agent_no', agentNo).gte('earned_at', from).lt('earned_at', to),
    sb.from('rc_player_districts').select('completed_at').eq('agent_no', agentNo).gte('completed_at', from).lt('completed_at', to),
    sb.from('rc_daily_activity').select('kst_date,track_counts').eq('agent_no', agentNo).gte('kst_date', fromDate).lte('kst_date', before),
    sb.from('rc_xp_ledger').select('created_at,amount,kind,source,dedup_key').eq('agent_no', agentNo).gte('created_at', from).lt('created_at', to),
    sb.from('rc_xp_ledger').select('created_at,amount,kind,source,dedup_key').eq('agent_no', agentNo).gte('dedup_key', `streams:${agentNo}:${fromDate}`).lte('dedup_key', `streams:${agentNo}:${before}`),
    sb.from('rc_backup_requests').select('completed_at,closed_at,status,banked_credit,helper_agent_no').eq('owner_agent_no', agentNo).or(backupOutcomeFilter),
    sb.from('rc_backup_requests').select('completed_at,closed_at,status,banked_credit,helper_agent_no').eq('helper_agent_no', agentNo).or(backupOutcomeFilter),
    sb.from('rc_quest_skips').select('created_at,free_reason').eq('agent_no', agentNo).gte('created_at', from).lt('created_at', to),
    sb.from('rc_supply_chest_opens').select('opened_at').eq('agent_no', agentNo).gte('opened_at', from).lt('opened_at', to),
    sb.from('rc_recelebrate_passes').select('pass_issued_at,team_chosen_at').eq('agent_no', agentNo),
    sb.from('rc_recelebrate_presence').select('watched_at').eq('agent_no', agentNo).gte('watched_at', from).lt('watched_at', to),
    sb.from('rc_recelebrate_after_party_claims').select('claimed_at').eq('agent_no', agentNo).gte('claimed_at', from).lt('claimed_at', to),
    sb.from('rc_recelebrate_battle_streams').select('listened_at').eq('agent_no', agentNo).gte('listened_at', kstDayBounds(fromDate).fromTs).lt('listened_at', kstDayBounds(addDaysStr(before, 1)).fromTs),
    sb.from('generated_playlists').select('created_at').eq('agent_no', agentNo).gte('created_at', from).lt('created_at', to),
    sb.from('rc_playlist_saves').select('created_at').eq('agent_no', agentNo).gte('created_at', from).lt('created_at', to),
    sb.from('rc_reconnect_participants').select('joined_at').eq('agent_no', agentNo).gte('joined_at', from).lt('joined_at', to),
    sb.from('rc_reconnect_participants').select('streamed_at').eq('agent_no', agentNo).gte('streamed_at', from).lt('streamed_at', to),
  ])
  const completedMissionsRes = await sb.from('rc_reconnect_missions').select('id,completed_at').eq('status', 'complete').gte('completed_at', from).lt('completed_at', to)
  const completedMissionIds = (completedMissionsRes.data || []).map((row: any) => row.id)
  const completedParticipationRes = completedMissionIds.length
    ? await sb.from('rc_reconnect_participants').select('mission_id').eq('agent_no', agentNo).in('mission_id', completedMissionIds)
    : { data: [] }
  const participatedMissionIds = new Set((completedParticipationRes.data || []).map((row: any) => row.mission_id))
  const dates = new Map<string, 'real' | 'light'>()
  const mark = (value: any, state: 'real' | 'light' = 'real', unix = false) => { if (!value) return; const d = kstDateOf(unix ? Number(value) : Date.parse(value) / 1000); if (d >= fromDate && d <= before && (state === 'real' || !dates.has(d))) dates.set(d, state) }
  dates.set(joinedDate, 'real')
  for (const row of entries.data || []) if (row.note || row.summary_snapshot?._state !== 'none') dates.set(row.kst_date, row.summary_snapshot?._state === 'real' ? 'real' : 'light')
  for (const result of [feed, badges, districts, skips, chests, presence, after, playlists]) for (const row of result.data || []) mark(row.created_at || row.earned_at || row.completed_at || row.opened_at || row.watched_at || row.claimed_at)
  for (const row of [...(backupOwner.data || []), ...(backupHelper.data || [])]) { if (row.status === 'complete' && row.helper_agent_no) mark(row.completed_at); if (row.status === 'banked' && row.helper_agent_no && Number(row.banked_credit) > 0) mark(row.closed_at) }
  for (const row of passes.data || []) { mark(row.pass_issued_at); mark(row.team_chosen_at) }
  for (const row of battle.data || []) mark(row.listened_at, 'real', true)
  for (const row of saves.data || []) mark(row.created_at, 'light')
  for (const row of missionJoins.data || []) mark(row.joined_at, 'real')
  for (const row of missionStreams.data || []) mark(row.streamed_at, 'real')
  for (const row of completedMissionsRes.data || []) if (participatedMissionIds.has(row.id)) mark(row.completed_at, 'real')
  const allowlist = content.config.bts_artists || []
  const artistOverrides = trackArtistOverrides(content)
  for (const row of daily.data || []) if (countedStreams(row.track_counts || {}, allowlist, PERSONAL_COUNT_CAP, artistOverrides) > 0) dates.set(row.kst_date, dates.get(row.kst_date) || 'light')
  const archiveXpRows = [...new Map([...(xp.data || []), ...(streamXp.data || [])].map((row: any) => [String(row.dedup_key || row.created_at), row])).values()]
  for (const row of archiveXpRows as any[]) if (row.kind === 'earn' && Number(row.amount) > 0 && !/admin|reset|spend/i.test(String(row.source || ''))) { const streamDate = String(row.source || '').toLowerCase().includes('stream') ? streamingXpKstDate(row.dedup_key, agentNo) : null; streamDate ? dates.set(streamDate, dates.get(streamDate) || 'light') : mark(row.created_at, 'light') }
  const pageDates = [...dates].filter(([d]) => d >= fromDate && d <= before).sort(([a], [b]) => b.localeCompare(a)).map(([date, state]) => ({ date, state }))
  return { success: true, joinedDate, dates: pageDates, nextBefore: fromDate > joinedDate ? addDaysStr(fromDate, -1) : null, complete: fromDate === joinedDate }
}

export async function saveDearDiaryNote(sb: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const date = normalizeDate(params.date)
  if (!date) return { success: false, error: 'That diary page is not available.' }
  const note = String(params.note || '').replace(/\r\n/g, '\n').trim().slice(0, NOTE_MAX)
  const { data: existing } = await sb.from('rc_dear_diary_entries').select('summary_text,summary_version,summary_snapshot')
    .eq('agent_no', agentNo).eq('kst_date', date).maybeSingle()
  const { error } = await sb.from('rc_dear_diary_entries').upsert({
    agent_no: agentNo, kst_date: date, note,
    summary_text: existing?.summary_text || null, summary_version: existing?.summary_version || 0,
    summary_snapshot: existing?.summary_snapshot || {}, updated_at: new Date().toISOString(),
  }, { onConflict: 'agent_no,kst_date' })
  return error ? { success: false, error: error.message } : { success: true, note }
}

export async function saveDearDiaryTheme(sb: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const theme = String(params.theme || '')
  if (!DIARY_THEMES.has(theme)) return { success: false, error: 'Choose one of the five diary eras.' }
  const { error } = await sb.from('rc_dear_diary_preferences').upsert({
    agent_no: agentNo, theme, updated_at: new Date().toISOString(),
  }, { onConflict: 'agent_no' })
  return error ? { success: false, error: error.message } : { success: true, theme }
}

export async function saveDearDiaryDecorations(sb: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const date = normalizeDate(params.date)
  if (!date) return { success: false, error: 'That diary page is not available.' }
  const checked = validateDiaryDecorations(params.decorations)
  if (!checked.success) return checked
  const { data, error } = await sb.from('rc_dear_diary_entries')
    .update({ decorations: checked.decorations, updated_at: new Date().toISOString() })
    .eq('agent_no', agentNo).eq('kst_date', date).select('agent_no').maybeSingle()
  if (error) return { success: false, error: error.message }
  if (!data) return { success: false, error: 'That diary page is not available.' }
  return { success: true, decorations: checked.decorations }
}

/** Small read-only preference lookup for the closed Pack object. This avoids
 * opening/reconstructing today's diary merely to paint its saved cover. */
export async function getDearDiaryPreference(sb: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const { data, error } = await sb.from('rc_dear_diary_preferences').select('theme').eq('agent_no', agentNo).maybeSingle()
  if (error) return { success: false, error: error.message }
  const theme = DIARY_THEMES.has(data?.theme) ? data.theme : null
  return { success: true, theme }
}
