import { describe, expect, it } from "vitest";
import {
  hopNowPicks,
  type HopNowEvent,
  type HopNowSpot,
  type HopNowSchedule,
} from "../src/hopNow";

const NOW = new Date("2026-05-17T15:00:00-07:00"); // Sunday 3:00 PM Pacific
const USER = { lat: 37.78, lon: -122.42 }; // SF downtown

function schedule(open: number, close: number): HopNowSchedule {
  const day = [{ open, close }];
  return {
    is247: false,
    days: {
      mon: day,
      tue: day,
      wed: day,
      thu: day,
      fri: day,
      sat: day,
      sun: day,
    },
  };
}

function isParkSpot(pick: { category: string }): boolean {
  return pick.category === "Outdoors";
}
function isMuseumSpot(pick: { category: string }): boolean {
  return pick.category === "Culture";
}

function spot(overrides: Partial<HopNowSpot> = {}): HopNowSpot {
  return {
    id: "s",
    name: "Spot",
    neighborhood: "Mission",
    category: "Outdoors",
    lat: 37.76,
    lon: -122.43,
    schedule: schedule(9 * 60, 20 * 60), // 9 AM – 8 PM
    friendScore: 75,
    kidsFriendly: true,
    ...overrides,
  };
}

describe("hopNowPicks", () => {
  it("excludes spots that close in less than the open-window threshold", () => {
    const closing = spot({
      id: "closing-soon",
      schedule: schedule(9 * 60, 15 * 60 + 30), // closes 3:30 PM, 30 min from now
    });
    const open = spot({ id: "open-late" });

    const result = hopNowPicks([closing, open], [], {
      now: NOW,
      audience: "kids",
      userLocation: USER,
    });
    const ids = result.picks.map((p) => p.id);
    expect(ids).toContain("open-late");
    expect(ids).not.toContain("closing-soon");
  });

  it("excludes spots that are not currently open", () => {
    const closedNow = spot({
      id: "closed",
      schedule: schedule(20 * 60, 22 * 60), // opens at 8 PM
    });
    const open = spot({ id: "open" });

    const result = hopNowPicks([closedNow, open], [], {
      now: NOW,
      audience: "kids",
      userLocation: USER,
    });
    const ids = result.picks.map((p) => p.id);
    expect(ids).not.toContain("closed");
    expect(ids).toContain("open");
  });

  it("includes always-open (24/7) spots", () => {
    const always: HopNowSpot = spot({
      id: "always",
      schedule: { is247: true, days: null },
    });
    const result = hopNowPicks([always], [], {
      now: NOW,
      audience: "kids",
      userLocation: USER,
    });
    const pick = result.picks.find((p) => p.id === "always");
    expect(pick).toBeDefined();
    expect(pick?.kind === "spot" && pick.alwaysOpen).toBe(true);
  });

  it("excludes events that start outside the lookahead window", () => {
    const tooSoon: HopNowEvent = {
      id: "too-soon",
      title: "Storytime",
      venue: "Library",
      neighborhood: "Mission",
      category: "Culture",
      lat: 37.76,
      lon: -122.43,
      startDateTime: new Date(NOW.getTime() - 60 * 60_000).toISOString(),
      url: "https://example.com/storytime",
    };
    const tooLate: HopNowEvent = {
      ...tooSoon,
      id: "too-late",
      startDateTime: new Date(NOW.getTime() + 6 * 60 * 60_000).toISOString(),
    };
    const justRight: HopNowEvent = {
      ...tooSoon,
      id: "just-right",
      startDateTime: new Date(NOW.getTime() + 30 * 60_000).toISOString(),
    };

    const result = hopNowPicks([], [tooSoon, tooLate, justRight], {
      now: NOW,
      audience: "kids",
      userLocation: USER,
    });
    const ids = result.picks.map((p) => p.id);
    expect(ids).toContain("just-right");
    expect(ids).not.toContain("too-soon");
    expect(ids).not.toContain("too-late");
  });

  it("falls back to transitMinutes when lat/lon or user location is missing", () => {
    const noGeo = spot({ id: "no-geo", lat: undefined, lon: undefined, transitMinutes: 12 });
    const tooFar = spot({ id: "too-far", lat: undefined, lon: undefined, transitMinutes: 60 });

    const result = hopNowPicks([noGeo, tooFar], [], {
      now: NOW,
      audience: "kids",
      // no userLocation
    });
    const ids = result.picks.map((p) => p.id);
    expect(ids).toContain("no-geo");
    expect(ids).not.toContain("too-far");
  });

  it("penalizes spots that are not kid-friendly when audience is kids", () => {
    const yes = spot({ id: "yes", kidsFriendly: true, friendScore: 70 });
    const no = spot({ id: "no", kidsFriendly: false, friendScore: 70 });

    const result = hopNowPicks([yes, no], [], {
      now: NOW,
      audience: "kids",
      userLocation: USER,
    });
    expect(result.picks[0]?.id).toBe("yes");
  });

  it("marks the result as sparse when fewer than 3 picks survive filtering", () => {
    const only = spot({ id: "only" });
    const result = hopNowPicks([only], [], {
      now: NOW,
      audience: "kids",
      userLocation: USER,
    });
    expect(result.picks).toHaveLength(1);
    expect(result.sparse).toBe(true);
    expect(result.reason).toBeTruthy();
  });

  it("returns empty + reason when nothing is open and nearby", () => {
    const result = hopNowPicks([], [], {
      now: NOW,
      audience: "kids",
      userLocation: USER,
    });
    expect(result.picks).toHaveLength(0);
    expect(result.sparse).toBe(true);
    expect(result.reason).toMatch(/nothing|nearby|weekend/i);
  });

  it("produces deterministic ordering for the same seed", () => {
    const spots = Array.from({ length: 8 }, (_, i) =>
      spot({ id: `s-${i}`, friendScore: 70, lat: 37.76 + i * 0.001 }),
    );
    const a = hopNowPicks(spots, [], {
      now: NOW,
      audience: "kids",
      userLocation: USER,
      shuffleSeed: 42,
    });
    const b = hopNowPicks(spots, [], {
      now: NOW,
      audience: "kids",
      userLocation: USER,
      shuffleSeed: 42,
    });
    expect(a.picks.map((p) => p.id)).toEqual(b.picks.map((p) => p.id));
  });

  it("yields different ordering across distinct seeds when scores are close", () => {
    const spots = Array.from({ length: 8 }, (_, i) =>
      spot({ id: `s-${i}`, friendScore: 70, lat: 37.76 + i * 0.001 }),
    );
    const a = hopNowPicks(spots, [], {
      now: NOW,
      audience: "kids",
      userLocation: USER,
      shuffleSeed: 1,
    });
    const b = hopNowPicks(spots, [], {
      now: NOW,
      audience: "kids",
      userLocation: USER,
      shuffleSeed: 999,
    });
    expect(a.picks.map((p) => p.id)).not.toEqual(b.picks.map((p) => p.id));
  });

  it("caps repetition inside the 'other' tier (max 2 per category)", () => {
    // No events, no parks — only Food and Culture. Diversity cap applies
    // within the catch-all tier so we don't show 5 cafes.
    const foods = Array.from({ length: 4 }, (_, i) =>
      spot({ id: `food-${i}`, category: "Food", friendScore: 90 - i }),
    );
    const culture = spot({
      id: "culture",
      category: "Culture",
      friendScore: 60,
    });
    const result = hopNowPicks([...foods, culture], [], {
      now: NOW,
      audience: "kids",
      userLocation: USER,
      limit: 5,
    });
    const counts = result.picks.reduce<Record<string, number>>((acc, p) => {
      acc[p.category] = (acc[p.category] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.Food ?? 0).toBeLessThanOrEqual(2);
    expect(result.picks.map((p) => p.id)).toContain("culture");
  });

  it("attaches a whyNow string and maps query to each pick", () => {
    const result = hopNowPicks([spot({ id: "x" })], [], {
      now: NOW,
      audience: "kids",
      userLocation: USER,
    });
    const pick = result.picks[0];
    expect(pick.whyNow.length).toBeGreaterThan(0);
    expect(pick.mapsQuery).toMatch(/Spot/);
  });

  it("includes a joinable event that started recently but is still ongoing", () => {
    const ongoing: HopNowEvent = {
      id: "ongoing",
      title: "Open Studio",
      venue: "Studio",
      neighborhood: "Mission",
      category: "Culture",
      lat: 37.76,
      lon: -122.43,
      startDateTime: new Date(NOW.getTime() - 15 * 60_000).toISOString(),
      endDateTime: new Date(NOW.getTime() + 90 * 60_000).toISOString(),
      url: "https://example.com",
    };
    const result = hopNowPicks([], [ongoing], {
      now: NOW,
      audience: "kids",
      userLocation: USER,
    });
    expect(result.picks.map((p) => p.id)).toContain("ongoing");
  });

  it("prioritizes events over all spots (tier 1)", () => {
    const park = spot({ id: "park", category: "Outdoors", friendScore: 95 });
    const cafe = spot({ id: "cafe", category: "Food", friendScore: 95 });
    const storytime: HopNowEvent = {
      id: "storytime",
      title: "Storytime",
      venue: "Library",
      neighborhood: "Mission",
      category: "Culture",
      lat: 37.76,
      lon: -122.43,
      startDateTime: new Date(NOW.getTime() + 30 * 60_000).toISOString(),
      url: "https://example.com/storytime",
    };
    const result = hopNowPicks([park, cafe], [storytime], {
      now: NOW,
      audience: "kids",
      userLocation: USER,
    });
    expect(result.picks[0]?.id).toBe("storytime");
  });

  it("prioritizes parks over other spots when no events qualify (tier 2)", () => {
    const park = spot({ id: "park", category: "Outdoors", friendScore: 70 });
    const cafe = spot({ id: "cafe", category: "Food", friendScore: 95 });
    const result = hopNowPicks([cafe, park], [], {
      now: NOW,
      audience: "kids",
      userLocation: USER,
    });
    expect(result.picks[0]?.id).toBe("park");
  });

  it("treats park-tagged spots as tier 2 even if category is not 'Outdoors'", () => {
    const playgroundCafe = spot({
      id: "playground-cafe",
      category: "Food",
      tags: ["playground", "family"],
      friendScore: 70,
    });
    const regularCafe = spot({
      id: "regular-cafe",
      category: "Food",
      friendScore: 95,
    });
    const result = hopNowPicks([regularCafe, playgroundCafe], [], {
      now: NOW,
      audience: "kids",
      userLocation: USER,
    });
    expect(result.picks[0]?.id).toBe("playground-cafe");
  });

  it("prioritizes museums over other spots when no events/parks qualify (tier 3)", () => {
    const cafe = spot({ id: "cafe", category: "Food", friendScore: 95 });
    const museum = spot({ id: "museum", category: "Culture", friendScore: 70 });
    const result = hopNowPicks([cafe, museum], [], {
      now: NOW,
      audience: "kids",
      userLocation: USER,
    });
    expect(result.picks[0]?.id).toBe("museum");
  });

  it("detects museum-like spots by name/tag even when category differs", () => {
    const gallery = spot({
      id: "gallery",
      category: "Food",
      name: "The Modern Gallery Cafe",
      friendScore: 70,
    });
    const regularCafe = spot({
      id: "regular-cafe",
      category: "Food",
      friendScore: 95,
    });
    const result = hopNowPicks([regularCafe, gallery], [], {
      now: NOW,
      audience: "kids",
      userLocation: USER,
    });
    expect(result.picks[0]?.id).toBe("gallery");
  });

  it("falls back to catch-all 'other' tier when events/parks/museums are exhausted", () => {
    const cafe = spot({ id: "cafe", category: "Food", friendScore: 80 });
    const result = hopNowPicks([cafe], [], {
      now: NOW,
      audience: "kids",
      userLocation: USER,
    });
    expect(result.picks.map((p) => p.id)).toContain("cafe");
  });

  it("respects tier budgets: 5 events + 2 parks + 2 museums = 9 picks", () => {
    const events: HopNowEvent[] = Array.from({ length: 8 }, (_, i) => ({
      id: `ev-${i}`,
      title: `Event ${i}`,
      venue: "Hall",
      neighborhood: "Mission",
      category: "Culture",
      lat: 37.76,
      lon: -122.43,
      startDateTime: new Date(NOW.getTime() + (20 + i * 15) * 60_000).toISOString(),
      url: "https://e.com",
    }));
    const parks = Array.from({ length: 4 }, (_, i) =>
      spot({ id: `park-${i}`, category: "Outdoors", friendScore: 80 - i }),
    );
    const museums = Array.from({ length: 4 }, (_, i) =>
      spot({ id: `museum-${i}`, category: "Culture", friendScore: 80 - i }),
    );
    const cafes = Array.from({ length: 4 }, (_, i) =>
      spot({ id: `cafe-${i}`, category: "Food", friendScore: 80 - i }),
    );
    const result = hopNowPicks([...parks, ...museums, ...cafes], events, {
      now: NOW,
      audience: "kids",
      userLocation: USER,
    });
    const counts = result.picks.reduce<Record<string, number>>((acc, p) => {
      acc[p.kind === "event" ? "event" : isParkSpot(p) ? "park" : isMuseumSpot(p) ? "museum" : "other"] =
        (acc[
          p.kind === "event" ? "event" : isParkSpot(p) ? "park" : isMuseumSpot(p) ? "museum" : "other"
        ] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.event).toBe(5);
    expect(counts.park).toBe(2);
    expect(counts.museum).toBe(2);
    expect(result.picks.length).toBe(9);
  });

  it("filters out IDs in excludeIds (powers 'Try a new batch')", () => {
    const a = spot({ id: "a" });
    const b = spot({ id: "b" });
    const result = hopNowPicks([a, b], [], {
      now: NOW,
      audience: "kids",
      userLocation: USER,
      excludeIds: new Set(["a"]),
    });
    const ids = result.picks.map((p) => p.id);
    expect(ids).toContain("b");
    expect(ids).not.toContain("a");
  });

  it("accepts events that start up to ~4 hours out", () => {
    const farOut: HopNowEvent = {
      id: "far",
      title: "Late Afternoon Storytime",
      venue: "Library",
      neighborhood: "Mission",
      category: "Culture",
      lat: 37.76,
      lon: -122.43,
      startDateTime: new Date(NOW.getTime() + 180 * 60_000).toISOString(),
      url: "https://e.com",
    };
    const result = hopNowPicks([], [farOut], {
      now: NOW,
      audience: "kids",
      userLocation: USER,
    });
    expect(result.picks.map((p) => p.id)).toContain("far");
  });

  it("fills remaining slots from lower tiers when higher tiers are sparse", () => {
    const event1: HopNowEvent = {
      id: "ev1",
      title: "Storytime",
      venue: "Library",
      neighborhood: "Mission",
      category: "Culture",
      lat: 37.76,
      lon: -122.43,
      startDateTime: new Date(NOW.getTime() + 30 * 60_000).toISOString(),
      url: "https://e.com",
    };
    const park = spot({ id: "park", category: "Outdoors" });
    const cafe = spot({ id: "cafe", category: "Food" });
    const result = hopNowPicks([park, cafe], [event1], {
      now: NOW,
      audience: "kids",
      userLocation: USER,
      limit: 3,
    });
    expect(result.picks.map((p) => p.id)).toEqual(["ev1", "park", "cafe"]);
  });
});
