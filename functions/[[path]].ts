// Cloudflare Pages Function guarding /{metro}/event/* and /{metro}/spot/*
// detail URLs (scoped via public/_routes.json — it is NOT invoked for other
// paths, so static pages elsewhere keep zero-function serving).
//
// Why: the build prerenders only capped, quality-gated detail pages and the
// 20k-file Pages limit forbids ended-event stub files (SEO_MAX_ENDED_STUBS=0).
// Any detail URL without a static file falls back to the SPA shell with
// 200 + index,follow + canonical-to-homepage — a soft-404 at scale (e.g.
// /los-angeles/event/canoga-park-memorial-day-parade-2026-05-25/).
//
// Behavior:
// - Real prerendered page → env.ASSETS passthrough, untouched.
// - Missing event page whose slug is a past YYYY-MM-DD or is in the metro's
//   ended-slug catalog → HTTP 410 with a small branded "event ended" page,
//   soft-landing links to upcoming events, x-robots-tag: noindex.
// - Missing event page whose slug the catalog has never recorded → HTTP 404
//   (real not-found, noindex) instead of a soft-404 200 shell.
// - Missing event page that IS a live (capped-out) event, or any missing spot
//   page → serve the SPA shell with x-robots-tag: noindex (the shell must
//   never be indexed under detail URLs; spots/live events can earn a page).

import { missingPageDisposition, parseDetailPath } from "./_detail-guard.mjs";

type Env = { ASSETS: { fetch: (input: Request | string) => Promise<Response> } };
type Context = { request: Request; env: Env };

type UpcomingLink = { slug: string; title: string };
type MetroCatalog = {
  liveSet: Set<string>;
  endedSet: Set<string>;
  upcoming: UpcomingLink[];
};

// Per-isolate cache of each metro's classification manifest. The manifest is a
// static asset (dist/data/<metro>/event-seo-manifest.json) emitted by the SEO
// build; fetching it only happens on the missing-page path, and the parsed
// result is reused for the life of the isolate. A null entry means "no usable
// manifest" — we then fall back to date-only disposition and never hard-404.
const catalogCache = new Map<string, MetroCatalog | null>();

async function loadCatalog(env: Env, origin: string, metro: string): Promise<MetroCatalog | null> {
  if (catalogCache.has(metro)) return catalogCache.get(metro) ?? null;
  let catalog: MetroCatalog | null = null;
  try {
    const res = await env.ASSETS.fetch(`${origin}/data/${metro}/event-seo-manifest.json`);
    if (res.ok) {
      const doc = (await res.json()) as {
        live?: string[];
        ended?: string[];
        upcoming?: UpcomingLink[];
      };
      catalog = {
        liveSet: new Set(Array.isArray(doc.live) ? doc.live : []),
        endedSet: new Set(Array.isArray(doc.ended) ? doc.ended : []),
        upcoming: Array.isArray(doc.upcoming) ? doc.upcoming.slice(0, 10) : [],
      };
    }
  } catch {
    catalog = null;
  }
  catalogCache.set(metro, catalog);
  return catalog;
}

// Deployed to both Pages projects (FamHop kids + Mosey adults), so brand from
// the request host — same pattern as functions/p/[pollId].js.
function brandForHost(host: string): { name: string; tag: string } {
  return /trymosey|mosey|nighthop/i.test(host || "")
    ? { name: "Mosey", tag: "Find your spot." }
    : { name: "FamHop", tag: "Plan · Hop · Repeat." };
}

function esc(value: unknown): string {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 5–10 internal links to upcoming events in the metro, so a visitor who lands
// on an expired/missing event from search can keep going (recovers bounce
// traffic) and the page passes link equity to live, indexable pages.
function softLandingHtml(metro: string, upcoming: UpcomingLink[]): string {
  const weekendPath = `/${metro}/this-weekend/`;
  const items = upcoming
    .slice(0, 10)
    .filter((e) => e && e.slug && e.title)
    .map(
      (e) =>
        `<li><a href="/${esc(metro)}/event/${esc(e.slug)}/">${esc(e.title)}</a></li>`,
    )
    .join("");
  const list = items ? `<h2>Upcoming events</h2><ul>${items}</ul>` : "";
  return `<p><a href="${esc(weekendPath)}">See what&#39;s on this weekend &rarr;</a></p>${list}`;
}

function detailMissPage(
  host: string,
  metro: string,
  status: 404 | 410,
  upcoming: UpcomingLink[],
): Response {
  const brand = brandForHost(host);
  const heading = status === 410 ? "This event has ended" : "Event not found";
  const lead =
    status === 410
      ? "The event at this link is no longer scheduled. It happened in the past or was removed by the organizer."
      : "We couldn&#39;t find an event at this link. It may have been moved, or the address may be mistyped.";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,follow">
<title>${esc(heading)} — ${esc(brand.name)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#222}a{color:#0066cc}ul{padding-left:1.1rem}li{margin:.25rem 0}</style>
</head>
<body>
<h1>${esc(heading)}</h1>
<p>${lead}</p>
${softLandingHtml(metro, upcoming)}
<p><a href="/">${esc(brand.name)}</a> — ${esc(brand.tag)}</p>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "x-robots-tag": "noindex",
    },
  });
}

export async function onRequest(context: Context): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const detail = parseDetailPath(url.pathname);
  const asset = await env.ASSETS.fetch(request);
  if (!detail) return asset;

  // Trailing-slash normalization redirects (e.g. /x/event/slug ->
  // /x/event/slug/ when the prerendered file exists) pass through untouched.
  if (asset.status >= 300 && asset.status < 400) return asset;

  // Distinguish a real prerendered detail page from the SPA fallback: with
  // no 404.html, Pages serves dist/index.html (the root shell) for paths
  // that have no static file, so the fallback carries the root's etag.
  const shell = await env.ASSETS.fetch(new URL("/", url).toString());
  const assetEtag = asset.headers.get("etag");
  const isShellFallback = assetEtag !== null && assetEtag === shell.headers.get("etag");
  if (!isShellFallback && asset.status === 200) return asset;

  // Only events consult the catalog; spots are always noindex-shell.
  const catalog =
    detail.kind === "event"
      ? await loadCatalog(env, url.origin, detail.metro)
      : null;
  const disposition = missingPageDisposition(
    detail.kind,
    detail.slug,
    Date.now(),
    catalog,
  );
  const upcoming = catalog?.upcoming ?? [];
  if (disposition === "gone") {
    return detailMissPage(url.hostname, detail.metro, 410, upcoming);
  }
  if (disposition === "not-found") {
    return detailMissPage(url.hostname, detail.metro, 404, upcoming);
  }
  const guarded = new Response(asset.body, asset);
  guarded.headers.set("x-robots-tag", "noindex");
  return guarded;
}
