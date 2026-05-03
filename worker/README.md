# Saturday Polls Worker

A small Cloudflare Worker that stores plan polls and anonymous votes in KV.

## One-time setup

```bash
cd worker
npm install
npx wrangler login
npx wrangler kv namespace create POLLS
npx wrangler kv namespace create POLLS --preview
```

Copy the two ids that print into `wrangler.toml` (`id` and `preview_id`).

Set the allowed origins for CORS in `wrangler.toml` (`ALLOWED_ORIGINS`, comma-separated).

For AI plan refinement, store the OpenAI API key as a Worker secret:

```bash
npx wrangler secret put OPENAI_API_KEY
```

## Develop

```bash
npm run dev
```

The dev server runs at `http://127.0.0.1:8787`. Point the React app at it via:

```
# saturday/.env.local
VITE_POLLS_API=http://127.0.0.1:8787
```

## Deploy

```bash
npm run deploy
```

## API

- `POST /polls` — `{ title, stops: [{ id, name, neighborhood, category, ... }] }` → `{ pollId, ownerToken }`
- `GET /polls/:id` — returns plan + tallies
- `POST /polls/:id/votes` — `{ voterId, votes: { [stopId]: "up" | "down" | "meh" } }` (idempotent per `voterId`)
- `POST /ai/brief` — `{ vibe, spots }` → AI-refined planner brief when `OPENAI_API_KEY` is configured

Records expire after 30 days.
