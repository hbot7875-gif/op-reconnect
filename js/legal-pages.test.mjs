// The five trust pages, checked as artefacts rather than as prose.
//
// Three things here have bitten this repo before or would be worst to get
// wrong: a page that is not registered in vite.config.js 404s on deploy (the
// config's own comments record that happening twice), a footer link that
// points at a page which does not exist is worse than no link, and a
// placeholder contact address reaching production would send privacy and
// takedown requests into a void.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const PAGES = ['terms', 'privacy', 'about', 'copyright', 'credits', 'contact']
const CONTACT = 'hopetrackervault@gmail.com'
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
// A migration moves from pending/ to migrations/ the moment it is applied.
// Look in both so these checks keep working either side of a deployment.
const readAny = (candidates) => {
  for (const f of candidates) {
    try { return read(f) } catch { /* try the next */ }
  }
  throw new Error(`none of these exist: ${candidates.join(', ')}`)
}
const readMigration = (name) => {
  for (const dir of ['migrations', 'pending']) {
    try { return read(`supabase/${dir}/${name}`) } catch { /* try the next */ }
  }
  throw new Error(`${name} is in neither supabase/migrations/ nor supabase/pending/`)
}
const html = Object.fromEntries(PAGES.map((p) => [p, read(`${p}.html`)]))

test('every page exists and is registered as a build input', () => {
  const config = read('vite.config.js')
  for (const p of PAGES) {
    assert.ok(existsSync(new URL(`../${p}.html`, import.meta.url)), `${p}.html missing`)
    assert.match(config, new RegExp(`resolve\\(__dirname, '${p}\\.html'\\)`), `${p}.html not a build input — it would 404 on deploy`)
  }
})

test('every page carries the unofficial fan-project disclaimer', () => {
  for (const p of PAGES) {
    assert.match(html[p], /unofficial fan project/i, p)
    assert.match(html[p], /BIGHIT MUSIC/, p)
    assert.match(html[p], /HYBE/, p)
  }
})

test('the landing page carries it too, and links all five', () => {
  const index = read('index.html')
  assert.match(index, /unofficial fan project/i)
  for (const p of PAGES) assert.match(index, new RegExp(`href="${p}\\.html"`), `index.html does not link ${p}`)
})

test('every footer link points at a page that exists', () => {
  for (const p of PAGES) {
    const hrefs = [...html[p].matchAll(/href="([a-z-]+)\.html"/g)].map((m) => m[1])
    for (const target of new Set(hrefs)) {
      assert.ok(existsSync(new URL(`../${target}.html`, import.meta.url)), `${p}.html links ${target}.html, which does not exist`)
    }
  }
})

test('no placeholder or default address survives anywhere', () => {
  // hq@yourdomain.com is a literal placeholder in the codebase and
  // onboarding@resend.dev is Resend's shared sender. Neither is reachable.
  for (const p of PAGES) {
    assert.doesNotMatch(html[p], /yourdomain\.com/, p)
    assert.doesNotMatch(html[p], /resend\.dev/, p)
    assert.doesNotMatch(html[p], /example\.(com|org)/, p)
  }
})

test('the pages that invite contact give the real address', () => {
  for (const p of ['terms', 'privacy', 'copyright', 'contact', 'about']) {
    assert.ok(html[p].includes(CONTACT), `${p}.html does not carry the contact address`)
  }
})

test('no page loads a third-party font or the game bundle', () => {
  // Someone reading the privacy policy should not have their IP handed to
  // Google to do it, and none of these pages needs the game to render.
  for (const p of PAGES) {
    assert.doesNotMatch(html[p], /fonts\.(googleapis|gstatic)\.com/, p)
    assert.doesNotMatch(html[p], /<script/, `${p}.html should need no script at all`)
  }
})

test('the pages are published: no draft banner, and indexable', () => {
  // These were drafts until the owner approved publication. Both the banner and
  // the noindex had to go together -- a page that is indexable while still
  // showing "DRAFT - not yet reviewed" is the worst of both.
  for (const p of PAGES) {
    assert.doesNotMatch(html[p], /legal-draft/, `${p}.html still shows the DRAFT banner`)
    assert.doesNotMatch(html[p], /DRAFT &mdash; not yet reviewed|DRAFT - not yet reviewed/,
      `${p}.html still carries the draft notice`)
    assert.doesNotMatch(html[p], /content="noindex"/, `${p}.html is still noindex`)
    // The canonical must name the EXTENSIONLESS URL. Cloudflare Static Assets
    // 307-redirects /privacy.html to /privacy by default (the same redirect
    // that broke the Spotify callback earlier), so a .html canonical would
    // point at a URL that immediately redirects away from itself.
    assert.match(html[p], new RegExp(`<link rel="canonical" href="https://hopetrackers\.org/${p}">`),
      `${p}.html canonical is missing or not the extensionless form`)
    assert.doesNotMatch(html[p], /rel="canonical" href="[^"]*\.html"/,
      `${p}.html still has a .html canonical`)
  }
})

