import { describe, expect, it } from "vitest";
import {
  buildPlan,
  eventToPlannerSpot,
  isAgeBand,
  isVibe,
  resolveMetro,
  searchRecords,
  type RawEvent,
} from "../src/planApi";
import type { PlannerSpot } from "../src/planner";
import { METROS } from "../src/metros";

function spot(overrides: Partial<PlannerSpot> & { id: string; name: string }): PlannerSpot {
  return {
    neighborhood: "San Francisco",
    category: "Outdoors",
    cost: "Free",
    transitMinutes: 12,
    mood: "Easy stop",
    groupSize: "Family",
    planning: "Walk-in",
    openNow: true,
    website: "https://example.com",
    friendScore: 80,
    ...overrides,
  };
}

const park = spot({ id: "park", name: "Big Park", category: "Outdoors", kidsFriendly: true });
const museum = spot({ id: "museum", name: "Kids Museum", category: "Culture", kidsFriendly: true });
const food = spot({ id: "food", name: "Taco Spot", category: "Food", cost: "$", kidsFriendly: true });
const bar = spot({ id: "bar", name: "Dive Bar", category: "Nightlife", kidsFriendly: false });

const event: RawEvent = {
  id: "story-time",
  title: "Library Story Time",
  description: "Songs and books for little ones",
  venue: "Main Library",
  city: "Oakland",
  category: "Library",
  timeWindow: "Morning",
  startDateTime: "2026-06-06T17:00:00.000Z",
  ageBands: ["toddler"],
  cost: "Free",
  url: "https://library.example/story",
  sourceName: "Oakland Library",
  verified: true,
};

const bayArea = resolveMetro("bay-area")!;

describe("validators", () => {
  it("validates vibes and age bands", () => {
    expect(isVibe("balanced")).toBe(true);
    expect(isVibe("nonsense")).toBe(false);
    expect(isAgeBand("toddler")).toBe(true);
    expect(isAgeBand("adult")).toBe(false);
  });
});

describe("resolveMetro", () => {
  it("resolves by id, canonical path, and alias", () => {
    expect(resolveMetro("bay-area")?.id).toBe("bay-area");
    expect(resolveMetro("/los-angeles/")?.id).toBe("los-angeles");
    expect(resolveMetro("bayarea")?.id).toBe("bay-area");
  });
  it("returns null for unknown / empty", () => {
    expect(resolveMetro("atlantis")).toBeNull();
    expect(resolveMetro("")).toBeNull();
    expect(resolveMetro(null)).toBeNull();
  });
  it("covers every shipped metro", () => {
    for (const m of METROS) {
      expect(resolveMetro(m.id)?.id).toBe(m.id);
    }
  });
});

describe("eventToPlannerSpot", () => {
  it("maps an event into a scorable spot", () => {
    const mapped = eventToPlannerSpot(event, "kids");
    expect(mapped.id).toBe("event-story-time");
    expect(mapped.dataSource).toBe("family-event");
    expect(mapped.category).toBe("Culture");
    expect(mapped.kidsFriendly).toBe(true);
    expect(mapped.sourceUrl).toBe("https://library.example/story");
  });
  it("adapts group size by audience", () => {
    expect(eventToPlannerSpot(event, "kids").groupSize).toBe("Family");
    expect(eventToPlannerSpot(event, "adults").groupSize).toBe("2-8 people");
  });
});

describe("buildPlan", () => {
  it("returns up to `limit` stops favoring category variety", () => {
    const plan = buildPlan({
      metro: bayArea,
      spots: [park, museum, food, bar],
      events: [],
      vibe: "balanced",
      audience: "kids",
      limit: 3,
    });
    expect(plan.stops).toHaveLength(3);
    const categories = plan.stops.map((s) => s.category);
    expect(new Set(categories).size).toBe(3);
    expect(plan.metro.id).toBe("bay-area");
    expect(plan.counts.places).toBe(4);
  });

  it("includes events by default and excludes them when asked", () => {
    const withEvents = buildPlan({
      metro: bayArea,
      spots: [park],
      events: [event],
      vibe: "culture",
      audience: "kids",
      limit: 3,
    });
    expect(withEvents.counts.events).toBe(1);
    expect(withEvents.stops.some((s) => s.kind === "event")).toBe(true);

    const withoutEvents = buildPlan({
      metro: bayArea,
      spots: [park],
      events: [event],
      vibe: "culture",
      audience: "kids",
      includeEvents: false,
    });
    expect(withoutEvents.counts.events).toBe(0);
    expect(withoutEvents.stops.every((s) => s.kind === "place")).toBe(true);
  });

  it("demotes a not-kid-friendly spot for the kids audience", () => {
    const plan = buildPlan({
      metro: bayArea,
      spots: [bar, park],
      events: [],
      vibe: "culture", // culture boosts Nightlife, so audience is the deciding factor
      audience: "kids",
      limit: 1,
    });
    expect(plan.stops[0].id).not.toBe("bar");
  });

  it("keeps the brief's top pick consistent with the lead stop even when events outrank places", () => {
    // Events are appended after places; the brief must still describe stops[0].
    const verifiedEvent: RawEvent = { ...event, id: "headliner", title: "Headliner Event" };
    const plan = buildPlan({
      metro: bayArea,
      spots: [park, museum],
      events: [verifiedEvent],
      vibe: "culture",
      audience: "kids",
      limit: 3,
    });
    expect(plan.brief.title).toContain(plan.stops[0].name);
  });

  it("clamps limit to a sane range", () => {
    const plan = buildPlan({
      metro: bayArea,
      spots: [park, museum, food, bar],
      events: [],
      vibe: "balanced",
      audience: "kids",
      limit: 99,
    });
    expect(plan.stops.length).toBeLessThanOrEqual(5);
  });
});

describe("searchRecords", () => {
  const spots = [park, museum, food];
  it("matches places by name and tags", () => {
    const res = searchRecords({ metro: bayArea, spots, events: [], query: "park" });
    expect(res.hits.some((h) => h.id === "park")).toBe(true);
  });
  it("matches events and respects type filter", () => {
    const placesOnly = searchRecords({
      metro: bayArea,
      spots,
      events: [event],
      query: "library",
      type: "places",
    });
    expect(placesOnly.hits.every((h) => h.kind === "place")).toBe(true);

    const eventsOnly = searchRecords({
      metro: bayArea,
      spots,
      events: [event],
      query: "story",
      type: "events",
    });
    expect(eventsOnly.hits.some((h) => h.id === "event-story-time")).toBe(true);
  });
  it("returns empty for blank query and caps the limit", () => {
    expect(searchRecords({ metro: bayArea, spots, events: [], query: "  " }).count).toBe(0);
    const capped = searchRecords({
      metro: bayArea,
      spots: Array.from({ length: 100 }, (_, i) => spot({ id: `p${i}`, name: `Park ${i}` })),
      events: [],
      query: "park",
      limit: 3,
    });
    expect(capped.hits).toHaveLength(3);
  });
});
