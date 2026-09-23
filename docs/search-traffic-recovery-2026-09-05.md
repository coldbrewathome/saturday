# FamHop search recovery and product quality plan

Audit date: September 5, 2026. Scope: famhop.com, its shared implementation, Search Console, and local generated feeds. This is an audit and proposed implementation plan; no application code, feeds, production configuration, or indexing submissions were changed.

## Recommendation

Treat this as search recovery plus a visitor-experience repair. Fix the broken mobile entrance and measurement immediately; preserve valuable URLs and make upcoming events discoverable early; then concentrate editorial effort on a small number of metros where FamHop can offer reliably useful family decisions. Measure useful actions and repeat use alongside search visibility. More generated pages alone will not establish that the strategy works.

## What happened to search

| Window | Google clicks | Impressions | CTR | Average position |
| --- | ---: | ---: | ---: | ---: |
| Jun 4–Jul 3, 30 days | 254 | 25,935 | 0.98% | 10.69 |
| Jun 21–Jul 18, 28 days | 194 | 21,490 | 0.90% | 12.02 |
| Jul 19–Aug 15, 28 days | 8 | 997 | 0.80% | 38.30 |
| Aug 4–Sep 2, 30 days | 2 | 1,018 | 0.20% | 43.78 |

The first and last 30-day windows show clicks down 99.2% and impressions down 96.1%. The most obvious break is July 19: July 18 had 338 impressions at average position 12.01; July 19 had 44 at 31.82. Comparing complete weeks, July 12–18 had 32 clicks / 3,174 impressions; July 19–25 had 6 / 282, a 91.1% impression decline. This is primarily lost visibility, not just a snippet that fails to persuade people to click.

Fresh authenticated Search Console queries confirm the drop spans page types:

| Page class | Jul 12–18 impressions | Jul 19–25 impressions | Change |
| --- | ---: | ---: | ---: |
| Event detail | 1,949 | 151 | −92.3% |
| Venue/spot | 992 | 67 | −93.2% |
| Weekend guide | 77 | 12 | −84.4% |
| City | 101 | 35 | −65.3% |
| Category | 40 | 11 | −72.5% |

Mobile impressions fell from 1,385 to 61 and desktop from 1,778 to 218 in those same weeks. This rules out an explanation limited to one device or expired fireworks pages. A rough URL-keyword classification attributes only 33 of the 194 pre-drop clicks to July 4/fireworks-related URLs; that is an estimate, not a complete seasonal attribution.

Event pages nevertheless remain the strongest demonstrated acquisition surface: they earned 154 of 194 clicks in Jun 21–Jul 18 (79%). Examples include Milpitas fireworks, Palatine Hometown Fest, and Bluey Bash. Broad metro queries currently mostly rank much lower: the Chicago weekend-with-kids query had 21 impressions at position 74.48 in Aug 4–Sep 2. Optimizing the snippet cannot compensate for that visibility gap.

Small opportunities exist, but avoid overinterpreting tiny samples: Seattle's library category had 82 impressions at position 1.91 and no clicks; the Bay Area weekend guide had 19 at 6.32 and no clicks. Inspect query, device, country, and search appearance for those pages before changing their positioning.

### What is confirmed versus uncertain

- **Confirmed: mixed indexing and recrawl problems.** The seven-URL inspection sample below contains indexed pages, an old not-found result, and a current featured page unknown to Google. It does not establish sitewide deindexing.
- **Confirmed: the original collapse predates two tempting explanations.** The spot pruning commit was July 24, after the July 19 break. The font-loading change that broke the live homepage shell was September 3, much later.
- **Confirmed: July 18 sitemap filtering did not itself introduce a new expiry rule.** Commit `0085b30` reused the existing page guard's gone classification and documented 406 FamHop sitemap URLs already returning 410. That is evidence of a lifecycle problem to investigate, not proof that filtering the sitemap caused the collapse.
- **Unproven: a Google penalty, a sitewide algorithmic reassessment, or crawl budget as the single binding cause.** Google's published ranking history has no announced update beginning July 19. Absence of an announcement does not exclude smaller ranking changes. Manual Actions, Security Issues, historical Page Indexing, and Crawl Stats were not available through this audit's API reads.
- **Seasonality contributes, but is insufficient on its own.** Evergreen venue and weekend pages also lost impressions sharply.

