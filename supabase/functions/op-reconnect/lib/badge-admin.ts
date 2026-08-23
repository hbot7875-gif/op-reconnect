// Badge Vault — the upload side of the Badge Collection.
//
// rc_badge_art used to be filled by hand: drop files in the 'badge-art'
// bucket, then write a migration to register them (20260819150000). Fine
// once, unworkable when several people are adding badges every week. These
// routes let a named agent upload a photo and register it in one action.
//
// Nothing downstream needs to change: rc_award_badge already picks a random
// photo from the template's ACTIVE pool at award time, so a row added here
// enters circulation immediately for every badge earned afterwards. Awards
// already handed out keep the photo they were given — that's by design (see
// badge-profile.ts), not something this file works around.
//
// PERMISSION MODEL — deliberately narrow.
// A badge editor is NOT an admin. This permission unlocks exactly the
// routes in this file and nothing else; every existing admin action still
// requires SYNC_ADMIN_KEY. The allowlist lives in rc_config.badge_editors
// (same admin-editable pattern as bts_artists) so members can be added or
// removed from the dashboard without a deploy, and AGENT000 is hardcoded
// as always-allowed so a malformed config row can never lock everyone out.

import type { SupabaseDB } from './config.ts'

const BUCKET = 'badge-art'
const MAX_BYTES = 2 * 1024 * 1024 // 2 MB after decode — the client crops and
                                  // re-encodes first, so real uploads are far
                                  // smaller; this is a floor against abuse.
const ALLOWED_TYPES: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

/** Always allowed regardless of config — the account that can already reach
 *  every other admin surface. Prevents a bad rc_config edit locking the
 *  vault for everyone including its owner. */
const ALWAYS_ALLOWED = 'AGENT000'

/** Reads just the one config row rather than loadContent() — this runs on
 *  the auth path of every Badge Vault request, and pulling goals/wards/
 *  districts to answer "is this agent allowed" would be wasteful. */
export async function isBadgeEditor(supabase: SupabaseDB, agentNo: string): Promise<boolean> {
  const no = String(agentNo || '').toUpperCase()
  if (!no) return false
  if (no === ALWAYS_ALLOWED) return true
  const { data, error } = await supabase
    .from('rc_config').select('value').eq('key', 'badge_editors').maybeSingle()
  if (error || !data) return false
  const list = Array.isArray(data.value) ? data.value : []
  return list.some((entry: unknown) => String(entry || '').toUpperCase() === no)
}

/** Lets the page show a clean "you don't have access" screen instead of
 *  discovering it by failing on the first upload. Agent-auth only, so any
 *  signed-in agent can ask about their own status. */
export async function amIBadgeEditor(supabase: SupabaseDB, params: any) {
  const allowed = await isBadgeEditor(supabase, String(params.agentNo || ''))
  return { success: true, allowed }
}

/** Everything the vault page renders: the templates art can attach to, and
 *  the art that already exists, newest first. inUse tells the UI which rows
 *  can't be deleted (see deleteBadgeArt). */
export async function getBadgeVault(supabase: SupabaseDB, _params: any) {
  const [tplRes, artRes, usedRes] = await Promise.all([
    supabase.from('rc_badge_catalog')
      .select('id, section, rarity, name, unlock_hint, sort_order, active')
      .order('section').order('sort_order'),
    supabase.from('rc_badge_art')
      .select('id, template_id, storage_path, member, pool, active, uploaded_by, created_at')
      .order('id', { ascending: false }).limit(500),
    supabase.from('rc_badges').select('artwork_id').not('artwork_id', 'is', null),
  ])
  if (tplRes.error) return { success: false, error: tplRes.error.message }
  if (artRes.error) return { success: false, error: artRes.error.message }

  const base = Deno.env.get('SUPABASE_URL') || ''
  const inUse = new Set((usedRes.data || []).map((r: any) => r.artwork_id))

  return {
    success: true,
    templates: tplRes.data || [],
    art: (artRes.data || []).map((a: any) => ({
      id: a.id,
      templateId: a.template_id,
      url: `${base}/storage/v1/object/public/${BUCKET}/${a.storage_path}`,
      storagePath: a.storage_path,
      member: a.member,
      pool: a.pool,
      active: a.active,
      uploadedBy: a.uploaded_by,
      createdAt: a.created_at,
      inUse: inUse.has(a.id),
    })),
  }
}

/** Decodes a base64 payload without blowing the stack on large inputs —
 *  atob + a char loop, chunked, rather than spreading into String.fromCharCode. */
