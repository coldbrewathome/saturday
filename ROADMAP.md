# Roadmap

_Last updated: 2026-05-23_

## Now
_In flight — actively being worked on. Keep this to 1–3 items._

### Newsletter delivery
- **Why:** `1d3ae14` shipped the newsletter capture card in the plans view, but there's no send pipeline yet. Collecting emails with no value loop leaks signups and trains users that subscribing does nothing.
- **Effort:** M (1–2 days)
- **Links:** `src/App.tsx`, `src/api.ts` (newsletter card), `worker/src/` (host for send)
- **Tasks:**
  - [ ] Pick provider (Resend vs. MailChannels vs. SES) and write the decision + chosen domain/from-address to `docs/decisions/01-newsletter-provider.md`. Should fit in <2h.
  - [ ] Inventory the current capture path: trace where `src/App.tsx` newsletter card POSTs to and where addresses are stored today (KV? D1? nowhere?). Write findings as a short "Current state" section appended to the decision doc.
  - [ ] Scaffold `worker/src/newsletter.ts` exporting a `sendWeekendDigest(env, recipients)` stub + wire `POST /api/newsletter/send` in `worker/index.ts` behind an admin token from `env`. No real send yet — log payload and return `{ ok: true, count }`.
  - [ ] Implement the provider call inside `sendWeekendDigest` using the chosen SDK/HTTP; gate on `env.NEWSLETTER_ENABLED`. Add API key to `wrangler.toml` as a secret reference (not value).
  - [ ] Build the digest HTML template (`worker/src/newsletter-template.ts`): per-metro "this weekend" top 3 plans + 5 events, pulled from `public/data/{metro}/featured-plans.json` and `events.json`. Plaintext fallback included.
  - [ ] Add a dry-run CLI: `scripts/newsletter-preview.mjs <metro>` that renders the template to `tmp/newsletter-preview.html` for visual QA. No network.
  - [ ] Send a real test to a single allowlisted address (operator email), confirm rendering in Gmail + Apple Mail, then document the manual weekly send command in `docs/decisions/01-newsletter-provider.md`.

## Next
_Committed, not yet started. Ordered by priority. Aim for ≤5 items._

### Operator-alerts triage UI
- **Why:** `0936fea` and `22bdfb9` generate per-metro `event-operator-alerts.json` (broken sources, last-known-good fallbacks, etc.), but today they only exist as JSON in `public/data/{metro}/`. No human workflow to act on them — alerts will keep piling up.
- **Effort:** M (1–2 days)
- **Links:** `public/data/*/event-operator-alerts.json`, `scripts/event-ops-agent.mjs`, `scripts/source-repair-agent.mjs`

## Later
_Candidates and ideas. Unordered. No commitment._

- **Analytics dashboard for funnel metrics** — `239ab7f` added privacy-safe first-party metrics; there's no UI to read them, so the data is invisible. _Effort: M._
- **Event detail pages (shareable, SEO-indexed)** — pairs with the rich share previews from `46896a9` and the heavy event pipeline investment; per-event landing pages are the missing surface. _Effort: M._
- **PWA / install + offline weekend cache** — mobile-first weekend use case is the canonical PWA fit; the mobile FAB from `9754dda` shows the pattern is working. _Effort: M._
- **Weekend reminder push (Fri-AM "your weekend is set")** — retention play that pairs sign-in (`1d3ae14`) with Hop-me-now; depends on PWA shipping first. _Effort: M (after PWA)._
- **Free-text search across spots + events** — current discovery is filter-only; a known ceiling for browse-style apps as the dataset grows. _Effort: M._
- **NightHop content/parity audit** — `deploy:adults` and the `audiences` arrays exist, but it's unclear how much adult-specific surface there is vs. just filtered kid data. _Effort: S audit → L close gaps._
- **UI/component tests** — `tests/` covers pipeline + planner, but nothing exercises `App.tsx`, `auth.ts`, or the plans view; React refactors are unsafe. _Effort: M._
- **Repo cleanup: root-level screenshots + tracked drift** — ~35 PNG screenshots at repo root, plus ~50 files of routine event-data drift in the working tree. _Effort: XS._

## Done
_Recently shipped (last ~10 items). Trim older ones into a separate CHANGELOG if needed._

- 2026-05-22 · **Agentic event ops workflow** — automated event ops + source repair agents.
- 2026-05-22 · **Newsletter capture card** — sign-in prompt + newsletter card on plans view.
- 2026-05-22 · **Stable spot slugs + SEO audit in CI** — legacy URL aliases preserved.
- 2026-05-22 · **Interactive Event Finder** — on weekend guide pages.
- 2026-05-19 · **Privacy-safe funnel metrics** — first-party measurement, no third-party trackers.
- 2026-05-19 · **Rich share previews** — weekend-guide event rich results.
