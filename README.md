# Saturday With Friends

A Vite React app for finding friend-friendly Bay Area places to visit.

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
deduplicated, validated, and balanced across food, nightlife, outdoors, culture,
wellness, and shopping. The GitHub Actions workflow in
`.github/workflows/refresh-data.yml` refreshes the dataset daily and runs tests
before committing data changes.

Images use the most specific trustworthy source available: OSM `image` tags
first, OSM Wikimedia Commons references second, Wikidata P18 images third, and
category fallbacks only when the spot has no place-level public image metadata.
The generated JSON includes `imageStats` so the UI can show how many spots have
place-specific images.

## Current features

- Search and filter friend outing spots by area, category, cost, and listed hours.
- Review filtered spots by coordinate coverage and top areas before browsing cards.
- Browse paginated spot cards instead of rendering the full dataset at once.
- Vibe-aware planner brief for balanced, low-effort, active, food-first, night-out, and culture plans.
- Optional server-side AI refinement through the Cloudflare Worker at `POST /ai/brief`.
- Save spots into a local shortlist.
- Mark spots as visited.
- Add custom spot ideas stored in browser local storage.
- Pull current Bay Area source data through a repeatable refresh pipeline.
- Build saved plans from shortlisted spots and share them for voting when `VITE_POLLS_API` is configured.

AI refinement keeps the OpenAI API key server-side in the Worker. Without
`VITE_POLLS_API` and `OPENAI_API_KEY`, the app uses the local deterministic
planner so the browser never needs secrets.

OpenStreetMap data is © OpenStreetMap contributors and licensed under ODbL.
