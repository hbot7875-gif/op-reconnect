// Admin CRUD for rc_goals — track goals, album goals, and reconnect goals,
// each assigned to exactly one district (or none, until an admin assigns
// it). See migration 036_rc_district_goals.sql — goals used to be one
// shared global list every district reused; now districts.ts's
// freezeGoals() only picks up goals whose district_id matches the district
// being started, so a goal sitting unassigned (or assigned elsewhere)
// contributes to nothing. Editing a goal here only affects districts
// activated after the edit; deleting one is safe even for a goal currently
// "live" since freezeGoals() copies its fields into
// rc_player_districts.goals at activation time, not a live foreign-key
// reference back to this table.
//
// Reconnect goals (see migration 037_rc_reconnect_goal_kind.sql) are the odd
// one out: a district can carry SEVERAL of them at once (different flavors),
// and freezeGoals() randomly picks just one per agent per activation — so
// `target`/`tracks` (track/album-only fields) are meaningless here; instead
// `variant` + `config` hold the flavor and its settings. See
// reconnect-goal.ts for what each flavor actually does at runtime.
//
// Same admin gate as everything else marked 'admin' in index.ts
// (SYNC_ADMIN_KEY via isAdminAuthorized), same CRUD shape as broadcasts.ts.

import type { SupabaseDB } from './config.ts'
import { loadContent } from './config.ts'
import { extractYoutubeId } from './text.ts'

export interface GoalDbRow {
  id: string
  kind: 'track' | 'album' | 'reconnect'
  label: string
  artist: string | null
  aliases: string[]
  tracks: { label: string; aliases: string[] }[] | null
  target: number
  active: boolean
  sort_order: number
  district_id: string | null
  variant: string | null
  config: Record<string, any>
  updated_at: string
}

const TEXT_PUZZLE_VARIANTS = new Set(['cipher', 'memory'])
const COOP_VARIANTS = new Set(['connect', 'invite'])
const RECONNECT_VARIANTS = new Set(['sotd', ...TEXT_PUZZLE_VARIANTS, ...COOP_VARIANTS])

function cleanReconnectConfig(variant: string, raw: any): { config: Record<string, any> } | { error: string } {
  const prompt = String(raw?.prompt || '').trim()
  if (variant === 'sotd') {
    // Song of the Day is a YouTube-link guess, same as the old arirang
    // site: the player pastes a URL, matched by extracted video ID — never
    // a text/title guess, unlike cipher/memory. The hint is optional there
    // too (an "Intercepted Clue"), so only the link itself is required.
    const youtubeId = extractYoutubeId(raw?.youtubeUrl)
    if (!youtubeId) return { error: 'youtube_url_required' }
    return { config: { prompt, youtubeId } }
  }
  if (TEXT_PUZZLE_VARIANTS.has(variant)) {
    const answerLabel = String(raw?.answerLabel || '').trim()
    if (!prompt) return { error: 'prompt_required' }
    if (!answerLabel) return { error: 'answer_required' }
    return { config: { prompt, answerLabel, answerAliases: cleanAliases(raw?.answerAliases) } }
  }
  // connect / invite
  const requiredAgents = parseInt(raw?.requiredAgents)
  if (!Number.isFinite(requiredAgents) || requiredAgents < 2) return { error: 'required_agents_at_least_2' }
  return { config: { requiredAgents } }
}

function shape(r: GoalDbRow) {
  return {
    id: r.id, kind: r.kind, label: r.label, artist: r.artist,
    aliases: r.aliases || [], tracks: r.tracks || null,
    target: r.target, active: r.active, sortOrder: r.sort_order,
    districtId: r.district_id, variant: r.variant || null, config: r.config || {},
  }
}

function slugify(label: string): string {
  const s = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return s || 'goal'
}

function cleanAliases(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map((a) => String(a).trim()).filter(Boolean) : []
}

function cleanTracks(raw: unknown): { label: string; aliases: string[] }[] | null {
  if (!Array.isArray(raw)) return null
  const tracks = raw
    .map((t: any) => ({ label: String(t?.label || '').trim(), aliases: cleanAliases(t?.aliases) }))
    .filter((t) => t.label)
  return tracks.length ? tracks : null
}

/** Admin: every goal, active or not, in display order — the panel manages
 *  the full rotation, not just what's currently live in gameplay. Bundles
 *  the mode multipliers too (rc_config's 'modes' key) so the panel can show
 *  what a base target actually becomes per mode without a second action. */
export async function adminListGoals(supabase: SupabaseDB) {
  const [{ data, error }, content] = await Promise.all([
    supabase.from('rc_goals').select('*').order('sort_order'),
    loadContent(supabase),
  ])
  if (error) return { success: false, error: error.message }
  return {
    success: true, goals: (data || []).map(shape), modes: content.config.modes || {},
    // So the admin's district picker doesn't need a second round trip.
    districts: content.districts.map((d) => ({ id: d.id, name: d.name, wardId: d.ward_id })),
  }
}

