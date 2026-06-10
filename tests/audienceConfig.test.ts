// Audience-driven config: Mosey (adults) is a Bay Area-only beta and its
// viral copy must be hangout-framed, while FamHop keeps the full metro list
// and family framing. The build-time APP_AUDIENCE constant can't be stubbed
// per test, so these exercise the pure per-audience derivations plus the
// slug-fallback mechanism that routes unknown metro paths to the default.
import { describe, expect, it } from "vitest";
import {
  digestCtaForAudience,
  domainForAudience,
  heroTitleForAudience,
  pollCtaForAudience,
} from "../src/appConfig";
import {
  DEFAULT_METRO,
  metroFromPath,
  metrosForAudience,
} from "../src/metros";

describe("metrosForAudience", () => {
  it("kids (FamHop) keeps the full metro list", () => {
    const metros = metrosForAudience("kids");
    expect(metros.length).toBeGreaterThan(10);
    expect(metros.some((m) => m.id === "seattle")).toBe(true);
  });

  it("adults (Mosey) is restricted to bay-area only", () => {
    expect(metrosForAudience("adults").map((m) => m.id)).toEqual(["bay-area"]);
  });
});

describe("metro path fallback", () => {
  it("unknown metro slugs fall back to the default metro with an alias redirect", () => {
    // On the adults build METROS only contains bay-area, so any other metro
    // path resolves through this same fallback (DEFAULT_METRO + isAlias),
    // which main.tsx turns into a replaceState to the canonical path.
    const { metro, isAlias, canonicalPath } = metroFromPath("/not-a-metro/");
    expect(metro.id).toBe(DEFAULT_METRO.id);
    expect(isAlias).toBe(true);
    expect(canonicalPath).toBe(DEFAULT_METRO.canonicalPath);
  });

  it("the default metro is bay-area", () => {
    expect(DEFAULT_METRO.id).toBe("bay-area");
  });
});

describe("audience copy", () => {
  it("kids poll CTA stays family-framed on famhop.com", () => {
    expect(pollCtaForAudience("kids")).toContain("family Saturday");
    expect(domainForAudience("kids")).toBe("famhop.com");
  });

  it("adults poll CTA is hangout-framed on trymosey.com with no family copy", () => {
    expect(pollCtaForAudience("adults")).toContain("hangout");
    expect(pollCtaForAudience("adults")).not.toMatch(/family/i);
    expect(domainForAudience("adults")).toBe("trymosey.com");
  });
});

describe("browse-hero headline", () => {
  it("Thu–Sun sells the imminent weekend", () => {
    for (const day of [4, 5, 6, 0]) {
      expect(heroTitleForAudience("kids", day)).toBe(
        "This weekend's plan, ready to go",
      );
      expect(heroTitleForAudience("adults", day)).toBe(
        "This weekend's hangout, ready to go",
      );
    }
  });

  it("Mon–Wed sells the head start", () => {
    for (const day of [1, 2, 3]) {
      expect(heroTitleForAudience("kids", day)).toBe(
        "Get a head start on the weekend",
      );
      expect(heroTitleForAudience("adults", day)).toBe(
        "Get a head start on the weekend hang",
      );
    }
  });
});

describe("digest CTA", () => {
  it("kids framing is family-first; adults framing is not", () => {
    expect(digestCtaForAudience("kids")).toBe(
      "Get 5 family things to do every Friday",
    );
    expect(digestCtaForAudience("adults")).toBe(
      "Get 5 things to do every Friday",
    );
    expect(digestCtaForAudience("adults")).not.toMatch(/family/i);
  });
});
