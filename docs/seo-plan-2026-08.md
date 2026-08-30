# famhop.com SEO plan — mapped to Google's SEO Starter Guide (2026-08-05)

Source: https://developers.google.com/search/docs/fundamentals/seo-starter-guide?hl=en
Every item below cites the guide principle it maps to, and marks the project's state (✓ done / GAP → action).

Project state at a glance: 16 metros, 7,016 URLs, event pages earn ~85% of clicks and rank in ~13 days; young domain (2026-05-09), zero backlinks, crawl budget is the binding constraint. Event pages = `Event` schema; the Google Indexing API is a verified no-op here — the valid levers are sitemap freshness, internal links from daily-crawled pages, and GSC request-indexing.

---

## P0 — close now (guide principles with concrete gaps)

### 1. GAP: Event rich-results warnings — `performer` + `validFrom` missing
Guide: "add valid structured data to qualify for special search features."
URL Inspection (2026-08-05) shows Events rich result with WARNING "Missing field performer" and "Missing field validFrom" on event pages. Event JSON-LD already has `organizer`, `audience`, `offers`, `eventStatus`, `eventAttendanceMode`.
Action: emit `performer` (the organizer/venue) and `validFrom` (startDate minus booking lead, or startDate) in `generate-seo-pages.mjs` Event schema. 1–2h. Verify via inspection API after deploy.

### 2. GAP: event pages have zero in-body images (no `<img>` at all)
Guide: "images can be how people find your website for the first time"; "sharp, clear images placed near relevant text"; "descriptive alt text."
`scripts/scrape-og-images.mjs` already scrapes OG images, but pages never render them in the body.
Action: render the scraped image on the event page near the lede with alt text `<event title> at <venue>, <city>` (the alt carries the query's terms). Second channel (Google Images) for pages that already rank. Medium effort; keep the image optional (skip when scrape failed) so it never blocks the page.

### 3. GAP: zero backlinks — the domain's #1 strategic constraint
Guide: "The vast majority of new pages Google finds daily come through links"; links "can corroborate your content"; "Promote your website… word of mouth is one of the most effective and lasting ways." Also: "Only link to resources you trust" — earned links only, never bought/networked.
Action (narrow, earned-only, slow):
- Organizers/venues: ask library systems, museums, parks with recurring programs to link their famhop event/recap page from a "community calendar partners" page (they already do reciprocal listing with local roundups).
- Local family roundups/blogs (metro-specific "things to do this weekend" newsletters) — submit 1–2 evergreen/seasonal pages per metro; these are the same named-entity pages that win clicks.
- No Fiverr/directories/PBNs; the project's own policy already rejects the "traffic playbook."
- Measure: track referring domains in GSC weekly; goal is 3–5 relevant domains by end of Q3, not volume.

### 4. GAP: no systematic re-crawl tracking after request-indexing
Guide: "wait a few weeks to assess, and iterate"; URL Inspection is the tool to check.
We request-indexed 49 URLs; there is no tracker for what was requested, when, and whether `lastCrawlTime` advanced.
Action: fold a "recrawl tracker" into the daily pulse: list of requested URLs → URL Inspection API (`v1/urlInspection/index:inspect`) → report verdict/lastCrawlTime deltas weekly. Stops the "requested 30 URLs, nothing happened" cycle from being unverifiable.

---

## P1 — strengthen the discovery graph (guide: "new pages are found through links")

### 5. ✓ Hubs link everything important (done 2026-08-04)
Guide: "Link to relevant resources" / "Write good link text."
Metro hubs (daily-crawled, verified) link: weekend guide, categories, cities, annual traditions, and now "Recurring & returning programs" (evergreen recaps, descriptive anchors with venue + "last held"). Category pages link 91 events each. This is the guide's primary discovery path, implemented.

### 6. ✓ Descriptive URLs + breadcrumbs
Guide: "URL parts can appear as breadcrumbs"; "Use descriptive URLs."
`/{metro}/event/{title-slug}/` + BreadcrumbList JSON-LD (rich result detected PASS on inspection). No restructure — per policy.

### 7. ✓ Duplicate content handled
Guide: "Google picks a single canonical URL per piece of content. Specify via redirects or rel=canonical."
(title, venue) dedupe mints one page per distinct event; old feed variants 301 to the merged page; canonical tags on all pages.
Open sub-item: venue-name variance across feeds defeats the dedupe (parks-after-dark minted twice from two feeds with different venue strings). Normalize venue names per source before dedupe — same fix class as the stay & play feed gap.

### 8. ✓/ongoing: freshness — "check in on previously published content, update or delete"
The rescue/strike-zone loop (pos ≤ 15 + impressions ≥ 10 + HTTP probe) + evergreen keep-long policy (user directive 2026-08-04: ranked pages stay up to attract traffic, never removed) implement this weekly.
Add before each seasonal ramp: re-verify facts on the top 50 annual/evergreen pages (dates, venues) — guide's "up-to-date" attribute, and the content-facts bar already in the skill.

### 9. Seasonal calendar with publish-by deadlines (guide: "time to impact" = weeks)
Halloween/December ingest by early Sept 2026 (open action). Because indexing lags (young domain, slow crawl), publish seasonal pages 1–3 weeks before ramp start; the annual/evergreen URLs already carry the year so "2026/2027" queries land.

---

## P2 — promotion & hygiene (guide: "Promote your website")

### 10. ✓ Social: Pinterest daily pins + weekly YT Shorts (runbook: skills/social-posting)
Guide-aligned; keep volume moderate (guide warns over-promotion).

### 11. Optional: embed YT Shorts on evergreen/video pages
Guide: "high-quality video embedded on standalone pages near relevant text, with descriptive titles."
Low priority: video content is weak for crawlers on a budget-starved domain; do only if a Shorts page becomes a user-facing destination.

### 12. ✓ Don't-focus list respected (guide explicitly de-prioritizes)
Meta keywords, keyword stuffing, URL keyword weighting, content-length games, heading order/count, duplicate-content "penalty", subdomain-vs-subdirectory, E-E-A-T-as-factor — all already rejected in this project's policy and code (aggregateRating, FAQPage never re-added).

---

## Measurement & expectations

- Guide: "changes take weeks to months" — assess per loop weekly, decide monthly. Don't over-monitor daily deltas.
- The weekly class table (queries × position × clicks, per seo-query-optimization skill) already reruns; add the recrawl tracker (P0-4) and keep the strike-zone report (P0 of the traffic loop).
- Success signals for this plan: (a) Event rich-results warnings gone, (b) ≥3 earned referring domains by end of Q3, (c) recrawl tracker shows lastCrawlTime advancing on the 49 requested URLs, (d) strike-zone impressions converting to clicks at ≥1% CTR within 60 days.

## Immediate next actions (this week)
1. Event schema: add performer/validFrom → rebuild → audit → deploy.
2. Render scraped OG image + alt on event pages → rebuild → audit → deploy.
3. Start the earned-link list: 2 organizers per metro (libraries first — they already publish community calendars).
4. Add recrawl tracker to daily-seo-pulse.
