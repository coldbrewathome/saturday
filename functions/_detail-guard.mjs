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

// What to do with a detail URL that has no prerendered page:
// - "gone": ended event → HTTP 410 branded page (noindex). Without this,
//   expired event URLs serve the SPA shell with 200 + index,follow —
//   thousands of soft-404s.
// - "noindex-shell": future/undated event (e.g. capped-out live events) or
//   gated-out spot → serve the SPA shell but add x-robots-tag: noindex.
//   410 is wrong for spots: a spot can re-earn its prerendered page on a
//   later build, and undated slugs give no evidence the thing is over.
export function missingPageDisposition(kind, slug, nowMs = Date.now()) {
  if (kind === "event") {
    const endedAfter = slugEndedAfterMs(slug);
    if (endedAfter !== null && nowMs >= endedAfter) return "gone";
  }
  return "noindex-shell";
}
