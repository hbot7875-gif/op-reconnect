// Candy Star Generator — Spotify OAuth.
//
// Ported from arirang-btsbackend/index.ts's "OAuth (auto-create playlists)"
// section. Unchanged from the source in one important way that matters a lot
// here: this is a SINGLE, SITE-WIDE connection (one row, id='default' in
// `spotify_oauth`), not per-agent. Only the site owner ever authorizes it,
// once, via the admin-key-gated routes in index.ts — every agent's
// generateAlpaca call rides on this one connected account.

import type { SupabaseDB } from './spotify-shared.ts'
import { utcNow } from './spotify-shared.ts'

export const SPOTIFY_SCOPES = 'playlist-modify-public playlist-modify-private user-read-private user-read-email ugc-image-upload'

/** Build the Spotify authorize URL the admin opens to connect their account. */
export function spotifyAuthUrl(params: { redirectUri: string }): { success: boolean; url: string } {
  const clientId = Deno.env.get('SPOTIFY_CLIENT_ID')
  if (!clientId) throw new Error('SPOTIFY_CLIENT_ID missing from env')
  if (!params.redirectUri) throw new Error('redirectUri required')
  const qs = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: params.redirectUri,
    scope: SPOTIFY_SCOPES, show_dialog: 'true',
  })
  return { success: true, url: `https://accounts.spotify.com/authorize?${qs}` }
}

/** Exchange the auth code for tokens and store them. */
export async function spotifyExchangeCode(supabase: SupabaseDB, params: { code: string; redirectUri: string }): Promise<any> {
  const clientId = Deno.env.get('SPOTIFY_CLIENT_ID')
  const clientSecret = Deno.env.get('SPOTIFY_CLIENT_SECRET')
  if (!clientId || !clientSecret) throw new Error('Spotify credentials missing from env')
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: params.code, redirect_uri: params.redirectUri }).toString(),
  })
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`)
  const tok = await res.json()

  let displayName = null, spotifyUser = null
  try {
    const me = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${tok.access_token}` } })
    if (me.ok) { const m = await me.json(); displayName = m.display_name; spotifyUser = m.id }
  } catch (_) { /* non-fatal */ }

  const { error } = await supabase.from('spotify_oauth').upsert({
    id: 'default', refresh_token: tok.refresh_token, access_token: tok.access_token,
    expires_at: new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString(),
    scope: tok.scope, display_name: displayName, spotify_user: spotifyUser, updated_at: utcNow(),
  }, { onConflict: 'id' })
  if (error) throw new Error(error.message)
  return { success: true, displayName, spotifyUser }
}

/** Get a valid user access token, refreshing if needed. */
export async function getUserAccessToken(supabase: SupabaseDB): Promise<{ token: string; userId: string }> {
  const { data } = await supabase.from('spotify_oauth').select('*').eq('id', 'default').maybeSingle()
  if (!data?.refresh_token) throw new Error('Spotify account not connected — connect it first.')
  if (data.access_token && data.expires_at && new Date(data.expires_at).getTime() > Date.now() + 60000) {
    return { token: data.access_token, userId: data.spotify_user }
  }
  const clientId = Deno.env.get('SPOTIFY_CLIENT_ID')
  const clientSecret = Deno.env.get('SPOTIFY_CLIENT_SECRET')
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: data.refresh_token }).toString(),
  })
  if (!res.ok) throw new Error('Token refresh failed — reconnect Spotify.')
  const tok = await res.json()
  await supabase.from('spotify_oauth').update({
    access_token: tok.access_token,
    expires_at: new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString(),
    updated_at: utcNow(),
  }).eq('id', 'default')
  return { token: tok.access_token, userId: data.spotify_user }
}

export async function getSpotifyConnection(supabase: SupabaseDB): Promise<any> {
  const { data } = await supabase.from('spotify_oauth').select('display_name, spotify_user, refresh_token').eq('id', 'default').maybeSingle()
  return { success: true, connected: !!data?.refresh_token, displayName: data?.display_name || null, spotifyUser: data?.spotify_user || null }
}

export async function disconnectSpotify(supabase: SupabaseDB): Promise<any> {
  await supabase.from('spotify_oauth').delete().eq('id', 'default')
  return { success: true }
}
