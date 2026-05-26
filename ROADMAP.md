# Roadmap

_Last updated: 2026-05-25_ (tick 26)

## Now
_In flight — actively being worked on. Keep this to 1–3 items._

### Event detail pages (shareable, SEO-indexed)
- **Why:** Pairs with the rich share previews from `46896a9` and the heavy event pipeline investment; per-event landing pages are the missing surface. Spots already got stable slugs + SEO audit in CI (`a28617b`); events are the obvious next surface to extend the same treatment to. Also unlocks a real link target for newsletter digest items and shared plans.
- **Effort:** M (1–2 days)
- **Links:** `46896a9` (rich share previews), `a28617b` (stable spot slugs + SEO audit pattern), `public/data/<metro>/events.json` (source data), `src/App.tsx:1096` (hash router)
- **Tasks:**
  - [x] Decide URL shape + slug strategy. Write `docs/decisions/04-event-detail-pages.md` covering: (a) URL form (`/<metro>/events/<slug>` vs. hash `#/event/<id>`), (b) slug source (stable id from event pipeline vs. derived `slugify(title + date)` with collision handling), (c) whether SSR/prerender is needed for SEO or if client-rendered hash routes + sitemap suffice given current spots approach, (d) how legacy/stale event URLs (events disappear after weekend) redirect — 410, redirect to metro guide, or stub-with-noindex. <2h. _(209ce88)_
  - [x] Add stable `slug` field to event records in the pipeline. Land in whatever module builds `public/data/<metro>/events.json` (grep for `events.json` writes). Add a `scripts/audit-event-slugs.*` check mirroring the spot-slug audit from `a28617b`, wired into `npm run validate:events` so CI fails on collisions or non-stable churn. _(261ce3b)_
  - [x] Scaffold an `EventDetailView` component at `src/EventDetailView.tsx` that takes a metro + slug, finds the event, and renders title/date/venue/description. Wire into the hash router in `src/App.tsx` (route alongside the existing `#/plans/...` and `#/p/...` matchers). Plain layout — visual polish in a later task. _(cb39561)_
  - [x] Add JSON-LD `Event` structured data + OpenGraph meta tags on the detail view (or via the same prerender surface that handles spots). Mirror the rich-share-preview approach from `46896a9`. _(838b2fe)_
  - [ ] Include event detail URLs in the sitemap generator (find the existing sitemap script that handles spots; extend it). Add legacy-redirect handling per the ADR for events that have aged out.
  - [ ] Add a "View details" link from event cards on the weekend guide + from plan share pages, so the detail page is reachable from the existing surfaces (not just direct URL).

## Next
_Committed, not yet started. Ordered by priority. Aim for ≤5 items._

### PWA / install + offline weekend cache
- **Why:** Mobile-first weekend use case is the canonical PWA fit; the mobile FAB from `9754dda` shows the pattern is working.
- **Effort:** M

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

- 2026-05-25 · **Analytics dashboard for funnel metrics** — `/ops/analytics` route (ADR 03 scope/storage/auth), `src/ops/loadAnalytics.ts` + worker `/metrics` `byMetro` aggregation, top funnel summary cards w/ 7-day delta, per-metro app-opens breakdown table linking to metro guides, and a 30-day inline-SVG sparkline for the headline metric with sessionStorage caching for <500ms loads (`45a7b06`).
- 2026-05-25 · **Operator-alerts triage UI** — `/ops/alerts` route with ADR-02 surface decision, alerts loader (`src/ops/loadAlerts.ts`), triage table sorted by severity, severity+metro filters with URL state, per-source snooze action (`data/alert-snoozes.json` + pipeline annotation), snooze-helper unit tests, and a top-of-page summary with link-jump to the critical filter (`79a54db`).
- 2026-05-24 · **Newsletter delivery (code-complete)** — Resend provider chosen (ADR 01), capture path inventoried, `worker/src/newsletter.ts` scaffolded behind `NEWSLETTER_ADMIN_TOKEN`, Resend HTTP wired, digest HTML+text template w/ unit tests, dry-run preview CLI, per-metro fetch+render in `sendWeekendDigest`, operator-test allowlist + runbook. Activation (Resend account, DNS, secrets, mail-client QA) is external ops work tracked in Later.
- 2026-05-22 · **Agentic event ops workflow** — automated event ops + source repair agents.
- 2026-05-22 · **Newsletter capture card** — sign-in prompt + newsletter card on plans view.
- 2026-05-22 · **Stable spot slugs + SEO audit in CI** — legacy URL aliases preserved.
- 2026-05-22 · **Interactive Event Finder** — on weekend guide pages.
- 2026-05-19 · **Privacy-safe funnel metrics** — first-party measurement, no third-party trackers.
- 2026-05-19 · **Rich share previews** — weekend-guide event rich results.
