# Roadmap

_Last updated: 2026-05-25_ (tick 21)

## Now
_In flight — actively being worked on. Keep this to 1–3 items._

### Analytics dashboard for funnel metrics
- **Why:** `239ab7f` added privacy-safe first-party metrics, but the data is write-only today — no UI reads it, so funnel drop-off, metro popularity, and feature usage are invisible. Pairs naturally with the just-shipped `/ops/alerts` surface (same operator audience, same auth model).
- **Effort:** M (1–2 days)
- **Links:** `239ab7f` (metrics capture), `worker/src/` (likely ingestion endpoint), `src/ops/OpsAlertsView.tsx` (sibling ops surface to mirror)
- **Tasks:**
  - [x] Inventory what's actually captured: read `239ab7f` + grep for the metrics emit call sites. Write a short decision doc at `docs/decisions/03-analytics-dashboard.md` listing (a) the event schema we have today, (b) which 3–5 funnel questions the dashboard should answer first (e.g. "plans-view sign-in conversion", "metro pageviews", "Hop-me-now usage"), (c) the storage surface (worker KV? D1? a flat JSON snapshot?), and (d) auth model (reuse `/ops/alerts` token gate vs. separate). <2h.
  - [x] Scaffold the route: add an empty `/ops/analytics` view (mirroring `src/ops/OpsAlertsView.tsx`) with a placeholder "no data yet" state. Wire it into the hash-router next to `#/ops/alerts`. No data loading yet.
  - [x] Add a loader that reads aggregated metrics from whatever storage the ADR picked. Land it at `src/ops/loadAnalytics.ts` with a unit test that asserts shape + empty-state behavior on missing data.
  - [x] Render the top 3 funnel questions from the ADR as plain numeric cards (big number + label + 7-day delta). Static, no charts yet. Match the visual density of the alerts summary panel from `79a54db`.
  - [x] Add a per-metro breakdown table for the highest-signal metric (likely pageviews or sign-in conversion). Sort desc, link metro name to the existing metro guide page.
  - [ ] Add a single trend chart for the headline metric (last 30 days, daily buckets). Use a minimal inline SVG sparkline — no chart library dep. Cache the rendered data so the page loads <500ms.

## Next
_Committed, not yet started. Ordered by priority. Aim for ≤5 items._

### Event detail pages (shareable, SEO-indexed)
- **Why:** Pairs with the rich share previews from `46896a9` and the heavy event pipeline investment; per-event landing pages are the missing surface.
- **Effort:** M

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

- 2026-05-25 · **Operator-alerts triage UI** — `/ops/alerts` route with ADR-02 surface decision, alerts loader (`src/ops/loadAlerts.ts`), triage table sorted by severity, severity+metro filters with URL state, per-source snooze action (`data/alert-snoozes.json` + pipeline annotation), snooze-helper unit tests, and a top-of-page summary with link-jump to the critical filter (`79a54db`).
- 2026-05-24 · **Newsletter delivery (code-complete)** — Resend provider chosen (ADR 01), capture path inventoried, `worker/src/newsletter.ts` scaffolded behind `NEWSLETTER_ADMIN_TOKEN`, Resend HTTP wired, digest HTML+text template w/ unit tests, dry-run preview CLI, per-metro fetch+render in `sendWeekendDigest`, operator-test allowlist + runbook. Activation (Resend account, DNS, secrets, mail-client QA) is external ops work tracked in Later.
- 2026-05-22 · **Agentic event ops workflow** — automated event ops + source repair agents.
- 2026-05-22 · **Newsletter capture card** — sign-in prompt + newsletter card on plans view.
- 2026-05-22 · **Stable spot slugs + SEO audit in CI** — legacy URL aliases preserved.
- 2026-05-22 · **Interactive Event Finder** — on weekend guide pages.
- 2026-05-19 · **Privacy-safe funnel metrics** — first-party measurement, no third-party trackers.
- 2026-05-19 · **Rich share previews** — weekend-guide event rich results.
