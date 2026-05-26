# ADR 05: PWA — Install + Offline Weekend Cache

- **Status:** Accepted
- **Date:** 2026-05-26
- **Decider:** Doer agent (kning to confirm)

## Context

The roadmap item "PWA / install + offline weekend cache" calls out
that scaffolding is half-present:

- `public/manifest.webmanifest` exists and is linked from
  `index.html:18`, but its `icons` array only references
  `/favicon.svg` (`size: any`, `purpose: any | maskable`). Chrome's
  installability check requires a raster icon ≥ 192×192, so
  installability is **broken** today even though the manifest is
  served.
- `public/icon-192.png` and `public/icon-512.png` are committed but
  **not referenced** by the manifest. `apple-touch-icon.png` is
  referenced from `<head>` (180×180) but not from the manifest.
- No service worker is registered. `grep -r serviceWorker src/`
  returns nothing.
- The repo builds with Vite 8 (`vite.config.ts`), and the kids and
  adults sibling apps share `src/App.tsx` + the same data feed,
  diverging only via `VITE_APP_AUDIENCE` / `VITE_APP_BRAND` env vars
  at build time. They deploy to **separate** Cloudflare Pages
  projects (`saturday-spots` aka famhop.com; `nighthop` aka
  nighthop.pages.dev).
- Data feed sizes per metro (Atlanta, representative):
  `events.json` 283 KB, `events-adults.json` 269 KB,
  `featured-plans.json` 11 KB, `featured-plans-adults.json` 20 KB,
  `spots.json` 2.7 MB, `spots-adults.json` 2.7 MB.

This ADR answers five questions before any implementation:

(a) **Caching strategy** — what gets cached, at what TTL, with which
    Workbox strategy.
(b) **Service worker library** — Workbox (via `vite-plugin-pwa`) vs.
    hand-rolled.
(c) **Install-prompt UX** — when/where to surface, and how dismissal
    persists.
(d) **Offline fallback** — what the user sees when offline on a route
    they haven't visited.
(e) **Scope boundary** — kids app only, or both kids + adults.

## (a) Caching strategy

### Asset classes

| Class | Examples | Strategy | TTL / max entries |
| --- | --- | --- | --- |
| App shell (HTML) | `/index.html`, prerendered `/<metro>/`, `/<metro>/spot/<slug>/`, `/<metro>/event/<slug>/` | `NetworkFirst` (3s timeout → cache) | 7 days, 200 entries |
| JS / CSS bundles | `/assets/*.js`, `/assets/*.css` (Vite-hashed) | Precache (workbox auto) | Lifetime of build (hashed filenames are immutable) |
| Manifest + icons | `/manifest.webmanifest`, `/favicon*.{svg,png}`, `/icon-*.png`, `/apple-touch-icon.png`, `/og-image.png` | Precache | Lifetime of build |
| Per-metro JSON (current weekend) | `/data/<metro>/events.json`, `/data/<metro>/featured-plans.json`, `/data/<metro>/events-adults.json`, `/data/<metro>/featured-plans-adults.json` | `StaleWhileRevalidate` | **6 hours**, 60 entries |
| Per-metro spot catalog | `/data/<metro>/spots.json`, `/data/<metro>/spots-adults.json` | `StaleWhileRevalidate` | **30 days**, 30 entries (the catalog churns slowly; aggressive caching is fine) |
| Ops + report JSON | `/data/<metro>/event-build-report.json`, `/data/<metro>/event-operator-alerts.json`, `/data/<metro>/*-enrichment.json`, anything matched by the ops routes | **No caching** (`NetworkOnly`) | n/a — these are operator-facing, freshness matters |
| Map tiles | `https://a.tile.openstreetmap.org/...`, `commons.wikimedia.org`, `images.unsplash.com` | `CacheFirst` | 30 days, 200 entries (size-capped) |
| Worker API | `https://saturday-polls.santaclararental2016.workers.dev/*`, `https://accounts.google.com/*` | `NetworkOnly` (do not cache auth or polls state) | n/a |

### Why these TTLs

- **6 hours for `events.json`** — the event pipeline runs on a manual
  cadence (last refresh `66b8dcf` was pre-Memorial-Day, and weekly
  refreshes are normal). Six hours is short enough that a user
  re-opening the app on a single weekend never sees stale data more
  than once, and `StaleWhileRevalidate` means even if the cache hits,
  the background fetch repairs it for the next view. Picking 24h
  would risk a parent seeing Friday's stale event list at Saturday
  brunch.
