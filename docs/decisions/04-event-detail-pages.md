# ADR 04: Event Detail Pages — URL Shape, Slug Strategy, Render Surface, and Aging-Out

- **Status:** Accepted
- **Date:** 2026-05-25
- **Decider:** Doer agent (kning to confirm)

## Context

`a28617b` shipped stable per-spot URLs at `dist/<metro>/spot/<slug>/` —
prerendered static HTML with Place JSON-LD, a sitemap entry, and a
legacy-alias path for slugs that churned in the old counter scheme. It
also added `scripts/validate-all-seo.mjs` (wired into `npm run ci` as
`seo:audit`) that walks the entire `dist/` and fails the build on
canonical/title/JSON-LD/sitemap drift. Spots are now a model surface.

Events are the obvious next surface to extend the same treatment to.
The pipeline (`scripts/eventPipeline.mjs` →
`public/data/<metro>/events.json`) carries everything a detail page
needs: title, venue+geo, category, ageBands, startDateTime, cost, url,
audiences. `scripts/generate-seo-pages.mjs` *already* emits
`dist/<metro>/event/<slug>/index.html` per event, sitemap-listed, with
`Event` JSON-LD (`46896a9` added `Offer.price`).

So the question is **not** "do we have event pages" — we have ~2k.
The question is: **are they good enough to be the shareable surface
the roadmap describes**, and what has to change to get there?

This ADR answers four questions before any UI work:

(a) **URL shape** — keep `/<metro>/event/<slug>/` (prerendered) or
    introduce a SPA hash route?
(b) **Slug stability** — today's slug is `slugify(event.id)`, and the
    id embeds `hash(title|venue|startDateTime|...)`. Is that stable
    enough to be a permanent URL? (Spoiler: no.)
(c) **Render surface** — keep the static prerender, add a Cloudflare
    Pages Function like `/p/{id}`, or move to client-rendered hash
    routes plus sitemap?
(d) **Aging-out** — events disappear from `events.json` after their
    weekend. What happens to the URL — 410, redirect, or noindex stub?

## (a) Event-id stability: the load-bearing constraint

The current pipeline assigns ids like:

```js
// scripts/eventPipeline.mjs:2081
id: raw.id || `${source.id}-${slugify(title)}-${hash(`${title}|${raw.venue}|${startDateTime||raw.url||source.url}`)}`
```

