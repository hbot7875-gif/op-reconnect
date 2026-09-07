// Privacy-safe, frozen social snapshots for link-first ReConnect sharing.
// The public row deliberately contains only words/numbers that may appear on
// the public card. Agent identity, internal district ids, chat and lore never
// enter the table, so neither the URL nor its public lookup can leak them.

import React from 'npm:react@18.3.1'
import { ImageResponse } from 'npm:@vercel/og@0.8.5'
import type { SupabaseDB } from './config.ts'
import { getGameState } from './handlers.ts'

const SITE = 'https://hopetrackers.org'
const ID_RE = /^[A-Za-z0-9_-]{22}$/

type SnapshotKind = 'district' | 'red_zone_active' | 'red_zone_success'

function opaqueId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let raw = ''
  for (const byte of bytes) raw += String.fromCharCode(byte)
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function clean(value: unknown, max = 90): string {
  return String(value || '').replace(/[<>\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function titleCase(value: unknown): string {
  return clean(value).toLowerCase().replace(/(^|[\s/&-])([a-z])/g, (_m, gap, c) => gap + c.toUpperCase())
}

function districtPercent(active: any): number {
  if (!active) return 0
  const pieces: number[] = []
  for (const goal of active.trackGoals || []) pieces.push(Math.min(1, Number(goal.progress || 0) / Math.max(1, Number(goal.target || 1))))
  for (const album of active.albums || []) pieces.push(Math.min(1, Number(album.passesDone || 0) / Math.max(1, Number(album.target || 1))))
  if (active.reconnect) pieces.push(active.reconnect.done ? 1 : Math.min(.99, Number(active.reconnect.progress || 0) / Math.max(1, Number(active.reconnect.target || 1))))
  return Math.round((pieces.length ? pieces.reduce((a, b) => a + b, 0) / pieces.length : 0) * 100)
}

function districtLine(name: string, complete: boolean): string {
  const n = name.toLowerCase()
  if (complete) return n.includes('map of seven') ? 'WE MADE IT ALL THE WAY 😭💜' : 'I FINALLY LIT IT UP 😭💜'
  if (/puple|sky|overlook|night|moon|rain/.test(n)) return 'my district is still basically dark 😭'
  if (/fountain|ocean|water|swim/.test(n)) return 'my district still needs more light 😭'
  if (/crossing|station|bridge|road/.test(n)) return 'my district still has a long way to go 😭'
  return 'my district is still mostly dark 😭'
}

function redTarget(defuse: any): { label: string; unit: string } {
  const entries = Array.isArray(defuse?.targetNames) ? defuse.targetNames : []
  if (entries.length) {
    const label = entries.map((entry: any) => clean(entry.name, 65)).filter(Boolean).join(' + ')
    return { label: label || 'BTS', unit: entries.every((entry: any) => entry.kind === 'album') ? 'album streams' : 'streams' }
  }
  return { label: clean(defuse?.targetTrack || defuse?.targetAlbum || 'BTS', 65), unit: defuse?.targetAlbum ? 'album streams' : 'streams' }
}

function redLine(progress: number, target: number, activeFrom: string | null, endsAt: string, capturedAt: string): string {
  const fraction = progress / Math.max(1, target)
  if (fraction >= .9) return "wait we're actually about to do this 😭"
  const now = new Date(capturedAt).getTime()
  const start = activeFrom ? new Date(activeFrom).getTime() : NaN
  const end = new Date(endsAt).getTime()
  const elapsed = now - start
  const remaining = end - now
  const projected = progress > 0 && elapsed >= 15 * 60_000 ? elapsed * (target - progress) / progress : Infinity
  if (elapsed >= 15 * 60_000 && (progress === 0 || projected > remaining)) return 'okay we actually need more ARMY 😭'
  return 'ARMY, we could use you in here 😭'
}

async function insert(supabase: SupabaseDB, kind: SnapshotKind, data: Record<string, unknown>) {
  const id = opaqueId()
  const { error } = await supabase.from('rc_share_snapshots').insert({ id, kind, data })
  if (error) throw new Error('share_snapshot_failed')
  const pathKind = kind === 'district' ? 'district' : 'red-zone'
  const url = `${SITE}/share/${pathKind}/${id}`
  return { id, url }
}

export async function createShareSnapshot(supabase: SupabaseDB, params: any) {
  const agentNo = clean(params.agentNo, 20).toUpperCase()
  const state: any = await getGameState(supabase, { agentNo })
  if (!state?.success || !state?.joined) return { success: false, error: 'share_unavailable' }
  const requested = clean(params.kind, 30)

  if (requested === 'district') {
    const wanted = clean(params.districtId, 100)
    const mapDistrict = (state.map?.districts || []).find((d: any) => d.id === wanted)
    const active = state.activeDistrict?.id === wanted ? state.activeDistrict : null
    if (!mapDistrict || (!active && !['restored', 'centerpiece_lit'].includes(mapDistrict.status))) return { success: false, error: 'district_not_shareable' }
    const complete = ['restored', 'centerpiece_lit'].includes(mapDistrict.status)
    const percent = complete ? 100 : districtPercent(active)
    const displayName = titleCase(mapDistrict.name)
    const line = districtLine(displayName, complete)
    const { url } = await insert(supabase, 'district', { displayName, percent, complete, line })
    const caption = complete
      ? `${line}\n${displayName} · 100% restored ✦\nReConnect → ${url}`
      : `${line}\n${displayName} · ${percent}% restored\ncome light yours up too 💜\nReConnect → ${url}`
    return { success: true, url, title: `${displayName} · ${percent}% restored`, caption }
  }

  if (requested === 'red_zone_active') {
    const defuse = state.bomb?.defuse
    if (!defuse) return { success: false, error: 'red_zone_not_active' }
    const capturedAt = new Date().toISOString()
    const endsAt = clean(defuse.activeUntil || defuse.endsAt, 40)
    const progress = Math.max(0, Number(defuse.progress) || 0)
    const target = Math.max(1, Number(defuse.target) || 1)
    const targetInfo = redTarget(defuse)
    const { data: event } = await supabase.from('rc_defuse_events').select('active_from').eq('id', defuse.id).maybeSingle()
    const line = redLine(progress, target, event?.active_from || null, endsAt, capturedAt)
    const remainingSeconds = Math.max(0, Math.floor((new Date(endsAt).getTime() - new Date(capturedAt).getTime()) / 1000))
    const { url } = await insert(supabase, 'red_zone_active', { targetLabel: targetInfo.label, unit: targetInfo.unit, progress, target, capturedAt, endsAt, remainingSeconds, line })
    return { success: true, url, title: 'ReConnect · City under attack', caption: `${line}\n${progress.toLocaleString()} / ${target.toLocaleString()} ${targetInfo.unit}\nReConnect → ${url}` }
  }

  if (requested === 'red_zone_success') {
    const resolved = state.bomb?.resolvedDefuse
    if (!resolved || resolved.status !== 'defused' || (params.eventId && params.eventId !== resolved.id)) return { success: false, error: 'red_zone_result_unavailable' }
    const progress = Math.max(0, Number(resolved.progress) || 0)
    const target = Math.max(1, Number(resolved.target) || 1)
    const line = 'WE ACTUALLY SAVED IT 😭'
    const { url } = await insert(supabase, 'red_zone_success', { progress, target, line })
    return { success: true, url, title: 'ReConnect · City safe', caption: `${line}\n${progress.toLocaleString()} / ${target.toLocaleString()} · Bomb defused\nReConnect → ${url}` }
  }
  return { success: false, error: 'invalid_share_kind' }
}

export async function getPublicShareSnapshot(supabase: SupabaseDB, params: any) {
  const id = clean(params.id, 30)
  if (!ID_RE.test(id)) return { success: false, error: 'not_found' }
  const { data } = await supabase.from('rc_share_snapshots').select('id,kind,data,created_at,expires_at').eq('id', id).gt('expires_at', new Date().toISOString()).maybeSingle()
  return data ? { success: true, snapshot: data } : { success: false, error: 'not_found' }
}

const h = React.createElement
function card(snapshot: any) {
  const data = snapshot.data || {}
  const district = snapshot.kind === 'district'
  const success = snapshot.kind === 'red_zone_success'
  const accent = district ? (data.complete ? '#e4b968' : '#a78bfa') : success ? '#e4b968' : '#d44a60'
  const heading = district ? data.displayName : success ? 'CITY SAFE ✦' : 'CITY UNDER ATTACK'
  const primary = district ? `${data.percent}% RESTORED${data.complete ? ' ✦' : ''}` : success ? 'DEFUSED' : `${Math.round(Number(data.progress) / Math.max(1, Number(data.target)) * 100)}% DEFUSED`
  const secondary = district ? data.line : `${Number(data.progress).toLocaleString()} / ${Number(data.target).toLocaleString()} ${String(data.unit || 'streams').toUpperCase()}`
  const timer = !district && !success ? `${String(Math.floor(data.remainingSeconds / 3600)).padStart(2, '0')}:${String(Math.floor(data.remainingSeconds % 3600 / 60)).padStart(2, '0')}:${String(data.remainingSeconds % 60).padStart(2, '0')} LEFT` : ''
  const scene = district
    ? h('div', { style: { display: 'flex', position: 'relative', width: '65%', height: '100%', background: 'linear-gradient(180deg,#111126,#29204b 60%,#090913)', overflow: 'hidden' } },
        h('div', { style: { position: 'absolute', left: 70, right: 55, bottom: 95, height: 230, border: '2px solid rgba(167,139,250,.35)', background: 'linear-gradient(180deg,rgba(80,58,133,.25),rgba(8,8,18,.92))' } }),
        ...[90,210,350,500].map((x, i) => h('div', { key: x, style: { position: 'absolute', left: x, bottom: 95, width: 70 + i * 9, height: 155 + i * 32, background: '#0a0a14', borderTop: `3px solid ${accent}` } })),
        h('div', { style: { position: 'absolute', inset: 0, background: 'linear-gradient(90deg,transparent 65%,#090810),linear-gradient(0deg,#090810,transparent 45%)' } }))
    : h('div', { style: { display: 'flex', width: '65%', height: '100%', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle at 50% 45%,rgba(128,30,52,.28),#090810 58%)' } },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 275, height: 275, borderRadius: 999, border: `5px solid ${accent}`, background: success ? 'radial-gradient(circle at 34% 28%,#d7bcff,#6d37bb 52%,#261345)' : 'radial-gradient(circle at 34% 28%,#d75b6e,#821b32 55%,#370913)', color: '#fff', fontSize: 68, boxShadow: `0 0 55px ${accent}55` } }, '⟭⟬'))
  return h('div', { style: { display: 'flex', width: 1200, height: 630, color: '#f4f0fa', background: '#090810', fontFamily: 'Arial, sans-serif' } }, scene,
    h('div', { style: { display: 'flex', flexDirection: 'column', width: '35%', padding: '74px 55px 42px 28px', justifyContent: 'center' } },
      h('div', { style: { color: '#aaa2b9', fontSize: 18, letterSpacing: 5, marginBottom: 25 } }, district ? 'MY DISTRICT' : 'RECONNECT · RED ZONE'),
      h('div', { style: { fontSize: district ? 40 : 36, fontWeight: 800, lineHeight: 1.12, marginBottom: 22 } }, clean(heading, 70).toUpperCase()),
      h('div', { style: { color: accent, fontSize: 29, fontWeight: 700, marginBottom: 24 } }, primary),
      h('div', { style: { fontSize: 23, lineHeight: 1.35, color: '#ddd7e6', marginBottom: timer ? 22 : 60 } }, secondary),
      timer ? h('div', { style: { color: '#ff9bac', fontSize: 25, fontWeight: 700, marginBottom: 45 } }, timer) : null,
      h('div', { style: { color: '#8f879d', fontSize: 17, letterSpacing: 3, marginTop: 'auto' } }, 'RECONNECT · HOPETRACKER'),
      h('div', { style: { color: '#bbb4c5', fontSize: 18, marginTop: 8 } }, 'hopetrackers.org')))
}

export async function shareImageResponse(supabase: SupabaseDB, id: string): Promise<Response> {
  const result: any = await getPublicShareSnapshot(supabase, { id })
  if (!result.success) return new Response('Not found', { status: 404 })
  const response = new ImageResponse(card(result.snapshot) as any, { width: 1200, height: 630 })
  response.headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  return response
}
