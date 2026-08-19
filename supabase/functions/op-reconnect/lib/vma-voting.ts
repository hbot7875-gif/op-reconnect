// Self-reported voting missions (MTV VMAs 2026 first, event_id-scoped so
// future ones reuse this) — see migration 20260819091000 for the original
// schema and 20260819100000 for the follow-up fixes referenced by number
// below (matching the review that drove them).
//
// Votes happen off-site (vote.mtv.com), so there's nothing to verify
// cryptographically. OCR runs client-side (Tesseract.js in the browser —
// its best-supported environment; a Deno Edge Function tried it first and
// failed, no worker/core/lang auto-discovery there). The client sends the
// extracted text alongside the image, but (per review) that text is NOT
// trusted as proof by itself — it's matched against expected keywords, a
// shared daily watermark, exact-duplicate-image rejection, and a Postgres
// function (rc_vma_submit_vote) that does the cap/dedupe/credit math
// atomically so concurrent submissions can't race past the limit. Anything
// that doesn't clear every check falls to 'pending' for manual admin review
// rather than being trusted outright.
import type { GameContent, SupabaseDB } from './config.ts'
import { awardBadge } from './badge-profile.ts'
import { addChestFill, getChestStatus } from './supply-chest.ts'

const BUCKET = 'vma-vote-proofs'
const ET_OFFSET_HOURS = -4 // fixed EDT for the whole Aug 18 - Sep 25 window
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png'])

function etDateOf(d: Date): string {
  const et = new Date(d.getTime() + ET_OFFSET_HOURS * 3600_000)
  return et.toISOString().slice(0, 10)
}

interface VmaConfig {
  title: string
  url: string
  categories: string[]
  category_labels: Record<string, string>
  category_keywords: Record<string, string[]> // which song (shared across categories)
  category_match_keywords: Record<string, string[]> // (1) which category page
  submitted_phrase: string
  daily_cap_per_category: number
  period_start_utc: string
  period_end_utc: string
  power_hour_first_utc: string
  power_hour_last_utc: string
  power_hour_utc_start: string // 'HH:MM'
  power_hour_utc_end: string
  double_days_utc: { start: string; end: string }[]
  watermark_words: string[]
}

// (10) event_id-scoped: any future voting mission is just another rc_config
// row of this same shape, keyed by its own event id.
function vmaConfig(content: GameContent, eventId: string): VmaConfig | null {
  return content.config[eventId] || null
}

function isPowerHour(cfg: VmaConfig, at: Date): boolean {
  if (at < new Date(cfg.power_hour_first_utc) || at > new Date(cfg.power_hour_last_utc)) return false
  const hm = at.toISOString().slice(11, 16)
  return hm >= cfg.power_hour_utc_start && hm <= cfg.power_hour_utc_end
}

// (9) Each window is now pre-clamped to the real voting period end in the
// migration itself, so no extra guard is needed here — but 'open' below is
// still checked independently before any credit is given.
function isDoubleDay(cfg: VmaConfig, at: Date): boolean {
  return cfg.double_days_utc.some((w) => at >= new Date(w.start) && at <= new Date(w.end))
}

/** (8) ONE shared code for every agent, per ET day — no per-agent suffix.
 *  Deterministic so nothing needs pre-generating for all 39 days. */
