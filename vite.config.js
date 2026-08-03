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
import { defineConfig } from 'vite'

export default defineConfig({
  root: __dirname,
  base: './',
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
      },
    },
  },
})
