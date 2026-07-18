// Serves /sitemap.xml through the same classification the detail guard uses:
// the static sitemap from the last deploy is fetched from ASSETS, and every
// event <url> whose disposition is already "gone" (the guard would 410 the
// page) is dropped at request time. Fixes the GSC "submitted URL not found"
// errors from events that end between weekly deploys (2026-07-18: 406 famhop
// + 12 trymosey sitemap URLs were serving 410).

import { loadCatalog, type Env, type MetroCatalog } from "./_catalog";
import { collectEventMetros, filterEndedEventUrls } from "./_sitemap-filter.mjs";

type Context = { request: Request; env: Env };

export async function onRequest(context: Context): Promise<Response> {
  const { request, env } = context;
  const asset = await env.ASSETS.fetch(request);
  if (!asset.ok || request.method !== "GET") return asset;

  const xml = await asset.text();
  const origin = new URL(request.url).origin;
  const catalogs = new Map<string, MetroCatalog | null>();
  await Promise.all(
    [...collectEventMetros(xml)].map(async (metro) => {
      catalogs.set(metro, await loadCatalog(env, origin, metro));
    }),
  );

  return new Response(filterEndedEventUrls(xml, Date.now(), catalogs), {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
