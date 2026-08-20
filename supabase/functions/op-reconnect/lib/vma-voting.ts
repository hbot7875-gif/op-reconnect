// Self-reported voting missions (MTV VMAs 2026 first, event_id-scoped so
// future ones reuse this) — see migration 20260819091000 for the original
// schema and 20260819100000 for the follow-up fixes referenced by number
// below (matching the review that drove them).
//
// Votes happen off-site (vote.mtv.com), so proof is checked from browser OCR
// against BTS, the configured song, the displayed vote total and the shared
// daily watermark. Proofs that clear all four checks are credited immediately;
// anything unclear falls to 'pending'. Exact-image dedupe and the atomic SQL
// cap calculation still prevent reuse and concurrent over-crediting.
import type { GameContent, SupabaseDB } from './config.ts'
import { addChestFill, getChestStatus } from './supply-chest.ts'
import { getCommunityChestStatus } from './vma-community-chest.ts'
import { evaluateVoteProof, validVoteTotals } from './vma-ocr.js'

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

/** The next Power Hour start, so the client can show a countdown and offer
 *  a reminder — fans coordinating a vote push get the most value voting
 *  right as the window opens, not sometime during it. Checks today's UTC
 *  occurrence first, then tomorrow's, each clamped against the campaign's
 *  overall power_hour_first/last_utc range. Returns null once today's
 *  window has already started (isPowerHour covers that case) or once
 *  there's no further occurrence left in the campaign. */
function nextPowerHourStart(cfg: VmaConfig, at: Date): Date | null {
  const first = new Date(cfg.power_hour_first_utc)
  const last = new Date(cfg.power_hour_last_utc)
  for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
    const day = new Date(at.getTime() + dayOffset * 86_400_000)
    const dateStr = day.toISOString().slice(0, 10)
    const candidate = new Date(`${dateStr}T${cfg.power_hour_utc_start}:00Z`)
    if (candidate <= at) continue
    if (candidate < first || candidate > last) continue
    return candidate
  }
  return null
}

// (9) Each window is now pre-clamped to the real voting period end in the
// migration itself, so no extra guard is needed here — but 'open' below is
// still checked independently before any credit is given.
function isDoubleDay(cfg: VmaConfig, at: Date): boolean {
  return cfg.double_days_utc.some((w) => at >= new Date(w.start) && at <= new Date(w.end))
}

/** The per-category daily cap, doubled during EITHER boost window — Power
 *  Hour or a Double Day — not just Double Day. The mission sheet's own
 *  copy already called Power Hour "boosted"; this is what makes that true
 *  for the actual credited amount, not just the label. */
