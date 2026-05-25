# ADR 03: Analytics Dashboard for Funnel Metrics — Scope, Storage, and Auth

- **Status:** Accepted
- **Date:** 2026-05-25
- **Decider:** Doer agent (kning to confirm)

## Context

`239ab7f` shipped privacy-safe first-party funnel metrics: a
client-side `trackMetric(name, metroId)` (`src/api.ts`) fires
`sendBeacon` against `POST /metric`, which the worker increments into
daily KV counters. The data is write-only today — no UI reads it. We
need a dashboard so growth/feature decisions stop flying blind, paired
with the just-shipped `/ops/alerts` surface (same operator audience).

This ADR answers four questions before any UI work:

(a) What's actually captured today?
(b) Which 3–5 funnel questions should v1 answer?
(c) What's the storage surface? (KV today; D1? snapshot?)
(d) What's the auth model? (reuse `/ops/alerts`'s unauth read vs.
    something else)

## (a) Event schema captured today

Source: `worker/src/index.ts` (`recordMetric` / `readMetrics`,
`METRIC_NAMES`) and the `trackMetric` call sites in `src/App.tsx` and
`src/PollView.tsx`.

**Storage shape (KV namespace `POLLS`):**

```
key:   metric:{name}:{metro}:{YYYY-MM-DD}
value: "<integer count>"   (stringified)
ttl:   ~120 days
```

For each event, the worker writes **two** keys: one with the real
metro id (`metric:app_open:atlanta:2026-05-24`) and one with
`metro=all` (`metric:app_open:all:2026-05-24`). The `all` bucket is a
denormalized roll-up so the read endpoint can sum without listing every
metro.

**Allowlisted event names (9):**

| name | fires from | meaning |
| --- | --- | --- |
| `app_open` | `App.tsx` mount effect | session start (one per route load) |
| `hop_now_opened` | `openHopNow()` | Hop-me-now sheet opened |
| `plan_shared` | post-share success | a generated plan URL was shared |
| `poll_viewed` | `PollView` load | recipient opened a shared plan |
| `vote_cast` | `PollView` first submit per session | conversion (engaged with shared plan) |
| `weekend_guide_click` | weekend-guide entry CTA | navigation into the guide surface |
| `signin_prompt_shown` | `App.tsx` post-load effect | sign-in nudge rendered |
| `signin_prompt_clicked` | sign-in nudge click | engaged with the nudge |
| `newsletter_subscribed` | newsletter card success | email captured |

**Per-event payload:** name + optional metro id. **No PII**, no user
id, no timestamps beyond the day bucket, no referrer, no UA. The
worker also rate-limits per IP (`checkAndIncrementCap` cap 500) so a
single client can't run up KV writes.

**Read endpoint today (`GET /metrics?days=N`)** is admin-gated and
returns:

```json
{
  "days": 30,
  "totals": { "app_open": 1234, "vote_cast": 56, ... },
  "byDay":  { "2026-05-24": { "app_open": 42, ... }, ... }
}
```

**Gap worth naming up front:** the read endpoint only sums the `all`
metro bucket. Per-metro counters are written but **not exposed** by
the current GET. The per-metro dashboard table (later task in this
roadmap item) will need a small worker change to either accept a
`metro=` filter or return `byMetro` totals. We tackle that in the
loader task, not here.

## (b) The 3–5 funnel questions v1 answers

Picked for **highest signal, lowest analysis surface** — each one is
already a single counter or a 2-counter ratio. No new instrumentation
required.

1. **"Are people actually using the app this week?"**
   → `app_open` 7-day total, with 7-day delta vs. the prior week.
   The baseline traffic question. If this drops, nothing else
   matters.

2. **"Is the share loop working?"**
   → `plan_shared` → `poll_viewed` → `vote_cast` funnel, as three
   counters + two conversion ratios:
   - `poll_viewed / plan_shared` = "did the recipient open it?"
   - `vote_cast / poll_viewed` = "did the recipient engage?"
   This is the load-bearing growth loop; the metric set was
   instrumented expressly to measure it (see `239ab7f` body).

3. **"Is Hop-me-now finding its users?"**
   → `hop_now_opened` total + `hop_now_opened / app_open` ratio.
   Feature was a big bet; we should know if it's used at all.

4. **"Is the sign-in nudge converting or just annoying?"**
   → `signin_prompt_clicked / signin_prompt_shown`. A bad ratio
   (<2%) is a signal to tone the prompt down; a good ratio (>10%)
   suggests we should surface it more.

5. **"Which metros have traction?"** _(per-metro breakdown table)_
   → `app_open` per metro, sorted desc. Single column, links each
   row to the live metro guide page. Answers "where should we focus
   content / source-curation effort?" in one glance.

Explicitly **out of scope for v1:**

- `newsletter_subscribed` and `weekend_guide_click` get rendered as
  raw counters in the same grid but no ratio analysis — too few
  weeks of data, and the newsletter is mid-activation (separate
  external ops work, see ROADMAP "Later").
- Cohort retention, time-of-day analysis, anything requiring more
  than the current daily-bucket schema.
- A/B test scaffolding.
- Per-feature pageviews beyond what's already captured.

## (c) Storage surface

