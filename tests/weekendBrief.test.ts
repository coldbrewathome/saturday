import { describe, expect, it } from "vitest";
import type { FamilyEvent } from "../src/App";
import type { WeatherForecast } from "../src/api";
import {
  BEST_OF_CAP,
  buildBestOf,
  pickHeadliner,
  rankWeekendEvents,
  weatherBrief,
  weatherIconKind,
} from "../src/weekendBrief";

function makeEvent(id: string, overrides: Partial<FamilyEvent> = {}): FamilyEvent {
  return {
    id,
    title: `Event ${id}`,
    description: "",
    venue: "Main Library",
    city: "San Francisco",
    neighborhood: "Civic Center",
    lat: 37.78,
    lon: -122.41,
    category: "Family",
    daysOfWeek: [6],
    timeWindow: "Afternoon",
    ageBands: [],
    cost: "Free",
    url: "https://example.org/storytime",
    verified: true,
    startDateTime: "2026-08-22T15:00:00",
    fetchedAt: "2026-08-01T00:00:00Z",
    ...overrides,
  } as FamilyEvent;
}

describe("rankWeekendEvents", () => {
  it("leads with the rank-1 popular pick even against a better family fit", () => {
    const entries = rankWeekendEvents({
      events: [
        makeEvent("plain", { title: "Storytime", ageBands: ["toddler"] }),
        makeEvent("pop", { title: "Bay Kids Festival" }),
      ],
      popularEvents: [makeEvent("pop")],
      editorEventIds: new Set(),
      profile: { ageBands: ["toddler"], interests: [], budget: "any" },
      home: null,
    });
    expect(entries[0].event.id).toBe("pop");
    expect(entries[0].popularRank).toBe(1);
  });

  it("ranks popular picks in pick order, not event order", () => {
    const a = makeEvent("a");
    const b = makeEvent("b");
    const entries = rankWeekendEvents({
      events: [a, b],
      popularEvents: [b, a], // b is rank 1, a is rank 2
      editorEventIds: new Set(),
      profile: null,
      home: null,
    });
    expect(entries.map((e) => e.event.id)).toEqual(["b", "a"]);
    expect(entries[0].popularRank).toBe(1);
    expect(entries[1].popularRank).toBe(2);
  });

  it("ranks editor's picks above unendorsed events", () => {
    const entries = rankWeekendEvents({
      events: [
        makeEvent("plain", { title: "Storytime" }),
        makeEvent("ed", { title: "Curated Museum Day" }),
      ],
      popularEvents: [],
      editorEventIds: new Set(["ed"]),
      profile: null,
      home: null,
    });
    expect(entries[0].event.id).toBe("ed");
    expect(entries[0].editorPicked).toBe(true);
  });

  it("uses family fit as the tie-breaker inside a tier", () => {
    const entries = rankWeekendEvents({
      events: [
        makeEvent("miss", { title: "Tween Coding Lab", ageBands: ["tween"] }),
        makeEvent("hit", { title: "Toddler Storytime", ageBands: ["toddler"] }),
      ],
      popularEvents: [],
      editorEventIds: new Set(),
      profile: { ageBands: ["toddler"], interests: [], budget: "any" },
      home: null,
    });
    expect(entries[0].event.id).toBe("hit");
  });

  it("prefers a photo when scores tie (and keeps ids stable as a last resort)", () => {
    const withPhoto = makeEvent("photogenic");
    const without = makeEvent("plain");
    const entries = rankWeekendEvents({
      events: [without, withPhoto],
      popularEvents: [],
      editorEventIds: new Set(),
      profile: null,
      home: null,
      hasPhotoFor: (e) => e.id === "photogenic",
    });
    expect(entries[0].event.id).toBe("photogenic");
  });

  it("returns an empty list when there are no events", () => {
    expect(
      rankWeekendEvents({
        events: [],
        popularEvents: [],
        editorEventIds: new Set(),
        profile: null,
        home: null,
      }),
    ).toEqual([]);
  });
});

