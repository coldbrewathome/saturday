# Roadmap

_Last updated: 2026-05-29_ (tick 33)

## Now
_In flight — actively being worked on. Keep this to 1–3 items._

_Nothing in flight. Pull the top of **Next** when ready._

## Next
_Committed, not yet started. Ordered by priority. Aim for ≤5 items._

## Later
_Candidates and ideas. Unordered. No commitment._

- **Weekend reminder push (Fri-AM "your weekend is set")** — retention play that pairs sign-in (`1d3ae14`) with Hop-me-now; depends on PWA shipping first. _Effort: M (after PWA)._
- **Interest-theme polish (post Phase 2)** — the personalization core shipped (saved interests + "For you" view). Remaining nice-to-haves: cross-device interest sync via sign-in (currently localStorage-only); lower the ~30% no-theme classifier rate; add a real "Sports & active" data source (thin today); window the app chip counts to the visible set so a count can be shown without the metro-wide vs near-term mismatch; a relevance *re-sort* (boost preferred-theme events) rather than just the For-you filter. _Effort: M._
- **NightHop content/parity audit** — `deploy:adults` and the `audiences` arrays exist, but it's unclear how much adult-specific surface there is vs. just filtered kid data. _Effort: S audit → L close gaps._
- **Repo cleanup: root-level screenshots + tracked drift** — ~35 PNG screenshots at repo root, plus ~50 files of routine event-data drift in the working tree. _Effort: XS._
- **Newsletter: activate live sends** — code is shipped; needs Resend account creation, DNS verification of `famhop.com`, `RESEND_API_KEY` + `NEWSLETTER_ADMIN_TOKEN` wrangler secrets, then a real test send to an operator address with Gmail + Apple Mail QA. Pure ops work, not a code task — promote back to Now only once the human has completed the external setup.

## Done
_Recently shipped (last ~10 items). Older items live in [CHANGELOG.md](CHANGELOG.md)._

- 2026-05-29 · **UI/component test foundation** — stood up React component testing (`jsdom` + `@testing-library/react`/`jest-dom`, vitest `test` config in `vite.config.ts` + `tests/setup.ts` localStorage shim for the Node-22/jsdom Web Storage clash). +29 tests (242 total): `eventThemes.mjs` classifier, `installPrompt.ts` gating, `auth.ts` sessions, `InstallBanner.tsx` (RTL), and a taxonomy drift guard (`eventThemes.ts` ↔ `.mjs`). **Caught a real bug:** the classifier's `/\b(…)\b/` patterns defeated word-start stemming, so "musical"/"birding"/"painting" were missed and the `scien` stem matched nothing (STEM under-counted). Fixed → no-theme rate 30%→24% (Bay Area), re-backfilled all metros, redeployed.
- 2026-05-29 · **Interest-theme personalization (Phase 2)** — saved interests (cross-metro, `localStorage` `famhop:interests`) + a "✨ For you" view that filters the weekend to events matching the user's chosen interests. First "For you" tap opens an interests picker; thereafter it toggles the filter directly, with an "Edit interests" affordance. Verified: pick → persist across reload → filter (1234→134). App-only (personalization can't apply to static SEO pages). Remaining polish (cross-device sync, re-sort, classifier tuning) tracked in Later.
- 2026-05-29 · **Interest-theme grouping for weekend events (Phase 1)** — 8-theme rule-based classifier (`scripts/eventThemes.mjs`) over category+title+description, wired into `buildEventsDataset` so every scan tags; backfilled `themes[]` into 13,721 events across all metros. App: "Browse by interest" chip band in the filter sidebar (filters the event list). SEO: `this-weekend/` pages get taxonomy-driven "Browse by interest" sections replacing the 3 hard-coded buckets. Splits the venue-type `category` skew (77% "Library") into interest entry points. Shipped to data feed + both apps; verified live on famhop.com. Phase 2 (personalization) in Later.
- 2026-05-28 · **PWA: install + offline weekend cache** — ADR 05; `vite-plugin-pwa` SW with runtime caching (events/featured-plans SWR 6h, spots SWR 30d, tiles/imagery CacheFirst 30d) + SPA shell fallback; mobile install banner (`InstallBanner.tsx` + `installPrompt.ts`) with native prompt on Android/desktop and iOS A2HS tutorial, per-origin gating; QA checklist in `docs/pwa-qa-checklist.md`. Deployed to both apps. (`offline.html` for unvisited metros + NightHop-branded icons deferred.)
- 2026-05-26 · **Event detail pages (shareable, SEO-indexed)** — ADR 04 (slug strategy + ended-event noindex stubs), stable `slug` field on event records w/ CI audit, `EventDetailView` at `#/event/<metro>/<slug>`, JSON-LD `Event` + OG meta on the SPA hash route, sitemap inclusion + slug-history aliases, and "View details" links from event cards across weekend guide + plan-share surfaces (`92f30f6`).
- 2026-05-25 · **Analytics dashboard for funnel metrics** — `/ops/analytics` route (ADR 03 scope/storage/auth), `src/ops/loadAnalytics.ts` + worker `/metrics` `byMetro` aggregation, top funnel summary cards w/ 7-day delta, per-metro app-opens breakdown table linking to metro guides, and a 30-day inline-SVG sparkline for the headline metric with sessionStorage caching for <500ms loads (`45a7b06`).
- 2026-05-25 · **Operator-alerts triage UI** — `/ops/alerts` route with ADR-02 surface decision, alerts loader (`src/ops/loadAlerts.ts`), triage table sorted by severity, severity+metro filters with URL state, per-source snooze action (`data/alert-snoozes.json` + pipeline annotation), snooze-helper unit tests, and a top-of-page summary with link-jump to the critical filter (`79a54db`).
- 2026-05-24 · **Newsletter delivery (code-complete)** — Resend provider chosen (ADR 01), capture path inventoried, `worker/src/newsletter.ts` scaffolded behind `NEWSLETTER_ADMIN_TOKEN`, Resend HTTP wired, digest HTML+text template w/ unit tests, dry-run preview CLI, per-metro fetch+render in `sendWeekendDigest`, operator-test allowlist + runbook. Activation (Resend account, DNS, secrets, mail-client QA) is external ops work tracked in Later.
- 2026-05-22 · **Agentic event ops workflow** — automated event ops + source repair agents.
- 2026-05-22 · **Newsletter capture card** — sign-in prompt + newsletter card on plans view.

_Older items in [CHANGELOG.md](CHANGELOG.md)._
