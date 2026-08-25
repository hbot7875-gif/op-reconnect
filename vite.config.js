// Op: Reconnect builds on its own.
//
// This game is a separate deployment from the arirang/Mission Control site —
// separate Supabase project, separate accounts, separate front door. It has
// no business being bundled into that site's dist/ alongside eight unrelated
// pages, so it gets its own root, its own inputs and its own output.
//
// Build it with:  npm run build:reconnect   (output: reconnect/dist)
//
// The _*_preview.html files are dev scratch pages for the scene/landmark
// generators and are deliberately NOT inputs — they're for local work, not
// for shipping.
//
// public/js holds the three CLASSIC (non-module) scripts. They live there so
// Vite copies them through untouched instead of trying to bundle them and
// leaving a dead <script src> in dist. botz.js especially must stay classic:
// botz.html wires its buttons with inline onclick= handlers, which can only
// see functions on window — module scope would break every one of them.

import { resolve } from 'path'
import { copyFileSync, mkdirSync, readFileSync } from 'fs'
import { defineConfig } from 'vite'

function copyOcrRuntime() {
  const files = new Map([
    ['/ocr/worker.min.js', [resolve(__dirname, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'), 'text/javascript']],
    ['/ocr/lang/eng.traineddata.gz', [resolve(__dirname, 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'), 'application/gzip']],
    ...[
      'tesseract-core.wasm.js',
      'tesseract-core-simd.wasm.js',
      'tesseract-core-lstm.wasm.js',
      'tesseract-core-simd-lstm.wasm.js',
    ].map((name) => [`/ocr/core/${name}`, [resolve(__dirname, 'node_modules', 'tesseract.js-core', name), 'text/javascript']]),
  ])
  return {
    name: 'copy-self-hosted-ocr-runtime',
    configureServer(server) {
      // Keep local playtests on the same self-hosted paths production uses.
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url || '/', 'http://localhost').pathname
        const asset = files.get(pathname)
        if (!asset) return next()
        response.setHeader('Content-Type', asset[1])
        response.end(readFileSync(asset[0]))
      })
    },
    closeBundle() {
      const ocrRoot = resolve(__dirname, 'dist', 'ocr')
      const coreRoot = resolve(ocrRoot, 'core')
      const langRoot = resolve(ocrRoot, 'lang')
      mkdirSync(coreRoot, { recursive: true })
      mkdirSync(langRoot, { recursive: true })

      copyFileSync(
        resolve(__dirname, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'),
        resolve(ocrRoot, 'worker.min.js'),
      )
      for (const name of [
        'tesseract-core.wasm.js',
        'tesseract-core-simd.wasm.js',
        'tesseract-core-lstm.wasm.js',
        'tesseract-core-simd-lstm.wasm.js',
      ]) {
        copyFileSync(
          resolve(__dirname, 'node_modules', 'tesseract.js-core', name),
          resolve(coreRoot, name),
        )
      }
      copyFileSync(
        resolve(__dirname, 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'),
        resolve(langRoot, 'eng.traineddata.gz'),
      )
    },
  }
}

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [copyOcrRuntime()],
  server: {
    // Respect an assigned PORT (e.g. the harness's autoPort) instead of
    // always claiming 5173 — otherwise two dev servers can't run side by
    // side on the same machine.
    port: Number(process.env.PORT) || 5173,
  },
  build: {
    sourcemap: false,
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // index = the public landing page; game = the game itself.
        index: resolve(__dirname, 'index.html'),
        game: resolve(__dirname, 'game.html'),
        botz: resolve(__dirname, 'botz.html'),
        // Site-owner-only tool (catalog refresh, Spotify connect) — added
        // when candy-star-admin.html was written, but never added HERE, so
        // it silently 404'd on every deploy despite building/deploying
        // clean otherwise. Not linked from anywhere in-game on purpose.
        candyAdmin: resolve(__dirname, 'candy-star-admin.html'),
        // Site-owner-only tool (Red Zone, broadcasts, agent lookup) — same
        // 'must be registered here or it silently 404s' lesson candyAdmin's
        // own comment above already documents. Not linked from anywhere
        // in-game on purpose.
        admin: resolve(__dirname, 'admin.html'),
        // Badge Vault — upload/crop badge photos. Unlike the two above it is
        // NOT SYNC_ADMIN_KEY-gated: it authorises per agent number against
        // rc_config.badge_editors, so trusted members can add badges without
        // holding the admin key. Registered here for the same reason those
        // two comments spell out — omit it and it 404s on every deploy.
        badgeAdmin: resolve(__dirname, 'badge-admin.html'),
        // Mobile Web Scrobbler walkthrough — same 'register here or it
        // 404s' lesson as the three above. Unlike them, this one IS meant
        // to be linked in-game (Settings → Scrobbler PIN).
        scrobblerMobile: resolve(__dirname, 'scrobbler-mobile.html'),
      },
    },
  },
})