describe("pickHeadliner / buildBestOf", () => {
  it("headliner is the top-ranked entry, null when empty", () => {
    const a = makeEvent("a");
    const b = makeEvent("b");
    const entries = rankWeekendEvents({
      events: [a, b],
      popularEvents: [],
      editorEventIds: new Set(),
      profile: null,
      home: null,
    });
    expect(pickHeadliner(entries)?.event.id).toBe("a");
    expect(pickHeadliner([])).toBeNull();
  });

  it("best-of caps the ranked list", () => {
    const events = Array.from({ length: 12 }, (_, i) => makeEvent(`e${i}`));
    const entries = rankWeekendEvents({
      events,
      popularEvents: [],
      editorEventIds: new Set(),
      profile: null,
      home: null,
    });
    expect(buildBestOf(entries).length).toBe(BEST_OF_CAP);
    expect(entries.length).toBe(12);
  });
});

describe("weatherIconKind", () => {
  const cases: Array<[number, string]> = [
    [0, "sun"],
    [1, "cloud-sun"],
    [2, "cloud-sun"],
    [3, "cloud"],
    [45, "fog"],
    [48, "fog"],
    [51, "drizzle"],
    [57, "drizzle"],
    [61, "rain"],
    [67, "rain"],
    [71, "snow"],
    [77, "snow"],
    [80, "rain"],
    [85, "snow"],
    [95, "storm"],
    [99, "storm"],
    [999, "cloud"], // unknown codes degrade, never crash
  ];
  for (const [code, kind] of cases) {
    it(`maps ${code} to ${kind}`, () => {
      expect(weatherIconKind(code)).toBe(kind);
    });
  }
});

describe("weatherBrief", () => {
  const day = (weatherCode: number, precipChance: number, tempMaxF = 80) => ({
    date: "2026-08-22",
    weatherCode,
    label: "Sunny",
    tempMaxF,
    tempMinF: 60,
    precipChance,
  });

  it("returns null when there is no forecast", () => {
    expect(weatherBrief(null)).toBeNull();
    expect(weatherBrief(undefined)).toBeNull();
  });

  it("returns null when neither day has data", () => {
    expect(
      weatherBrief({
        saturday: null,
        sunday: null,
        fetchedAt: "2026-08-20T00:00:00Z",
      }),
    ).toBeNull();
  });

  it("hints at the dry day when only Saturday is dry", () => {
    const brief = weatherBrief({
      saturday: day(0, 10),
      sunday: day(61, 80),
      fetchedAt: "2026-08-20T00:00:00Z",
    });
    expect(brief?.saturday?.icon).toBe("sun");
    expect(brief?.hint).toContain("Saturday's the dry day");
  });

  it("hints at Sunday when only Sunday is dry", () => {
    const brief = weatherBrief({
      saturday: day(61, 70),
      sunday: day(2, 20),
      fetchedAt: "2026-08-20T00:00:00Z",
    });
    expect(brief?.hint).toContain("Sunday looks clearer");
  });

  it("celebrates clear skies when both days are dry", () => {
    const brief = weatherBrief({
      saturday: day(0, 5),
      sunday: day(1, 15),
      fetchedAt: "2026-08-20T00:00:00Z",
    });
    expect(brief?.hint).toContain("outdoor picks are safe");
  });

  it("points at indoor picks when both days are wet", () => {
    const brief = weatherBrief({
      saturday: day(61, 80),
      sunday: day(82, 90),
      fetchedAt: "2026-08-20T00:00:00Z",
    });
    expect(brief?.hint).toContain("indoor picks");
  });

  it("has no hint when only one day has data", () => {
    const brief = weatherBrief({
      saturday: day(0, 10),
      sunday: null,
      fetchedAt: "2026-08-20T00:00:00Z",
    });
    expect(brief?.sunday).toBeNull();
    expect(brief?.hint).toBeNull();
  });

  it("keeps the temperature and precip chance for the pill row", () => {
    const brief = weatherBrief({
      saturday: day(61, 80, 74),
      sunday: day(0, 5, 88),
      fetchedAt: "2026-08-20T00:00:00Z",
    });
    expect(brief?.saturday?.tempF).toBe(74);
    expect(brief?.saturday?.precipChance).toBe(80);
    expect(brief?.sunday?.tempF).toBe(88);
  });
});
