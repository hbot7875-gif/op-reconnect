# Op: Reconnect

A standalone streaming game. **Separate from the arirang / Mission Control site
in every layer** — separate frontend, separate build, separate backend,
separate database, separate accounts. Nothing is shared but the repo folder.

The old site is a team-battle season. This is not that: no teams, no weekly
checkpoints, no battles. One agent, one city, restored district by district.

## Layout

```
reconnect/
  index.html         the game
  botz.html          BOTZ — your listening page
  css/
    reconnect.css    the game's stylesheet
    botz-base.css    base styles the BOTZ page structure needs
  js/                ES modules (bundled by Vite)
  public/js/         CLASSIC scripts, copied through as-is — see below
  icons/  map/       own assets, not shared with the other site
  _*_preview.html    dev scratch pages, not shipped
```

### Why `public/js` exists

`botz.js`, `botz-api.js` and `concert-voyage.js` are plain scripts, not ES
modules. `botz.html` wires its buttons with inline `onclick=` handlers, which
can only reach functions on `window` — making it a module would break every
one of them. Vite can't bundle a non-module `<script src>`, so these live in
`public/` where it copies them through untouched. Move them into `js/` and
they'll silently 404 in the built output.

## Running it

```bash
npm run build:reconnect
```

Output lands in `reconnect/dist/`. Deploy that folder on its own.

For local work, serve this folder directly (`python -m http.server --directory
reconnect`) — but note the `public/js` paths only resolve in a Vite dev server
or in `dist/`, so verify anything touching BOTZ against a real build.

## Backend

Its own Supabase project: **`lcvmwlioqpyaprxicdfl`**, edge function
`op-reconnect` (source in `../supabase/functions/op-reconnect/`). The arirang
site's `arirang-btsbackend` on project `xyivyebbafqwthvlwzlm` is a different
deployment and shares no tables, no accounts and no agent numbers with this
one. An `AGENT042` here is not the `AGENT042` there.

Sessions are stored under the `rc_agent` localStorage key. The old site owns
`arirang_agent`; this project never touches it, and vice versa — signing into
one must never disturb the other.

## Known gaps

- **Playlist generation** (`generateAlpaca` / `previewAlpaca` /
  `getAlpacaOptions` in `js/candy-star.js`) has no backend equivalent yet. It
  needs real Spotify OAuth credentials. The calls resolve to a clear "not
  available" rather than reaching for the old backend, which would reject
  this game's agent numbers anyway.
- **BOTZ aggregate views** — all-time totals, top tracks/albums/members,
  streaks, per-album breakdowns — need a rollup action on `op-reconnect` that
  reads `rc_daily_activity`. Until then `public/js/botz-api.js` serves the
  live parts from `getSignalLog` (now playing, last 24h) and reports the rest
  as unavailable instead of showing numbers that aren't real.
- **Cross-links** to the arirang site: if the two ever end up on different
  domains, any link between them needs an absolute URL. There are currently
  none left pointing out of this folder.
