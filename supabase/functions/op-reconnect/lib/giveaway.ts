// PC Giveaway — admin-only (SYNC_ADMIN_KEY) routes behind giveaway-admin.html
// and the recording view giveaway-wheel.html. The database does the locking
// (migration 20261109180000): a frozen list can't change and only one
// official draw can ever be stored. Nothing here writes votes, streams,
// teams, XP or rewards.
import type { SupabaseDB } from './config.ts'
import { GIVEAWAY_ID, GIVEAWAY_CAMPAIGN, GIVEAWAY_RULES, securePick, retryOnTimeout } from './giveaway-rules.js'

type P = Record<string, any>

const KNOWN = ['giveaway_locked', 'list_changed_review_again', 'count_mismatch', 'no_eligible_members',
  'already_drawn', 'not_frozen', 'bad_index', 'unknown_giveaway', 'unknown_campaign', 'list_timeout']

function fail(error: any) {
  const msg = String(error?.message || error || '')
  return { success: false, error: KNOWN.find((k) => msg.includes(k)) || 'giveaway_error' }
}

const idOf = (p: P) => (typeof p.giveawayId === 'string' && /^[a-z0-9_]{1,40}$/.test(p.giveawayId) ? p.giveawayId : GIVEAWAY_ID)

async function load(sb: SupabaseDB, id: string) {
  const { data, error } = await sb.from('rc_giveaways').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

/** The winning team, read from the battle's winner-reward claims (only the
 *  winning side can claim), with every team listed so the admin can confirm. */
async function battleTeams(sb: SupabaseDB, campaignId: string) {
  const [{ data: camp }, { data: claims }] = await Promise.all([
    sb.from('rc_vote_campaigns').select('battle').eq('id', campaignId).maybeSingle(),
    sb.from('rc_battle_winner_claims').select('team').eq('campaign_id', campaignId).limit(500),
  ])
  const teams = ((camp as any)?.battle?.teams || []).map((t: any) => ({ id: String(t.id), label: String(t.label || t.id) }))
  const claimed = [...new Set((claims || []).map((c: any) => c.team))]
  return { teams, suggestedTeam: claimed.length === 1 ? claimed[0] : null }
}

/** Admin review page: the full review list, status and — only once drawn — the draw. */
export async function adminGiveawayGet(sb: SupabaseDB, p: P) {
  try {
    const id = idOf(p)
    const g = await load(sb, id)
    const campaignId = g?.campaign_id || GIVEAWAY_CAMPAIGN
    const battle = await battleTeams(sb, campaignId)
    let draw = null
    if (g?.status === 'drawn') {
      const { data } = await sb.from('rc_giveaway_draws')
        .select('winner_index, winner_agent_no, winner_display, entry_count, entries_hash, random_value, drawn_at')
        .eq('giveaway_id', id).maybeSingle()
      draw = data
    }
    return { success: true, giveawayId: id, campaignId, ...battle, rules: GIVEAWAY_RULES, giveaway: g, draw }
  } catch (e) { return fail(e) }
}

export async function adminGiveawayPrepare(sb: SupabaseDB, p: P) {
  const team = String(p.team || '')
  if (!/^[a-z0-9_]{1,24}$/.test(team)) return { success: false, error: 'team_required' }
  // A cold first read of the plays can pass the 8 s API limit; see retryOnTimeout.
  const { error } = await retryOnTimeout(() => sb.rpc('rc_giveaway_prepare', {
    p_id: idOf(p), p_campaign_id: GIVEAWAY_CAMPAIGN, p_team: team, p_rules: GIVEAWAY_RULES,
  }))
  if (error) return fail(error)
  return adminGiveawayGet(sb, p)
}

export async function adminGiveawayFreeze(sb: SupabaseDB, p: P) {
  const count = Number(p.expectedCount)
  if (!p.preparedAt || !Number.isInteger(count)) return { success: false, error: 'review_required' }
  const { error } = await sb.rpc('rc_giveaway_freeze', { p_id: idOf(p), p_prepared_at: p.preparedAt, p_expected_count: count })
  if (error) return fail(error)
  return adminGiveawayGet(sb, p)
}

/** Recording view: entries and, if already drawn, the stored result. Never the review data. */
export async function adminGiveawayWheel(sb: SupabaseDB, p: P) {
  try {
    const id = idOf(p)
    const g = await load(sb, id)
    if (!g) return { success: false, error: 'unknown_giveaway' }
    const list = g.status === 'draft'
      ? (g.candidates || []).filter((c: any) => c.eligible).map((c: any) => c.display)
      : (g.entries || []).map((e: any) => e.display)
    let drawn = null
    if (g.status === 'drawn') {
      const { data } = await sb.from('rc_giveaway_draws').select('winner_index, winner_display, drawn_at').eq('giveaway_id', id).maybeSingle()
      drawn = data
    }
    return { success: true, status: g.status, teamLabel: g.team_label, names: list, drawn }
  } catch (e) { return fail(e) }
}

/** The ONE official draw. The pick is made here, with a cryptographic RNG and
 *  equal odds, at the moment the official SPIN is pressed; the wheel then
 *  animates to the stored result. A second call fails with already_drawn. */
export async function adminGiveawayDraw(sb: SupabaseDB, p: P) {
  try {
    const id = idOf(p)
    const g = await load(sb, id)
    if (!g) return { success: false, error: 'unknown_giveaway' }
    if (g.status === 'drawn') return { success: false, error: 'already_drawn' }
    if (g.status !== 'frozen') return { success: false, error: 'not_frozen' }
    const n = (g.entries || []).length
    const { index, random } = securePick(n)
    const { data, error } = await sb.rpc('rc_giveaway_draw', {
      p_id: id, p_entry_count: n, p_winner_index: index, p_random_value: random,
    })
    if (error) return fail(error)
    return { success: true, winnerIndex: data.winner_index, winnerDisplay: data.winner_display, drawnAt: data.drawn_at }
  } catch (e) { return fail(e) }
}
