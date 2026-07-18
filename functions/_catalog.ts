// Per-isolate loader for each metro's classification manifest
// (dist/data/<metro>/event-seo-manifest.json, emitted by the SEO build).
// Split out of [[path]].ts so functions/sitemap.xml.ts can consult the same
// authority the 410 detail guard uses. The underscore keeps this file out of
// the Pages route table (imported, not served).

export type Env = { ASSETS: { fetch: (input: Request | string) => Promise<Response> } };

export type UpcomingLink = { slug: string; title: string };
export type MetroCatalog = {
  liveSet: Set<string>;
  liveEnds: Record<string, number>;
  endedSet: Set<string>;
  upcoming: UpcomingLink[];
};

// Fetching only happens on the missing-page/sitemap path, and the parsed
// result is reused for the life of the isolate. A null entry means "no usable
// manifest" — callers then fall back to date-only disposition and never
// hard-404.
const catalogCache = new Map<string, MetroCatalog | null>();

export async function loadCatalog(env: Env, origin: string, metro: string): Promise<MetroCatalog | null> {
  if (catalogCache.has(metro)) return catalogCache.get(metro) ?? null;
  let catalog: MetroCatalog | null = null;
  try {
    const res = await env.ASSETS.fetch(`${origin}/data/${metro}/event-seo-manifest.json`);
    if (res.ok) {
      const doc = (await res.json()) as {
        live?: string[];
        liveEnds?: Record<string, number>;
        ended?: string[];
        upcoming?: UpcomingLink[];
      };
      catalog = {
        liveSet: new Set(Array.isArray(doc.live) ? doc.live : []),
        liveEnds: doc.liveEnds && typeof doc.liveEnds === "object" ? doc.liveEnds : {},
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
