# ADR 01: Newsletter Delivery Provider

- **Status:** Accepted (pending DNS confirmation from operator)
- **Date:** 2026-05-23
- **Decider:** Doer agent (kning to confirm domain ownership)

## Context

The Friday weekend digest capture card shipped in `1d3ae14` and writes
subscribers to KV (`worker/src/index.ts` `subscribeNewsletter`, key
`newsletter:{metro}:{email}`). There is no send pipeline. We need one
provider for the weekly digest that:

1. Runs from the existing Cloudflare Worker (`saturday-polls`) — no new
   infra to babysit.
2. Authenticates with SPF/DKIM/DMARC on `famhop.com` so Gmail/Apple Mail
   don't dump it in spam.
3. Has a free or near-free tier at our volume (low hundreds of
   subscribers, weekly cadence — well under 3k sends/month at launch).
4. Reasonable to swap out later if volume grows past 50k/month.

## Options considered

### MailChannels
- **Pro:** Was the de-facto CF Workers email path; well-documented
  `fetch("https://api.mailchannels.net/tx/v1/send")`.
- **Con:** The historically free CF Workers integration ended in
  mid-2024; MailChannels is now a paid product (Transactional plan,
  metered). At our volume the price isn't bad, but the "it just works
  from a Worker" advantage is gone, so we'd be paying for an SMTP relay
  with no dashboard, no subscriber view, no template editor.
- **Verdict:** Reject. We'd take on cost without the ergonomics of a
  modern provider.

### Amazon SES
- **Pro:** Cheapest at scale ($0.10/1k), rock-solid deliverability.
- **Con:** Sandbox-by-default (must request production access),
  AWS account + IAM + verified identity + DKIM CNAMEs to manage,
  Signature V4 signing from a Worker is awkward without the SDK.
  Over-engineered for "send one digest a week to a few hundred parents."
- **Verdict:** Reject for now; revisit if we cross ~50k sends/month.

### Resend
- **Pro:** First-class HTTP API (`POST https://api.resend.com/emails`
  with a Bearer token — trivial from a Worker, no SDK required), 3k
  free emails/month + 100/day, React Email templates if we want them
  later, dashboard with bounces / opens / delivery logs, clean
  domain-verification flow (SPF + DKIM + optional DMARC CNAMEs).
- **Con:** Hosted SaaS — adds a vendor and an API key to rotate. Free
  tier is per-account, not per-domain.
- **Verdict:** Accept.

## Decision

**Use Resend.** Authenticate via `RESEND_API_KEY` stored as a Worker
secret (`wrangler secret put RESEND_API_KEY`, not committed to
`wrangler.toml`). Call the HTTP API directly from
`worker/src/newsletter.ts` — no SDK dependency.

### Chosen from-address

- **From:** `FamHop Weekend <weekly@famhop.com>`
- **Reply-To:** `hello@famhop.com` (TODO(human): confirm this inbox
  exists or pick another; operator email is `kaining.usc@gmail.com` if
  we want replies to land there directly during the test phase)
- **List-Unsubscribe header:**
  `<mailto:unsubscribe@famhop.com>, <https://famhop.com/unsubscribe?token=...>`

**Assumption:** `famhop.com` is the production domain (confirmed via
`ALLOWED_ORIGINS` in `worker/wrangler.toml` and `MEMORY.md`). DNS is
assumed to be operator-controlled; the DKIM/SPF CNAMEs Resend
provisions on domain verification need to be added before the first
real send. TODO(human): confirm DNS access and add the records Resend
shows in the dashboard.

## Rollback

If Resend's deliverability is bad on a real test, or pricing changes,
swap is contained:

1. The send code lives behind `sendWeekendDigest(env, recipients)` in
   `worker/src/newsletter.ts` — change the HTTP call body/URL and the
   secret name. No call sites move.
2. Subscriber data is in our KV, not Resend — no export needed.
3. SPF/DKIM records on `famhop.com` are additive; leaving stale Resend
   CNAMEs in DNS is harmless while a new provider's records are added.