Google recommends comparing affected page groups, indexing and crawl reports, and seasonality before deciding on a remedy: [traffic-drop troubleshooting](https://developers.google.com/search/docs/monitor-debug/debugging-search-traffic-drops). Published update dates: [Search Status Dashboard](https://status.search.google.com/products/rGHU1u87FJnkP6W2GwMi/history).

### Google's stored view of representative URLs

| URL / page | Stored indexing result | Last crawl | Implication |
| --- | --- | --- | --- |
| `/bay-area/` | Submitted and indexed; canonical matches | Aug 16 | Earlier claims that this hub is crawled daily are not current. |
| `/bay-area/this-weekend/` | Submitted and indexed; canonical matches | Aug 22 | A weekly guide can be current for people while Google's stored version is weeks behind. |
| `/chicago/event/bluey-bash-central-library/` | Submitted and indexed | Aug 19 | Not all former event earners have disappeared from the index. |
| Milpitas Red, White & Boom event | Submitted and indexed | Jul 4 | Google still has old event/schema content. |
| Carnival in de Capital event, Washington DC | Not found (404) | Jul 18 | A former 10-click page encountered a not-found response; current HTTP probe returns 200. Recovering the URL and getting it recrawled are separate tasks. |
| Millbrae Art & Wine Festival event, Bay Area | URL is unknown to Google | None reported | A featured event can reach its weekend without entering Google's index. |
| `/seattle/category/library/` | Submitted and indexed | Aug 19 | Investigate its impressions without assuming it needs an indexing fix. |

URL Inspection describes Google's stored index, not a live rendering test. The sample is deliberately small. The sitemap API's `indexed: 0` field was not treated as a count of all indexed pages; the inspection results demonstrate that several pages are indexed.

## Concrete site improvements

### 1. Repair the first impression — highest immediate priority

At a 390×844 viewport, the live homepage places a 2,156px-tall unstyled metro directory before the React root. The actual weekend heading begins around y=2,352. The fixed navigation overlaps the directory. A first-visit personalization modal and Hop-now prompt add competing overlays.

Cause: the generator replaced the first `<noscript>` block, which became a font fallback in `<head>` after the September 3 change. The SEO shell consequently sits outside the React mount and survives hydration. An existing user change in `scripts/generate-seo-pages.mjs:1973` targets the root fallback correctly. The existing regression test passed, along with all 32 tests in `tests/seo-pages.test.mjs`; a production rebuild and deployment were not performed.

**Next action:** review and ship that existing correction through the normal release process, then inspect root and multiple metro routes with JavaScript enabled and disabled, desktop and mobile, and a returning service-worker session. Do not replace it with a broad redesign.

**Acceptance:** the useful weekend content appears in the first screen; no leftover duplicate shell or overlapping headings; crawlable links remain available without JavaScript. Screenshots: [first visit](../output/playwright/famhop-home-mobile-before.png), [after dismissing personalization](../output/playwright/famhop-home-mobile-no-modal.png).

### 2. Make mobile landing pages help people choose

The static Bay Area weekend guide has a long H1 and introduction before the first event card. Its H1 names different headliners from the document title and introductory paragraph. The page contains about 2,738 DOM elements and 339KB of uncompressed HTML. In the observed desktop-browser connection it loaded quickly, so this is not evidence of failing Core Web Vitals.

**Design direction:** keep the warm brand, real event imagery, official-source links, and ready-made outings. Use a short visible heading such as “Bay Area with kids this weekend,” a separate date line, and three clearly differentiated picks. Put city/distance, age fit, time, confirmed cost, registration, and an official-details action together. Use one headliner selection for title, heading, and intro. Ask for personalization after showing useful choices, and show one prompt at a time.

**Acceptance:** first useful pick appears in the initial mobile viewport or immediately below it; keyboard users can operate and dismiss controls; layouts work at 320, 390, and 768px. Measure real mobile LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 at the 75th percentile once enough field data exists. Treat those as targets, not measured current scores. [Observed guide](../output/playwright/famhop-weekend-mobile.png).

### 3. Make “verified” and “free” precise promises

Current local feeds contain 1,107 Miami and 1,538 NYC upcoming records marked both `sourceMode=last-known-good` and `verified=true`. These are retained records, not necessarily bad events, but `src/EventDetailView.tsx:365` shows the same plain Verified label without explaining recovery state. `fetchedAt` is preserved as a first-seen timestamp; it must not be used as proof of a recent source check.

The coverage report also labels Honolulu `ok` and `concentrated=false` despite a top-source share of 93% and 14 noncontributing sources out of 21. `scripts/build-coverage-summary.mjs:44` classifies counts against a minimum; its concentration flag only checks whether healthy source count is at most two. That can hide a fragile supply base.

**Next action:** distinguish `firstSeenAt`, `lastSuccessfulExtractionAt`, and `lastConfirmedAt`; show “confirmed from organizer” versus “previously listed—check organizer” where appropriate. Keep estimated/likely-free costs separate from confirmed zero cost. Rank confirmed current events ahead of recovered entries. Alert on source share, successful extraction age, unique programs, and geographic/category breadth, not just record totals. Use the grounded-event-discovery workflow for all source repairs.

**Acceptance:** every promoted event has an official source supporting date, time, place, and the displayed price claim. Fallback records cannot silently become freshly verified when a build runs. An HTTP 200 source check alone cannot satisfy the gate. Current local feed findings must be checked against production before describing them as deployed.

### 4. Fix structured-data accuracy, not just warning counts

Images, related events, breadcrumbs, newsletter forms, and performer/validFrom code already exist; the August SEO plan is partly stale. However, `buildEventJsonLd` in `scripts/generate-seo-pages.mjs:3848` currently puts `validFrom` on the Event, substitutes the event start for an unknown ticket-sale date, copies the organizer into performer, derives zero price from “likely free,” stamps build time as verification time, and sets `offers.availability=InStock` whenever it emits a price.

**Next action:** emit only supported facts. Ticket-sale `validFrom` belongs under the Offer when genuinely known. Do not infer a performer, ticket availability, free admission, or recent verification just to fill a schema field. Review repeated occurrences individually: separate ticketed performances require appropriate separate Event markup; simply spanning first start to last end can misrepresent a schedule. Keep rich-result event markup focused on actual individual events, excluding general opening hours, programming-break notices, and private/member-only sessions.

**Acceptance:** visible content and schema agree on sampled free, paid, unknown-price, recurring, canceled, and archived pages. Optional warnings may remain when facts are unavailable. Google's requirements distinguish required properties from recommendations: [Event structured data](https://developers.google.com/search/docs/appearance/structured-data/event).

### 5. Preserve search assets and establish earlier discovery

The sampled live sitemap has 7,552 URLs, including 7,035 event pages. A large listing inventory is not evidence that Google has discovered or indexed it. Current inspections show gaps even for a featured event.

**Next action:** build a protected cohort from the last 90 days of page clicks and impressions. For each URL, record live response, canonical, indexability, sitemap/internal-link presence, event lifecycle, and Google's last crawl. Preserve valuable URLs with honest archived/returning-program content and links to current alternatives. Review metrics before any removal, noindex, redirect, or consolidation. Validate both cold and cached requests; unknown non-content paths should not return an indexable homepage with status 200.

Publish verified seasonal content several weeks before demand; use stable existing URLs for returning programs where identity is genuinely the same. Link selected priorities from useful metro and weekend pages, maintain truthful lastmod, and track first discovery/crawl/indexing over time. Do not assume hubs are crawled daily or ranking arrives in a fixed 13 days. Do not restart the Google Indexing API workflow for ordinary events.

**Acceptance:** no protected URL unexpectedly becomes 404/410/noindex; sampled featured URLs resolve and have relevant crawlable internal links; report days from publication to first crawl and indexing. Expand only after the pilot shows discovery and useful visits, rather than multiplying page types blindly.

### 6. Repair measurement before interpreting conversion

The frontend emits `profile_completed`, `checkin_answered`, `plan_card_created`, and `plan_card_shared` (`src/App.tsx:830`, `1281`, `3072`, `3128`), but the Worker allowlist (`worker/src/index.ts:1821`) omits them and silently returns 204. The dashboard also omits some accepted events. Existing first-party counters carry name, metro, and brand, not an acquisition source or landing page. App opens are not unique visitors, and aggregate event-count ratios are not user-cohort conversion rates.

**Next action:** share a typed event contract across frontend, Worker, and dashboard; make missing events detectable. Measure static SEO landings as well as app activity, with privacy-conscious source and page-type dimensions. Instrument official-organizer clicks, calendar saves, saved events, successful plan creation, shares, newsletter completion, and return sessions. Keep brand and metro separable. Reconcile the GA tag in `index.html` with static page coverage and the first-party dashboard before reporting a whole-site funnel.

**Acceptance:** a controlled journey from an event landing to a useful action appears exactly as designed in the dashboard; unsupported events fail a contract check; bot/internal traffic is separated where feasible. Establish a clean baseline before setting growth claims. Existing KV read-modify-write counters are approximate under concurrency and should not be presented as exact cohort analytics.

### 7. Build a reason to return and recommend FamHop

**Product bet:** the differentiator should be “I can confidently choose a family outing in a minute.” Focus editorial work on Bay Area plus one metro selected from clean acquisition data and supply quality. Maintain existing coverage elsewhere, but avoid spreading equal curation effort across all 16 metros.

Create genuinely useful local picks with ages, total outing cost, booking requirements, transport/parking, accessibility when confirmed, and a nearby backup. Use real imagery where available, with graceful fallbacks. Let someone save or calendar an outing before asking them to construct a three-stop plan or sign in. Offer a relevant Friday digest after that first value moment; verify current delivery configuration and subscriber consent before sending anything.

Earn discovery through useful organizer relationships, venue links, parent groups, and local newsletters. Prepare a short list of relevant partners and helpful resources; measure referred visits and actions. Outreach and newsletter sends require explicit authorization and were not performed. Current backlink counts and newsletter operating status were not verified; older “zero backlinks” or “never sent” notes are not reliable current facts.

**Acceptance:** five parents in the pilot metros can find a suitable outing and reach official booking/details in under a minute without assistance. Review failures before adding features. Evaluate newsletter retention only after delivery works and a cohort exists. Improve successful decisions, not just the number of generated plans.

## Sequence and ownership

| When | Owner role | Deliverable | Exit criterion |
| --- | --- | --- | --- |
| First 1–2 working days | Frontend + release owner | Existing shell fix; shared analytics event contract | Mobile entrance verified live; four missing events recorded end-to-end |
| First week | SEO/engineering | Protected URL cohort; indexing/crawl/manual-action review; lifecycle checks | Every priority loss URL has a classified state and a concrete next action |
| First week, in parallel | Data/content | Confidence timestamps, cost labels, top-source alerts; pilot event QA | Promoted picks have grounded facts; recovered data clearly distinguished |
| Weeks 2–3 | Product/frontend | Short mobile guide, coherent headliners, early useful action, controlled prompts | Five-parent task test passes; clean landing-to-action baseline available |
| Weeks 2–4 | Editorial/growth | Early seasonal pages on stable URLs; internal discovery; partner resource drafts | Publication-to-crawl tracked; real referral and organic actions measurable |
| Days 30 and 60 | Owner + product | Review matched page/query cohorts and useful actions | Expand improving cohorts; revise or stop bets that add pages without discovery or engagement |

Operational thresholds are immediate gates; search recovery is not guaranteed on a deadline. Review a matched cohort and complete weeks so that changing query mix, expired events, seasonality, and tiny samples do not masquerade as improvement. Primary business metric: qualified visits that take a useful action. Supporting metrics: organic clicks/impressions by page class, priority-page index/crawl status, confirmed upcoming supply, organizer/calendar/save actions, and properly defined repeat use.

## Evidence and limitations

- Fresh Search Console export: `/private/tmp/famhop-search-audit-20260904.json`, fetched September 5; web search, final data, row limit 25,000 per dimension/window. No query result reached that limit. Property-level totals and page-level impression totals use different aggregation semantics and must not be mixed. Queries can omit anonymized searches.
- Stored daily history: `scratch/gsc-breakdown.json`, covering Jun 4–Sep 2; current summary cross-checked against the fresh API response. The 30-day baseline predates the fresh comparison window.
- Fresh URL Inspection: `/private/tmp/famhop-url-inspection-20260905.json`, seven URLs; stored Google results, not live tests. Full Manual Actions, Security Issues, Crawl Stats, GA4, newsletter delivery, backlinks, and field Core Web Vitals were not reviewed.
- Live browser observations and screenshots were collected during the September 4–5 audit; later deployment changes can supersede them. No form submissions, external messages, indexing requests, or production mutations were made.
- Local generated feeds and the user's existing dirty changes were inspected without re-ingesting or reverting them. Existing shell regression: 32/32 focused tests passed. No new application implementation is claimed.
