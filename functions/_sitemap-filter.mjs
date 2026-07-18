// Pure filtering logic for functions/sitemap.xml.ts. The static sitemap is
// regenerated only at deploy time (roughly weekly), but the detail guard
// starts answering 410 the moment an event's run ends — so between deploys
// the sitemap advertises URLs that Google fetches as 410 ("submitted URL not
// found" coverage errors). These helpers drop exactly the <url> entries the
// guard would already call "gone", so sitemap and page status can never
// disagree. Plain .mjs so `node --test` can import it without a TS loader.

import { missingPageDisposition, parseDetailPath } from "./_detail-guard.mjs";

const URL_BLOCK_RE = /<url>[\s\S]*?<\/url>\n?/g;
const LOC_RE = /<loc>\s*([\s\S]*?)\s*<\/loc>/;

function eventDetail(block) {
  const loc = LOC_RE.exec(block);
  if (!loc) return null;
  let pathname;
  try {
    pathname = new URL(loc[1]).pathname;
  } catch {
    return null;
  }
  const detail = parseDetailPath(pathname);
  return detail && detail.kind === "event" ? detail : null;
}

// Metros that have at least one event URL in the sitemap — the caller loads
// only these metros' manifests before filtering.
export function collectEventMetros(xml) {
  const metros = new Set();
  for (const block of String(xml || "").match(URL_BLOCK_RE) || []) {
    const detail = eventDetail(block);
    if (detail) metros.add(detail.metro);
  }
  return metros;
}

// `catalogs` maps metro -> MetroCatalog|null; a null/absent catalog falls back
// to the slug-date heuristic inside missingPageDisposition, exactly like the
// page guard. Non-event entries (spots, cities, weekend pages) pass through
// untouched.
export function filterEndedEventUrls(xml, nowMs, catalogs) {
  return String(xml || "").replace(URL_BLOCK_RE, (block) => {
    const detail = eventDetail(block);
    if (!detail) return block;
    const catalog = catalogs?.get(detail.metro) ?? null;
    return missingPageDisposition("event", detail.slug, nowMs, catalog) === "gone" ? "" : block;
  });
}
