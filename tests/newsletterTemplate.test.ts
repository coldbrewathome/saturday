import { describe, expect, it } from "vitest";
import {
  renderWeekendDigest,
  type DigestEvent,
  type DigestPlan,
} from "../worker/src/newsletter-template";

// Pin "now" to a Wednesday so the upcoming weekend is the following
// Saturday (May 23) + Sunday (May 24) in America/New_York.
const NOW = new Date("2026-05-20T15:00:00-04:00");

const plans: DigestPlan[] = [
  {
    id: "gen-day-atlanta",
    name: "Day out in Atlanta",
    summary: "3 stops in Atlanta",
    city: "Atlanta",
    eventIds: [],
  },
  {
    id: "gen-events-atlanta",
    name: "Atlanta events",
    summary: "Two upcoming events in Atlanta",
    city: "Atlanta",
    eventIds: ["evt-a", "evt-b"],
  },
  {
    id: "gen-day-decatur",
    name: "Day out in Decatur",
    summary: "3 stops in Decatur",
    city: "Decatur",
    eventIds: [],
  },
  {
    id: "gen-day-marietta",
    name: "Day out in Marietta",
    summary: "3 stops in Marietta",
    city: "Marietta",
    eventIds: [],
  },
];

const events: DigestEvent[] = [
  {
    id: "evt-sat-morning",
    title: "Sat morning museum",
    venue: "Children's Museum",
    city: "Atlanta",
    startDateTime: "2026-05-23T13:00:00.000Z", // 9am ET Sat
    url: "https://example.org/sat-morning",
  },
  {
    id: "evt-sat-afternoon",
    title: "Sat afternoon yoga",
    venue: "Museum yard",
    city: "Atlanta",
    startDateTime: "2026-05-23T18:00:00.000Z", // 2pm ET Sat
  },
  {
    id: "evt-sun",
    title: "Sun storytime",
    venue: "Decatur Library",
    city: "Decatur",
    startDateTime: "2026-05-24T15:30:00.000Z", // 11:30am ET Sun
  },
  {
    id: "evt-friday-noise",
    title: "Friday open studio",
    venue: "Studio",
    city: "Atlanta",
    startDateTime: "2026-05-22T20:00:00.000Z", // Fri — must be excluded
  },
  {
    id: "evt-next-week",
    title: "Next-week event",
    venue: "Far Future Hall",
    city: "Atlanta",
    startDateTime: "2026-05-30T18:00:00.000Z", // Sat next week — excluded
  },
];

describe("renderWeekendDigest", () => {
  it("returns subject + html + text and event/plan counts", () => {
    const out = renderWeekendDigest({
      metroId: "atlanta",
      metroLabel: "Atlanta",
      timezone: "America/New_York",
      plans,
      events,
      now: NOW,
    });

    expect(out.subject).toBe("Atlanta weekend: May 23–24");
    expect(out.planCount).toBe(3);
    expect(out.eventCount).toBe(3);
    expect(out.html).toContain("<!doctype html>");
    expect(out.html).toContain("Atlanta this weekend");
    expect(out.html).toContain("Atlanta events"); // event-bearing plan
    expect(out.html).toContain("Sat morning museum");
    expect(out.html).not.toContain("Friday open studio");
    expect(out.html).not.toContain("Next-week event");
    expect(out.text).toContain("TOP 3 PLANS");
    expect(out.text).toContain("5 THINGS HAPPENING");
    expect(out.text).toContain("Sat morning museum");
  });

  it("orders plans with events first, then fills with day-out plans", () => {
    const out = renderWeekendDigest({
      metroId: "atlanta",
      metroLabel: "Atlanta",
      timezone: "America/New_York",
      plans,
      events: [],
      now: NOW,
    });
    const eventsIdx = out.text.indexOf("Atlanta events");
    const dayOutIdx = out.text.indexOf("Day out in Atlanta");
    expect(eventsIdx).toBeGreaterThan(-1);
    expect(dayOutIdx).toBeGreaterThan(-1);
    expect(eventsIdx).toBeLessThan(dayOutIdx);
  });

  it("dedupes recurring events by baseId", () => {
    const recurring: DigestEvent[] = [
      {
        id: "evt-recur-1",
        baseId: "yoga-series",
        title: "Family yoga",
        startDateTime: "2026-05-23T14:00:00.000Z",
      },
      {
        id: "evt-recur-2",
        baseId: "yoga-series",
        title: "Family yoga",
        startDateTime: "2026-05-24T14:00:00.000Z",
      },
    ];
    const out = renderWeekendDigest({
      metroId: "atlanta",
      metroLabel: "Atlanta",
      timezone: "America/New_York",
      plans: [],
      events: recurring,
      now: NOW,
    });
    expect(out.eventCount).toBe(1);
  });

  it("renders empty-state copy when no plans or events", () => {
    const out = renderWeekendDigest({
      metroId: "atlanta",
      metroLabel: "Atlanta",
      timezone: "America/New_York",
      plans: [],
      events: [],
      now: NOW,
    });
    expect(out.planCount).toBe(0);
    expect(out.eventCount).toBe(0);
    expect(out.html).toContain("No featured plans yet");
    expect(out.html).toContain("No new family events");
    expect(out.text).toContain("(none yet");
    expect(out.text).toContain("(no events found");
  });

  it("escapes HTML in plan and event titles", () => {
    const out = renderWeekendDigest({
      metroId: "atlanta",
      metroLabel: "Atlanta",
      timezone: "America/New_York",
      plans: [{ id: "x", name: "Bobby <script>", eventIds: [] }],
      events: [
        {
          id: "e",
          title: "Tom & Jerry",
          startDateTime: "2026-05-23T14:00:00.000Z",
        },
      ],
      now: NOW,
    });
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("Bobby &lt;script&gt;");
    expect(out.html).toContain("Tom &amp; Jerry");
  });

  it("handles a Saturday 'today' (weekend is today + tomorrow)", () => {
    const sat = new Date("2026-05-23T10:00:00-04:00");
    const out = renderWeekendDigest({
      metroId: "atlanta",
      metroLabel: "Atlanta",
      timezone: "America/New_York",
      plans: [],
      events,
      now: sat,
    });
    expect(out.eventCount).toBe(3); // sat-morning, sat-afternoon, sun
    expect(out.subject).toBe("Atlanta weekend: May 23–24");
  });
});
