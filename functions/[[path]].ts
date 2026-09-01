// Cloudflare Pages Function guarding /{metro}/event/* and /{metro}/spot/*
// detail URLs, plus (fresh-1) /{metro}/city/*, /{metro}/category/* and
// /{metro}/this-weekend/* (scoped via public/_routes.json — it is NOT
// invoked for other paths, so static pages elsewhere keep zero-function
// serving).
//
// Why: the build prerenders only capped, quality-gated detail pages and the
// 20k-file Pages limit forbids ended-event stub files (SEO_MAX_ENDED_STUBS=0).
// Any detail URL without a static file falls back to the SPA shell with
// 200 + index,follow + canonical-to-homepage — a soft-404 at scale (e.g.
// /los-angeles/event/canoga-park-memorial-day-parade-2026-05-25/).
//
// Behavior:
// - Real prerendered page → env.ASSETS passthrough, untouched.
// - Ended event still inside the 14-day grace window (_detail-guard.mjs
//   ENDED_GRACE_MS) → the prerendered page keeps serving with 200 (it shows
//   full past-tense event info); with no prerendered page, the branded
//   "past event" page serves with 200.
// - Ended event beyond grace (past YYYY-MM-DD slug or in the metro's
//   ended-slug catalog) → HTTP 200 with a permanent, indexable "past event"
//   page: soft-landing links to upcoming events, self-canonical. The URL
//   never dies — with crawl inflow near zero, 410ing expired URLs was
//   draining the index (removals without replacement); freezing them as 200
//   stops the drain. 404 stays reserved for slugs that never existed.
// - Missing event page whose slug the catalog has never recorded → HTTP 404
//   (real not-found, noindex) instead of a soft-404 200 shell.
// - Missing event page that IS a live (capped-out) event, or any missing spot
//   page → serve the SPA shell with x-robots-tag: noindex (the shell must
//   never be indexed under detail URLs; spots/live events can earn a page).

import { isRemovedSectionKind, missingPageDisposition, parseDetailPath } from "./_detail-guard.mjs";
import { loadCatalog, type Env, type UpcomingLink } from "./_catalog";

type Context = { request: Request; env: Env };

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
  status: 200 | 404,
  upcoming: UpcomingLink[],
  pageKind: string = "event",
  canonicalPath?: string,
  isIndexable?: boolean,
): Response {
  const brand = brandForHost(host);
  const isEvent = pageKind === "event";
  // Dead-end pages must not stay in the index: 404s are noindex already;
  // 200 "This event has ended" pages were indexable, so every ended event
  // URL accumulated in GSC forever (~11k slugs). Default 404 → noindex,
  // 200 → indexable, but callers serving "gone" (past the grace window)
  // pass false so Google drops the URL while humans still get the page.
  const indexable = isIndexable ?? status === 200;
  const heading =
    status === 404
      ? isEvent
        ? "Event not found"
        : "Page not found"
      : "This event has ended";
  const lead =
    status === 404
      ? isEvent
        ? "We couldn&#39;t find an event at this link. It may have been moved, or the address may be mistyped."
        : "We couldn&#39;t find a page at this link. It may have been removed, or the address may be mistyped."
      : `This event was listed on ${esc(brand.name)} and is no longer scheduled. We keep a permanent record at this link — the live list for this metro is below.`;
  const canonical = indexable && canonicalPath
    ? `<link rel="canonical" href="https://${esc(host)}${esc(canonicalPath)}">\n`
    : "";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${indexable ? "" : `<meta name="robots" content="noindex,follow">\n`}${canonical}<title>${esc(heading)} — ${esc(brand.name)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#222}a{color:#0066cc}ul{padding-left:1.1rem}li{margin:.25rem 0}</style>
</head>
<body>
<h1>${esc(heading)}</h1>
<p>${lead}</p>
${softLandingHtml(metro, upcoming)}
<p><a href="/">${esc(brand.name)}</a> — ${esc(brand.tag)}</p>
</body>
</html>`;
  const headers: Record<string, string> = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "public, max-age=3600",
  };
  if (!indexable) headers["x-robots-tag"] = "noindex";
  return new Response(html, { status, headers });
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

  // Events consult the catalog for disposition; the fresh-1 section kinds
  // load it only for the 404 page's soft-landing links. Spots are always
  // noindex-shell/passthrough.
  const catalog =
    detail.kind === "event" || isRemovedSectionKind(detail.kind)
      ? await loadCatalog(env, url.origin, detail.metro)
      : null;

  // fresh-1: removed page classes (/{metro}/city/*, /{metro}/category/*,
  // /{metro}/city/*/category/*, /{metro}/this-weekend/{child}/). A real
  // prerendered page passes through untouched; the shell fallback becomes an
  // honest 404 (noindex, branded, soft-landing links) instead of a 200
  // index,follow homepage duplicate.
  if (isRemovedSectionKind(detail.kind)) {
    if (!isShellFallback) return asset;
    return detailMissPage(url.hostname, detail.metro, 404, catalog?.upcoming ?? [], detail.kind);
  }

  // A real prerendered event page must still be freshness-checked — a page
  // minted before its event ended (or one that ages out between manual
  // deploys, which run roughly weekly) would otherwise keep serving
  // attendable copy with no client-side correction (event detail pages are
  // fully static, unlike the in-app EventDetailView). Spots never 410, so
  // they pass through untouched regardless.
  if (!isShellFallback && asset.status === 200) {
    if (detail.kind === "event") {
      const disposition = missingPageDisposition(detail.kind, detail.slug, Date.now(), catalog);
      if (disposition === "gone") {
        return detailMissPage(url.hostname, detail.metro, 200, catalog?.upcoming ?? [], "event", url.pathname, false);
      }
      // "ended-grace" intentionally falls through: the prerendered page keeps
      // serving with 200 for 14 days after the event ends (full past-tense
      // event info, JSON-LD endDate in the past), so ranked pages get their
      // earn-out instead of a 410 at the exact end instant.
    }
    return asset;
  }

  const disposition = missingPageDisposition(
    detail.kind,
    detail.slug,
    Date.now(),
    catalog,
  );
  const upcoming = catalog?.upcoming ?? [];
  if (disposition === "gone") {
    return detailMissPage(url.hostname, detail.metro, 200, upcoming, "event", url.pathname, false);
  }
  if (disposition === "ended-grace") {
    // No prerendered asset (capped-out, or a redeploy dropped it): the
    // branded past-event page with its soft-landing links serves with 200
    // through the grace window and stays as the permanent page after it.
    return detailMissPage(url.hostname, detail.metro, 200, upcoming, "event", url.pathname, true);
  }
  if (disposition === "not-found") {
    return detailMissPage(url.hostname, detail.metro, 404, upcoming);
  }
  const guarded = new Response(asset.body, asset);
  guarded.headers.set("x-robots-tag", "noindex");
  return guarded;
}
