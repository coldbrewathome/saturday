# Event Harvest Audit — 2026-08-09

Trigger: Bay Area Aloha Festival (Aug 8–9, 2026, San Mateo County Event Center, 31st year, free, family) absent from the feed. Audited the whole engine; the miss is a symptom of three structural gaps, all confirmed with data. The engine's extractor breadth is good (~35 sourceTypes); **coverage and maintenance are the bottleneck, not extraction**.

## The three gaps

### Gap 1 — City-source coverage: 70% of covered cities have no source

Per-metro count of cities in `coverage.cities` with no configured source (from `data/event-sources-*.json`):

| Metro | cities covered | cities with a source | no source |
|---|---|---|---|
| bay-area | 126 | 38 | **88** |
| los-angeles | 78 | 19 | **59** |
| honolulu | 19 | 5 | **14** |
| seattle | 13 | 5 | 8 |
| san-diego | 12 | 5 | 7 |
| phoenix | 8 | 2 | 6 |
| houston | 9 | 3 | 6 |
| …all 16 metros | ~270 | ~110 | **~160** |

A city with no source only appears when the weekly search sweep happens to catch it. Bay Area examples with zero sources: Menlo Park, Burlingame, South San Francisco, Petaluma, Novato, El Cerrito, Emeryville, Half Moon Bay, Pacifica, San Bruno, Millbrae, Foster City. Most run CivicPlus park-and-rec calendars — the `civicpluscal` extractor already exists, so these are cheap wins.

Also missing at the venue level: **no fairground/event-center sources** for the Bay Area — San Mateo County Event Center (smcec.co — home of the Aloha Festival, County Fair, Disaster Preparedness Day), Santa Cruz County Fairgrounds, Solano County Fairgrounds, Sonoma-Marin Fair. The County Fair sources that DO exist (alameda/marin/santa-clara-county-fair) are `html` scrapers on fair homepages and extract **zero** events (Gap 2).

### Gap 2 — Broken sources are chronic and accepted as noise

Fresh `ingest-events.mjs --metro=bay-area` (2026-08-09): **46 operator alerts**, including `zero-extracted` criticals on exactly the marquee/festival class: niles-canyon-railway, ardenwood-historic-farm, alameda-county-fair, marin-county-fair, santa-clara-county-fair, napa-city-rec, great-american-music-hall, the-uc-theatre, east-bay-parks-bird-butterfly-adults.

`build-coverage-summary.mjs` measures event counts and healthy-source ratios per metro but **not zero-extracted counts**, so a metro's festival sources can all be dead while coverage reads "ok". The weekly repair pass is bounded (30 min, one agent, traffic metros only) and the skill explicitly normalizes "~10/metro chronic backlog" as background noise. At ~160 broken sources across 16 metros, the backlog never drains.

### Gap 3 — The weekly sweep is search-dependent, not coverage-driven

`weekly-event-prep` step 3a runs fresh searches per weekend with a ~4–6 search budget per metro, plus `discovery-leads.json`. The leads file for the Bay Area has **7 entries, all SF / East Bay / North Bay — zero Peninsula/South Bay pages** (no Bay Area Parent, no Red Tricycle Peninsula, no Mercury News family, no San Jose local). The Aloha Festival was listed on Funcheap (a configured lead) and has an official Eventbrite page, yet was still missed — a fixed leads list plus a small search budget cannot cover the festival class. The skill itself documents the same failure on 2026-07-18/19 (Teddy Bear Picnic, Hayes Valley Carnival, Japan Day, Sunday Streets all absent while the routine reported green).

The Eventbrite channel is per-org pages only (`eventbrite.com/o/<org>`); there is no Eventbrite search-by-venue/keyword source type, so orgs that list on Eventbrite without a configured page (PICA) are invisible to the engine.

## Strategy

### Tier 1 — Close the city-source gap (highest leverage; durable; do first)