- **30 days for `spots.json`** — spots are a curated catalog
  (`scripts/build-curated-spots.mjs`, see ADR 04), not a weekly
  refresh artifact. The file is 2.7 MB; we **want** the second visit
  to skip re-downloading it. SWR with a long TTL is correct.
- **App shell `NetworkFirst` with 3s timeout** — the prerendered SEO
  pages encode title/meta/JSON-LD that has to stay fresh for shares;
  fall back to cache only if network is slow or offline.
- **Precache JS/CSS** — Vite emits hashed filenames, so the SW
  precache entries roll over cleanly on each deploy. `workbox-build`'s
  injectManifest mode handles this automatically.

### Cache versioning

`workbox-precaching` uses a build-time manifest of `{ url, revision }`
tuples. Each `vite build` regenerates the manifest with new hashes;
old entries are evicted on SW activation via
`cleanupOutdatedCaches: true`. Runtime caches (the per-metro JSON,
map tiles, etc.) get versioned cache names — `famhop-events-v1`,
`famhop-spots-v1` — so a future ADR can bump the version to force a
purge without touching user devices' precache.

### Cache exclusions

The SW **never** caches:
- Anything under `/api/` (newsletter, ops endpoints).
- The polls worker (`saturday-polls.santaclararental2016.workers.dev`).
- Google Identity (`accounts.google.com`, `apis.google.com`) — auth
  flows must always be live.
- Any URL with `?nocache=1` in the query (escape hatch for ops debugging).

## (b) Service worker library

### Option B1: hand-rolled `sw.js`
- **Pro:** zero new dependency. Total control.
- **Con:** we'd reinvent Workbox's precache-revision manifest, the
  route registry, the strategy implementations, and the cleanup of
  stale precache entries. A non-trivial weekend of work that we'd
  then own forever. The strategies above (`StaleWhileRevalidate`,
  `NetworkFirst` with timeout, `CacheFirst` with expiration) are
  exactly the Workbox catalog.
- **Verdict:** Reject.

### Option B2: `vite-plugin-pwa` (Workbox under the hood) — **chosen**
- **Pro:** designed for the Vite build pipeline we already have.
  Generates the SW at build time, injects the precache manifest with
  the hashed asset list, supports `injectManifest` mode if we
  outgrow the declarative `generateSW` mode. Ships Workbox as a
  transitive dependency, no extra config beyond `vite.config.ts`.
  Battle-tested; this is the default for Vite PWAs.
- **Con:** one new dev dependency (`vite-plugin-pwa` +
  `workbox-*` transitive). Adds ~50KB to the production SW (Workbox
  runtime), which is fine — the SW runs out-of-band.
- **Verdict:** Accept. Use `generateSW` mode for v1; revisit
  `injectManifest` only if we need custom SW logic (e.g. background
  sync, push) that the declarative config can't express.

### Option B3: Cloudflare Workers
- **Pro:** Cloudflare-native.
- **Con:** category error — service workers are a browser API, not a
  Cloudflare Worker. Listed only to close the question.
- **Verdict:** Reject.

### Concretely

- Add `vite-plugin-pwa` as a `devDependency`.
- In `vite.config.ts`, register `VitePWA({ registerType: 'autoUpdate', ... })`.
  Drop the workbox runtime-cache config inline (the table above
  becomes the `workbox.runtimeCaching` array).
- The plugin writes `dist/sw.js` and `dist/registerSW.js`. The latter
  is auto-imported via the injected `<script>` tag.
- Register only in production: gate behind `import.meta.env.PROD` in
  `src/main.tsx`. Dev gets no SW so HMR isn't disrupted.
- Manifest: **the plugin can own `manifest.webmanifest`**. Move the
  config from the static file into `VitePWA({ manifest: { ... } })`,
  delete `public/manifest.webmanifest`, and let the plugin emit it
  with the correct PNG icon entries baked in. This also gives us a
  single source of truth for kids vs. adults manifests (driven by
  `env.VITE_APP_AUDIENCE`, mirroring `audienceJsonLdPlugin` in
  `vite.config.ts`).

## (c) Install-prompt UX

### When to surface

- **Desktop Chrome + Android Chrome:** capture the
  `beforeinstallprompt` event in `src/main.tsx`, stash the deferred
  prompt in a module-level variable, and **suppress** the browser
  mini-infobar (`event.preventDefault()`). Surface our own affordance.
