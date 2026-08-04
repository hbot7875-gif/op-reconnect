// Admin CRUD for rc_goals — the game's one shared, global goal set (track
// goals + a single album goal), not per-district. See migrations/
// 011_op_reconnect_schema.sql for the table and districts.ts's freezeGoals()
// for how these get copied onto a district the moment a player starts it —
// editing a goal here only affects districts activated after the edit;
// deleting one is safe even for a goal currently "live" since freezeGoals()
// copies its fields into rc_player_districts.goals at activation time, not a
// live foreign-key reference back to this table.
//
// Same admin gate as everything else marked 'admin' in index.ts
// (SYNC_ADMIN_KEY via isAdminAuthorized), same CRUD shape as broadcasts.ts.

import type { SupabaseDB } from './config.ts'
import { loadContent } from './config.ts'

export interface GoalDbRow {
  id: string
  kind: 'track' | 'album'
  label: string
  artist: string | null
  aliases: string[]
  tracks: { label: string; aliases: string[] }[] | null
  target: number
  active: boolean
  sort_order: number
  updated_at: string
}

function shape(r: GoalDbRow) {
  return {
    id: r.id, kind: r.kind, label: r.label, artist: r.artist,
    aliases: r.aliases || [], tracks: r.tracks || null,
    target: r.target, active: r.active, sortOrder: r.sort_order,
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
  return { success: true, goals: (data || []).map(shape), modes: content.config.modes || {} }
}

/** Admin: add a new goal. target is the base easy-mode number — every other
 *  mode's target is target * that mode's multiplier, computed at freeze
 *  time (districts.ts), not stored here. */
export async function adminAddGoal(supabase: SupabaseDB, params: any) {
  const kind = params.kind === 'album' ? 'album' : 'track'
  const label = String(params.label || '').trim()
  const target = parseInt(params.target)
  if (!label) return { success: false, error: 'label_required' }
  if (!Number.isFinite(target) || target < 1) return { success: false, error: 'target_required' }

  const artist = params.artist ? String(params.artist).trim() : null
  const aliases = cleanAliases(params.aliases)
  const tracks = kind === 'album' ? cleanTracks(params.tracks) : null
  if (kind === 'album' && !tracks) return { success: false, error: 'tracks_required' }

  // ids are stable slugs, not surrogate keys anything references by FK — a
  // collision just gets a short unique suffix, never blocks the insert.
  let id = slugify(label)
  const { data: clash } = await supabase.from('rc_goals').select('id').eq('id', id).maybeSingle()
  if (clash) id = `${id}-${Date.now().toString(36)}`

  const { data: last } = await supabase.from('rc_goals')
    .select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle()
  const sortOrder = Number.isFinite(parseInt(params.sortOrder)) ? parseInt(params.sortOrder) : (last?.sort_order ?? -1) + 1

  const { data, error } = await supabase.from('rc_goals')
    .insert({ id, kind, label, artist, aliases, tracks, target, sort_order: sortOrder })
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
