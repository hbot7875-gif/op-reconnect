import type { GameContent, SupabaseDB } from './config.ts'
import { totalXp } from './derive.ts'
import { levelFor } from './leveling.ts'

const LEVEL_BADGES: Record<string, number> = { 'level:5': 5, 'level:10': 10, 'level:20': 20 }
const DISTRICT_BADGES: Record<string, number> = { 'districts:1': 1, 'districts:10': 10, 'districts:50': 50 }
const XP_BADGES: Record<string, number> = { 'xp:1000': 1000, 'xp:10000': 10000 }
const STREAK_BADGES = new Set(['streak:7', 'streak:30', 'streak:100'])

function publicArtUrl(storagePath: string | null): string | null {
  if (!storagePath) return null
  const base = Deno.env.get('SUPABASE_URL') || ''
  return `${base}/storage/v1/object/public/badge-art/${storagePath}`
}

function parseBadgeId(badgeId: string): { templateId: string; scopeId: string | null } {
  const i = badgeId.indexOf(':')
  return i === -1 ? { templateId: badgeId, scopeId: null } : { templateId: badgeId.slice(0, i), scopeId: badgeId.slice(i + 1) }
}

/** Award a Badge Collection template (see migration 20260819090000) to an
 *  agent, scoped if given (badge_id becomes 'templateId:scopeId'). Picks one
 *  photo at random from that template's active rc_badge_art pool and stores
 *  it on the award row — permanent from then on, since the award itself is
 *  permanent (no separate freeze step needed the way the old site had one).
 *  Idempotent: re-awarding an already-held badge is a no-op, EXCEPT (11) if
 *  the existing award has no artwork yet (it was earned before any photos
 *  were uploaded to that template's pool) — in that case it backfills one
 *  now, so old awards don't stay blank forever once art shows up. Shared by
 *  every award trigger (districts.ts, handlers.ts's ward badge,
 *  vma-voting.ts, ...) so the pick-art-once/backfill behavior stays in
 *  exactly one place.
 *
 *  The database RPC performs the ownership check, permanent art selection,
 *  insert and blank-art backfill atomically, so concurrent award paths can
 *  never turn a harmless duplicate into a false failure. */
export async function awardBadge(
  supabase: SupabaseDB, agentNo: string, templateId: string, scopeId?: string,
): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('rc_award_badge', {
    p_agent_no: agentNo,
    p_template_id: templateId,
    p_scope_id: scopeId || null,
  })
  if (error) {
    console.error(`awardBadge: RPC failed for ${agentNo}/${templateId}: ${error.message}`)
    return { success: false, error: error.message }
  }
  if (!data) return { success: false, error: 'badge_template_unavailable' }
  return { success: true }
}

