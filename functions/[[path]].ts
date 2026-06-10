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
// - Missing event page whose slug ends in a past YYYY-MM-DD → HTTP 410 with
//   a small branded "event ended" page and x-robots-tag: noindex.
// - Missing event page (future/undated) or missing spot page → serve the SPA
//   shell response but add x-robots-tag: noindex (the shell must never be
//   indexed under detail URLs; spots never 410 — they can re-earn a page).

import { missingPageDisposition, parseDetailPath } from "./_detail-guard.mjs";

type Env = { ASSETS: { fetch: (input: Request | string) => Promise<Response> } };
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

function endedEventResponse(host: string, metro: string): Response {
  const brand = brandForHost(host);
  const weekendPath = `/${metro}/this-weekend/`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,follow">
<title>This event has ended — ${esc(brand.name)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#222}a{color:#0066cc}</style>
</head>
<body>
<h1>This event has ended</h1>
<p>The event at this link is no longer scheduled. It happened in the past or was removed by the organizer.</p>
<p><a href="${esc(weekendPath)}">See what&#39;s on this weekend &rarr;</a></p>
<p><a href="/">${esc(brand.name)}</a> — ${esc(brand.tag)}</p>
</body>
</html>`;
  return new Response(html, {
    status: 410,
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

  if (missingPageDisposition(detail.kind, detail.slug) === "gone") {
    return endedEventResponse(url.hostname, detail.metro);
  }
  const guarded = new Response(asset.body, asset);
  guarded.headers.set("x-robots-tag", "noindex");
  return guarded;
}