**Decision: keep the existing KV schema. No D1, no snapshot.**

Considered:

### D1 (SQLite)
- **Pro:** Real query language; per-metro / per-name / per-day
  arbitrary GROUP BY without listing every key.
- **Con:** Requires a migration from KV (or dual-write), a schema, a
  D1 binding in `wrangler.toml`, and rewriting `recordMetric` to
  `INSERT ... ON CONFLICT UPDATE`. Today's read volume is **one
  operator, a handful of times per week.** The dashboard fits in a
  single `KV list` + sum pass; D1 is over-engineered for the question
  it would answer.
- **Verdict:** Reject for v1. Revisit when (i) we want sparkline
  granularity finer than daily, (ii) we want >10 metric types, or
  (iii) read volume crosses ~50 dashboard loads/day.

### Pre-aggregated JSON snapshot in `public/data/`
- **Pro:** Dashboard would be a static fetch — zero worker traffic on
  read, mirrors the `/ops/alerts` pattern exactly.
- **Con:** Requires a Cron Trigger (or CI step) to roll KV into the
  snapshot. The metrics counters are **not public data** (no PII, but
  they leak vote-cast volume which is competitively sensitive).
  Publishing them as a static asset puts them on the public CDN.
  Either we accept that, or we add a worker-fronted snapshot — at
  which point we've reinvented the existing `/metrics` endpoint.
- **Verdict:** Reject. The data sensitivity argues against
  mirroring `/ops/alerts` here.

### Keep KV + the existing `/metrics` endpoint (chosen)
- **Pro:** Already shipped, already admin-gated, already correct for
  the daily-bucket / handful-of-metric-names regime. The list+sum is
  fast — at 9 names × 14 metros × 30 days = 3,780 keys (worst case at
  full saturation), well within KV's listing throughput. The 120-day
  TTL caps unbounded growth.
- **Con:** One small change needed — the endpoint must expose
  per-metro totals (it currently only sums the `all` bucket). Done by
  extending the response with a `byMetro` map. No schema change.
- **Verdict:** Accept.

## (d) Auth model

**Decision: reuse the existing `/metrics` session-based admin gate.
Do NOT mirror `/ops/alerts`'s unauthenticated read model.**

`/ops/alerts` (ADR 02) is unauthenticated because the underlying alert
JSON is already public on the CDN. Analytics is different:

- The raw data is **not public** today — `/metrics` requires an admin
  session (`isAdmin(env, session.data.email)`).
- It's also **competitively meaningful** — share-loop conversion
  rates and metro traction would tell a competitor exactly which
  cities are working and which growth experiments paid off. ADR 02's
  "the data is already public, gating the UI is security theater"
  reasoning does **not** apply here.
- The infrastructure exists. `isAdmin` + Google sign-in is the same
  gate `/admin/events` and `/api/newsletter/send` already use.

**Concretely for the UI:**

- The `/ops/analytics` route renders unconditionally (no token in the
  bundle is meaningful, same as ADR 02 reasoning).
- The loader (`src/ops/loadAnalytics.ts`, next task) calls `GET
  /metrics` with `credentials: "include"` so the existing session
  cookie is sent.
- 401/403 from the worker → render a "Sign in as an admin to view
  analytics" empty state with a link to the existing sign-in flow.
  No client-side gating, no secrets in the bundle.
- Discoverability: same as `/ops/alerts` — unlisted route, operator
  knows the URL. Add a one-line cross-link from the alerts page to
  `#/ops/analytics`.

### Why not reuse `NEWSLETTER_ADMIN_TOKEN` (the bearer-header pattern)?

The newsletter token is a **CLI/server-to-server** secret for the
weekly send job. The dashboard is **interactive in a browser** —
shipping that token in the bundle would expose it to any visitor with
devtools. The session-cookie path already exists for exactly this
use case.

## Decision summary

| Question | Answer |
| --- | --- |
| Schema today | `metric:{name}:{metro}:{date}` → int, 9 allowlisted names, daily buckets, 120d TTL |
| v1 questions | (1) app_open WoW (2) share-loop funnel (3) hop-now adoption (4) sign-in prompt CTR (5) per-metro `app_open` table |
| Storage | Keep KV. Extend `GET /metrics` to include a `byMetro` map. No D1, no snapshot. |
| Auth | Reuse existing session-based `isAdmin` gate. Browser sends cookie via `credentials: "include"`. 401 → empty-state sign-in CTA. |

## Consequences

- One small worker change is on the critical path of the next task
  (loader): extend `readMetrics` response with per-metro totals.
  Estimated <20 LOC and additive (no breaking change to existing
  shape).
- `/ops/analytics` joins `/ops/alerts` under `src/ops/`; same
  hash-route pattern, same file conventions.
- No new infra, no new secrets, no new dependency.
- The dashboard is **admin-only** by design — if we ever want a
  public "we have N happy families across N metros" social-proof
  widget, that's a separate, deliberately public, deliberately
  rounded export.

## Rollback

The route is self-contained under `src/ops/analytics*`. If the
dashboard turns out to be the wrong surface, delete those files and
drop the `AppRoute` enum value. The `/metrics` endpoint and the KV
keys it reads pre-date this ADR and stay regardless.