export async function setEquippedBadge(supabase: SupabaseDB, content: GameContent, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const badgeId = String(params.badgeId || '').trim()
  const { data: player, error: playerErr } = await supabase.from('rc_players').select('agent_no').eq('agent_no', agentNo).maybeSingle()
  if (playerErr) return { success: false, error: playerErr.message }
  if (!player) return { success: false, error: 'Not joined' }

  if (!badgeId) {
    const { error } = await supabase.from('rc_players').update({ equipped_badge_id: null }).eq('agent_no', agentNo)
    return error ? { success: false, error: error.message } : { success: true, equippedBadgeId: null }
  }

  let earned = false
  if (STREAK_BADGES.has(badgeId)) {
    const { data, error } = await supabase.from('rc_badges').select('badge_id')
      .eq('agent_no', agentNo).eq('badge_id', badgeId).maybeSingle()
    if (error) return { success: false, error: error.message }
    earned = !!data
  } else if (LEVEL_BADGES[badgeId] || XP_BADGES[badgeId] || DISTRICT_BADGES[badgeId]) {
    const xp = await totalXp(supabase, agentNo)
    if (LEVEL_BADGES[badgeId]) earned = levelFor(content, xp).level >= LEVEL_BADGES[badgeId]
    else if (XP_BADGES[badgeId]) earned = xp >= XP_BADGES[badgeId]
    else if (DISTRICT_BADGES[badgeId]) {
      const { count, error } = await supabase.from('rc_player_districts').select('district_id', { count: 'exact', head: true })
        .eq('agent_no', agentNo).eq('status', 'restored')
      if (error) return { success: false, error: error.message }
      earned = (count || 0) >= DISTRICT_BADGES[badgeId]
    }
  } else {
    // Badge Collection: every catalog-templated award (badge_id is either a
    // bare template id like 'mission_bond', or 'template_id:scope_id' like
    // 'district_frag_1:tae13') is a real earned row already, so ownership is
    // just an exact-match check — same shape as the STREAK_BADGES branch
    // above, generalized so new rc_badge_catalog templates equip for free
    // with no code change (this repo's DB-driven-content rule).
    const { templateId } = parseBadgeId(badgeId)
    const { data: template, error: templateErr } = await supabase.from('rc_badge_catalog').select('id').eq('id', templateId).maybeSingle()
    if (templateErr) return { success: false, error: templateErr.message }
    if (template) {
      const { data, error } = await supabase.from('rc_badges').select('badge_id')
        .eq('agent_no', agentNo).eq('badge_id', badgeId).maybeSingle()
      if (error) return { success: false, error: error.message }
      earned = !!data
    }
  }
  if (!earned) return { success: false, error: 'badge_locked' }

  const { error } = await supabase.from('rc_players').update({ equipped_badge_id: badgeId }).eq('agent_no', agentNo)
  return error ? { success: false, error: error.message } : { success: true, equippedBadgeId: badgeId }
}

/** Saves how a player wants their equipped badge photo framed in the Agent
 *  ID card — a manual crop/adjust, since object-fit:cover alone can cut an
 *  arbitrary photo's interesting part out of a small 52x52 frame. x/y are
 *  0-100 object-position percentages, zoom is clamped to a sane 1.0-2.0
 *  range. Passing null clears it back to the default centered crop. */
export async function setAvatarCrop(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const crop = params.crop as { x?: unknown; y?: unknown; zoom?: unknown } | null

  let value: { x: number; y: number; zoom: number } | null = null
  if (crop) {
    const clamp = (n: unknown, min: number, max: number, fallback: number) => {
      const v = Number(n)
      return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
    }
    value = {
      x: clamp(crop.x, 0, 100, 50),
      y: clamp(crop.y, 0, 100, 50),
      zoom: clamp(crop.zoom, 1, 2, 1),
    }
  }

  const { error } = await supabase.from('rc_players').update({ avatar_crop: value }).eq('agent_no', agentNo)
  return error ? { success: false, error: error.message } : { success: true, avatarCrop: value }
}

/** (12) Badge Collection screen data for one agent: every catalog template
 *  (so locked ones can render as silhouettes) plus this agent's actual
 *  earned instances, each with its resolved artwork URL, parsed scope, and
 *  whether it's the currently-equipped one. Legacy badges (streak:*,
 *  level:*, districts:*, xp:*) aren't catalog-templated — see badges.js on
 *  the client, which still owns rendering those. */
