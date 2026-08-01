// head-sync regression lock: the metro hubs are prerendered pages, and the
// SW's navigateFallback must never serve the precached shell (root canonical,
// shell title) under a hub path. vite.config.ts ships the exact array built by
// swNavigateFallbackDenylist, so these assertions run against the shipped
// config, not a copy that can drift.
import { describe, expect, it } from "vitest";
import metrosDoc from "../data/metros.json";
import {
  hubDenylistRegex,
  hubSlugsForAudience,
  swNavigateFallbackDenylist,
} from "../src/swHubRoutes";

const metros = metrosDoc.metros;

const denies = (list: RegExp[], path: string) =>
  list.some((re) => re.test(path));

describe("hubDenylistRegex(hubSlugsForAudience(..., 'kids'))", () => {
  const re = hubDenylistRegex(hubSlugsForAudience(metros, "kids"));

  it("matches every canonicalPath slug and every alias, with and without trailing slash", () => {
    for (const metro of metros) {
      const canonical = metro.canonicalPath.replace(/^\//, "");
      for (const slug of [canonical, ...(metro.aliases ?? [])]) {
        expect(re.test(`/${slug}/`), `/${slug}/`).toBe(true);
        expect(re.test(`/${slug}`), `/${slug}`).toBe(true);
      }
    }
    // Spot checks pinned to the fix spec.
    expect(re.test("/atlanta/")).toBe(true);
    expect(re.test("/atlanta")).toBe(true);
    expect(re.test("/nyc/")).toBe(true);
    expect(re.test("/dfw")).toBe(true);
  });

  it("does not match the homepage or unknown single segments", () => {
    expect(re.test("/")).toBe(false);
    expect(re.test("/pricing/")).toBe(false);
    expect(re.test("/pricing")).toBe(false);
  });

  it("matches hub paths with query strings (workbox tests pathname + search)", () => {
    expect(re.test("/atlanta?utm=x")).toBe(true);
    expect(re.test("/atlanta/?utm=x")).toBe(true);
  });
});

describe("swNavigateFallbackDenylist (full array as shipped to workbox)", () => {
  it("kids: keeps denying deep paths, /api/, and trust pages, and adds the hubs", () => {
    const list = swNavigateFallbackDenylist(metros, "kids");
    // Pre-existing three regexes still deny what they always denied.
    expect(denies(list, "/atlanta/this-weekend/")).toBe(true);
    expect(denies(list, "/api/x")).toBe(true);
    expect(denies(list, "/about/")).toBe(true);
    // The new hub regex.
    expect(denies(list, "/atlanta/")).toBe(true);
    // Query-string semantics: "/atlanta/?utm=x" is denied by the pre-existing
    // deep-path regex; "/atlanta?utm=x" needs the new anchored hub regex.
    expect(denies(list, "/atlanta/?utm=x")).toBe(true);
    expect(denies(list, "/atlanta?utm=x")).toBe(true);
    // The shell fallback itself stays reachable.
    expect(denies(list, "/")).toBe(false);
  });

  it("adults: denies only bay-area + its aliases; /seattle/ still falls back to the shell", () => {
    const list = swNavigateFallbackDenylist(metros, "adults");
    expect(denies(list, "/bay-area/")).toBe(true);
    expect(denies(list, "/bay-area")).toBe(true);
    expect(denies(list, "/bayarea/")).toBe(true);
    expect(denies(list, "/bayarea")).toBe(true);
    // Mosey is Bay Area-only: other metro paths land on the shell and the
    // SPA's alias redirect walks them to /bay-area/.
    expect(denies(list, "/seattle/")).toBe(false);
    expect(denies(list, "/atlanta")).toBe(false);
  });
});
