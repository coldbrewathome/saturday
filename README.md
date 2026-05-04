# Weekend With Kids

A Vite React app for planning the weekend with the kids in the Bay Area —
parks, libraries, museums, family-friendly venues, and family events.

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
npm run validate:data
```

The generated file lives at `public/data/bay-area-spots.json`. It is sanitized,
deduplicated, validated, and balanced across food, outdoors, culture, wellness,
and shopping (Nightlife is excluded from the kid-focused build). The GitHub
Actions workflow in `.github/workflows/refresh-data.yml` refreshes the dataset
daily and runs tests before committing data changes.

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