- **iOS Safari:** does not fire `beforeinstallprompt`. We render the
  same affordance, but tapping it opens a one-screen modal with
  "Tap the Share button, then Add to Home Screen" instructions.
  Detect iOS via `navigator.userAgent` (acceptable here — we only
  need a UX hint, not a security boundary).

### Where to surface

A single dismissable banner in the metro-guide header, right above
the mobile FAB (`9754dda` pattern). Banner copy:

> Add FamHop to your home screen for one-tap weekend planning.

Two buttons: **Install** (or **Show me how** on iOS) and **Not now**.

### Gating rules

Show the banner only if **all** of:
1. The user has visited at least 2 distinct sessions (counted in
   `localStorage` under `famhop:visits`). First-visit users get the
   experience first, install ask second.
2. The browser dispatched `beforeinstallprompt` (Android/desktop) **or**
   the UA is iOS Safari (`/iP(hone|ad|od)/.test(ua) && /Safari/.test(ua)`).
3. The app is **not** running in standalone mode
   (`matchMedia('(display-mode: standalone)').matches === false`).
4. The user has not dismissed it in the last **30 days**
   (`localStorage` key `famhop:install:dismissedAt`, ISO timestamp).
5. The user is not on an `/ops/*` route.

### Dismiss semantics

"Not now" sets `famhop:install:dismissedAt = Date.now()` and hides
the banner for 30 days. There is no "Never show again" — re-prompting
every 30 days is the right cadence for retention without being
annoying. Installing (Android/desktop path) sets
`famhop:install:installed = true` and stops showing the banner
permanently for that origin.

The keys are per-origin, so famhop.com and nighthop.pages.dev count
separately (correct — they're different installable apps).

## (d) Offline fallback

When the SW is active and the network is offline, three cases:

1. **User visits a page they've cached** (any URL they've hit before
   while online — landing page, their home-metro guide, a spot they
   tapped, the events JSON for their metro). Served from cache via
   `StaleWhileRevalidate` or `NetworkFirst`. They see the full page.

2. **User visits a page they have NOT cached** (e.g. a metro they've
   never opened). The `NetworkFirst` strategy times out after 3s and
   falls back to the precached **offline fallback page** at
   `/offline.html`. Content:

   > **You're offline.**
   >
   > FamHop saved your weekend plans for {their last-visited metro,
   > read from localStorage at SW install time}. Tap below to open
   > your saved weekend.
   >
   > [ Open my saved weekend ]
   >
   > Reconnect to load other metros, search, or check in on sign-in.

   The page is plain HTML/CSS (no React), ~2 KB, precached. The
   "Open my saved weekend" link points to `/<lastMetro>/` which is
   itself cached.

3. **User visits an asset request** (JSON, image, tile) that's not
   cached. Network failure surfaces as a fetch reject; the app shell
   already handles fetch failures (renders a "couldn't load events"
   inline message). No SW work needed here beyond not interfering.

The offline page is generated at build time as a static asset
(`public/offline.html`, audience-aware via Vite mode) and listed in
the precache manifest by the plugin via
`workbox.navigateFallback: '/offline.html'`.

## (e) Scope boundary

**Both kids and adults get the PWA.** Reasoning:

- They ship from the same `App.tsx`, the same `main.tsx`, the same
  `vite.config.ts`. Branching SW registration on `VITE_APP_AUDIENCE`
  would be more code than just shipping both.
- They deploy to separate origins (famhop.com, nighthop.pages.dev),
  so the install state, SW registration, and caches are per-origin
  by browser rules. No interference.
- Manifest content **does** differ (different name, theme color,
  icons). The Vite plugin generates the right one per build mode via
  the `VitePWA({ manifest })` argument reading `env.VITE_APP_*`,
  mirroring how `audienceJsonLdPlugin` already swaps the JSON-LD
  block.

### Per-audience manifest values