function boostedCap(cfg: VmaConfig, at: Date): number {
  return (isDoubleDay(cfg, at) || isPowerHour(cfg, at)) ? cfg.daily_cap_per_category * 2 : cfg.daily_cap_per_category
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

interface ProofCheck {
  status: 'verified' | 'pending'
  note: string
  watermarkOk: boolean
  displayedTotal: number | null
}

/** Uses the exact same proof-bearing checks as the browser. The VMA logo and
 * category heading remain advisory because the mobile viewport often omits
 * them; the selected category still controls which daily counter is credited.
 * A miss goes to pending rather than being rejected. */
function checkProofText(text: string, cfg: VmaConfig, category: string, expectedCode: string, dailyCap: number): ProofCheck {
  if (!text.trim()) {
    return {
      status: 'pending', note: 'No OCR text supplied — held for manual review.',
      watermarkOk: false, displayedTotal: null,
    }
  }

  const proof = evaluateVoteProof(text, {
    expectedCode,
    songKeywords: cfg.category_keywords[category] || [],
    allowedVoteTotals: validVoteTotals(dailyCap),
  })

  const missing: string[] = []
  if (!proof.hasSong) missing.push('song title')
  if (!proof.watermarkOk) missing.push('watermark code')

  if (proof.passed) {
    return {
      status: 'verified', note: 'All automatic checks passed.',
      watermarkOk: proof.watermarkOk, displayedTotal: proof.displayedTotal,
    }
  }
  return {
    status: 'pending', note: `Needs manual review — missing: ${missing.join(', ')}.`,
    watermarkOk: proof.watermarkOk, displayedTotal: proof.displayedTotal,
  }
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
  const chest = await getChestStatus(supabase, content, { agentNo, eventId })

  if (!open) {
    // (9) Voting closing doesn't mean saved chest progress becomes
    // unreachable — keep a minimal claim-only banner up while there's still
    // something in it. Once fillCount hits 0 there's genuinely nothing
    // left to show, and the banner disappears for good.
    if (chest.success && chest.fillCount > 0) {
      return {
        eventId, title: cfg.title, ended: true,
        isPowerHour: false, isDoubleDay: false, periodEndUtc: cfg.period_end_utc,
        todayVotes: 0, todayCap: 0,
        chestFill: chest.fillCount, chestThreshold: chest.threshold, chestReady: chest.ready,
      }
    }
    return null
  }

  const day = etDateOf(now)
  const { data: rows } = await supabase.from('rc_vma_votes')
    .select('votes_logged').eq('event_id', eventId).eq('agent_no', agentNo).eq('vote_day', day).eq('verify_status', 'verified')
  const cap = boostedCap(cfg, now)
  const todayVotes = (rows || []).reduce((s: number, r: any) => s + r.votes_logged, 0)
  const todayCap = cap * cfg.categories.length

  // Every agent's votes today, not just this one's — a live "the whole
  // fandom logged N votes today" figure reads as collective momentum,
  // which a single agent's own capped count (max 20/day) can't convey.
  const { data: communityRows } = await supabase.from('rc_vma_votes')
    .select('votes_logged').eq('event_id', eventId).eq('vote_day', day).eq('verify_status', 'verified')
  const communityVotesToday = (communityRows || []).reduce((s: number, r: any) => s + r.votes_logged, 0)

  // Group Supply Chest — the fandom-wide milestone track (see
  // vma-community-chest.ts), folded in here so the banner can nudge
  // "claimable" without the World screen needing its own extra fetch.
  const communityChest = await getCommunityChestStatus(supabase, content, { agentNo, eventId })

  return {
    eventId, title: cfg.title, ended: false,
    // (7) Both can be true on the same real-world day (e.g. a Double Day
    // that also has a Power Hour window inside it) — the caller renders
    // both tags, not one-or-the-other.
    isPowerHour: isPowerHour(cfg, now), isDoubleDay: isDoubleDay(cfg, now),
    nextPowerHourStartUtc: nextPowerHourStart(cfg, now)?.toISOString() || null,
    periodEndUtc: cfg.period_end_utc,
    todayVotes, todayCap, communityVotesToday,
    chestFill: chest.success ? chest.fillCount : 0,
    chestThreshold: chest.success ? chest.threshold : null,
    chestReady: chest.success ? chest.ready : false,
    communityChestCumulative: communityChest.success ? communityChest.cumulativeVotes : 0,
    communityChestNextThreshold: communityChest.success ? communityChest.nextThreshold : null,
    communityChestClaimable: communityChest.success ? communityChest.claimableIndices.length > 0 : false,
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

  const cap = boostedCap(cfg, now)
  const usedByCategory: Record<string, number> = {}
  for (const c of cfg.categories) usedByCategory[c] = 0
  for (const r of rows || []) usedByCategory[r.category] = (usedByCategory[r.category] || 0) + r.votes_logged

  // Same fandom-wide total shown on the World-screen banner (getVmaBanner)
  // — repeated here so it still reads inside the mission sheet without
  // needing both endpoints called together.
  const { data: communityRows } = await supabase.from('rc_vma_votes')
    .select('votes_logged').eq('event_id', eventId).eq('vote_day', day).eq('verify_status', 'verified')
  const communityVotesToday = (communityRows || []).reduce((s: number, r: any) => s + r.votes_logged, 0)

  return {
    success: true,
    eventId,
    config: cfg,
    open: now >= new Date(cfg.period_start_utc) && now <= new Date(cfg.period_end_utc),
    isPowerHour: isPowerHour(cfg, now),
    isDoubleDay: isDoubleDay(cfg, now),
    nextPowerHourStartUtc: nextPowerHourStart(cfg, now)?.toISOString() || null,
    pendingTotal, pendingByCategory,
    dailyCap: cap,
    remaining: Object.fromEntries(cfg.categories.map((c) => [c, Math.max(0, cap - (usedByCategory[c] || 0))])),
    watermarkCode: dailyWatermarkCode(cfg, day),
    communityVotesToday,
  }
}

export async function logVmaVote(supabase: SupabaseDB, content: GameContent, params: Record<string, unknown>) {
  const eventId = String(params.eventId || 'vma_2026')
  const cfg = vmaConfig(content, eventId)
  if (!cfg) return { success: false, error: 'Voting mission not configured' }
  const agentNo = String(params.agentNo || '').trim().toUpperCase()
  const category = String(params.category || '')
  const imageBase64 = String(params.imageBase64 || '')
  const imageMime = String(params.imageMime || '').toLowerCase()
  const ocrText = String(params.ocrText || '') // client-extracted, untrusted — see module header

  if (!cfg.categories.includes(category)) return { success: false, error: 'bad_category' }
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
  const cap = boostedCap(cfg, now)
  const imageHash = await sha256Hex(bytes)
  const expectedCode = dailyWatermarkCode(cfg, day)
  const check = checkProofText(ocrText, cfg, category, expectedCode, cap)
  // The on-screen vote counter is no longer part of the proof — song +
  // BTS + today's watermark code passing is what "this screenshot is
  // real" means now. A verified proof credits the full boosted cap
  // outright (10 normally, 20 during Power Hour or a Double Day); an
  // unclear one still stores whatever OCR could read (0 if nothing) and
  // waits for an admin to check the actual screenshot.
  const displayedTotal = check.status === 'verified' ? cap : (check.displayedTotal ?? 0)

  const path = `${agentNo}/${Date.now()}.${imageMime.includes('png') ? 'png' : 'jpg'}`
  const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: imageMime })
  // (5) Every DB/storage error is checked before anything else happens —
  // no badge is ever awarded off an upload or insert that didn't actually
  // succeed.
  if (uploadErr) return { success: false, error: 'upload_failed', detail: uploadErr.message }

  // (3) Atomic: locks this agent/category/day/event, re-checks the
  // duplicate hash and the cap, and inserts — all inside one transaction —
  // so two concurrent submissions can't both read a stale cap and both get
  // credited past it. Clear proofs are verified and credited atomically;
  // unclear proofs are inserted with zero credit for later review.
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

  const creditedVotes = Number(result.creditedVotes) || 0
  if (check.status === 'verified') await addChestFill(supabase, agentNo, eventId, creditedVotes)
  return {
    success: true, verifyStatus: check.status, verifyNote: check.note,
    creditedVotes, watermarkCode: expectedCode, remaining: result.remaining,
  }
}

