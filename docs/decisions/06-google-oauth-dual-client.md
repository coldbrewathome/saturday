# ADR 06: Per-Brand Google OAuth Clients (FamHop + Mosey)

- **Status:** Accepted
- **Date:** 2026-06-06
- **Decider:** Doer agent (kning to confirm)

## Context

FamHop (kids, `famhop.com` / `saturday-spots.pages.dev`) and Mosey
(adults, `trymosey.com` / `nighthop.pages.dev`) are the same `src/App.tsx`
built twice with different `VITE_*` env vars and deployed to two Cloudflare
Pages projects. They share **one** Cloudflare Worker (`saturday-polls`),
which is what verifies Google sign-in (`POST /auth/google` →
`googleAuth()` in `worker/src/index.ts`).

Google sign-in uses Google Identity Services (GIS) in the browser
(`src/auth.ts` loads the GIS script; `src/App.tsx` calls
`initialize({ client_id: VITE_GOOGLE_CLIENT_ID, ux_mode: "popup", ... })`
and posts the returned ID-token `credential` to the Worker). The Worker
verifies the token via Google's `tokeninfo` endpoint and enforces that the
token's `aud` claim matches a configured client ID.

Originally both apps shared FamHop's single OAuth client ID. The problem:
the Google account-chooser / consent popup shows the **GCP project's**
branding (app name, logo), which is configured once per project on the
OAuth consent screen. With a shared client, Mosey users saw FamHop
branding on the sign-in popup.

## Decision

Give each brand its **own** Google OAuth Web client, and (for true brand
isolation) its own **GCP project** so the consent screen is brand-specific:

- **FamHop** — project `673443526391`, client
  `673443526391-r7oj4up03jd13ti57a6fpq6bcdas91p6.apps.googleusercontent.com`
- **Mosey** — project `1023251555604`, client
  `1023251555604-f7eablhhk0499jhjthprhgqn32vk6gvi.apps.googleusercontent.com`

The shared Worker now accepts **either** audience. `googleAuth()` builds an
`allowedAudiences` list from two env vars and checks membership instead of
strict equality against a single ID:

- `GOOGLE_CLIENT_ID` — FamHop (existing)
- `GOOGLE_CLIENT_ID_ADULTS` — Mosey (new)

Each app build mints tokens with its own `VITE_GOOGLE_CLIENT_ID`
(`.env` for kids, `.env.adults` for Mosey). The pairs must match:

| Brand  | Browser (`VITE_GOOGLE_CLIENT_ID`) | Worker (`aud` allow-list)   |
|--------|-----------------------------------|-----------------------------|
| FamHop | `.env`                            | `GOOGLE_CLIENT_ID`          |
| Mosey  | `.env.adults`                     | `GOOGLE_CLIENT_ID_ADULTS`   |

If the browser-side ID and the Worker-side allow-list drift apart, sign-in
fails with `401 audience mismatch`.

### Alternatives rejected

- **Reuse FamHop's client for both** — zero code, but Mosey's consent
  popup shows FamHop branding. Rejected for brand integrity.
- **Second client in FamHop's project** — separate client ID/origins, but
  the consent screen is per-project, so branding would still be FamHop's.
  (We briefly wired this, then moved Mosey to its own project.)
- **Two Workers** — unnecessary; one Worker accepting two audiences is
  simpler and keeps a single KV session store.

## Setup runbook (adding/rotating a brand's OAuth client)

In **Google Cloud Console** for the brand's project:

1. **OAuth consent screen** — User type *External*; set app name, logo,
   support email, domain. **Publish** it (Testing mode only lets
   allow-listed test users sign in). Scopes: defaults
   `openid email profile` only — no Google verification needed.
2. **Credentials → OAuth client ID → Web application.** Set
   **Authorized JavaScript origins** (scheme+host only, no path / trailing
   slash). For Mosey:
   ```
   http://localhost:5173
   https://trymosey.com
   https://www.trymosey.com
   https://nighthop.pages.dev
   ```
   Leave **Authorized redirect URIs** empty — the app uses
   `ux_mode: "popup"` (postMessage, not redirect).
   > Note: `*.pages.dev` per-deploy preview hashes (e.g.
   > `abc123.nighthop.pages.dev`) cannot be authorized (no wildcards), so
   > sign-in only works on the canonical subdomain + custom domains.
3. Copy the client ID into **both** the app env and the Worker var:
   - `.env.adults` → `VITE_GOOGLE_CLIENT_ID=<id>`
   - `worker/wrangler.toml [vars]` → `GOOGLE_CLIENT_ID_ADULTS = "<id>"`
4. Ensure the calling origins are in the Worker's `ALLOWED_ORIGINS` (CORS).
5. Deploy **Worker first** (so it accepts the new audience), then the app:
   ```bash
   npm --prefix worker run deploy
   npm run deploy:adults
   ```
   (FamHop needs no redeploy when only Mosey changes.)

## Verification

On the live origin (devtools):

- `accounts.google.com/gsi/client` → 200, no `[GSI_LOGGER]` "origin not
  allowed" error.
- `accounts.google.com/gsi/button?...&client_id=<brand id>` → 200 (a 403
  means the origin isn't authorized for that client).
- Click the Google button → popup shows the brand's consent screen →
  `POST /auth/google` → 201 with `{ sessionToken, user }`; `signin_success`
  metric fires.

Note: the PWA service worker caches the app shell, so a freshly deployed
client ID may not appear until the new SW activates (one extra reload, or
a cache-busted query string).
