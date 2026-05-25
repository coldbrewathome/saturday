# Roadmap

_Last updated: 2026-05-24_ (tick 11)

## Now
_In flight — actively being worked on. Keep this to 1–3 items._

### Operator-alerts triage UI
- **Why:** `0936fea` and `22bdfb9` generate per-metro `event-operator-alerts.json` (broken sources, last-known-good fallbacks, zero-extracted feeds), but today they only exist as JSON in `public/data/{metro}/`. No human workflow to act on them — alerts pile up across all 14 metros and silently degrade event coverage. Atlanta alone has 9 active alerts.
- **Effort:** M (1–2 days)
- **Links:** `public/data/*/event-operator-alerts.json`, `scripts/event-ops-agent.mjs`, `scripts/source-repair-agent.mjs`
- **Tasks:**
  - [x] Decide the surface: standalone `/ops/alerts` route in the existing app vs. a separate `worker/` admin page vs. a static CLI report. Write the decision (and the auth model — operator token? local-only?) to `docs/decisions/02-operator-alerts-ui.md`. <2h.
  - [x] Add a loader that aggregates all `public/data/*/event-operator-alerts.json` into a single in-memory list with `metroId` attached. Land it at `src/ops/loadAlerts.ts` (or `worker/src/ops-alerts.ts` depending on the decision above) with a unit test covering merge + count totals.
  - [ ] Render a minimal triage table: columns = severity, metro, sourceName, issueType, recoveredBy, fetchedAt. Sort by severity desc then fetchedAt desc. Static HTML/JSX is fine — no filtering yet.
  - [ ] Add filter controls: severity (critical/warning/all) and metro (multi-select). Persist filter state in the URL querystring so reloads keep it.
  - [ ] Add a "snooze until next ingest" action per source: writes `sourceId` + expiry to a local JSON (`data/alert-snoozes.json`) that `scripts/event-ops-agent.mjs` reads when emitting alerts. Snoozed alerts grey-out in the UI; expiry auto-clears.
  - [ ] Wire a top-of-page summary: total alerts, count by severity, count of metros with ≥1 critical. Make critical count link-jump to the filtered view.

## Next
_Committed, not yet started. Ordered by priority. Aim for ≤5 items._

### Analytics dashboard for funnel metrics
- **Why:** `239ab7f` added privacy-safe first-party metrics; there's no UI to read them, so the data is invisible. Pairs naturally with the ops UI surface above.
- **Effort:** M

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

- 2026-05-24 · **Newsletter delivery (code-complete)** — Resend provider chosen (ADR 01), capture path inventoried, `worker/src/newsletter.ts` scaffolded behind `NEWSLETTER_ADMIN_TOKEN`, Resend HTTP wired, digest HTML+text template w/ unit tests, dry-run preview CLI, per-metro fetch+render in `sendWeekendDigest`, operator-test allowlist + runbook. Activation (Resend account, DNS, secrets, mail-client QA) is external ops work tracked in Later.
- 2026-05-22 · **Agentic event ops workflow** — automated event ops + source repair agents.
- 2026-05-22 · **Newsletter capture card** — sign-in prompt + newsletter card on plans view.
- 2026-05-22 · **Stable spot slugs + SEO audit in CI** — legacy URL aliases preserved.
- 2026-05-22 · **Interactive Event Finder** — on weekend guide pages.
- 2026-05-19 · **Privacy-safe funnel metrics** — first-party measurement, no third-party trackers.
- 2026-05-19 · **Rich share previews** — weekend-guide event rich results.