function dailyWatermarkCode(cfg: VmaConfig, etDay: string): string {
  let h = 0
  for (let i = 0; i < etDay.length; i++) h = (h * 31 + etDay.charCodeAt(i)) >>> 0
  const word = cfg.watermark_words[h % cfg.watermark_words.length]
  const dayNum = etDay.slice(-2).replace(/^0/, '')
  return `${word}${dayNum}`
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

interface ProofCheck { status: 'verified' | 'pending'; note: string; watermarkOk: boolean }

/** (1) Now checks BOTH which song (category_keywords, shared — BTS's entry
 *  is the same song in every category) AND which category page
 *  (category_match_keywords) so a Song of the Year screenshot can't credit
 *  Best K-Pop or vice versa. Decision tree: mtv site -> BTS -> song ->
 *  category page -> "votes submitted" -> today's shared watermark. All must
 *  pass to auto-approve; any single miss goes to 'pending', never
 *  'rejected' by text alone (duplicate-image is the only server-side
 *  rejection — see rc_vma_submit_vote). */
function checkProofText(text: string, cfg: VmaConfig, category: string, expectedCode: string): ProofCheck {
  if (!text.trim()) return { status: 'pending', note: 'No OCR text supplied — held for manual review.', watermarkOk: false }

  const norm = text.toLowerCase().replace(/\s+/g, ' ')
  const has = (s: string) => norm.includes(s.toLowerCase())
  const hasAny = (arr: string[]) => arr.length === 0 || arr.some((k) => has(k))

  const hasMtv = has('mtv') || has('vote.mtv.com')
  const hasBts = has('bts')
  const hasSong = hasAny(cfg.category_keywords[category] || [])
  const hasCategoryPage = hasAny(cfg.category_match_keywords?.[category] || [])
  const hasSubmitted = has(cfg.submitted_phrase)
  const watermarkOk = norm.replace(/[^a-z0-9]/g, '').includes(expectedCode.toLowerCase().replace(/[^a-z0-9]/g, ''))

  const missing: string[] = []
  if (!hasMtv) missing.push('MTV site')
  if (!hasBts) missing.push('BTS')
  if (!hasSong) missing.push('song title')
  if (!hasCategoryPage) missing.push('category page')
  if (!hasSubmitted) missing.push('"Votes Submitted"')
  if (!watermarkOk) missing.push('watermark code')

  if (missing.length === 0) return { status: 'verified', note: 'All checks passed.', watermarkOk }
  return { status: 'pending', note: `Needs manual review — missing: ${missing.join(', ')}.`, watermarkOk }
}

/** Cheap, DB-free summary for the World-screen event banner — folded into
 *  getGameState (handlers.ts) so the banner renders synchronously off the
 *  same poll every other World-screen card already uses (broadcasts, Red
 *  Zone), instead of the screen needing its own extra fetch. The full
 *  per-agent numbers (remaining votes, watermark code, ...) stay behind the
 *  dedicated getVmaStatus call, made only once the player actually opens
 *  the mission sheet. */
export async function getVmaBanner(supabase: SupabaseDB, content: GameContent, agentNo: string, eventId = 'vma_2026') {
  const cfg = vmaConfig(content, eventId)
  if (!cfg) return null
  const now = new Date()
  const open = now >= new Date(cfg.period_start_utc) && now <= new Date(cfg.period_end_utc)
  if (!open) return null

  const day = etDateOf(now)
  const { data: rows } = await supabase.from('rc_vma_votes')
    .select('votes_logged').eq('event_id', eventId).eq('agent_no', agentNo).eq('vote_day', day).eq('verify_status', 'verified')
  const cap = isDoubleDay(cfg, now) ? cfg.daily_cap_per_category * 2 : cfg.daily_cap_per_category
  const todayVotes = (rows || []).reduce((s: number, r: any) => s + r.votes_logged, 0)
  const todayCap = cap * cfg.categories.length

  const chest = await getChestStatus(supabase, content, { agentNo, eventId })

  return {
    eventId, title: cfg.title,
    isPowerHour: isPowerHour(cfg, now), isDoubleDay: isDoubleDay(cfg, now),
    periodEndUtc: cfg.period_end_utc,
    todayVotes, todayCap,
    chestFill: chest.success ? chest.fillCount : 0,
    chestThreshold: chest.success ? chest.threshold : null,
    chestReady: chest.success ? chest.ready : false,
  }
}

export async function getVmaStatus(supabase: SupabaseDB, content: GameContent, params: Record<string, unknown>) {
  const eventId = String(params.eventId || 'vma_2026')
  const cfg = vmaConfig(content, eventId)
  if (!cfg) return { success: false, error: 'Voting mission not configured' }
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const now = new Date()
  const day = etDateOf(now)

  const { data: rows, error } = await supabase.from('rc_vma_votes')
    .select('category, votes_logged')
    .eq('event_id', eventId).eq('agent_no', agentNo).eq('vote_day', day).eq('verify_status', 'verified')
  if (error) return { success: false, error: error.message }

  // Lightweight "you already have one in review" signal — count only, no
  // history/detail — so a player doesn't assume a pending submission failed
  // and upload it again. Not scoped to today: a still-pending review from
  // an earlier day should keep showing until an admin resolves it.
  const { data: pendingRows } = await supabase.from('rc_vma_votes')
    .select('category').eq('event_id', eventId).eq('agent_no', agentNo).eq('verify_status', 'pending')
  const pendingByCategory: Record<string, number> = {}
  for (const c of cfg.categories) pendingByCategory[c] = 0
  for (const r of pendingRows || []) pendingByCategory[r.category] = (pendingByCategory[r.category] || 0) + 1
  const pendingTotal = (pendingRows || []).length

  const cap = isDoubleDay(cfg, now) ? cfg.daily_cap_per_category * 2 : cfg.daily_cap_per_category
  const usedByCategory: Record<string, number> = {}
  for (const c of cfg.categories) usedByCategory[c] = 0
  for (const r of rows || []) usedByCategory[r.category] = (usedByCategory[r.category] || 0) + r.votes_logged

  return {
    success: true,
    config: cfg,
    open: now >= new Date(cfg.period_start_utc) && now <= new Date(cfg.period_end_utc),
    isPowerHour: isPowerHour(cfg, now),
    isDoubleDay: isDoubleDay(cfg, now),
    pendingTotal, pendingByCategory,
    dailyCap: cap,
    remaining: Object.fromEntries(cfg.categories.map((c) => [c, Math.max(0, cap - (usedByCategory[c] || 0))])),
    watermarkCode: dailyWatermarkCode(cfg, day),
  }
}

export async function logVmaVote(supabase: SupabaseDB, content: GameContent, params: Record<string, unknown>) {
  const eventId = String(params.eventId || 'vma_2026')
  const cfg = vmaConfig(content, eventId)
  if (!cfg) return { success: false, error: 'Voting mission not configured' }
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const category = String(params.category || '')
  // (2) What the screenshot's counter shows right now — cumulative, not a
  // per-submission count. Credit is the delta above this agent/category/
  // day's highest prior *verified* total, computed atomically in SQL.
  const displayedTotal = Math.floor(Number(params.displayedTotal))
  const imageBase64 = String(params.imageBase64 || '')
  const imageMime = String(params.imageMime || '').toLowerCase()
  const ocrText = String(params.ocrText || '') // client-extracted, untrusted — see module header

  if (!cfg.categories.includes(category)) return { success: false, error: 'bad_category' }
  if (!(displayedTotal >= 1 && displayedTotal <= 10000)) return { success: false, error: 'bad_vote_count' }
  if (!imageBase64) return { success: false, error: 'proof_required' }
  // (6) Only JPG/PNG, capped at 5MB. Compression itself is a frontend
  // concern (not built yet) — this is the hard server-side backstop
  // regardless of what any client does or doesn't compress.
  if (!ALLOWED_MIME.has(imageMime)) return { success: false, error: 'bad_image_type' }

  const now = new Date()
  if (now < new Date(cfg.period_start_utc) || now > new Date(cfg.period_end_utc)) {
    return { success: false, error: 'voting_closed' }
  }

  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0))
  } catch {
    return { success: false, error: 'bad_image_data' }
  }
  if (bytes.length > MAX_IMAGE_BYTES) return { success: false, error: 'image_too_large' }

  const doubleDay = isDoubleDay(cfg, now)
  const powerHour = isPowerHour(cfg, now)
  const day = etDateOf(now)
  const cap = doubleDay ? cfg.daily_cap_per_category * 2 : cfg.daily_cap_per_category
  const imageHash = await sha256Hex(bytes)
  const expectedCode = dailyWatermarkCode(cfg, day)
  const check = checkProofText(ocrText, cfg, category, expectedCode)

  const path = `${agentNo}/${Date.now()}.${imageMime.includes('png') ? 'png' : 'jpg'}`
  const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: imageMime })
  // (5) Every DB/storage error is checked before anything else happens —
  // no badge is ever awarded off an upload or insert that didn't actually
  // succeed.
  if (uploadErr) return { success: false, error: 'upload_failed', detail: uploadErr.message }

  // (3) Atomic: locks this agent/category/day/event, re-checks the
  // duplicate hash and the cap, and inserts — all inside one transaction —
  // so two concurrent submissions can't both read a stale cap and both get
  // credited past it.
  const { data: result, error: rpcErr } = await supabase.rpc('rc_vma_submit_vote', {
    p_agent_no: agentNo, p_event_id: eventId, p_category: category, p_vote_day: day,
    p_displayed_total: displayedTotal, p_daily_cap: cap,
    p_is_power_hour: powerHour, p_is_double_day: doubleDay,
    p_proof_path: path, p_image_hash: imageHash, p_image_mime: imageMime, p_ocr_text: ocrText,
    p_expected_code: expectedCode, p_watermark_ok: check.watermarkOk,
    p_verify_status: check.status, p_verify_note: check.note,
  })
  if (rpcErr) return { success: false, error: 'db_error', detail: rpcErr.message }
  if (!result?.success) return { success: false, error: result?.error || 'submit_failed' }

  if (check.status === 'verified') {
    const templateIds = ['event_vma_voter']
    if (powerHour) templateIds.push('event_vma_power_hour')
    if (doubleDay) templateIds.push('event_vma_double_day')
    for (const templateId of templateIds) await awardBadge(supabase, agentNo, templateId)
    await addChestFill(supabase, agentNo, eventId, result.creditedVotes)
  }

  return {
    success: true, verifyStatus: check.status, verifyNote: check.note,
    watermarkCode: expectedCode, creditedVotes: result.creditedVotes, remaining: result.remaining,
  }
}

