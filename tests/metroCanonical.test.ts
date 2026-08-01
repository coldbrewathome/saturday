// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://famhop.com/" }
//
// Regression (famhop-1): the SPA's metro head-sync effect must never rewrite
// the canonical/title on prerendered pages. generate-seo-pages.mjs ships a
// self-referencing canonical (`${origin}${pathname}`); when it is present the
// effect skips entirely (metroCanonicalOverride returns null), so the crafted
// static titles and trailing-slash canonicals survive in the rendered DOM
// Google indexes. Pre-fix, hydration rewrote the homepage canonical to
// /bay-area (slashless), which GSC recorded as a canonical fold.
import { beforeEach, describe, expect, it } from "vitest";
import { metroCanonicalOverride, type MetroConfig } from "../src/metros";

const atlanta: MetroConfig = {
  id: "atlanta",
  label: "Atlanta",
  seoName: "Atlanta",
  canonicalPath: "/atlanta",
  aliases: [],
  dataDir: "atlanta",
  center: { lat: 33.749, lon: -84.388 },
  timezone: "America/New_York",
};

function setCanonical(href: string) {
  document.head.querySelector('link[rel="canonical"]')?.remove();
  const link = document.createElement("link");
  link.setAttribute("rel", "canonical");
  link.setAttribute("href", href);
  document.head.appendChild(link);
}

function renderedCanonical(): string | null | undefined {
  return document
    .querySelector('link[rel="canonical"]')
    ?.getAttribute("href");
}

describe("metroCanonicalOverride (prerendered head survives hydration)", () => {
  beforeEach(() => {
    document.title = "FamHop family weekend planner by metro";
  });

  it("keeps the homepage canonical at https://famhop.com/", () => {
    window.history.pushState(null, "", "/");
    setCanonical("https://famhop.com/");
    expect(metroCanonicalOverride(atlanta)).toBeNull();
    // The effect returns before touching the DOM, so the rendered canonical
    // and static title stay exactly as prerendered.
    expect(renderedCanonical()).toBe("https://famhop.com/");
    expect(document.title).toBe("FamHop family weekend planner by metro");
  });

  it("keeps a prerendered hub canonical at https://famhop.com/atlanta/", () => {
    window.history.pushState(null, "", "/atlanta/");
    setCanonical("https://famhop.com/atlanta/");
    expect(metroCanonicalOverride(atlanta)).toBeNull();
    expect(renderedCanonical()).toBe("https://famhop.com/atlanta/");
  });

  it("never claims a metro canonical for the homepage, even on a mismatch", () => {
    window.history.pushState(null, "", "/");
    setCanonical("https://famhop.com/bay-area");
    expect(metroCanonicalOverride(atlanta)).toBeNull();
  });

  it("builds a trailing-slash canonical for a genuine client-side render", () => {
    // SW shell fallback: the SPA shell (root canonical) served under a metro
    // path. The override rewrites — with a trailing slash, never slashless.
    window.history.pushState(null, "", "/atlanta/");
    setCanonical("https://famhop.com/");
    expect(metroCanonicalOverride(atlanta)).toBe("https://famhop.com/atlanta/");
  });

  it("repairs the exact production precached-shell head served under a hub path", () => {
    // The raw precached-shell head captured from the live SW cache (verified
    // 2026-07-31): root canonical + shell title under /atlanta/. This branch
    // is the legacy-SW/offline repair path — only reachable when the
    // swHubRoutes navigateFallback denylist is bypassed (a SW installed
    // before the denylist shipped, or an offline fallback) — so the
    // prerendered network head is otherwise untouched.
    window.history.pushState(null, "", "/atlanta/");
    setCanonical("https://famhop.com/");
    document.title = "FamHop family weekend planner by metro";
    expect(metroCanonicalOverride(atlanta)).toBe("https://famhop.com/atlanta/");
    expect(document.title).toBe("FamHop family weekend planner by metro");
  });
});
