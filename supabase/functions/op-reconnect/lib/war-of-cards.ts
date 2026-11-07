// War of Cards beyond the table: the one-time album unlock pop-up and the
// Run ARMY leaderboard. Counting rules live in SQL (rc_war_outcomes,
// rc_war_leaderboard; migration 20261107120000) and ranking in
// war-of-cards-rules.js. No XP, levels or currency are involved.

import {
  WAR_CHAMPION_BADGE, WAR_UNLOCK_OWNER, rankWar, boardWithMe, warUnlockDue, weekStartKst,
} from './war-of-cards-rules.js'

// deno-lint-ignore no-explicit-any
type Sb = any

/** For the game state: should this agent see the unlock pop-up now? One
 *  small read, and only once their album is complete. Fails closed: if the
 *  read breaks, the pop-up simply waits for a later poll. */
export async function warUnlockForState(sb: Sb, agentNo: string, album: any, tester: boolean) {
  const owner = agentNo === WAR_UNLOCK_OWNER
  if (!owner && (!album?.complete || tester)) return false
  const { data, error } = await sb.from('rc_war_unlock_notices').select('agent_no').eq('agent_no', agentNo).maybeSingle()
  if (error) return false
  return warUnlockDue({ albumComplete: !!album?.complete, tester, seen: !!data, owner })
}

/** The pop-up was shown: remember it for every device. */
export async function markWarUnlockSeen(sb: Sb, params: any) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const { error } = await sb.from('rc_war_unlock_notices')
    .upsert({ agent_no: agentNo }, { onConflict: 'agent_no', ignoreDuplicates: true })
  return error ? { success: false, error: 'save_failed' } : { success: true }
}

/** The leaderboard: weekly (since Monday 00:00 KST) or all time, ranked by
 *  wins or by win percentage, with the viewer's own row when they're lower. */
export async function getWarLeaderboard(sb: Sb, params: any) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const period = params.period === 'week' ? 'week' : 'all'
  const sort = params.sort === 'pct' ? 'pct' : 'wins'
  const since = period === 'week' ? weekStartKst() : null
  const { data, error } = await sb.rpc('rc_war_leaderboard', { p_since: since })
  if (error) return { success: false, error: 'leaderboard_unavailable' }
  const rows = (data || []).map((r: any) => ({
    agentNo: r.agent_no, played: r.played, wins: r.wins, currentStreak: r.current_streak, bestStreak: r.best_streak,
  }))
  const agents = rows.map((r: any) => r.agentNo)
  const [{ data: players }, { data: badges }] = agents.length
    ? await Promise.all([
      sb.from('rc_players').select('agent_no, codename').in('agent_no', agents),
      // Every copy ('achievement_card_champion:10', ':20', …); one mark per agent.
      sb.from('rc_badges').select('agent_no, artwork_id, badge_id').like('badge_id', `${WAR_CHAMPION_BADGE}:%`).in('agent_no', agents)
        .order('earned_at', { ascending: false }),
    ])
    : [{ data: [] }, { data: [] }]
  const names = new Map((players || []).map((p: any) => [p.agent_no, p.codename]))
  // The Card Champion badge's own artwork, when one is set, for a small mark
  // beside the name. Agent numbers never leave this function.
  const artIds = [...new Set((badges || []).map((b: any) => b.artwork_id).filter(Boolean))]
  const { data: art } = artIds.length
    ? await sb.from('rc_badge_art').select('id, storage_path').in('id', artIds)
    : { data: [] }
  const base = Deno.env.get('SUPABASE_URL') || ''
  const urlOf = new Map((art || []).map((a: any) => [a.id, `${base}/storage/v1/object/public/badge-art/${a.storage_path}`]))
  // Their newest Card Champion copy's photo (the query is newest first).
  const champion = new Map<string, string>()
  for (const b of badges || []) if (!champion.has(b.agent_no)) champion.set(b.agent_no, urlOf.get(b.artwork_id) || '')

  const ranked = rankWar(rows, sort, (a: string) => names.get(a) || a)
  const { top, me } = boardWithMe(ranked, agentNo)
  const shape = (r: any) => ({
    position: r.position, codename: names.get(r.agentNo) || 'Agent', isMe: r.agentNo === agentNo,
    played: r.played, wins: r.wins, pct: r.pct, currentStreak: r.currentStreak, bestStreak: r.bestStreak,
    champion: champion.has(r.agentNo), championArt: champion.get(r.agentNo) || null,
  })
  return { success: true, period, sort, since, rows: top.map(shape), me: me ? shape(me) : null, ranked: ranked.length }
}