// ── Admin review (7) ─────────────────────────────────────────────────────

export async function adminListVmaPending(supabase: SupabaseDB, params: Record<string, unknown>) {
  const eventId = String(params.eventId || 'vma_2026')
  const { data, error } = await supabase.from('rc_vma_votes')
    .select('id, agent_no, category, vote_day, displayed_total, ocr_text, expected_code, watermark_ok, verify_note, voted_at, proof_path')
    .eq('event_id', eventId).eq('verify_status', 'pending').order('voted_at', { ascending: true })
  if (error) return { success: false, error: error.message }
  return { success: true, pending: data || [] }
}

export async function adminReviewVmaVote(supabase: SupabaseDB, content: GameContent, params: Record<string, unknown>) {
  const voteId = Number(params.voteId)
  const decision = String(params.decision || '')
  const admin = String(params.admin || 'admin')
  const note = params.note ? String(params.note) : null
  if (!voteId || !['approve', 'reject'].includes(decision)) return { success: false, error: 'bad_params' }

  const { data: result, error } = await supabase.rpc('rc_vma_review_vote', {
    p_vote_id: voteId, p_decision: decision, p_admin: admin, p_note: note,
  })
  if (error) return { success: false, error: error.message }
  if (!result?.success) return { success: false, error: result?.error || 'review_failed' }

  if (result.verifyStatus === 'verified') {
    const { data: row } = await supabase.from('rc_vma_votes').select('agent_no, event_id, is_power_hour, is_double_day').eq('id', voteId).maybeSingle()
    if (row) {
      const templateIds = ['event_vma_voter']
      if (row.is_power_hour) templateIds.push('event_vma_power_hour')
      if (row.is_double_day) templateIds.push('event_vma_double_day')
      for (const templateId of templateIds) await awardBadge(supabase, row.agent_no, templateId)
      await addChestFill(supabase, row.agent_no, row.event_id, result.creditedVotes)
    }
  }

  return { success: true, verifyStatus: result.verifyStatus, creditedVotes: result.creditedVotes }
}