test('the Privacy Policy still flags its one unwritten section', () => {
  // The minimum age is an open decision; publishing with the placeholder
  // still in it would ship a visible "[DRAFT — ...]" to players.
  assert.match(html.privacy, /<h2>Children<\/h2>/)
  // Written as of the approved revision. It must stay factual: no minimum age,
  // no verification, no consent mechanism -- none of which exist in the product.
  assert.match(html.privacy, /does not ask for your age or date of birth/)
  assert.match(html.privacy, /no age-verification system/)
  assert.match(html.privacy, /parent or guardian/)
  assert.doesNotMatch(html.privacy, /minimum age|verify your age|parental consent/i,
    'the Children section must not claim an age rule or consent flow that does not exist')
})

test('the retention promises match what the migration actually does', () => {
  // Stage 2A installs the machinery; Stage 2B starts it on a timer. The 30-day
  // figure therefore appears in two places and must agree in both, or the
  // pages promise a window nothing enforces.
  const machinery = readMigration('20260928060000_rc_privacy_retention.sql')
  // Stage 2B moved from pending/ to migrations/ when it was deployed, and was
  // renamed in the process. Resolve it either way rather than pinning a path
  // that a deployment invalidates.
  const schedules = readAny([
    'supabase/migrations/20260928080000_rc_privacy_retention_schedules.sql',
    'supabase/pending/STAGE2B_rc_privacy_retention_schedules.sql',
  ])

  // 2A defines the retention windows as defaults...
  assert.match(machinery, /p_days integer default 30/)
  // ...and 2B is what actually invokes them, with the same number.
  assert.match(schedules, /rc_purge_deleted_agent_log\(30\)/)
  assert.match(schedules, /rc_queue_expired_vote_proofs\('vma_2026', 30\)/)

  // 2A must schedule nothing — that is the whole point of the split.
  assert.doesNotMatch(machinery, /cron\.schedule/, 'Stage 2A must not schedule anything')

  assert.match(html.privacy, /Identifying details in it are removed after 30 days/)
  assert.match(html.privacy, /deleted 30 days after the event they belong to ends/)
  assert.match(html.terms, /you do not play for <strong>14 days<\/strong>/)
})

test('the ownership notice appears in full and in short', () => {
  const NOTICE = /(?:©|&copy;) 2026 HopeTrackers\. Original game artwork, written stories, original website code and other original content created for HopeTrackers are protected by applicable copyright law, subject to third-party rights\./
  assert.match(html.copyright, NOTICE)
})