The hash includes **`startDateTime`**. For one-off events this is
fine — re-ingesting the same listing produces the same id. For
**recurring** events (which dominate the dataset — library
storytimes, museum members-hours, weekly farmers' markets), the
pipeline expands a template into one record per occurrence:

```js
// scripts/eventPipeline.mjs:2179
id: `${template.id}-${dateOnly(cursor)}`,
baseId: template.id,
```

A different `dateOnly` → a different id → a different
`slugify(event.id)` → a different URL. Concretely, "Members-Only Hour:
Play at the Museum" at the Children's Museum of Atlanta is:

| Commit (ingest date) | startDateTime | id suffix | URL |
| --- | --- | --- | --- |
| `66b8dcf` (pre-Memorial Day) | `2026-05-22T13:00Z` | `628cdf5aa2` | `/atlanta/event/atlanta-museum-...-628cdf5aa2/` |
| working tree (today, 05-25)  | `2026-05-25T13:00Z` | `fbc8acd06b` | `/atlanta/event/atlanta-museum-...-fbc8acd06b/` |
| next weekend's ingest        | `2026-05-29T13:00Z` | (new hash)  | (new URL) |

**Every weekly refresh re-slugs every recurring event.** That's
catastrophic for SEO (Google sees a new page every week, the old one
404s after one weekend) and for shareability (a link the parent texts
on Friday is dead by Monday).

This is the single most important constraint. Everything downstream
follows from how we fix it.

## (b) Slug strategy

### Option B1: keep `slugify(event.id)` (status quo)
- **Pro:** zero code change.
- **Con:** churns weekly for recurring events as shown above. Defeats
  the entire purpose of the roadmap task.
- **Verdict:** Reject. Documents the bug we're here to fix.

### Option B2: slug from `baseId` for recurring, `id` for one-offs
- **Pro:** `baseId` is stable across occurrences by construction — the
  recurring-template expansion sets it explicitly. One-off events
  (`baseId === null`) keep using `id`, which is already stable for
  them (its hash inputs don't include re-ingest-volatile fields once
  the listing is fixed).
- **Con:** A recurring template that runs both Saturday and Sunday
  collapses to one URL — meaning the detail page can't be "the
  Saturday 10am instance" specifically; it has to be "the template,
  with the next upcoming occurrence rendered." That's actually the
  *right* behavior for SEO and sharing ("see this museum hour" is
  more useful than "see this museum hour on May 25"), but we need to
  pick which occurrence to render and how to handle the case where the
  template is between active weekends. Handled in (d).
- **Verdict:** Accept. This is the slug source.

### Option B3: content-hash slug (`hash(normalized_title + venue)`)
- **Pro:** stable across pipeline-id refactors too.
- **Con:** opaque to users, churns whenever we tweak `slugify` or
  title-cleanup rules, and we'd still need a stable upstream identity
  to *find* a record at render time. Solves nothing B2 doesn't.
- **Verdict:** Reject.

### Option B4: dedicated stable-id pass in the pipeline
- **Pro:** most rigorous — explicit "this is the canonical identity"
  field on every event record, computed once.
- **Con:** B2 already gets us 95% there with one field we already
  have. A separate pass is the right answer **only** if B2 collisions
  turn out to be common; an audit (next task) will tell us.
- **Verdict:** Defer. If `audit-event-slugs.mjs` shows >1% collision
  rate, revisit and add an OSM-id-style stable suffix mirror of
  `getStableSuffix` in `generate-seo-pages.mjs:2679`.

### Slug format chosen

```
slug = slugify(`${title} ${venue ?? ""}`)
       + (collision ? `-${getStableSuffix(baseId ?? id)}` : "")
```

Mirrors `buildSpotSlugLookup` exactly (`generate-seo-pages.mjs:2739`).
Title-and-venue is the human-meaningful part; the suffix is only added
on collision and is derived from the stable `baseId` (or `id` for
one-offs), so the suffix itself doesn't churn either.

### Concretely for `generate-seo-pages.mjs`

`buildEventSlugLookup` at line 2722 changes from:

```js
let base = slugify(id) || slugify(`${event.title} ${event.venue ?? ""}`);
```

to:

```js
let base = slugify(`${event.title} ${event.venue ?? ""}`);
// on collision, suffix with getStableSuffix(event.baseId ?? event.id)
```

That's a small diff and lives in the lookup builder, not the page
generator. The detail-page renderer is unchanged.

## (c) Render surface

Three options, in increasing complexity:

### Option C1: keep the static prerender (chosen)
- **Pro:** already shipped. Already in the sitemap. Already JSON-LD'd
  (`buildEventJsonLd` at line 1413 emits a full `Event` schema with
  `eventAttendanceMode`, `location`, `offers`, `audience`). Already
  audited by `validate-all-seo.mjs`. Slug fix from (b) is a
  ~10-line change to `buildEventSlugLookup`. Crawlers see fully-formed
  HTML with no JS dependency. Cache-friendly (static CDN edge).
- **Con:** the page is a *standalone* SEO landing, not a SPA
  experience — clicking "Plan a day" sends the user to the metro
  guide, not back into a stateful planner with this event preloaded.
  That's a deliberate trade in `a28617b`'s spot pages and the same
  trade applies here.
- **Verdict:** Accept.

### Option C2: SPA hash route (`#/event/<slug>`) inside `App.tsx`
- **Pro:** rich interactivity — "add to plan" button, share sheet,
  related events.
- **Con:** invisible to crawlers without prerender. We'd end up
  *also* needing C1 for SEO, doubling the surface. The roadmap item
  *does* call for an `EventDetailView` component in the next task, but
  that's the in-app surface; the SEO surface is C1.
- **Verdict:** Both. The static page from C1 is the shareable
  canonical URL; the SPA hash route is the "tap a card in the app"
  surface. They render different audiences (crawler + cold link
  recipient vs. in-app browser), so they're allowed to disagree on
  layout. We do **not** redirect between them — the prerendered page
  is its own destination, like spot pages.

### Option C3: Cloudflare Pages Function (mirror `/p/{id}`)
- **Pro:** could fetch fresh event data at request time, so the page
  is never stale.
- **Con:** events are already published as static JSON; the
  prerender uses the same input. No freshness win. Adds a request-time
  worker call (latency + cost) for zero benefit on a content-driven
  surface. The `/p/{id}` function exists because *polls* are
  user-generated and not in a static asset bundle — events are.
- **Verdict:** Reject.

## (d) Aging-out behavior

Events disappear from `events.json` after their weekend. Three failure
modes to address:

1. **Recurring template, currently between active occurrences.** The
   `baseId` slug exists conceptually but the data file has no live
   record for it. Decision: at SEO-build time we keep emitting the
   page if *any* record with that `baseId` was seen in the last 90
   days (cache that as a side-table). The page describes the
   recurring pattern + the next-known occurrence; if the next
   occurrence is unknown, the page says so and links to the venue's
   official site. This is closer to "evergreen venue-program page"
   than "specific event page" — appropriate for templates.

2. **One-off event, past its date.** The slug existed; the data file
   no longer contains it. Decision: emit a **noindex page** for 30
   days that says "This event has ended" and links to the metro
   guide. After 30 days, **drop the page** — let it 404. We don't
   need a redirect: one-off events that have happened are not
   high-value link targets. Pinning them as aliases (à la
   `seo-pinned-paths.json` for spots) is overkill for ephemeral
   content.

3. **A URL someone shares Friday night for Saturday's event.** Covered
   by either case 1 or case 2 in the worst case — they tap the link
   Monday and see either the recurring template page or a "this event
   has ended" stub. Both are better than a hard 404.

### Why not 410 Gone?
Considered. 410 is the semantically-correct status for
permanently-removed content, but Cloudflare Pages serves either a
static file or a 404 — there's no straightforward way to return 410
without a Pages Function per URL, which is a lot of infrastructure
for a tiny correctness win. A `noindex` HTML stub gets Google to
de-index just as effectively, with the bonus that humans see a
useful page rather than a 404.

### Why not "redirect to metro guide"?
Considered. Sends the user somewhere useful but lies to crawlers
about what was at the URL. `noindex` stub is more honest and the UX
cost is one extra tap on a CTA we'd render anyway.

### Concretely for the pipeline

The 90-day "recent baseIds" cache lives at
`data/<metro>/event-slug-history.json`, written by the next pipeline
run and read by `generate-seo-pages.mjs`. Schema:

```json
{
  "schemaVersion": 1,
  "metroId": "atlanta",
  "updatedAt": "2026-05-25T...",
  "slugs": {
    "<slug>": { "baseId": "...", "lastSeenAt": "...", "isRecurring": true }
  }
}
```

One file per metro, tracked in git (≤30KB per metro at full
saturation). Pruned to 90 days on every pipeline run. The "this event
has ended" stub generation reads the same file to decide what to emit
for one-offs in the 30-day grace window.

## Decision summary

| Question | Answer |
| --- | --- |
| URL shape | Keep `/<metro>/event/<slug>/` (prerendered static). Add SPA `#/event/<slug>` for in-app surface; the two URLs are siblings, not redirects. |
| Slug source | `slugify(title + venue)`, collision-suffixed with `getStableSuffix(baseId ?? id)`. Mirror of `buildSpotSlugLookup`. |
| Stable id | Use existing `baseId` for recurring events (already in the schema), `id` for one-offs (already stable for them once title/venue/url are fixed). No dedicated stable-id pass for v1; revisit if collision rate >1%. |
| Render surface | Static prerender (existing). No Pages Function. SPA hash route is additive for in-app UX, not the canonical URL. |
| Aging-out | Recurring templates: page persists for 90 days of inactivity. One-offs: 30-day `noindex` "event has ended" stub, then drop. No 410, no redirect. |
| New artifact | `data/<metro>/event-slug-history.json` — 90-day rolling cache of recently-seen slugs. |

## Consequences

- The next task in this roadmap item ("add stable `slug` field to
  event records") is now scoped to: (i) compute the slug in the
  pipeline and write it to `events.json` so the SPA and SEO surface
  agree, (ii) write the slug-history cache, (iii) add
  `scripts/audit-event-slugs.mjs` mirroring the spot-slug audit. The
  page-generation changes in `generate-seo-pages.mjs` are a 1-function
  edit (`buildEventSlugLookup`).
- `EventDetailView` (third task) renders against the slug field on the
  event record, not against `id`. URL is `#/event/<slug>` and the
  loader looks the slug up via the in-memory events array.
- The sitemap and `validate-all-seo.mjs` keep working unchanged —
  same `/<metro>/event/<slug>/` shape, fewer slug-churn diffs in
  weekly refresh PRs.
- `data/<metro>/event-slug-history.json` is a new tracked artifact.
  It's bounded (90-day window, prune on every run) and small.
- No new dependencies, no new infra, no new secrets.
- Weekly event-refresh diffs get *smaller* on average — today every
  recurring event re-slugs, generating churn in `dist/`. After this
  change, only the few events whose title or venue actually changed
  produce new slugs.

## Rollback

The slug fix is a pure rename in `buildEventSlugLookup`. Reverting
that one function restores the status-quo (churning) behavior; the
slug-history JSON files can be deleted. The "event has ended" stub
generation is a new code branch in `generateEventPages` that can be
gated behind a feature flag if it misbehaves. The SPA `EventDetailView`
is self-contained and deletable with no impact on existing routes.
