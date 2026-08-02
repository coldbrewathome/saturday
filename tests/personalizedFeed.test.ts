import { describe, expect, it } from "vitest";
import { rankEventsForFamily, type FamilyProfile } from "../src/familyProfile";
import type { FamilyEvent } from "../src/App";

function makeEvent(overrides: Partial<FamilyEvent> & { id: string }): FamilyEvent {
  return {
    title: "Weekend Event",
    description: "",
    venue: "Venue",
    city: "San Francisco",
    neighborhood: "Mission",
    lat: 37.7749,
    lon: -122.4194,
    category: "Community",
    daysOfWeek: [6],
    timeWindow: "Morning",
    ageBands: [],
    cost: "Free",
    url: "https://example.com/e",
    verified: true,
    ...overrides,
  } as FamilyEvent;
}

const profile: FamilyProfile = {
  ageBands: ["school-age", "tween"],
  zipCode: "94110",
  interests: ["stem", "animals-nature"],
  budget: "any",
  setting: "indoor",
};

describe("rankEventsForFamily", () => {
  it("preserves input order when no profile exists", () => {
    const events = [makeEvent({ id: "1" }), makeEvent({ id: "2" }), makeEvent({ id: "3" })];
    expect(rankEventsForFamily(events, { profile: null })).toEqual(events);
  });

  it("ranks age-matched events ahead of mismatched ones", () => {
    const events = [
      makeEvent({ id: "toddler-event", ageBands: ["toddler"] }),
      makeEvent({ id: "school-event", ageBands: ["school-age"] }),
    ];
    const ranked = rankEventsForFamily(events, { profile });
    expect(ranked[0].id).toBe("school-event");
  });

  it("ranks theme-matching events ahead of plain ones", () => {
    const events = [
      makeEvent({ id: "plain", themes: [] }),
      makeEvent({ id: "stem-lab", themes: ["stem"] }),
    ];
    const ranked = rankEventsForFamily(events, { profile });
    expect(ranked[0].id).toBe("stem-lab");
  });

  it("ranks indoor events ahead for an indoor-setting profile", () => {
    const events = [
      makeEvent({ id: "outdoor-fest", category: "Festival", description: "outdoor festival in the park" }),
      makeEvent({ id: "museum", category: "Museum", description: "hands-on exhibit" }),
    ];
    const ranked = rankEventsForFamily(events, { profile });
    expect(ranked[0].id).toBe("museum");
  });

  it("ranks a nearby event ahead of a far one for a home-anchored profile", () => {
    const events = [
      makeEvent({ id: "far", lat: 34.05, lon: -118.24 }),
      makeEvent({ id: "near", lat: 37.76, lon: -122.42 }),
    ];
    const ranked = rankEventsForFamily(events, {
      profile,
      home: { lat: 37.7749, lon: -122.4194 },
    });
    expect(ranked[0].id).toBe("near");
  });

  it("is stable: equal-scored events keep their relative order", () => {
    const a = makeEvent({ id: "a", ageBands: ["school-age"] });
    const b = makeEvent({ id: "b", ageBands: ["school-age"] });
    const c = makeEvent({ id: "c", ageBands: ["school-age"] });
    const ranked = rankEventsForFamily([a, b, c], { profile });
    expect(ranked.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });
});
