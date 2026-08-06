// Loads all game content from the DB in one pass. Nothing gameplay-related is
// hardcoded — goals, targets, copy, ranks, caps all come from rc_* tables so
// the admin retunes via SQL with zero redeploys.

// deno-lint-ignore-file no-explicit-any
export type SupabaseDB = any

export interface GoalRow {
  id: string
  kind: 'track' | 'album' | 'reconnect'
  label: string
  artist: string | null
  aliases: string[]
  tracks: { label: string; aliases: string[] }[] | null
  target: number
  sort_order: number
  district_id: string | null
  // Only meaningful for kind:'reconnect' — which of the five flavors this
  // is, and its flavor-specific settings. See reconnect-goal.ts.
  variant: 'sotd' | 'cipher' | 'memory' | 'connect' | 'invite' | null
  config: Record<string, any>
}

export interface DistrictRow {
  id: string
  ward_id: string
  sequence: number
  name: string
  echo_of: string | null
  memory: string | null
  is_centerpiece: boolean
  is_tutorial: boolean
}

export interface WardRow {
  id: string
  name: string
  sort_order: number
  // Not read by handlers.ts anymore — the wards response builds its
  // centerpiece list from rc_districts (is_centerpiece = true) instead,
  // since this single-text column can't represent Echo Quarter's four.
  // Left in the schema/select as reference metadata, not a live source.
  centerpiece_name: string | null
  memory: string | null
}

export interface GameContent {
  config: Record<string, any>
  goals: GoalRow[]
  wards: WardRow[]
  districts: DistrictRow[]
}

export async function loadContent(supabase: SupabaseDB): Promise<GameContent> {
  const [cfgRes, goalsRes, wardsRes, districtsRes] = await Promise.all([
    supabase.from('rc_config').select('key, value'),
    supabase.from('rc_goals').select('*').eq('active', true).order('sort_order'),
    supabase.from('rc_wards').select('*').eq('active', true).order('sort_order'),
    supabase.from('rc_districts').select('*').eq('active', true).order('sequence'),
  ])
  const config: Record<string, any> = {}
  for (const row of cfgRes.data || []) config[row.key] = row.value
  return {
    config,
    goals: goalsRes.data || [],
    wards: wardsRes.data || [],
    districts: districtsRes.data || [],
  }
}

export function modeMultiplier(content: GameContent, mode: string): number {
  return content.config.modes?.[mode]?.multiplier || 1
}

export function xpRules(content: GameContent): { streamsPerXp: number; varietyCapBase: number; districtXp: number } {
  return { streamsPerXp: 10, varietyCapBase: 15, districtXp: 50, ...(content.config.xp_rules || {}) }
}

/** Streams needed per XP, by the player's own chosen mode — easy mode
 *  converts streams to XP fastest, hard mode slowest, so a harder mode is
 *  a real tradeoff and not just bigger goal targets for the same XP.
 *  Independent of modeMultiplier (which scales goal *targets*, not the
 *  stream-to-XP rate) so retuning one never silently moves the other.
 *  Admin-overridable per mode via rc_config's xp_rules.streamsPerXpByMode,
 *  same spread-over-defaults pattern as xpRules() itself. */
const STREAMS_PER_XP_BY_MODE: Record<string, number> = { easy: 10, medium: 20, hard: 30 }
export function streamsPerXpFor(content: GameContent, mode: string): number {
  const overrides = content.config.xp_rules?.streamsPerXpByMode || {}
  return overrides[mode] ?? STREAMS_PER_XP_BY_MODE[mode] ?? xpRules(content).streamsPerXp
}

/** Days an agent has, from activation, to restore a district before the
 *  attempt lapses (see districtDeadline in districts.ts). */
export function restorationDays(content: GameContent): number {
  return Number(content.config.restoration_days) || 7
}

export function limits(content: GameContent): { backfillMaxDays: number; lbMaxPages: number; streakLookbackDays: number } {
  return { backfillMaxDays: 35, lbMaxPages: 100, streakLookbackDays: 110, ...(content.config.limits || {}) }
}

/** Rank for a lifetime XP total: current title + next threshold/title. */
export function rankFor(content: GameContent, xp: number): { index: number; title: string; nextAt: number | null; nextTitle: string | null } {
  const ladder: { xp: number; title: string }[] = content.config.ranks || [{ xp: 0, title: 'Agent' }]
  let idx = 0
  for (let i = 0; i < ladder.length; i++) if (xp >= ladder[i].xp) idx = i
  const next = ladder[idx + 1]
  return { index: idx + 1, title: ladder[idx].title, nextAt: next ? next.xp : null, nextTitle: next ? next.title : null }
}