test('the ownership notice claims no trademark and no rights over mechanics', () => {
  // Overclaiming here is worse than underclaiming: it invites a fight this
  // project cannot win and does not want.
  assert.match(html.copyright, /aren(?:&rsquo;|')t ours to own/)
  for (const p of PAGES) assert.doesNotMatch(html[p], /™|\(R\)|registered trademark of/i, p)
})

test('the three kinds of content stay distinguished', () => {
  // BTS material, images added to the game, and our own work must not blur
  // together — the ownership notice only means something against that split.
  // The split now lives on Credits, which is where attribution belongs.
  assert.match(html.credits, /By HopeTrackers/)
  assert.match(html.credits, /BTS-related material/)
  assert.match(html.credits, /Third-party software/)
  assert.match(html.credits, /Community/)
})

test('the pages do not describe HopeTrackers as a team', () => {
  // HopeTrackers is one person's project. Meta descriptions count — they are
  // what a search result or a link preview shows.
  for (const p of PAGES) {
    assert.doesNotMatch(html[p], /(?:our|the|a) team|staff|employees|volunteers|moderators/i, p)
  }
})

test('badge mechanics are explained only where retention requires it', () => {
  // Uploading is an operational detail, not a legal one. The single place it
  // belongs is where it explains why a photo survives an account deletion.
  assert.doesNotMatch(html.about, /badge artwork/i, 'About should not explain uploads')
  assert.doesNotMatch(html.copyright, /uploaded by players/i)
  assert.match(html.terms, /[Bb]adge photos you uploaded/, 'terms must explain what survives retirement')
  assert.match(html.privacy, /badge artwork you uploaded/i, 'privacy must explain what survives retirement')
})

test('the fan-project disclaimer survives alongside the ownership claim', () => {
  // Asserting copyright over your own work and disclaiming affiliation are
  // different statements; adding the first must never quietly drop the second.
  for (const p of ['copyright', 'about']) {
    assert.match(html[p], /unofficial fan project|not affiliated/i, p)
  }
})

test('retention exceptions are disclosed, not glossed', () => {
  // Badge art surviving, the 30-day log, and backups are all real exceptions
  // to "retiring deletes everything". Saying only the headline would be a lie.
  for (const p of ['terms', 'privacy']) {
    assert.match(html[p], /backups/i, `${p} does not mention backups`)
    assert.match(html[p], /30 days/, `${p} does not state the log window`)
  }
  assert.match(html.terms, /[Bb]adge photos you uploaded/, 'terms: badge art survival not disclosed')
  assert.match(html.privacy, /badge artwork you uploaded/i, 'privacy: badge art survival not disclosed')
})

test('the image fingerprint kept after proof deletion is disclosed', () => {
  assert.match(html.privacy, /fingerprint of the image/)
  assert.match(html.privacy, /stops the same screenshot being submitted twice/)
})

test('publication did not disturb the page furniture', () => {
  // Removing the banner is a surgical deletion: everything around it stays.
  for (const p of PAGES) {
    assert.match(html[p], /class="legal-wrap"/, `${p} lost its wrapper`)
    assert.match(html[p], /class="legal-top"/, `${p} lost its header`)
    assert.match(html[p], /class="legal-foot"/, `${p} lost its footer`)
    assert.match(html[p], /Back to the game/, `${p} lost its back link`)
    assert.match(html[p], /<h1>/, `${p} lost its heading`)
  }
})

test('backup retention is stated as the verified seven days, not hedged', () => {
  // Checked against the project's own backup list: 7 daily physical backups,
  // PITR disabled. A vague "short period" invites a reader to assume less.
  for (const p of ['terms', 'privacy']) assert.match(html[p], /seven days/, p)
})

test('the policy does not claim identifying data vanishes everywhere at 30 days', () => {
  // It cannot: backups hold it for up to seven more days and provider logs are
  // outside our control. Claiming otherwise would be the one flatly false
  // sentence in the document.
  assert.doesNotMatch(html.privacy, /nothing identifying remains after that/)
  assert.match(html.privacy, /Files are removed on an hourly cycle/)
  assert.match(html.privacy, /nothing identifying is left in the running game/)
})

test('Terms and Privacy agree that retiring deletes', () => {
  // These two sentences drifting apart is exactly how a policy becomes untrue.
  assert.match(html.terms, /Retiring permanently deletes your agent file and everything in it/)
  assert.match(html.privacy, /your personal data is permanently deleted/)
  const settings = read('supabase/functions/op-reconnect/lib/settings.ts')
  assert.match(settings, /rc_purge_agent_data/, 'retireAccount no longer purges — the pages would be lying')
})

test('the analytics claim is accurate: no third party, but our own records disclosed', () => {
  // privacy.html used to say "no analytics ... of any kind" while
  // js/engagement.js was sending game-usage events to our own backend. That
  // sentence was false. These exist so it cannot come back.
  assert.doesNotMatch(html.privacy, /no analytics, no advertising and no tracking of any kind/i,
    'the blanket "no analytics of any kind" claim is back, and it is false')
  for (const p of PAGES) {
    assert.doesNotMatch(html[p], /we use no analytics/i, p)
  }
  assert.match(html.privacy, /no third-party analytics, advertising or tracking services/)
  assert.match(html.privacy, /Limited game-usage records/)
  assert.match(html.privacy, /opening the app, opening a district, viewing a screen, building a queue/)

  // The disclosure must keep matching what the code actually sends.
  const engagement = read('js/engagement.js')
  assert.match(engagement, /sessionStorage/, 'engagement session id left sessionStorage')
  for (const field of ['eventType', 'screen', 'districtId', 'sessionId']) {
    assert.ok(engagement.includes(field), `engagement.js no longer sends ${field}`)
  }
})

test('third-party embeds and fonts are disclosed', () => {
  assert.match(html.privacy, /Google Fonts/)
  assert.match(html.privacy, /YouTube/)
  assert.match(html.privacy, /Spotify/)
  assert.match(html.privacy, /receive your IP address/)
})

test('the public badge-art bucket is disclosed as public', () => {
  assert.match(html.privacy, /stored in a <strong>public<\/strong> location/)
})

test('no page ships with an unfilled date placeholder', () => {
  // The last thing between these pages and publication. A policy dated
  // "[DATE ON PUBLICATION]" is worse than one with no date at all.
  for (const p of PAGES) {
    if (!/legal-updated/.test(html[p])) continue
    assert.doesNotMatch(html[p], /\[DATE ON PUBLICATION\]/,
      `${p}.html still has an unfilled "Last updated" date -- set it before deploying`)
  }
})
