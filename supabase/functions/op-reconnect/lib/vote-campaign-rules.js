/**
 * Voting campaigns (MAMA 2026 first) — the pure rules both runtimes share.
 *
 * Kept free of DOM/Deno imports so Node can test the exact logic the Edge
 * Function and the browser run. The browser uses these for display and for a
 * friendly pre-check only; every decision that awards anything is made by the
 * server (lib/vote-campaign.ts) and the database (migration 20261013150000).
 *
 * Nothing here knows about VMA. The VMA vote log keeps its own module.
 */
import { proofKeywordMatches } from './vma-ocr.js'

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 86_400_000

/** KST calendar day ('YYYY-MM-DD') of a Date or ms timestamp. */
export function kstDayOf(at) {
  const ms = at instanceof Date ? at.getTime() : Number(at)
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10)
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** The instant the next KST day starts (00:00 KST), as a Date. */
export function nextKstMidnight(at = new Date()) {
  return new Date(`${addDays(kstDayOf(at), 1)}T00:00:00+09:00`)
}

/** 'upcoming' | 'open' | 'closed' for a campaign row at a given moment. */
export function campaignPhase(campaign, at = new Date()) {
  const t = at instanceof Date ? at.getTime() : Number(at)
  if (!campaign) return 'closed'
  if (t < new Date(campaign.opens_at).getTime()) return 'upcoming'
  if (t > new Date(campaign.closes_at).getTime()) return 'closed'
  return 'open'
}