export async function getBadgeCollection(supabase: SupabaseDB, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()

  const [{ data: templates, error: templatesErr }, { data: player, error: playerErr }] = await Promise.all([
    supabase.from('rc_badge_catalog').select('*').eq('active', true).order('sort_order'),
    supabase.from('rc_players').select('equipped_badge_id').eq('agent_no', agentNo).maybeSingle(),
  ])
  if (templatesErr) return { success: false, error: templatesErr.message }
  if (playerErr) return { success: false, error: playerErr.message }

  const { data: awards, error: awardsErr } = await supabase.from('rc_badges')
    .select('badge_id, artwork_id, earned_at').eq('agent_no', agentNo)
  if (awardsErr) return { success: false, error: awardsErr.message }

  const artworkIds = [...new Set((awards || []).map((a: any) => a.artwork_id).filter((id: any) => id != null))]
  const { data: artRows, error: artRowsErr } = artworkIds.length
    ? await supabase.from('rc_badge_art').select('id, storage_path').in('id', artworkIds)
    : { data: [], error: null }
  if (artRowsErr) return { success: false, error: artRowsErr.message }
  const artById = new Map((artRows || []).map((a: any) => [a.id, a.storage_path]))
  const templateById = new Map((templates || []).map((t: any) => [t.id, t]))
  const equippedBadgeId = player?.equipped_badge_id || null

  const earned = (awards || [])
    .map((a: any) => {
      const { templateId, scopeId } = parseBadgeId(a.badge_id)
      const template = templateById.get(templateId)
      if (!template) return null // legacy (streak/level/xp/districts) — not catalog data
      return {
        badgeId: a.badge_id,
        templateId,
        scopeId,
        name: template.name,
        rarity: template.rarity,
        section: template.section,
        unlockHint: template.unlock_hint,
        artworkUrl: publicArtUrl(artById.get(a.artwork_id) || null),
        earnedAt: a.earned_at,
        equipped: a.badge_id === equippedBadgeId,
      }
    })
    .filter(Boolean)

  return {
    success: true,
    equippedBadgeId,
    templates: (templates || []).map((t: any) => ({
      id: t.id, section: t.section, rarity: t.rarity, name: t.name, unlockHint: t.unlock_hint,
    })),
    earned,
  }
}

/** (13) Batch-resolves equipped-badge artwork for player/leaderboard
 *  responses, replacing reliance on the client's hardcoded badges.js
 *  catalog for anything that's actually a Badge Collection template. Legacy
 *  badge ids (streak:*, level:*, xp:*, districts:*) aren't in
 *  rc_badge_catalog, so they resolve to null here — badges.js keeps
 *  rendering those client-side exactly as before; nothing about that path
 *  changes. */
export async function resolveEquippedBadges(
  supabase: SupabaseDB, pairs: { agentNo: string; badgeId: string | null }[],
): Promise<Map<string, { badgeId: string; name: string; rarity: string; artworkUrl: string | null } | null>> {
  const out = new Map<string, { badgeId: string; name: string; rarity: string; artworkUrl: string | null } | null>()
  const withBadge = pairs.filter((p) => p.badgeId)
  if (withBadge.length === 0) return out

  const agentNos = [...new Set(withBadge.map((p) => p.agentNo))]
  const badgeIds = [...new Set(withBadge.map((p) => p.badgeId as string))]
  const templateIds = [...new Set(badgeIds.map((b) => parseBadgeId(b).templateId))]

  const [{ data: awardRows, error: awardsErr }, { data: templates, error: templatesErr }] = await Promise.all([
    supabase.from('rc_badges').select('agent_no, badge_id, artwork_id').in('agent_no', agentNos).in('badge_id', badgeIds),
    supabase.from('rc_badge_catalog').select('id, name, rarity').in('id', templateIds),
  ])
  if (awardsErr || templatesErr) {
    console.error(`resolveEquippedBadges failed: ${awardsErr?.message || templatesErr?.message}`)
    return out
  }
  const templateById = new Map((templates || []).map((t: any) => [t.id, t]))
  const artworkIds = [...new Set((awardRows || []).map((a: any) => a.artwork_id).filter((id: any) => id != null))]
  const { data: artRows, error: artRowsErr } = artworkIds.length
    ? await supabase.from('rc_badge_art').select('id, storage_path').in('id', artworkIds)
    : { data: [], error: null }
  if (artRowsErr) {
    console.error(`resolveEquippedBadges artwork lookup failed: ${artRowsErr.message}`)
    return out
  }
  const artById = new Map((artRows || []).map((a: any) => [a.id, a.storage_path]))
  const awardByAgentBadge = new Map((awardRows || []).map((a: any) => [`${a.agent_no} ${a.badge_id}`, a]))

  for (const p of withBadge) {
    const { templateId } = parseBadgeId(p.badgeId as string)
    const template = templateById.get(templateId)
    const award = awardByAgentBadge.get(`${p.agentNo} ${p.badgeId}`)
    if (!template || !award) { out.set(p.agentNo, null); continue }
    out.set(p.agentNo, {
      badgeId: p.badgeId as string, name: template.name, rarity: template.rarity,
      artworkUrl: publicArtUrl(artById.get(award.artwork_id) || null),
    })
  }
  return out
}