1. **Every covered city gets ≥1 city-run calendar source.** Prioritize by population, starting with the 88 uncovered Bay Area cities. Most are CivicPlus (`civicpluscal` exists); libraries via `libcal`/`biblioevents`/`communicoEvents`. Target: zero cities-with-source gaps in traffic metros.
2. **Add fairground/event-center sources per metro** — Bay Area: San Mateo County Event Center (smcec.co, WordPress — check `tribeEvents`/`wpRestEvents` first), Santa Cruz/Solano/Sonoma-Marín fairgrounds. This one venue alone covers Aloha Festival, County Fair, and several annual festivals.
3. **Add an Eventbrite venue-search source type** (`eventbrite.com/e/...` pages are primary when organizer-created): search by venue or city keyword per metro. Catches orgs like PICA that self-list but aren't configured.
4. Make "cities-with-source" a first-class column in `build-coverage-summary.mjs`, so coverage has a concrete definition instead of event counts alone.

### Tier 2 — Drain the broken-source backlog instead of normalizing it

1. Add **zero-extracted count per source** to the coverage summary/trend file so dead festival sources are visible and tracked over 90 days.
2. **Repair or retire with a deadline:** a source that zero-extracts for 2 consecutive weekly prep cycles is either fixed (structured type where one exists — the fairyland fix pattern: `html` → `tribeEvents`) or retired and its class covered by Tier 1 sources. Fair homepages (`html` on `/`) are the wrong source type almost by definition — they're marketing pages, not event listings.
3. Run repair as part of the weekly loop with a real (but still bounded) budget per metro, prioritizing festival/fair/venue sources — they carry the marquee events that earn the clicks.

### Tier 3 — Make the sweep coverage-driven, not search-luck

1. **Expand leads by geography**: Bay Area needs Peninsula/South Bay lead pages (Bay Area Parent, Red Tricycle SF Peninsula, Mercury News family events, Peninsula parent groups) plus the marquee/venue calendar lead (smcec.co). Same for each metro: leads should map to that metro's geography, not just its core city.
2. **A lead-scrape step before the agent sweep**: extract candidate event links from the leads (cheap script), so the agent's search budget is spent on *verification*, not *discovery*. Currently the agent must both find and verify inside 4–6 searches.
3. **Festival lookahead from the seasonal calendar** already exists in `weekly-event-prep` step 3a-bis — enforce it per metro, and treat "annual tradition" as a trigger for `annual-events.json` (the Aloha Festival, 31 years running, is exactly that).

### Tier 4 — Prove coverage with a periodic missing-event audit

1. A monthly "known marquee events vs feed" backtest per traffic metro: take the past 4 weekends' marquee events (from leads/roundups/news), check presence in `public/data/<m>/events.json`, categorize the miss (coverage / broken source / sweep miss / not-family). This is the audit that would have caught the Aloha Festival in July.
2. Gate: traffic metros should not have a documented marquee event missing two weekends in a row.

## Immediate first fix (this weekend's miss) — DONE 2026-08-09

1. **San Mateo County Event Center is NOT a calendar source** — verified: smcec.co is a WordPress/Elementor press-release blog (no Tribe Events API, no machine-readable event list, JS-rendered archive; no 2026 Aloha post). Do not add it as a source. Its events are carried by its organizers' own channels (PICA, County Fair site).
2. **Added `pica-bay-area-aloha-festival`** (`data/event-sources.json`): officialTextEvents gated on the organizer's page pica-org.org (visible text confirms "Bay Area Aloha Festival", "August 8-9, 2026", "San Mateo County Event Center"). Extracts cleanly; event is live in the feed for the festival's final day.
3. **Added `bay-area-aloha-festival` to `data/annual-events.json`** (31-year August tradition) so the evergreen page holds rank and next year's dated event cross-links automatically.
4. Verified: re-ingest (no zero-extracted alert on the new id), event live in `public/data/bay-area/events.json`, `validate-events` green (3000 events), slug audit clean (6246 slugs).
