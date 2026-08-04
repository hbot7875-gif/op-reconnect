// Loads all game content from the DB in one pass. Nothing gameplay-related is
// hardcoded — goals, targets, copy, ranks, caps all come from rc_* tables so
// the admin retunes via SQL with zero redeploys.

// deno-lint-ignore-file no-explicit-any
export type SupabaseDB = any

export interface GoalRow {
  id: string
  kind: 'track' | 'album'
  label: string
  artist: string | null
  aliases: string[]
  tracks: { label: string; aliases: string[] }[] | null
  target: number
  sort_order: number
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

export function xpRules(content: GameContent): { streamsPerXp: number; transmissionXp: number; varietyCapBase: number; districtXp: number } {
  return { streamsPerXp: 10, transmissionXp: 10, varietyCapBase: 15, districtXp: 50, ...(content.config.xp_rules || {}) }
}

export function limits(content: GameContent): { backfillMaxDays: number; lbMaxPages: number; streakLookbackDays: number } {
  return { backfillMaxDays: 35, lbMaxPages: 100, streakLookbackDays: 110, ...(content.config.limits || {}) }
}

/** Rank for a lifetime XP total: current title + next threshold. */
export function rankFor(content: GameContent, xp: number): { index: number; title: string; nextAt: number | null } {
  const ladder: { xp: number; title: string }[] = content.config.ranks || [{ xp: 0, title: 'Agent' }]
  let idx = 0
  for (let i = 0; i < ladder.length; i++) if (xp >= ladder[i].xp) idx = i
  const next = ladder[idx + 1]
  return { index: idx + 1, title: ladder[idx].title, nextAt: next ? next.xp : null }
}
