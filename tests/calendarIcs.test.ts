import { describe, expect, it } from "vitest";
import { buildEventIcs, buildPlanIcs } from "../src/calendarIcs";
import type { FamilyEvent, PlanItem } from "../src/types";

const base = {
  id: "miami-zoo-family-spring-festival-abcdef1234",
  title: "Spring Festival",
  description: "Live music, food trucks, and a petting zoo.",
  venue: "Zoo Miami",
  city: "Miami",
  neighborhood: "Richmond Heights",
  lat: 25.6,
  lon: -80.4,
  category: "Festival",
  daysOfWeek: [6],
  timeWindow: "Morning",
  ageBands: ["0-2", "3-5"],
  cost: "Free",
  url: "https://www.zoomiami.org/spring-fest",
  verified: true,
} as unknown as FamilyEvent;

/** RFC 5545 folding is transport detail; assertions read the logical lines. */
const unfold = (ics: string): string => ics.replace(/\r\n[ \t]/g, "");

const timed = (): FamilyEvent => ({
  ...base,
  startDateTime: "2026-10-03T14:00:00.000Z",
  endDateTime: "2026-10-03T18:00:00.000Z",
});
// Date-only feed row stamped by ingest: a ~24h span, not a real 3:00 AM start.
const allDay = (): FamilyEvent => ({
  ...base,
  startDateTime: "2026-10-03T07:00:00.000Z",
  endDateTime: "2026-10-04T06:59:00.000Z",
});

describe("buildEventIcs", () => {
  it("writes a timed event in UTC with an escaped, folded payload", () => {
    const ics = buildEventIcs(
      {
        ...timed(),
        description:
          "Live music, food trucks, and a petting zoo all afternoon plus a butterfly garden tour for the whole family.",
      },
      new Date("2026-10-01T00:00:00Z"),
    )!;
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20261003T140000Z");
    expect(ics).toContain("DTEND:20261003T180000Z");
    expect(ics).toContain("UID:miami-zoo-family-spring-festival-abcdef1234@famhop.com");
    expect(ics).toContain("DTSTAMP:20261001T000000Z");
    expect(unfold(ics)).toContain("LOCATION:Zoo Miami\\, Miami");
    // Every physical line is folded at 75 octets; continuations start with a
    // space and rejoin to the original logical line.
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(ics).toMatch(/\r\n +\S/);
    expect(unfold(ics)).toContain("butterfly garden tour for the whole family.");
  });

  it("emits date-only values for all-day rows", () => {
    const ics = buildEventIcs(allDay(), new Date("2026-10-01T00:00:00Z"))!;
    expect(ics).toContain("DTSTART;VALUE=DATE:20261003");
    // DTEND is exclusive: the day after the event's local start date.
    expect(ics).toContain("DTEND;VALUE=DATE:20261004");
    expect(ics).not.toMatch(/DTSTART:\d{8}T/);
  });

  it("escapes TEXT specials and newlines instead of breaking the file", () => {
    const ics = buildEventIcs(
      {
        ...timed(),
        title: "Storytime; songs, rhymes",
        description: "First line\nSecond line",
        endDateTime: "2026-10-03T18:00:00.000Z",
      },
      new Date("2026-10-01T00:00:00Z"),
    )!;
    expect(ics).toContain("SUMMARY:Storytime\\; songs\\, rhymes");
    expect(ics).toContain("First line\\nSecond line");
  });

  it("returns null when the event has no usable start/end", () => {
    expect(buildEventIcs({ ...base }, new Date())).toBeNull();
    expect(buildEventIcs({ ...base, startDateTime: "2026-10-03T14:00:00.000Z" }, new Date())).toBeNull();
    expect(
      buildEventIcs(
        { ...base, startDateTime: "2026-10-03T14:00:00.000Z", endDateTime: "2026-10-03T13:00:00.000Z" },
        new Date(),
      ),
    ).toBeNull();
  });
});

describe("buildPlanIcs", () => {
  const items: PlanItem[] = [
    { kind: "spot", id: "zoo", spot: { id: "zoo", name: "Zoo Miami", openingHours: "10am-5pm" } as never },
    { kind: "event", id: "a", event: timed() },
    {
      kind: "event",
      id: "b",
      event: { ...timed(), id: "b", title: "Lunch Downtown", startDateTime: "2026-10-03T19:00:00.000Z", endDateTime: "2026-10-03T20:00:00.000Z" },
    },
  ];

  it("covers the whole outing in one entry with the ordered itinerary", () => {
    const ics = buildPlanIcs(
      { name: "Zoo + lunch", items, url: "https://famhop.com/plan/abc" },
      new Date("2026-10-01T00:00:00Z"),
    )!;
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain("DTSTART:20261003T140000Z");
    expect(ics).toContain("DTEND:20261003T200000Z");
    expect(unfold(ics)).toContain("SUMMARY:FamHop plan: Zoo + lunch");
    expect(unfold(ics)).toContain("1. Zoo Miami (10am-5pm)");
    // Times render in the viewer's zone, so only the stable parts are pinned.
    expect(unfold(ics)).toMatch(/2\. \d{1,2}:\d{2} [AP]M — Spring Festival at Zoo Miami/);
    expect(unfold(ics)).toContain("Lunch Downtown");
    expect(unfold(ics)).toContain("https://famhop.com/plan/abc");
  });

  it("returns null when no item carries a time", () => {
    const spotsOnly: PlanItem[] = [
      { kind: "spot", id: "zoo", spot: { id: "zoo", name: "Zoo Miami" } as never },
    ];
    expect(buildPlanIcs({ name: "Spots only", items: spotsOnly }, new Date())).toBeNull();
  });
});
