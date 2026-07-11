# FamHop promo previews — June 2026

Three silent, vertical promo concepts generated from real app views.

## Concepts

1. `weekend-map` — Promote the weekend map: local events, free options, and filters.
2. `hop-now` — Promote the Hop Now function: nearby, open, starts-soon ideas.
3. `share-vote` — Promote plan sharing: one vote link instead of group-chat churn.

## Build

Start the app first:

```bash
npm run dev -- --host 127.0.0.1 --port 5173
```

Then render all three previews:

```bash
node video/promos-2026-06/build-all.mjs --app-url http://127.0.0.1:5173
```

The build captures actual app screenshots into `assets/`, then renders the
three MP4s in parallel. No voice or music is added yet.

## Outputs

- `weekend-map.mp4`
- `hop-now.mp4`
- `share-vote.mp4`

All outputs are 1080×1920 H.264 silent masters.

