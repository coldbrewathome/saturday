# FamHop

A Vite React app (famhop.com) for planning the weekend with the kids in the
Bay Area — parks, libraries, museums, family-friendly venues, and family
events.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Build

```bash
npm run build
```

## Data refresh

The Bay Area dataset is generated from OpenStreetMap through the Overpass API.

```bash
npm run ingest:bay-area
npm run ingest:events
npm run validate:data
npm run validate:events
```

The generated file lives at `public/data/bay-area-spots.json`. It is sanitized,
deduplicated, validated, and balanced across food, outdoors, culture, wellness,
and shopping (Nightlife is excluded from the kid-focused build). The GitHub
Actions workflow in `.github/workflows/refresh-data.yml` refreshes the dataset
daily and runs tests before committing data changes.

Events are generated from `data/event-sources.json` (kid-facing feeds) plus
`data/event-sources-adults.json` (adult-audience feeds) and recurring templates
in `data/event-templates.json` into `public/data/events.json`, with diagnostics
in `public/data/event-build-report.json`. The event pipeline first attempts
live structured extraction from official source pages (JSON-LD, ICS, RSS/XML,
JSON, LibCal, BiblioCommons events, LibraryCalendar cards, Drupal Views AJAX
cards, and dated HTML event cards). If a trusted source is reachable but does
not expose parseable dated events, it expands the configured recurring
templates so the app still has dated weekend options while the build report
shows the fallback.

## Shared dataset (multi-app)

Every spot and event in `public/data/*.json` carries an `audiences` array —
one of `["kids"]`, `["adults"]`, or `["all"]`. The values are inherited from
the source registry (`defaults.audiences`) and refined per item by the
heuristics in `resolveAudiences()` / `deriveSpotAudiences()`. CORS on `/data/*`
is open (`public/_headers`) so a sibling app on a different domain can fetch
the same JSON and filter to its own audience. The kid-facing FamHop frontend
filters on read against `APP_AUDIENCE = "kids"` so adult-tagged entries never
leak in here.

Images use the most specific trustworthy source available: OSM `image` tags
first, OSM Wikimedia Commons references second, Wikidata P18 images third, and
category fallbacks only when the spot has no place-level public image metadata.

## Current features

- Pick-a-vibe home funnel that builds a 3-stop family plan in one tap, tuned
  for the visitor's city via Cloudflare IP geolocation.
- Age-band filter (toddler / preschool / school-age / tween) that biases the
  AI suggestion and local rank toward age-appropriate stops.
- Browse mode with full filter set, real "open now" computation from parsed
  OSM `opening_hours`, accessibility / dogs-allowed chips, geolocation-based
  distance.
- Saved shortlist, manual + AI-built plans, share-for-voting links backed by
  a Cloudflare Worker (KV-stored polls, anonymous voters, per-IP rate limit).
- Google sign-in unlocks AI refine + cross-device sync of saved spots and
  plans.

AI refinement keeps the OpenAI API key server-side in the Worker. Without
`VITE_POLLS_API` and `OPENAI_API_KEY`, the app uses the local deterministic
planner so the browser never needs secrets.

OpenStreetMap data is © OpenStreetMap contributors and licensed under ODbL.
