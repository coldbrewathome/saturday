// Plan-first hero (browse view): pickHeroFeatured chooses the suggestion the
// hero card shows — editorial rail order by default, client-side vibe
// re-ranking when a chip is active, and a hard freshness gate so a plan whose
// only content already happened never surfaces. Plus the small pure helpers
// behind the vote-tally panel and the "Verified · host" trust line.
import { describe, expect, it } from "vitest";
import {
  pickHeroFeatured,
  sourceHostname,
  summarizePollTallies,
  type FamilyEvent,
  type FeaturedPlan,
  type Spot,
} from "../src/App";
import type { PollSnapshot } from "../src/api";

function makeSpot(overrides: Partial<Spot> & { id: string }): Spot {
  return {
    name: overrides.id,
    neighborhood: "Mission",
    category: "Outdoors",
    imageUrl: "",
    cost: "Free",
    transitMinutes: 15,
    timeWindow: "Anytime",
    mood: "Easy",
    groupSize: "Family",
    planning: "Walk-in",
    openNow: true,
    note: "",
    tags: [],
    ...overrides,
  } as Spot;
}

function makeEvent(
  overrides: Partial<FamilyEvent> & { id: string; startDateTime: string },
): FamilyEvent {
  return {
    title: overrides.id,
    description: "",
    venue: "Main Library",
    city: "San Francisco",
    neighborhood: "Civic Center",
    lat: 37.78,
    lon: -122.41,
    category: "Family",
    daysOfWeek: [6],
    timeWindow: "Morning",
    ageBands: [],
    cost: "Free",
    url: "https://sfpl.org/events/storytime",
    verified: true,
    ...overrides,
  } as FamilyEvent;
}

function makePlan(
  overrides: Partial<FeaturedPlan> & { id: string },
): FeaturedPlan {
  return {
    name: overrides.id,
    summary: "A nice day out.",
    stopIds: [],
    ...overrides,
  } as FeaturedPlan;
}

const park = makeSpot({ id: "park", category: "Outdoors" });
const cafe = makeSpot({ id: "cafe", category: "Food" });
const planPark = makePlan({ id: "plan-park", stopIds: ["park"] });
const planCafe = makePlan({ id: "plan-cafe", stopIds: ["cafe"] });

const NOW = new Date("2026-06-10T12:00:00");

describe("pickHeroFeatured", () => {
  it("returns null when nothing is loaded", () => {
    expect(pickHeroFeatured([], [], [], null, undefined, NOW)).toBeNull();
  });

  it("keeps the editorial rail order without a vibe", () => {
    const pick = pickHeroFeatured(
      [planPark, planCafe],
      [park, cafe],
      [],
      null,
      undefined,
      NOW,
    );
    expect(pick?.featured.id).toBe("plan-park");
    expect(pick?.stops.map((s) => s.id)).toEqual(["park"]);
  });

  it("skips plans whose referenced items are all missing", () => {
    const ghost = makePlan({ id: "ghost", stopIds: ["nope"] });
    const pick = pickHeroFeatured(
      [ghost, planCafe],
      [park, cafe],
      [],
      null,
      undefined,
      NOW,
    );
    expect(pick?.featured.id).toBe("plan-cafe");
  });

  it("re-ranks client-side when a vibe chip is active", () => {
    const args = [[planPark, planCafe], [park, cafe], []] as const;
    expect(
      pickHeroFeatured(...args, "food-first", undefined, NOW)?.featured.id,
    ).toBe("plan-cafe");
    expect(
      pickHeroFeatured(...args, "active", undefined, NOW)?.featured.id,
    ).toBe("plan-park");
  });

  it("freshness gate: a plan whose only event has ended never surfaces", () => {
    const pastEvent = makeEvent({
      id: "past",
      startDateTime: "2026-06-06T10:00:00",
      endDateTime: "2026-06-06T12:00:00",
    });
    const futureEvent = makeEvent({
      id: "future",
      startDateTime: "2026-06-13T10:00:00",
    });
    const stalePlan = makePlan({ id: "stale", eventIds: ["past"] });
    const freshPlan = makePlan({ id: "fresh", eventIds: ["future"] });
    const pick = pickHeroFeatured(
      [stalePlan, freshPlan],
      [],
      [pastEvent, futureEvent],
      null,
      undefined,
      NOW,
    );
    expect(pick?.featured.id).toBe("fresh");
    expect(pick?.events.map((e) => e.id)).toEqual(["future"]);
    expect(
      pickHeroFeatured([stalePlan], [], [pastEvent], null, undefined, NOW),
    ).toBeNull();
  });
});

describe("summarizePollTallies", () => {
  it("sums yes votes and orders per-item counts by itemOrder", () => {
    const poll: PollSnapshot = {
      pollId: "p1",
      title: "Saturday",
      stops: [
        { id: "s1", name: "Park", neighborhood: "Mission", category: "Outdoors" },
        { id: "s2", name: "Cafe", neighborhood: "Mission", category: "Food" },
      ],
      events: [{ id: "e1", title: "Storytime", venue: "Library", city: "SF" }],
      itemOrder: [
        { kind: "event", id: "e1" },
        { kind: "spot", id: "s1" },
        { kind: "spot", id: "s2" },
      ],
      tallies: {
        s1: { up: 2, down: 0, meh: 1 },
        e1: { up: 1, down: 1, meh: 0 },
      },
      voterCount: 3,
      createdAt: "2026-06-09T00:00:00Z",
    };
    const summary = summarizePollTallies(poll);
    expect(summary.voterCount).toBe(3);
    expect(summary.totalYes).toBe(3);
    expect(summary.perItem).toEqual([
      { id: "e1", label: "Storytime", yes: 1 },
      { id: "s1", label: "Park", yes: 2 },
      { id: "s2", label: "Cafe", yes: 0 },
    ]);
  });

  it("falls back to stops-then-events order for legacy polls", () => {
    const poll: PollSnapshot = {
      pollId: "p2",
      title: "Legacy",
      stops: [
        { id: "s1", name: "Park", neighborhood: "Mission", category: "Outdoors" },
      ],
      events: [{ id: "e1", title: "Storytime", venue: "Library", city: "SF" }],
      tallies: {},
      voterCount: 0,
      createdAt: "2026-06-09T00:00:00Z",
    };
    expect(summarizePollTallies(poll).perItem.map((i) => i.id)).toEqual([
      "s1",
      "e1",
    ]);
  });
});

describe("sourceHostname", () => {
  it("strips www and returns the bare host", () => {
    expect(sourceHostname("https://www.sfpl.org/events/x")).toBe("sfpl.org");
    expect(sourceHostname("https://events.stanford.edu/e/1")).toBe(
      "events.stanford.edu",
    );
  });

  it("returns null for unparseable URLs (trust line is skipped)", () => {
    expect(sourceHostname("not-a-url")).toBeNull();
  });
});