Fastest rollback if a send goes wrong mid-week: set
`NEWSLETTER_ENABLED=false` in `wrangler.toml` `[vars]` and redeploy —
the send function will short-circuit and return `{ ok: true, count: 0,
skipped: "disabled" }`.

## Current state (capture path inventory)

Where addresses come from today, where they go, what's missing.

### Capture surfaces (two)

1. **React app — plans view newsletter card** (`src/App.tsx:5771`
   `NewsletterCard`). POSTs via `subscribeNewsletter()` in
   `src/api.ts:274` to `${VITE_API_BASE}/newsletter`. Sends
   `{ email, metroId, ageBand?, source?, url? }`. Source defaults to
   `"weekend-guide"` server-side if omitted. Card auto-dismisses and
   sets `localStorage` keys `saturday.newsletterSubscribed` /
   `saturday.newsletterDismissed`.
2. **Pre-rendered SEO weekend-guide pages** (`scripts/generate-seo-pages.mjs:2282`
   `renderNewsletterSignup` + `renderNewsletterScript`). Inline `<script>`
   POSTs to `${POLLS_API}/newsletter` with the same shape, plus
   `source: "weekend-guide"` and `url: window.location.href`. Gated by
   `if (IS_ADULTS) return ""` — NightHop pages do not have a signup.

Both surfaces hit the same endpoint; no other capture paths exist.

### Server endpoint

`POST /newsletter` in `worker/src/index.ts:1360` → `subscribeNewsletter`
handler at `worker/src/index.ts:~1200`. Validates email via
`cleanEmail`, normalizes `metroId` (default `"unknown"`), `ageBand`,
`source` (default `"weekend-guide"`), and `url`. Returns
`{ ok: true }` on success, `{ error }` with 400 on bad input.

### Storage — KV, not D1

Subscribers live in the `POLLS` KV namespace
(`worker/wrangler.toml`, id `dd49dd61e74b4823b9427a91df59eb3e`) at key
`newsletter:{safeKvSegment(metroId)}:{safeKvSegment(email)}`. Value is
JSON matching the `NewsletterRecord` type
(`worker/src/index.ts:45`):

```ts
{ email, metroId, ageBand?, source?, url?, createdAt, updatedAt }
```

Re-subscribes preserve `createdAt` and bump `updatedAt`. No TTL — these
records persist indefinitely.

### What's missing (gaps the send pipeline must fill)

- **No list/export endpoint.** Nothing reads back the `newsletter:*`
  KV keys. The send pipeline will need an internal helper that paginates
  `env.POLLS.list({ prefix: "newsletter:" })` and parses each value.
  Optionally filter by `metroId` for per-metro digests.
- **No unsubscribe.** Schema has no `unsubscribedAt` field and the worker
  has no `/newsletter/unsubscribe` route. The List-Unsubscribe header
  promised above is unimplemented. Adding this is in-scope for the send
  pipeline; one approach: HMAC-signed token in the URL → DELETE the KV
  key (or set `unsubscribedAt` and skip on send).
- **No confirmation / double opt-in.** Signups are written immediately.
  For a low-volume weekly digest from a known operator this is
  acceptable; revisit if abuse appears.
- **No bounce / complaint handling.** Resend exposes webhooks for
  bounce/complaint events — wire a `/newsletter/webhook` route in a
  later task and mark records that bounce as `bouncedAt` so the sender
  skips them. Out of scope for the initial scaffold.
- **No admin visibility.** `readMetrics` exists for funnel metrics but
  there's no equivalent for "how many subscribers in metro X". A small
  admin-gated `/newsletter/stats` route (count per metro) would help,
  but it's not blocking the first send.
- **Subscribers from before today have `source` defaulted to
  `"weekend-guide"` server-side regardless of true source.** That's a
  data-quality nit, not a blocker — keep in mind when interpreting
  signup-funnel attribution.
