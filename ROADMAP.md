# Roadmap

_Last updated: 2026-05-28_ (tick 32)

## Now
_In flight — actively being worked on. Keep this to 1–3 items._

_Nothing in flight. Pull the top of **Next** when ready._

## Next
_Committed, not yet started. Ordered by priority. Aim for ≤5 items._

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
_Recently shipped (last ~10 items). Older items live in [CHANGELOG.md](CHANGELOG.md)._

- 2026-05-28 · **PWA: install + offline weekend cache** — ADR 05; `vite-plugin-pwa` SW with runtime caching (events/featured-plans SWR 6h, spots SWR 30d, tiles/imagery CacheFirst 30d) + SPA shell fallback; mobile install banner (`InstallBanner.tsx` + `installPrompt.ts`) with native prompt on Android/desktop and iOS A2HS tutorial, per-origin gating; QA checklist in `docs/pwa-qa-checklist.md`. Deployed to both apps. (`offline.html` for unvisited metros + NightHop-branded icons deferred.)
- 2026-05-26 · **Event detail pages (shareable, SEO-indexed)** — ADR 04 (slug strategy + ended-event noindex stubs), stable `slug` field on event records w/ CI audit, `EventDetailView` at `#/event/<metro>/<slug>`, JSON-LD `Event` + OG meta on the SPA hash route, sitemap inclusion + slug-history aliases, and "View details" links from event cards across weekend guide + plan-share surfaces (`92f30f6`).
- 2026-05-25 · **Analytics dashboard for funnel metrics** — `/ops/analytics` route (ADR 03 scope/storage/auth), `src/ops/loadAnalytics.ts` + worker `/metrics` `byMetro` aggregation, top funnel summary cards w/ 7-day delta, per-metro app-opens breakdown table linking to metro guides, and a 30-day inline-SVG sparkline for the headline metric with sessionStorage caching for <500ms loads (`45a7b06`).
- 2026-05-25 · **Operator-alerts triage UI** — `/ops/alerts` route with ADR-02 surface decision, alerts loader (`src/ops/loadAlerts.ts`), triage table sorted by severity, severity+metro filters with URL state, per-source snooze action (`data/alert-snoozes.json` + pipeline annotation), snooze-helper unit tests, and a top-of-page summary with link-jump to the critical filter (`79a54db`).
- 2026-05-24 · **Newsletter delivery (code-complete)** — Resend provider chosen (ADR 01), capture path inventoried, `worker/src/newsletter.ts` scaffolded behind `NEWSLETTER_ADMIN_TOKEN`, Resend HTTP wired, digest HTML+text template w/ unit tests, dry-run preview CLI, per-metro fetch+render in `sendWeekendDigest`, operator-test allowlist + runbook. Activation (Resend account, DNS, secrets, mail-client QA) is external ops work tracked in Later.
- 2026-05-22 · **Agentic event ops workflow** — automated event ops + source repair agents.
- 2026-05-22 · **Newsletter capture card** — sign-in prompt + newsletter card on plans view.

_Older items in [CHANGELOG.md](CHANGELOG.md)._
