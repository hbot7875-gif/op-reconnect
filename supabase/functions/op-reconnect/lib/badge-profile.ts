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
 *  (13) Every DB call here is now checked and surfaced — previously a
 *  failed select/insert/update was silently swallowed, so the caller (and
 *  the player, via a chest-reveal card or "badge earned" message) could
 *  believe a badge was saved when it wasn't. Returns {success:false, error}
 *  on any real failure instead; existing fire-and-forget callers that don't
 *  check the return value are unaffected, but now have the option to. */
export async function awardBadge(
  supabase: SupabaseDB, agentNo: string, templateId: string, scopeId?: string,
): Promise<{ success: boolean; error?: string }> {
  const badgeId = scopeId ? `${templateId}:${scopeId}` : templateId
  const { data: existing, error: selectErr } = await supabase.from('rc_badges').select('badge_id, artwork_id')
    .eq('agent_no', agentNo).eq('badge_id', badgeId).maybeSingle()
  if (selectErr) {
    console.error(`awardBadge: select failed for ${agentNo}/${badgeId}: ${selectErr.message}`)
    return { success: false, error: selectErr.message }
  }

  if (existing && existing.artwork_id != null) return { success: true }

  const { data: art, error: artErr } = await supabase.from('rc_badge_art').select('id')
    .eq('template_id', templateId).eq('active', true)
  if (artErr) {
    console.error(`awardBadge: art lookup failed for ${templateId}: ${artErr.message}`)
    return { success: false, error: artErr.message }
  }
  const artworkId = art && art.length ? art[Math.floor(Math.random() * art.length)].id : null

  if (existing) {
    if (artworkId == null) return { success: true }
    const { error: updateErr } = await supabase.from('rc_badges').update({ artwork_id: artworkId })
      .eq('agent_no', agentNo).eq('badge_id', badgeId)
    if (updateErr) {
      console.error(`awardBadge: artwork backfill failed for ${agentNo}/${badgeId}: ${updateErr.message}`)
      return { success: false, error: updateErr.message }
    }
    return { success: true }
  }

  const { error: insertErr } = await supabase.from('rc_badges').insert({ agent_no: agentNo, badge_id: badgeId, artwork_id: artworkId })
  if (insertErr) {
    console.error(`awardBadge: insert failed for ${agentNo}/${badgeId}: ${insertErr.message}`)
    return { success: false, error: insertErr.message }
  }
  return { success: true }
}

export async function setEquippedBadge(supabase: SupabaseDB, content: GameContent, params: Record<string, unknown>) {
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const badgeId = String(params.badgeId || '').trim()
  const { data: player } = await supabase.from('rc_players').select('agent_no').eq('agent_no', agentNo).maybeSingle()
  if (!player) return { success: false, error: 'Not joined' }

  if (!badgeId) {
    await supabase.from('rc_players').update({ equipped_badge_id: null }).eq('agent_no', agentNo)
    return { success: true, equippedBadgeId: null }
  }

  let earned = false
  if (STREAK_BADGES.has(badgeId)) {
    const { data } = await supabase.from('rc_badges').select('badge_id')
      .eq('agent_no', agentNo).eq('badge_id', badgeId).maybeSingle()
    earned = !!data
  } else if (LEVEL_BADGES[badgeId] || XP_BADGES[badgeId] || DISTRICT_BADGES[badgeId]) {
    const xp = await totalXp(supabase, agentNo)
    if (LEVEL_BADGES[badgeId]) earned = levelFor(content, xp).level >= LEVEL_BADGES[badgeId]
    else if (XP_BADGES[badgeId]) earned = xp >= XP_BADGES[badgeId]
    else if (DISTRICT_BADGES[badgeId]) {
      const { count } = await supabase.from('rc_player_districts').select('district_id', { count: 'exact', head: true })
        .eq('agent_no', agentNo).eq('status', 'restored')
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
    const { data: template } = await supabase.from('rc_badge_catalog').select('id').eq('id', templateId).maybeSingle()
    if (template) {
      const { data } = await supabase.from('rc_badges').select('badge_id')
        .eq('agent_no', agentNo).eq('badge_id', badgeId).maybeSingle()
      earned = !!data
    }
  }
  if (!earned) return { success: false, error: 'badge_locked' }

  const { error } = await supabase.from('rc_players').update({ equipped_badge_id: badgeId }).eq('agent_no', agentNo)
  return error ? { success: false, error: error.message } : { success: true, equippedBadgeId: badgeId }
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
  const { data: artRows } = artworkIds.length
    ? await supabase.from('rc_badge_art').select('id, storage_path').in('id', artworkIds)
    : { data: [] }
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

  const [{ data: awardRows }, { data: templates }] = await Promise.all([
    supabase.from('rc_badges').select('agent_no, badge_id, artwork_id').in('agent_no', agentNos).in('badge_id', badgeIds),
    supabase.from('rc_badge_catalog').select('id, name, rarity').in('id', templateIds),
  ])
  const templateById = new Map((templates || []).map((t: any) => [t.id, t]))
  const artworkIds = [...new Set((awardRows || []).map((a: any) => a.artwork_id).filter((id: any) => id != null))]
  const { data: artRows } = artworkIds.length
    ? await supabase.from('rc_badge_art').select('id, storage_path').in('id', artworkIds)
    : { data: [] }
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
