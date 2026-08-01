// Service-worker navigation denylist for metro hub routes.
//
// The SW's navigateFallback serves the precached SPA shell for single-segment
// paths — but metro hubs (/atlanta/, /nyc, …) are PRERENDERED pages whose
// crafted head (self-referencing canonical, query-shaped title) must come from
// the network, never the shell (whose head carries the ROOT canonical — the
// exact head GSC recorded as a canonical fold). This module is the single
// source of truth for that denylist: vite.config.ts consumes
// `swNavigateFallbackDenylist` for the shipped workbox config and
// tests/swHubRoutes.test.ts asserts against the same export, so the tested
// array can never drift from the shipped one.
//
// Workbox tests denylist regexes against `url.pathname + url.search`, so the
// hub regex must anchor on end-of-string OR a `?` (e.g. "/atlanta?utm=x").

export type HubMetroLike = {
  id: string;
  canonicalPath: string;
  aliases?: string[];
};

export type SwAudience = "kids" | "adults";

// Mosey (adults) is a Bay Area-only product: its build prerenders only the
// bay-area hub, so only bay-area (+ aliases) may be denied the shell fallback
// — /seattle/ etc. must keep falling back to the shell the SPA redirects from.
export function hubSlugsForAudience(
  metros: HubMetroLike[],
  audience: SwAudience,
): string[] {
  const active =
    audience === "adults" ? metros.filter((m) => m.id === "bay-area") : metros;
  const slugs = new Set<string>();
  for (const metro of active) {
    const canonical = String(metro.canonicalPath || "").replace(/^\/+|\/+$/g, "");
    if (canonical) slugs.add(canonical);
    for (const alias of metro.aliases ?? []) {
      if (alias) slugs.add(alias);
    }
  }
  return [...slugs];
}

export function hubDenylistRegex(slugs: string[]): RegExp {
  const escaped = slugs.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // "/atlanta", "/atlanta/", "/atlanta?utm=x", "/atlanta/?utm=x" — but not
  // "/" (empty alternative never emitted), "/pricing/", or deeper paths like
  // "/atlanta/this-weekend/" (those are denied by the deep-path regex below).
  return new RegExp(`^/(?:${escaped.join("|")})/?(?:$|\\?)`);
}

// The full navigateFallbackDenylist shipped to workbox: the three pre-existing
// regexes (deep paths / API / single-segment trust pages) plus the hub regex.
export function swNavigateFallbackDenylist(
  metros: HubMetroLike[],
  audience: SwAudience,
): RegExp[] {
  return [
    /^\/[^/]+\/.+/,
    /^\/api\//,
    /^\/(about|how-we-verify|privacy)\/?$/,
    hubDenylistRegex(hubSlugsForAudience(metros, audience)),
  ];
}