/** Admin: add a new goal. target is the base easy-mode number — every other
 *  mode's target is target * that mode's multiplier, computed at freeze
 *  time (districts.ts), not stored here. Reconnect goals ignore
 *  target/tracks entirely; their settings live in variant/config instead. */
export async function adminAddGoal(supabase: SupabaseDB, params: any) {
  const kind = params.kind === 'album' ? 'album' : params.kind === 'reconnect' ? 'reconnect' : 'track'
  const label = String(params.label || '').trim()
  if (!label) return { success: false, error: 'label_required' }

  const artist = params.artist ? String(params.artist).trim() : null
  const aliases = cleanAliases(params.aliases)
  const districtId = params.districtId ? String(params.districtId).trim() : null

  let target = 1 // unused for reconnect kind — kept >=1 in case target has a DB check constraint
  let tracks: { label: string; aliases: string[] }[] | null = null
  let variant: string | null = null
  let config: Record<string, any> = {}

  if (kind === 'reconnect') {
    variant = String(params.variant || '')
    if (!RECONNECT_VARIANTS.has(variant)) return { success: false, error: 'variant_required' }
    const cleaned = cleanReconnectConfig(variant, params.config)
    if ('error' in cleaned) return { success: false, error: cleaned.error }
    config = cleaned.config
  } else {
    const parsedTarget = parseInt(params.target)
    if (!Number.isFinite(parsedTarget) || parsedTarget < 1) return { success: false, error: 'target_required' }
    target = parsedTarget
    tracks = kind === 'album' ? cleanTracks(params.tracks) : null
    if (kind === 'album' && !tracks) return { success: false, error: 'tracks_required' }
  }

  // ids are stable slugs, not surrogate keys anything references by FK — a
  // collision just gets a short unique suffix, never blocks the insert.
  let id = slugify(label)
  const { data: clash } = await supabase.from('rc_goals').select('id').eq('id', id).maybeSingle()
  if (clash) id = `${id}-${Date.now().toString(36)}`

  const { data: last } = await supabase.from('rc_goals')
    .select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle()
  const sortOrder = Number.isFinite(parseInt(params.sortOrder)) ? parseInt(params.sortOrder) : (last?.sort_order ?? -1) + 1

  const { data, error } = await supabase.from('rc_goals')
    .insert({ id, kind, label, artist, aliases, tracks, target, sort_order: sortOrder, district_id: districtId, variant, config })
    .select().single()
  if (error) return { success: false, error: error.message }
  return { success: true, goal: shape(data) }
}

/** Admin: edit an existing goal. Only the fields actually present in params
 *  get touched, so a client can send just `{id, active:false}` to retire a
 *  goal without resending its label/target/etc. */
export async function adminUpdateGoal(supabase: SupabaseDB, params: any) {
  const id = String(params.id || '')
  if (!id) return { success: false, error: 'id_required' }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (params.label !== undefined) {
    const label = String(params.label).trim()
    if (!label) return { success: false, error: 'label_required' }
    patch.label = label
  }
  if (params.artist !== undefined) patch.artist = params.artist ? String(params.artist).trim() : null
  if (params.target !== undefined) {
    const target = parseInt(params.target)
    if (!Number.isFinite(target) || target < 1) return { success: false, error: 'target_required' }
    patch.target = target
  }
  if (params.aliases !== undefined) patch.aliases = cleanAliases(params.aliases)
  if (params.tracks !== undefined) patch.tracks = cleanTracks(params.tracks)
  if (params.active !== undefined) patch.active = !!params.active
  if (params.sortOrder !== undefined) patch.sort_order = parseInt(params.sortOrder) || 0
  if (params.districtId !== undefined) patch.district_id = params.districtId ? String(params.districtId).trim() : null
  if (params.variant !== undefined || params.config !== undefined) {
    const variant = String(params.variant || '')
    if (!RECONNECT_VARIANTS.has(variant)) return { success: false, error: 'variant_required' }
    const cleaned = cleanReconnectConfig(variant, params.config)
    if ('error' in cleaned) return { success: false, error: cleaned.error }
    patch.variant = variant
    patch.config = cleaned.config
  }

  const { data, error } = await supabase.from('rc_goals').update(patch).eq('id', id).select().maybeSingle()
  if (error) return { success: false, error: error.message }
  if (!data) return { success: false, error: 'goal_not_found' }
  return { success: true, goal: shape(data) }
}

/** Admin: remove a goal for good — not a soft-retire (that's `active:false`
 *  via adminUpdateGoal). Safe for a goal currently live in gameplay; see the
 *  module comment on why this table has no in-flight readers. */
export async function adminDeleteGoal(supabase: SupabaseDB, params: any) {
  const id = String(params.id || '')
  if (!id) return { success: false, error: 'id_required' }
  const { error } = await supabase.from('rc_goals').delete().eq('id', id)
  if (error) return { success: false, error: error.message }
  return { success: true }
}
