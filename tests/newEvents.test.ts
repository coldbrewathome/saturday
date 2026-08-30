import { beforeEach, describe, expect, it } from "vitest";
import {
  NEW_EVENTS_CAP,
  readLastVisit,
  selectNewEvents,
  writeLastVisit,
} from "../src/newEvents";
import type { FamilyEvent, FeaturedPlan } from "../src/App";
import type { EventTrust } from "../src/checkinApi";

// Fixed dates keep the tests deterministic regardless of run time: Aug 15
// 2026 is a Saturday (matches the repo's current weekend fixtures).
const SAT = new Date(2026, 7, 15, 0, 0, 0);
const SUN = new Date(2026, 7, 16, 0, 0, 0);
const NOW = new Date(2026, 7, 15, 9, 0, 0); // Sat morning, before fixture starts
const LAST_VISIT = "2026-08-10T00:00:00Z";

beforeEach(() => {
  window.localStorage.clear();
});

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
    // Sat afternoon of the fixture weekend, in local time — upcoming
    // relative to NOW and inside the Sat/Sun window.
    startDateTime: "2026-08-15T15:00:00",
    fetchedAt: "2026-08-11T12:00:00Z",
    ...overrides,
  } as FamilyEvent;
}

const baseOptions = {
  lastVisit: LAST_VISIT,
  sat: SAT,
  sun: SUN,
  now: NOW,
};

describe("readLastVisit / writeLastVisit", () => {
  it("returns null when no timestamp is stored", () => {
    expect(readLastVisit()).toBeNull();
  });

  it("returns null for a garbage stored value", () => {
    window.localStorage.setItem("saturday.lastVisit", "not-a-date");
    expect(readLastVisit()).toBeNull();
  });

  it("round-trips a written timestamp", () => {
    writeLastVisit("2026-08-11T09:30:00Z");
    expect(readLastVisit()).toBe("2026-08-11T09:30:00Z");
  });
});

describe("selectNewEvents gating", () => {
  it("returns [] on first visit (null lastVisit)", () => {
    const events = [makeEvent("a")];
    expect(selectNewEvents(events, { ...baseOptions, lastVisit: null })).toEqual([]);
  });

  it("includes only events with fetchedAt strictly newer than lastVisit", () => {
    const newer = makeEvent("newer");
    const equal = makeEvent("equal", { fetchedAt: LAST_VISIT });
    const older = makeEvent("older", { fetchedAt: "2026-08-09T00:00:00Z" });
    const out = selectNewEvents([newer, equal, older], baseOptions);
    expect(out.map((e) => e.id)).toEqual(["newer"]);
  });

  it("excludes events without fetchedAt or with malformed fetchedAt", () => {
    const missing = makeEvent("missing", { fetchedAt: undefined });
    const malformed = makeEvent("malformed", { fetchedAt: "garbage" });
    const good = makeEvent("good");
    const out = selectNewEvents([missing, malformed, good], baseOptions);
    expect(out.map((e) => e.id)).toEqual(["good"]);
  });

  it("excludes events outside the Sat/Sun window (next weekend)", () => {
    const nextWeekend = makeEvent("next", { startDateTime: "2026-08-22T15:00:00" });
    const inWindow = makeEvent("in");
    const out = selectNewEvents([nextWeekend, inWindow], baseOptions);
    expect(out.map((e) => e.id)).toEqual(["in"]);
  });

  it("excludes events that have already ended", () => {
    // Saturday-morning event viewed on Sunday: isUpcomingEvent rejects it.
    const ended = makeEvent("ended", { startDateTime: "2026-08-15T08:00:00" });
    const out = selectNewEvents([ended], {
      ...baseOptions,
      now: new Date(2026, 7, 16, 12, 0, 0),
    });
    expect(out).toEqual([]);
  });

  it("excludes feed junk (board meetings, advisories)", () => {
    const junk = makeEvent("junk", { title: "Library Board Meeting" });
    const good = makeEvent("good");
    const out = selectNewEvents([junk, good], baseOptions);
    expect(out.map((e) => e.id)).toEqual(["good"]);
  });
});

describe("selectNewEvents ranking", () => {
  it("ranks marquee titles above routine titles, free above paid", () => {
    const routine = makeEvent("routine", {
      title: "Toddler Storytime Hour",
      cost: "Paid",
    });
    const free = makeEvent("free", { title: "Puppet Hour", cost: "Free" });
    const marquee = makeEvent("marquee", { title: "Bay Kids Festival" });
    const out = selectNewEvents([routine, free, marquee], baseOptions);
    expect(out.map((e) => e.id)).toEqual(["marquee", "free", "routine"]);
  });

  it("boosts editorial picks by rank when the file names the current weekend", () => {
    const plain = makeEvent("plain");
    const rank3 = makeEvent("rank3");
    const rank1 = makeEvent("rank1");
    const out = selectNewEvents([plain, rank3, rank1], {
      ...baseOptions,
      popularPicks: {
        weekendStart: "2026-08-15",
        picks: [
          { eventId: "rank3", rank: 3 },
          { eventId: "rank1", rank: 1 },
        ],
      },
    });
    expect(out.map((e) => e.id)).toEqual(["rank1", "rank3", "plain"]);
  });

  it("ignores a stale picks file (other weekend)", () => {
    // Equal scores (stale file → no boost) — earlier start must lead.
    const later = makeEvent("later", { startDateTime: "2026-08-15T18:00:00" });
    const earlier = makeEvent("earlier", { startDateTime: "2026-08-15T14:00:00" });
    const out = selectNewEvents([later, earlier], {
      ...baseOptions,
      popularPicks: {
        weekendStart: "2026-08-22",
        picks: [{ eventId: "earlier", rank: 1 }],
      },
    });
    expect(out.map((e) => e.id)).toEqual(["earlier", "later"]);
  });

  it("boosts editor picks from featured plans", () => {
    const plan: FeaturedPlan = {
      id: "p1",
      name: "Day out",
      summary: "",
      stopIds: [],
      eventIds: ["picked"],
    };
    const plain = makeEvent("plain");
    const picked = makeEvent("picked");
    const out = selectNewEvents([plain, picked], {
      ...baseOptions,
      featuredPlans: [plan],
    });
    expect(out[0].id).toBe("picked");
  });

  it("boosts trusted events from check-in aggregates", () => {
    const trusted = makeEvent("trusted");
    const plain = makeEvent("plain");
    const trust: EventTrust = { worthIt: 5, notWorthIt: 0, total: 5, trustScore: 100 };
    const out = selectNewEvents([plain, trusted], {
      ...baseOptions,
      trust: new Map([["trusted", trust]]),
    });
    expect(out[0].id).toBe("trusted");
  });

  it("breaks score ties by earlier startDateTime", () => {
    const later = makeEvent("later", { startDateTime: "2026-08-15T18:00:00" });
    const earlier = makeEvent("earlier", { startDateTime: "2026-08-15T14:00:00" });
    const out = selectNewEvents([later, earlier], baseOptions);
    expect(out.map((e) => e.id)).toEqual(["earlier", "later"]);
  });

  it("caps the section at NEW_EVENTS_CAP", () => {
    const many = Array.from({ length: NEW_EVENTS_CAP + 1 }, (_, i) =>
      makeEvent(`e${i}`, { startDateTime: `2026-08-15T1${i}:00:00` }),
    );
    const out = selectNewEvents(many, baseOptions);
    expect(out).toHaveLength(NEW_EVENTS_CAP);
  });
});
