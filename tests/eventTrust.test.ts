import { expect, it } from "vitest";
import { eventCalendarUrl, eventTrustDisplay } from "../src/eventTrust";
import type { FamilyEvent } from "../src/types";

const event = { title: "Family day", verified: true, url: "https://example.org/event", startDateTime: "2026-09-12T10:00:00-07:00" } as FamilyEvent;

it("does not present retained or recurring listings as freshly verified", () => {
  expect(eventTrustDisplay({ ...event, sourceMode: "last-known-good" })?.kind).toBe("previously-listed");
  expect(eventTrustDisplay({ ...event, sourceMode: "recurring-template" })?.kind).toBe("recurring");
});

it("does not fabricate calendar durations", () => {
  expect(eventCalendarUrl(event)).toBeNull();
  expect(eventCalendarUrl({ ...event, endDateTime: "invalid" })).toBeNull();
  expect(eventCalendarUrl({ ...event, endDateTime: "2026-09-11T10:00:00-07:00" })).toBeNull();
  const url = new URL(eventCalendarUrl({ ...event, endDateTime: "2026-09-12T12:00:00-07:00" })!);
  expect(url.searchParams.get("dates")).toBe("20260912T170000Z/20260912T190000Z");
});