// ── Admin review (7) ─────────────────────────────────────────────────────

const PROOF_BUCKET = 'vma-vote-proofs'
const SIGNED_URL_TTL_SECONDS = 10 * 60

// (5) A usable review queue needs to actually show the screenshot — the
// bucket is private (proof screenshots show the phone's status bar), so
// the list hands back a short-lived signed URL per row instead of the raw
// proof_path, and supports paging so a backlog doesn't have to load in one
// shot.
export async function adminListVmaPending(supabase: SupabaseDB, content: GameContent, params: Record<string, unknown>) {
  const eventId = String(params.eventId || 'vma_2026')
  const cfg = vmaConfig(content, eventId)
  if (!cfg) return { success: false, error: 'not_configured' }
  const limit = Math.min(50, Math.max(1, Number(params.limit) || 20))
  const offset = Math.max(0, Number(params.offset) || 0)

  const { count } = await supabase.from('rc_vma_votes')
    .select('id', { count: 'exact', head: true }).eq('event_id', eventId).eq('verify_status', 'pending')

  const { data, error } = await supabase.from('rc_vma_votes')
    .select('id, agent_no, category, vote_day, displayed_total, ocr_text, expected_code, watermark_ok, verify_note, voted_at, proof_path, is_double_day, is_power_hour')
    .eq('event_id', eventId).eq('verify_status', 'pending')
    .order('voted_at', { ascending: true }).range(offset, offset + limit - 1)
  if (error) return { success: false, error: error.message }

  const rows = data || []
  const withUrls = await Promise.all(rows.map(async (r: any) => {
    const { data: signed } = await supabase.storage.from(PROOF_BUCKET).createSignedUrl(r.proof_path, SIGNED_URL_TTL_SECONDS)
    const { proof_path, ...rest } = r
    const allowedTotal = (r.is_double_day || r.is_power_hour) ? cfg.daily_cap_per_category * 2 : cfg.daily_cap_per_category
    const songKeywords = cfg.category_keywords[r.category] || []
    return { ...rest, allowedTotal, songKeywords, proofUrl: signed?.signedUrl || null }
  }))

  return { success: true, pending: withUrls, pendingCount: count || 0, limit, offset }
}