/** Whole KST days left until voting closes, counting today. */
export function daysLeft(campaign, at = new Date()) {
  const today = kstDayOf(at)
  const last = kstDayOf(new Date(campaign.closes_at))
  const diff = Math.round((new Date(`${last}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / DAY_MS)
  return Math.max(0, diff + 1)
}

export function missionById(campaign, id) {
  return (campaign?.missions || []).find((m) => m && m.id === id) || null
}

// ── X posts ───────────────────────────────────────────────────────────

const X_HOSTS = new Set(['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'])

/** Accepts x.com / twitter.com status links, with or without query strings,
 *  and the handle-less /i/status/ form. Returns null for anything else so a
 *  pasted profile link, search page or shortened t.co link is refused before
 *  anything is fetched. */
export function parseXPostUrl(raw) {
  let url
  try { url = new URL(String(raw || '').trim()) } catch { return null }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!X_HOSTS.has(url.hostname.toLowerCase())) return null
  const parts = url.pathname.split('/').filter(Boolean)
  let handle = null
  let id = null
  if (parts.length >= 3 && parts[0] === 'i' && (parts[1] === 'status' || parts[1] === 'web') ) {
    id = parts[1] === 'web' ? parts[3] : parts[2]
  } else if (parts.length >= 3 && (parts[1] === 'status' || parts[1] === 'statuses')) {
    handle = parts[0]
    id = parts[2]
  }
  if (!id || !/^\d{5,25}$/.test(id)) return null
  if (handle !== null && !/^[A-Za-z0-9_]{1,15}$/.test(handle)) return null
  return {
    postId: id,
    urlHandle: handle ? handle.toLowerCase() : null,
    canonicalUrl: `https://x.com/${handle || 'i/status'}${handle ? '/status' : ''}/${id}`,
  }
}

/** X post ids are snowflakes: the top bits are milliseconds since X's epoch.
 *  That gives the exact posting time without fetching anything, so the
 *  "posted on the right KST day" check never depends on X being reachable. */
export function snowflakeTime(postId) {
  if (!/^\d{5,25}$/.test(String(postId || ''))) return null
  const ms = Number((BigInt(postId) >> 22n) + 1288834974657n)
  // Pre-2010 ids are sequential, not snowflakes; nothing that old is a vote.
  return ms > Date.UTC(2010, 10, 1) ? new Date(ms) : null
}

export function normalizeHandle(raw) {
  const h = String(raw || '').trim().replace(/^@+/, '').toLowerCase()
  return /^[a-z0-9_]{1,15}$/.test(h) ? h : null
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&mdash;/g, '—').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/** Reads X's public oEmbed response. Only the post paragraph is used — the
 *  author line and date link that follow it are not part of the post text. */
export function parseOembed(json) {
  if (!json || typeof json !== 'object' || typeof json.html !== 'string') return null
  const authorMatch = String(json.author_url || '').match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?$/i)
  const para = json.html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)
  const inner = para ? para[1] : ''
  const hashtags = new Set()
  for (const m of inner.matchAll(/\/hashtag\/([^?"'\s]+)/gi)) {
    try { hashtags.add(decodeURIComponent(m[1]).toLowerCase()) } catch { hashtags.add(m[1].toLowerCase()) }
  }
  const text = decodeEntities(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
  for (const m of text.matchAll(/#([\p{L}\p{N}_]+)/gu)) hashtags.add(m[1].toLowerCase())
  return {
    authorHandle: authorMatch ? authorMatch[1].toLowerCase() : null,
    text,
    hashtags: [...hashtags],
  }
}

export function missingHashtags(found, required) {
  const have = new Set((found || []).map((h) => String(h).replace(/^#/, '').toLowerCase()))
  return (required || []).filter((h) => !have.has(String(h).replace(/^#/, '').toLowerCase()))
}

/**
 * The X decision. `fetched` is what the verifier could learn about the post
 * (see XPostVerifier in vote-campaign.ts). Anything short of a confident pass
 * goes to review — an unreachable X, a deleted post or a missing hashtag is
 * for a person to judge, never an automatic rejection.
 */
export function decideXProof({ fetched, requiredHashtags, expectedHandle, requireHandleMatch, dateOk }) {
  const checks = { date: !!dateOk }
  if (!fetched || !fetched.ok) {
    checks.found = null
    return { status: 'review', checks, note: fetched?.reason === 'not_found' ? 'x_post_not_found' : 'x_unreachable' }
  }
  checks.found = true
  checks.publicPost = true // oEmbed only ever serves public posts
  const missing = missingHashtags(fetched.hashtags, requiredHashtags)
  checks.hashtags = missing.length === 0
  if (requireHandleMatch) checks.author = !!expectedHandle && fetched.authorHandle === expectedHandle
  const pass = checks.date && checks.hashtags && (!requireHandleMatch || checks.author)
  let note = 'all_checks_passed'
  if (!checks.hashtags) note = 'missing_hashtags'
  else if (requireHandleMatch && !checks.author) note = 'author_mismatch'
  else if (!checks.date) note = 'wrong_day'
  return { status: pass ? 'verified' : 'review', checks, note }
}

/** Prefilled composer link. Hashtags only — the player adds anything else. */
export function xComposeUrl(hashtags) {
  const text = (hashtags || []).map((h) => (String(h).startsWith('#') ? h : `#${h}`)).join(' ')
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`
}

// ── Mnet certificates ─────────────────────────────────────────────────

/** A UTC offset in minutes, east positive (IST = 330, KST = 540) — only a
 *  real one: whole quarter hours from UTC−12:00 to UTC+14:00. Else null. */
export function validUtcOffset(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return Number.isInteger(n) && n >= -720 && n <= 840 && n % 15 === 0 ? n : null
}

const KST_OFFSET_MIN = 540
// Phone clocks and our server clock disagree a little; a certificate may be
// printed up to this far "after" the upload landed and still count.
const CLOCK_SKEW_MS = 5 * 60_000

/** The certificate's own "Participation Date 2026.10.13 21:41", as an
 *  instant — or null if OCR couldn't read a full date and time.
 *
 *  Mnet prints the time on the VOTING PHONE's local clock, not KST (an
 *  Indian phone voting at 01:11 KST prints 2026.10.13 21:41). Pass that
 *  clock's UTC offset; without one the printed time is read as KST, which
 *  is also the stable key used for duplicate-time fingerprints. */
export function participationTime(text, utcOffsetMinutes = KST_OFFSET_MIN) {
  const t = String(text || '').replace(/\s+/g, ' ')
  const m = t.match(/(20\d\d)\s?[.\-/]\s?(\d{1,2})\s?[.\-/]\s?(\d{1,2})\.?\s+(\d{1,2})\s?[:.]\s?(\d{2})/)
  if (!m) return null
  const off = validUtcOffset(utcOffsetMinutes) ?? KST_OFFSET_MIN
  const [y, mo, d, hh, mm] = m.slice(1).map(Number)
  // A wall-clock reading that really exists (no Feb 31, no 24:00).
  const wall = new Date(Date.UTC(y, mo - 1, d, hh, mm))
  if (hh > 23 || mm > 59 || wall.getUTCFullYear() !== y || wall.getUTCMonth() !== mo - 1 || wall.getUTCDate() !== d) return null
  return new Date(wall.getTime() - off * 60_000)
}

/**
 * The 2026 MAMA voting certificate (Mnet Plus) as the launch reference
 * defines it. It never prints the artist's name — BTS is the artist image,
 * which bts-tile-match.js checks — so the text checks are only:
 *   certificate  "VOTING CERTIFICATE" + "Participation Date" + Mnet Plus wording
 *   category     "FANS' CHOICE Category 1st VOTE"
 *   date         the participation time — the printed local time converted
 *                with the uploading phone's UTC offset — is inside the voting
 *                window, on the KST day the proof is credited to, and not
 *                after the upload itself
 * `window` = { opensAt, closesAt, utcOffsetMinutes?, submittedAt? }. No
 * offset → the printed time is read as KST (the strict, original rule). The
 * offset only converts; it never widens the day: an old certificate stays
 * on its own KST day whatever offset is claimed, and must also predate the
 * upload. Plain booleans out. The text, the certificate number and anything
 * else on the certificate are never returned, kept or sent.
 */
export function evaluateCertificateText(text, mission, voteDay, window = {}) {
  const cfg = mission?.certificate || {}
  const has = (k) => proofKeywordMatches(text, k)
  const all = (list) => (list || []).length > 0 && list.every(has)
  const any = (list) => (list || []).some(has)
  const certificate = all(cfg.title_keywords || ['voting certificate']) && all(cfg.structure_keywords || ['participation date'])
    && any(cfg.issuer_keywords || ['mnet plus', 'mnetplus'])
  const category = any(cfg.category_keywords || ["fans' choice category 1st vote"])
  const at = participationTime(text, window.utcOffsetMinutes ?? KST_OFFSET_MIN)
  const inWindow = !!at && (!window.opensAt || at >= new Date(window.opensAt)) && (!window.closesAt || at <= new Date(window.closesAt))
  const sent = window.submittedAt ? new Date(window.submittedAt).getTime() : NaN
  const beforeUpload = !!at && (Number.isNaN(sent) || at.getTime() <= sent + CLOCK_SKEW_MS)
  const date = inWindow && beforeUpload && kstDayOf(at) === voteDay
  return { certificate, category, date }
}

// ── Duplicate-certificate inputs (kept in memory only) ───────────────
// The certificate number and participation minute are read only to be
// fingerprinted by the server (HMAC with a server-side key). They are
// never stored, logged or returned. Mnet prints numbers like
// "No. 61013E8U3K4UIKYF"; O/0 and I/L/1 are folded together because OCR
// confuses them and the fingerprint must survive a re-screenshot.

export function normalizeCertificateNumber(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
}

/** The "No. …" token from one OCR pass, normalised — or null. */
export function certificateNumberFromText(text, length = 16) {
  const m = String(text || '').match(/\bN[o0]\.?\s*:?\s*([A-Za-z0-9]{8,30})\b/)
  if (!m) return null
  const v = normalizeCertificateNumber(m[1])
  return v.length === length ? v : null
}

/** Never a guess: a number is used only when at least two separate OCR
 *  passes read exactly the same value, and no other value ties with it. */
export function certificateNumberConsensus(reads, length = 16) {
  const counts = new Map()
  for (const r of reads || []) {
    const v = typeof r === 'string' ? normalizeCertificateNumber(r) : null
    if (v && v.length === length) counts.set(v, (counts.get(v) || 0) + 1)
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  if (!ranked.length || ranked[0][1] < 2) return null
  if (ranked[1] && ranked[1][1] === ranked[0][1]) return null
  return ranked[0][0]
}

/** 'YYYY-MM-DDTHH:MM' (KST) of the participation time, for its fingerprint. */
export function participationMinuteKey(at) {
  const d = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(d.getTime())) return null
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 16)
}

const MNET_TEXT_CHECKS = ['certificate', 'category', 'date']
const BTS_RESULTS = ['match', 'unclear', 'no_match']

/** Only the three booleans and the image result survive a trust boundary —
 *  nothing else can ride along into storage. btsScore is a reviewer aid. */
export function sanitizeMnetChecks(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const k of MNET_TEXT_CHECKS) out[k] = r[k] === true
  out.bts = BTS_RESULTS.includes(r.bts) ? r.bts : 'unclear'
  if (typeof r.btsScore === 'number' && r.btsScore >= -1 && r.btsScore <= 1) out.btsScore = Math.round(r.btsScore * 1000) / 1000
  return out
}

/** The browser pre-check's hint: three booleans and nothing else. It is
 *  stored for reviewer triage only and never decides anything. */
export function sanitizeClientCertChecks(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const k of MNET_TEXT_CHECKS) out[k] = r[k] === true
  return out
}

/** Trusted checks in, status out. Auto-verified only when all three text
 *  checks pass AND the BTS image check says 'match'. Anything else — an
 *  unclear image, or a clear no_match — goes to a reviewer. Never rejected
 *  automatically. */
export function decideMnetChecks(checks) {
  const c = sanitizeMnetChecks(checks)
  const failed = MNET_TEXT_CHECKS.filter((k) => !c[k])
  if (c.bts !== 'match') failed.push(c.bts === 'no_match' ? 'bts_no_match' : 'bts')
  const pass = failed.length === 0
  return { status: pass ? 'verified' : 'review', checks: c, note: pass ? 'all_checks_passed' : `unclear:${failed.join(',')}` }
}

// ── Player summaries ─────────────────────────────────────────────────

/** Consecutive KST days with at least one verified proof, ending today — or
 *  ending yesterday, so a streak isn't shown as broken before today's vote. */
export function votingStreak(verifiedDays, today) {
  const days = new Set(verifiedDays || [])
  let cursor = days.has(today) ? today : addDays(today, -1)
  let n = 0
  while (days.has(cursor)) { n++; cursor = addDays(cursor, -1) }
  return n
}

/**
 * Per-mission state for today, from the player's own proof rows.
 * 'todo' | 'verifying' | 'review' | 'verified' | 'rejected'
 * A rejected proof leaves a configured daily slot open because it is not live.
 */
export function missionStates(campaign, proofs, today) {
  const out = {}
  for (const m of campaign?.missions || []) {
    const rows = (proofs || []).filter((p) => p.mission_id === m.id && p.vote_day === today)
    const live = rows.filter((p) => p.status !== 'rejected')
    const max = Math.max(1, Number(m.max_daily) || 1)
    const verified = live.filter((p) => p.status === 'verified').length
    const pending = live.find((p) => p.status === 'review' || p.status === 'verifying')
    out[m.id] = verified >= max ? 'verified' : pending ? pending.status : rows.length && !live.length ? 'rejected' : 'todo'
  }
  return out
}

/**
 * What the player is told about duplicate certificates today, per Mnet
 * mission: only about their LATEST certificate, and only one of two words —
 *   'duplicate'           the trusted check matched a certificate already
 *                         submitted (won't be counted again)
 *   'possible_duplicate'  it may match one — sent to a reviewer
 * Nothing else crosses: no numbers, hashes, fingerprints, other agents, or
 * how the match was made. A reviewer's later "verified" clears it.
 */
export function duplicateNotices(campaign, proofs, today) {
  const out = {}
  for (const m of campaign?.missions || []) {
    if (m.kind !== 'mnet_certificate') continue
    const latest = (proofs || [])
      .filter((p) => p.mission_id === m.id && p.vote_day === today)
      .sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)))[0]
    if (!latest || latest.status === 'verified') continue
    if (latest.duplicate_kind === 'certificate') out[m.id] = 'duplicate'
    else if (latest.duplicate_kind === 'possible') out[m.id] = 'possible_duplicate'
  }
  return out
}

/** Per-channel KST-day counters. Rejected proofs never consume a slot. */
export function missionProgress(campaign, proofs, today) {
  const out = {}
  for (const m of campaign?.missions || []) {
    const max = Math.max(1, Number(m.max_daily) || 1)
    const live = (proofs || []).filter((p) => p.mission_id === m.id && p.vote_day === today && p.status !== 'rejected')
    const verified = live.filter((p) => p.status === 'verified').length
    const pending = live.filter((p) => p.status === 'review' || p.status === 'verifying').length
    out[m.id] = { verified, pending, used: live.length, remaining: Math.max(0, max - live.length), max }
  }
  return out
}

/** Voting Gift state from the event's own config and the player's fill:
 *  'tba' until a threshold and a pool exist, 'ready' when it can open now,
 *  'capped' when full but today's opens are used up, else 'filling'. */
export function giftState(gift, fill, opensToday) {
  const threshold = Number(gift?.threshold) || 0
  const pool = (Array.isArray(gift?.pool) ? gift.pool : []).filter((x) => Number(x?.weight) > 0)
  const cap = Number(gift?.daily_open_cap) || 0
  if (!threshold || !pool.length) return 'tba'
  if (fill >= threshold) return !cap || opensToday < cap ? 'ready' : 'capped'
  return 'filling'
}

// ── BTS X Vote Pulse (display only) ───────────────────────────────────

/** The smallest post id X could have assigned at a moment — the collector's
 *  starting cursor, so the first run counts nothing posted before voting
 *  opened. */
export function snowflakeAt(at) {
  const ms = BigInt(new Date(at).getTime())
  return ((ms - 1288834974657n) << 22n).toString()
}

/** The provider search: the X mission's own hashtag list, so the Pulse and
 *  personal verification always use the same configured set. */
export function pulseQuery(hashtags, { excludeRetweets = true } = {}) {
  const tags = (hashtags || []).map((h) => `#${String(h).replace(/^#/, '')}`)
  return [...tags, ...(excludeRetweets ? ['-filter:retweets'] : [])].join(' ')
}

const PULSE_STALE_MS = 8 * 3600_000

/**
 * What players may see of the cached Pulse row. Never a zero that stands in
 * for "unknown": no successful run yet is `count: null` (collecting), and a
 * failed or stale refresh keeps the last good count, drops the delta and
 * says when it was last updated. Provider, cost and cursor never leave.
 */
export function pulseView(row, hashtags, now = new Date()) {
  const tags = (hashtags || []).map((h) => `#${String(h).replace(/^#/, '')}`)
  if (!row || !row.last_success_at) return { tags, count: null, delta: null, lastUpdatedAt: null, stale: false }
  const age = new Date(now).getTime() - new Date(row.last_success_at).getTime()
  const healthy = (row.last_status === 'ok' || row.last_status === 'partial') && age <= PULSE_STALE_MS
  const delta = healthy && row.previous_count != null ? Number(row.total_count) - Number(row.previous_count) : null
  return {
    tags,
    count: Number(row.total_count),
    delta: delta != null && delta > 0 ? delta : null,
    lastUpdatedAt: row.last_success_at,
    stale: !healthy,
  }
}

// ── City presence (map marker + banner) ──────────────────────────────

/**
 * Where an event stands for the City screen:
 *   'open'       voting is live
 *   'verifying'  voting closed, reviews still landing, before the freeze
 *   'final'      after the freeze, for battle.final_visible_hours (48)
 *   null         before voting opens, or once the final window has passed
 */
export function cityPhase(campaign, at = new Date()) {
  if (!campaign) return null
  const t = new Date(at).getTime()
  const opens = new Date(campaign.opens_at).getTime()
  const closes = new Date(campaign.closes_at).getTime()
  const freeze = new Date(campaign.battle?.freeze_at || campaign.closes_at).getTime()
  const hours = Number(campaign.battle?.final_visible_hours ?? 48)
  if (t < opens) return null
  if (t <= closes) return 'open'
  if (t <= freeze) return 'verifying'
  if (t <= freeze + hours * 3600_000) return 'final'
  return null
}
