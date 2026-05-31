# Thin-metro event-source triage — 2026-05-31

Honolulu and Austin are starved of events. This triage live-fetched every broken
source and categorized the fix. **Source changes only take effect on the next
ingest** (`npm run ingest:events:all`) — they re-fetch + re-extract + rewrite
`events.json`. The new `/ops/analytics` "Metro coverage health" panel tracks the
numbers; `scripts/build-coverage-summary.mjs` regenerates it after each ingest.

## State (live build reports)

- **Honolulu — BELOW threshold:** 4 events vs `minEvents=5`. Only the public
  library produces events; the kids museums/zoo are blocked, empty, or
  selector-broken (see below). There is **no quick URL fix for the kids fire** —
  these venues largely don't expose machine-readable family events.
- **Austin — fragile:** 16 events vs `minEvents=10`, 2 healthy sources of 14.
- **Philadelphia — healthy but concentrated:** 536 events on 2 healthy sources
  (single-outage risk). Flagged in the dashboard, not urgent.

## Applied now (URL corrections — verified live; activate on next ingest)

These were hard-404s / stale redirects pointing at confirmed-live venue events
pages with real listings. Safe (a live URL can't extract worse than a 404):

| Source | Config | New URL |
| --- | --- | --- |
| The Republik | `event-sources-adults-honolulu.json` | `jointherepublik.com/upcoming-events/` |
| Blue Note Hawaii | `event-sources-adults-honolulu.json` | `bluenotejazz.com/hawaii/shows/` |
| Hawaii Theatre Center | `event-sources-adults-honolulu.json` | `hawaiitheatre.com/upcoming-events/` |
| Stubb's BBQ | `event-sources-adults-austin.json` | `stubbsaustin.com/concert-calendar/` |
| Cap City Comedy Club | `event-sources-adults-austin.json` | `capcitycomedy.com/calendar` |

**Caveat:** all five are HTML pages with **no JSON-LD/iCal/RSS**. The pipeline's
structured-HTML extractor may pick up some; if a re-ingest still shows 0, they
need per-page selector work (below). Verify with `npm run ingest:events:all`
then check the coverage panel.

## Needs you (not auto-applied)

**Likely-good URL updates I held back** (judgment calls):
- **Antone's Nightclub (Austin)** → Ticketmaster venue `…/venue/476138` **has
  structured data** (best extraction bet), but TM 403'd the fetcher for another
  venue, and the current URL is 200-not-404. Worth trying with a TM-aware fetch.
- **ACL Live (Austin)** → `acllive.com/` (moved; current is `acl-live.com`).

**Selector work (page loads, events present, extractor finds none):**
- The Mohawk (`mohawkaustin.com/shows`), Continental Club (`continentalclub.com/austin`),
  Alamo Drafthouse — JS-rendered calendars; need a headless fetch or an API.
- Hawaii Children's Discovery Center, Waikiki Aquarium, Iolani Palace (Honolulu kids).

**Blocked (bot/Cloudflare — likely unfixable without an API/key):**
- Bishop Museum, Honolulu Museum of Art (403), Austin Public Library.

**Candidates for removal (no public events feed → pure alert noise):**
- Honolulu Zoo, Kualoa Ranch, Aloha Comedy Club (recurring-program pages, no
  dated calendar), Thinkery (tickets open only 1 week out), Blanton Museum,
  Umlauf Sculpture Garden (genuinely empty).

## Bigger lever

Honolulu/Austin need **structured sources**, not just URL fixes: a metro-wide
aggregator (Do512 for Austin, an Oahu events feed), or Ticketmaster/Eventbrite
org pages (JSON-LD the pipeline already parses). That's the durable fix for the
"venue sites have no machine-readable events" root cause.
