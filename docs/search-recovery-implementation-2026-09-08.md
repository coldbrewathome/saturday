# Search recovery implementation — September 8, 2026

Local implementation of the first repair batch from [the audit](search-traffic-recovery-2026-09-05.md). Not deployed. This does not establish that Google visibility has recovered.

## Implemented

- Preserved the existing root-scoped SEO fallback repair; added literal replacement safety so event text containing replacement tokens cannot corrupt the shell.
- Shortened weekend-guide H1s, separated dates, and moved featured picks before the long introduction. Kept likely-free counts explicitly qualified.
- Made the profile wizard opt-in. Suppressed the floating coaching message on weekend/event views and while the profile wizard is open.
- Distinguished retained and recurring listings from ordinary verified listings in event detail, weekend cards, and static event pages. Removed the blanket homepage verification promise.
- Removed inferred performer, availability, verification-time, and sale-start claims from static event structured data. Both client and static schema now require explicit free-price text or a dollar amount rather than guessing from categories or age numbers.
- Connected event-detail saving to existing saved-event state. Added calendar links to React event and weekend views only when valid start and end times are available.
- Shared the metric event vocabulary between client, Worker, and dashboard; accepted previously dropped profile/check-in/plan-card events. Added bounded source/page-type aggregates and static landing, organizer-click, calendar-save, and saved-event measurement. Beacon rejection falls back to fetch.
- Flagged coverage concentration when a source provides at least 80% of live events, even with more than two healthy sources. In the isolated current-feed check, Honolulu's 93% share now correctly triggers the flag.

Metrics are aggregate activity counts, not unique people or a linked acquisition funnel. Source reflects the current document referrer, not persistent first-touch attribution. Existing historical counts cannot be backfilled for events previously discarded. Attribution currently combines both brands, as labeled in the dashboard.

## Validation

- Tests: 242 Node tests and 464 Vitest tests passed, including static-metric and event-trust regressions.
- Application and Worker TypeScript checks passed. Focused tests also passed after final copy/prompt adjustments.
- Production build completed in `/private/tmp/famhop-recovery-build.HEQspY`, protecting the working tree's existing feed/history edits.
- SEO audit: 11,266 HTML files, zero errors and warnings. Localized SEO validation: 18 pages, zero errors and warnings.
- Playwright at 390px: homepage content heading at 126px, no forced profile dialog, no horizontal overflow. Production API reads reject the local preview origin via CORS, so this check does not prove live API behavior. Analytics requests were intercepted.
- Visual checks: [homepage](../output/playwright/famhop-recovery-home-mobile.png) and [weekend guide](../output/playwright/famhop-recovery-guide-mobile.png). The guide's first featured card is visible in the initial 844px viewport.
- Build warnings remain for existing missing enrichment files and unmatched pinned spot slugs. They did not fail the generated-page audit.

## Still outstanding

- Deployment of both the site and metrics Worker, followed by production smoke checks and confirmation of new metric records.
- Search Console Manual Actions/Security/Page Indexing/Crawl Stats review and a fresh post-release comparison. No indexing submissions were made.
- A 90-day traffic-protection report, historical URL lifecycle/soft-404 work, and recrawl follow-up. No URLs were removed or newly noindexed in this batch.
- Pipeline-backed confirmation timestamps, freshness-aware promotion/ranking, deeper coverage breadth checks, and editorial verification of featured events.
- Broader keyboard, responsive and returning-service-worker checks; real-user performance measurement; remaining retention/editorial experiments from the audit.

No deployments, production feed changes, subscriber messages, or outreach were performed.
