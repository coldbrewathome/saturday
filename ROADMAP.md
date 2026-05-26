# Roadmap

_Last updated: 2026-05-26_ (tick 29)

## Now
_In flight — actively being worked on. Keep this to 1–3 items._

### PWA / install + offline weekend cache
- **Why:** Mobile-first weekend use case is the canonical PWA fit; the mobile FAB from `9754dda` shows the pattern is working. Unlocks the "Friday-AM weekend reminder push" Later item, which is blocked on PWA shipping. Manifest already exists at `public/manifest.webmanifest` and is linked from `index.html`, but no service worker is registered and PNG icons (`icon-192.png`, `icon-512.png`) exist on disk but aren't referenced — so installability is broken even though most of the scaffolding is there.
- **Effort:** M (1–2 days)
- **Links:** `public/manifest.webmanifest` (exists, SVG-only icons), `index.html:18` (manifest link), `public/icon-192.png` + `public/icon-512.png` (orphaned), `9754dda` (mobile FAB pattern)
- **Tasks:**
  - [x] Decide PWA scope + caching strategy. Write `docs/decisions/05-pwa-offline.md` covering: (a) what "offline weekend" means concretely — cache the current metro's `events.json` + `featured-plans.json` + spot detail JSON, or only the app shell?, (b) service worker library choice (Workbox vs. hand-rolled — repo already builds with Vite, so `vite-plugin-pwa` is the obvious default), (c) cache versioning + invalidation strategy (event data rotates weekly; need a `stale-while-revalidate` story that doesn't serve last-week's events), (d) install-prompt UX — passive (browser-driven) vs. an explicit "Install FamHop" button somewhere near the mobile FAB. <2h. _(dc5d887)_
  - [ ] Fix the manifest to be actually installable. Add the existing `icon-192.png` and `icon-512.png` PNG entries to `public/manifest.webmanifest` (Chrome's installability check requires a 192+ PNG), verify `start_url` and `scope` against current routing, and add a `display_override` if the ADR calls for it. Run Lighthouse PWA audit locally to confirm "Installable" passes.
  - [ ] Scaffold the service worker. Add `vite-plugin-pwa` (or chosen equivalent) to `vite.config.ts`, generate `sw.js` at build, register it from `src/main.tsx` behind a feature flag or a `import.meta.env.PROD` guard so dev isn't disrupted. Confirm SW shows up in DevTools → Application on a production build.
  - [ ] Implement the offline cache strategy from the ADR. At minimum: precache app shell + `manifest.webmanifest` + favicon assets; runtime-cache `public/data/<metro>/events.json` and `featured-plans.json` with the strategy chosen in step 1. Verify by loading a metro guide, going offline in DevTools, hard-reloading, and confirming the page still renders.
  - [ ] Add the install-prompt UX from the ADR. Capture the `beforeinstallprompt` event, stash it, and surface an explicit install affordance on mobile (likely near the existing FAB or in the header). Dismiss state should persist in `localStorage` so users aren't nagged.
  - [ ] Write a smoke test or document a manual QA checklist for PWA install across iOS Safari (Add to Home Screen), Android Chrome (install prompt), and desktop Chrome. iOS doesn't fire `beforeinstallprompt` so confirm the manifest alone gives a reasonable A2HS experience.

## Next
_Committed, not yet started. Ordered by priority. Aim for ≤5 items._

### Free-text search across spots + events
- **Why:** Current discovery is filter-only; a known ceiling for browse-style apps as the dataset grows.
- **Effort:** M

### UI/component tests
- **Why:** `tests/` covers pipeline + planner, but nothing exercises `App.tsx`, `auth.ts`, or the plans view; React refactors are unsafe.
- **Effort:** M

## Later
_Candidates and ideas. Unordered. No commitment._

- **Weekend reminder push (Fri-AM "your weekend is set")** — retention play that pairs sign-in (`1d3ae14`) with Hop-me-now; depends on PWA shipping first. _Effort: M (after PWA)._
- **NightHop content/parity audit** — `deploy:adults` and the `audiences` arrays exist, but it's unclear how much adult-specific surface there is vs. just filtered kid data. _Effort: S audit → L close gaps._
- **Repo cleanup: root-level screenshots + tracked drift** — ~35 PNG screenshots at repo root, plus ~50 files of routine event-data drift in the working tree. _Effort: XS._
- **Newsletter: activate live sends** — code is shipped; needs Resend account creation, DNS verification of `famhop.com`, `RESEND_API_KEY` + `NEWSLETTER_ADMIN_TOKEN` wrangler secrets, then a real test send to an operator address with Gmail + Apple Mail QA. Pure ops work, not a code task — promote back to Now only once the human has completed the external setup.

## Done
_Recently shipped (last ~10 items). Trim older ones into a separate CHANGELOG if needed._

- 2026-05-26 · **Event detail pages (shareable, SEO-indexed)** — ADR 04 (slug strategy + ended-event noindex stubs), stable `slug` field on event records w/ CI audit, `EventDetailView` at `#/event/<metro>/<slug>`, JSON-LD `Event` + OG meta on the SPA hash route, sitemap inclusion + slug-history aliases, and "View details" links from event cards across weekend guide + plan-share surfaces (`92f30f6`).
- 2026-05-25 · **Analytics dashboard for funnel metrics** — `/ops/analytics` route (ADR 03 scope/storage/auth), `src/ops/loadAnalytics.ts` + worker `/metrics` `byMetro` aggregation, top funnel summary cards w/ 7-day delta, per-metro app-opens breakdown table linking to metro guides, and a 30-day inline-SVG sparkline for the headline metric with sessionStorage caching for <500ms loads (`45a7b06`).
- 2026-05-25 · **Operator-alerts triage UI** — `/ops/alerts` route with ADR-02 surface decision, alerts loader (`src/ops/loadAlerts.ts`), triage table sorted by severity, severity+metro filters with URL state, per-source snooze action (`data/alert-snoozes.json` + pipeline annotation), snooze-helper unit tests, and a top-of-page summary with link-jump to the critical filter (`79a54db`).
- 2026-05-24 · **Newsletter delivery (code-complete)** — Resend provider chosen (ADR 01), capture path inventoried, `worker/src/newsletter.ts` scaffolded behind `NEWSLETTER_ADMIN_TOKEN`, Resend HTTP wired, digest HTML+text template w/ unit tests, dry-run preview CLI, per-metro fetch+render in `sendWeekendDigest`, operator-test allowlist + runbook. Activation (Resend account, DNS, secrets, mail-client QA) is external ops work tracked in Later.
- 2026-05-22 · **Agentic event ops workflow** — automated event ops + source repair agents.
- 2026-05-22 · **Newsletter capture card** — sign-in prompt + newsletter card on plans view.
- 2026-05-22 · **Stable spot slugs + SEO audit in CI** — legacy URL aliases preserved.
- 2026-05-22 · **Interactive Event Finder** — on weekend guide pages.
- 2026-05-19 · **Privacy-safe funnel metrics** — first-party measurement, no third-party trackers.
- 2026-05-19 · **Rich share previews** — weekend-guide event rich results.
