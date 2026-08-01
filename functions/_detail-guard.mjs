// Pure decision logic for the [[path]].ts detail-page guard. The leading
// underscore keeps this file out of the Pages route table (it is imported,
// not served) — same pattern as functions/api/_data.ts. Plain .mjs so
// `node --test tests/seo-*.test.mjs` can import it without a TS loader.

// /{metro}/event/{slug}/ or /{metro}/spot/{slug}/ (trailing slash optional).
const DETAIL_PATH_RE = /^\/([a-z0-9-]+)\/(event|spot)\/([^/]+)\/?$/;

export function parseDetailPath(pathname) {
  const match = DETAIL_PATH_RE.exec(String(pathname || ""));
  if (!match) return null;
  return { metro: match[1], kind: match[2], slug: match[3] };
}

// Event slugs end in the event's start date, e.g.
// "canoga-park-memorial-day-parade-2026-05-25". Returns the UTC timestamp
// after which the event counts as over: UTC midnight of the slug date plus
// two days — one for the event day itself and one of grace, so an event is
// never declared ended while its start day is still in progress in any US
// timezone. Returns null for undated slugs or impossible dates.
export function slugEndedAfterMs(slug) {
  const match = /(\d{4})-(\d{2})-(\d{2})$/.exec(String(slug || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return Date.UTC(year, month - 1, day) + 2 * 24 * 60 * 60 * 1000;
}

// Post-end grace window: an ended event keeps serving a real 200 page for 14
// days before the 410 lands. Pre-grace, pages were destroyed at the exact
// end instant — right as they ranked (~13-day runway) — and the sitemap lost
// 100-300 URLs/day, teaching Google the inventory evaporates. The eventual
// 410 stays: the soft-404 guard exists for good reason.
export const ENDED_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

// "gone" once the grace window after `endMs` has fully elapsed, "ended-grace"
// while inside it, null when the event has not ended yet.
function endedDisposition(endMs, nowMs) {
  if (nowMs < endMs) return null;
  return nowMs >= endMs + ENDED_GRACE_MS ? "gone" : "ended-grace";
}

// What to do with a detail URL that has no prerendered page:
// - "gone": ended event, past the 14-day grace window → HTTP 410 branded
//   page (noindex). Without this, expired event URLs serve the SPA shell
//   with 200 + index,follow — thousands of soft-404s.
// - "ended-grace": ended event still inside the grace window → serve the
//   prerendered page (if any) or the branded ended page with 200, keeping
//   the URL alive through its ranking earn-out.
// - "not-found": event slug the catalog has never recorded → HTTP 404
//   (noindex). Only returned when an authoritative `catalog` is supplied;
//   without it we cannot tell a fake slug from a real-but-uncatalogued one,
//   so we fall back to "noindex-shell".
// - "noindex-shell": a live-but-not-prerendered event (capped out of the page
//   budget), or any spot, or — with no catalog — a future/undated event.
//   Serve the SPA shell but add x-robots-tag: noindex. 410/404 are wrong for
//   spots (a spot can re-earn its prerendered page on a later build) and for
//   live capped events (the page is real, just not statically rendered).
//
// `catalog` (optional) is the per-metro event-seo-manifest classification:
//   { liveSet: Set<slug>, liveEnds?: Record<slug, msEpoch>, endedSet: Set<slug> }.
//   liveSet = slugs in the current dataset; liveEnds = the true end instant
//   for a live slug (spans the full occurrence run for a deduped multi-date
//   event) — authoritative over the slug-date+2d heuristic below, which
//   would otherwise 410 a live multi-day event partway through its run (its
//   slug carries the *start* date). endedSet = slugs seen in the rolling
//   slug history but no longer live. When present, `catalog` is authoritative
//   for the unknown->404 split.
/**
 * @param {string} kind
 * @param {string} slug
 * @param {number} [nowMs]
 * @param {{liveSet?: Set<string>, liveEnds?: Record<string, number>, endedSet?: Set<string>} | null} [catalog]
 * @returns {"gone"|"ended-grace"|"not-found"|"noindex-shell"}
 */
export function missingPageDisposition(kind, slug, nowMs = Date.now(), catalog = null) {
  if (kind === "event") {
    if (catalog) {
      const hasLiveEnd = catalog.liveEnds && Object.prototype.hasOwnProperty.call(catalog.liveEnds, slug);
      if (hasLiveEnd) return endedDisposition(catalog.liveEnds[slug], nowMs) ?? "noindex-shell";
      if (catalog.endedSet && catalog.endedSet.has(slug)) {
        // Dropped from the live feed. Grace applies only when the slug's own
        // date shows a genuinely past event; a future-dated or undated slug
        // that vanished was cancelled/removed — keep the immediate 410 so a
        // stale prerender can't keep advertising it as attendable.
        const endedAfter = slugEndedAfterMs(slug);
        if (endedAfter !== null && nowMs >= endedAfter) return endedDisposition(endedAfter, nowMs);
        return "gone";
      }
      if (catalog.liveSet && catalog.liveSet.has(slug)) return "noindex-shell";
      // Authoritative catalog, slug unknown to it, and no live end on record —
      // fall back to the slug-date heuristic for a past date, else it never
      // existed.
      const endedAfter = slugEndedAfterMs(slug);
      if (endedAfter !== null && nowMs >= endedAfter) return endedDisposition(endedAfter, nowMs);
      return "not-found";
    }
    // No catalog at all — the slug-date heuristic is all we have.
    const endedAfter = slugEndedAfterMs(slug);
    if (endedAfter !== null && nowMs >= endedAfter) return endedDisposition(endedAfter, nowMs);
  }
  return "noindex-shell";
}