export async function adminReviewVmaVote(supabase: SupabaseDB, content: GameContent, params: Record<string, unknown>) {
  const voteId = Number(params.voteId)
  const decision = String(params.decision || '')
  const admin = String(params.admin || 'admin')
  const note = params.note ? String(params.note) : null
  const correctedTotal = params.correctedDisplayedTotal != null ? Math.floor(Number(params.correctedDisplayedTotal)) : null
  if (!voteId || !['approve', 'reject'].includes(decision)) return { success: false, error: 'bad_params' }
  if (correctedTotal != null && !Number.isInteger(correctedTotal)) {
    return { success: false, error: 'bad_corrected_total' }
  }

  // The cap for a row is decided by conditions AT SUBMIT TIME (is_double_day
  // was already resolved then), not "now" — an admin reviewing a Tuesday
  // submission on Wednesday must still get Tuesday's cap.
  const { data: row } = await supabase.from('rc_vma_votes')
    .select('agent_no, event_id, category, displayed_total, is_power_hour, is_double_day').eq('id', voteId).maybeSingle()
  if (!row) return { success: false, error: 'not_found' }
  const cfg = vmaConfig(content, row.event_id)
  if (!cfg) return { success: false, error: 'not_configured' }
  const dailyCap = (row.is_double_day || row.is_power_hour) ? cfg.daily_cap_per_category * 2 : cfg.daily_cap_per_category
  const effectiveTotal = correctedTotal ?? Number(row.displayed_total)
  if (decision === 'approve' && effectiveTotal !== dailyCap) {
    return { success: false, error: 'bad_corrected_total', expectedTotal: dailyCap }
  }

  const { data: result, error } = await supabase.rpc('rc_vma_review_vote', {
    p_vote_id: voteId, p_decision: decision, p_admin: admin, p_note: note,
    p_daily_cap: dailyCap, p_corrected_total: correctedTotal,
  })
  if (error) return { success: false, error: error.message }
  if (!result?.success) return { success: false, error: result?.error || 'review_failed' }

  if (result.verifyStatus === 'verified') {
    await addChestFill(supabase, row.agent_no, row.event_id, result.creditedVotes)
  }

  return { success: true, verifyStatus: result.verifyStatus, creditedVotes: result.creditedVotes }
}