| Field | Kids (`VITE_APP_AUDIENCE=kids`) | Adults (`VITE_APP_AUDIENCE=adults`) |
| --- | --- | --- |
| `name` | "FamHop — family weekend planner by metro" | "NightHop — nightlife & night-out planner" |
| `short_name` | "FamHop" | "NightHop" |
| `theme_color` | `#ff6b5b` (existing) | `#7c3aed` (matches `.env.adults`) |
| `background_color` | `#FFF6EE` (existing) | `#0c0a1f` (dark, matches adults palette) |
| `start_url` | `/` | `/` |
| `categories` | `["lifestyle","travel","kids"]` | `["lifestyle","entertainment","social"]` |
| `icons` | `/icon-192.png` (any), `/icon-512.png` (any), `/icon-512.png` (maskable), `/favicon.svg` (any) | same shape, eventual NightHop-branded PNGs (TODO: NightHop icons currently reuse FamHop PNGs; ship the kids fix now, file follow-up for an adults-branded `icon-*-adults.png` set) |

Note: an icon-set ADR is **not** in scope here — we're shipping the
PWA with the assets that exist. The follow-up icon work is called
out in Consequences.

## Decision summary

| Question | Answer |
| --- | --- |
| Caching strategy | `StaleWhileRevalidate` for per-metro JSON (6h events, 30d spots), `NetworkFirst` for HTML (3s timeout), precache for hashed JS/CSS + manifest + icons, `CacheFirst` for map tiles (30d), `NetworkOnly` for polls/auth/ops endpoints. |
| SW library | `vite-plugin-pwa` (Workbox `generateSW` mode). Plugin owns `manifest.webmanifest` going forward; static file in `public/` is deleted. |
| Install UX | Custom banner above the mobile FAB on metro guides. Gated on ≥2 sessions, not-standalone, not-dismissed-30d, not-on-/ops. iOS gets a "Share → Add to Home Screen" tutorial modal. Dismiss persists 30d in `localStorage`. |
| Offline fallback | Cached pages render normally. Uncached navigations get `/offline.html` (precached, ~2 KB, plain HTML) with a "Open my last-visited metro" deep link. |
| Scope | Both kids and adults. Plugin reads `VITE_APP_AUDIENCE` at build time to swap manifest fields. |
| New artifacts | `public/offline.html` (precached fallback), `vite.config.ts` PWA config, deleted `public/manifest.webmanifest` (moved into plugin config). |

## Consequences

- **Next task** ("Fix the manifest to be actually installable") is
  now scoped to: add PNG icon entries via the new
  `VitePWA({ manifest })` block, delete `public/manifest.webmanifest`,
  verify Lighthouse PWA audit passes. Note that adopting the plugin
  here changes the manifest source-of-truth from a static file to a
  Vite-emitted artifact; if the Doer wants to ship the manifest fix
  before the SW (smaller diff), they can edit the static file in
  place and migrate to the plugin in the next task. The ADR allows
  either ordering.
- **SW task** scopes to: add `vite-plugin-pwa` devDep, configure
  `VitePWA(...)` in `vite.config.ts` with the runtime-caching table
  above, gate registration behind `import.meta.env.PROD` in
  `main.tsx`, create `public/offline.html`. No source changes to
  `App.tsx` or component files.
- **Install-prompt task** scopes to: a single new component
  (`InstallBanner.tsx`) mounted from `App.tsx` on metro-guide views
  only, plus the `beforeinstallprompt` capture logic in `main.tsx`.
- **NightHop icon follow-up:** the adults manifest will reference
  FamHop-branded PNGs until purpose-built ones land. Acceptable for
  v1 (NightHop is on `*.pages.dev`, not a marketed domain yet); track
  as a Later item.
- **No new infra, no new secrets, no new SaaS.** `vite-plugin-pwa` is
  a build-time-only devDep; the SW it emits is a static asset served
  by Cloudflare Pages exactly like the rest of `dist/`.
- **Bundle size:** Workbox runtime adds ~50 KB to the SW (not the
  main app bundle). Acceptable.
- **Test impact:** SW tests are deferred — the existing
  `npm test` covers planner + pipeline logic, none of which the SW
  touches. The PWA roadmap item's last task explicitly asks for a
  manual QA checklist across iOS/Android/desktop, which is the right
  shape of validation here.

## Rollback

The SW can be killed by removing the `VitePWA` plugin from
`vite.config.ts` and pushing a build. Browsers that already
registered the old SW need an explicit unregister to clear cached
assets — add a one-line `kill switch` SW that immediately calls
`self.registration.unregister()` and `clients.claim()`, ship it as
the new `sw.js`, and existing installs self-clean on next visit.
The install banner is a single component and is deletable. The
offline fallback page is a static HTML file with no other dependencies.