function decodeBase64(b64: string): Uint8Array {
  const clean = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64
  const bin = atob(clean)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Upload one already-cropped photo and register it.
 *
 *  The crop happens in the browser (canvas → re-encode) and this receives
 *  the finished square. Doing it server-side would mean image decoding in
 *  the Deno sandbox, which is the exact thing that forced VMA's OCR to move
 *  client-side — and baking the crop into the file means every existing
 *  display surface (HUD crest, Agent ID, rank rows, Badge Drawer) needs no
 *  changes at all. */
export async function addBadgeArt(supabase: SupabaseDB, params: any) {
  const templateId = String(params.templateId || '').trim()
  const agentNo = String(params.agentNo || '').toUpperCase()
  const contentType = String(params.contentType || '')
  const member = params.member ? String(params.member).trim().slice(0, 40) : null
  const pool = params.pool ? String(params.pool).trim().slice(0, 40) : null

  if (!templateId) return { success: false, error: 'Pick a badge template first.' }
  const ext = ALLOWED_TYPES[contentType]
  if (!ext) return { success: false, error: 'Image must be WebP, JPEG or PNG.' }
  if (!params.imageBase64) return { success: false, error: 'No image data received.' }

  // The template has to exist — a typo'd id would otherwise insert a row
  // that violates the FK with a much less readable error.
  const { data: tpl, error: tplErr } = await supabase
    .from('rc_badge_catalog').select('id').eq('id', templateId).maybeSingle()
  if (tplErr) return { success: false, error: tplErr.message }
  if (!tpl) return { success: false, error: `No badge template called "${templateId}".` }

  let bytes: Uint8Array
  try { bytes = decodeBase64(String(params.imageBase64)) }
  catch { return { success: false, error: "Couldn't read that image." } }
  if (!bytes.length) return { success: false, error: 'That image was empty.' }
  if (bytes.length > MAX_BYTES) {
    return { success: false, error: `Image is ${(bytes.length / 1048576).toFixed(1)} MB — 2 MB max.` }
  }

  // Path carries the template so the bucket stays browsable by hand, and a
  // random suffix so two uploads in the same second can't collide.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const rand = Math.random().toString(36).slice(2, 8)
  const storagePath = `vault/${templateId}/${stamp}-${rand}.${ext}`

  const { error: upErr } = await supabase.storage.from(BUCKET)
    .upload(storagePath, bytes, { contentType, upsert: false })
  if (upErr) return { success: false, error: `Upload failed: ${upErr.message}` }

  const { data: row, error: insErr } = await supabase.from('rc_badge_art')
    .insert({
      template_id: templateId,
      storage_path: storagePath,
      member, pool,
      active: params.active === false ? false : true,
      uploaded_by: agentNo || null,
    })
    .select('id').single()

  if (insErr) {
    // Don't leave an orphan file in the bucket if the row failed to land.
    await supabase.storage.from(BUCKET).remove([storagePath])
    return { success: false, error: insErr.message }
  }

  const base = Deno.env.get('SUPABASE_URL') || ''
  return {
    success: true,
    art: {
      id: row.id, templateId, storagePath,
      url: `${base}/storage/v1/object/public/${BUCKET}/${storagePath}`,
      member, pool, active: params.active !== false,
      uploadedBy: agentNo || null, inUse: false,
    },
  }
}

/** Take a photo out of circulation (or put it back) without touching any
 *  award that already used it. This is the safe alternative to deleting. */
export async function setBadgeArtActive(supabase: SupabaseDB, params: any) {
  const id = Number(params.artId)
  if (!Number.isFinite(id)) return { success: false, error: 'Which photo?' }
  const { error } = await supabase.from('rc_badge_art')
    .update({ active: !!params.active }).eq('id', id)
  if (error) return { success: false, error: error.message }
  return { success: true, artId: id, active: !!params.active }
}

/** Permanent removal — refused whenever an award already points at this
 *  photo. rc_badges.artwork_id is a real FK, so the delete would fail at
 *  the database anyway; refusing here turns a raw constraint error into an
 *  explanation, and points at the action they actually want (deactivate,
 *  which leaves existing wearers untouched). */
export async function deleteBadgeArt(supabase: SupabaseDB, params: any) {
  const id = Number(params.artId)
  if (!Number.isFinite(id)) return { success: false, error: 'Which photo?' }

  const { count, error: useErr } = await supabase
    .from('rc_badges').select('artwork_id', { count: 'exact', head: true }).eq('artwork_id', id)
  if (useErr) return { success: false, error: useErr.message }
  if ((count || 0) > 0) {
    return {
      success: false,
      error: `${count} agent${count === 1 ? '' : 's'} already wear this photo, so it can't be deleted. Deactivate it instead — it stops being handed out and everyone who has it keeps it.`,
    }
  }

  const { data: row } = await supabase.from('rc_badge_art')
    .select('storage_path').eq('id', id).maybeSingle()

  const { error } = await supabase.from('rc_badge_art').delete().eq('id', id)
  if (error) return { success: false, error: error.message }
  if (row?.storage_path) await supabase.storage.from(BUCKET).remove([row.storage_path])
  return { success: true, artId: id }
}
